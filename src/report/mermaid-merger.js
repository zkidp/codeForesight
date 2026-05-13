// 把多个 PRD 的 mermaid flowchart 块合并成项目级架构图。
//
// 支持范围（MVP）：
//   - flowchart / graph 类型（带方向 LR/TD/TB/RL/BT）
//   - 节点声明：`id`、`id[Label]`、`id{Label}`、`id(Label)`、`id((Label))`
//   - 边：`-->`、`---`、`-.->`、`==>`、`-- text -->`、`--> text --`、`-->|text|`
//   - 跳过：sequenceDiagram、classDiagram 等非 flow 类型；subgraph 块（剥离外壳保留内部节点）
//
// 输出：单个 `flowchart LR` 字符串 + 每个节点关联的 req-id 列表。

import { parsePRD } from '../prd-parser.js';
import path from 'node:path';

const FLOW_TYPES = ['flowchart', 'graph'];

function detectType(code) {
  const first = (code.split(/\r?\n/).find(l => l.trim()) || '').trim().toLowerCase();
  for (const t of FLOW_TYPES) {
    if (first.startsWith(t)) return t;
  }
  return null;
}

// 解析单个 flowchart 块
function parseFlowchart(code) {
  const nodes = new Map(); // id → { label, shape }
  const edges = []; // { from, to, label, arrow }
  const lines = code.split(/\r?\n/);

  let skipSubgraphDepth = 0;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // 第一行类型声明
    if (FLOW_TYPES.some(t => line.toLowerCase().startsWith(t))) continue;
    // subgraph 块边界：跳过外壳但保留内部节点
    if (line.toLowerCase().startsWith('subgraph')) { skipSubgraphDepth++; continue; }
    if (line === 'end' && skipSubgraphDepth > 0) { skipSubgraphDepth--; continue; }
    // 样式声明等跳过
    if (/^(classDef|class|style|linkStyle|click)\b/i.test(line)) continue;

    // 尝试匹配边
    const edge = parseEdge(line);
    if (edge) {
      registerNodeRef(nodes, edge.from);
      registerNodeRef(nodes, edge.to);
      edges.push({ from: edge.from.id, to: edge.to.id, label: edge.label, arrow: edge.arrow });
      continue;
    }

    // 单独节点声明
    const node = parseNode(line);
    if (node) registerNodeRef(nodes, node);
  }
  return { nodes, edges };
}

function registerNodeRef(nodes, ref) {
  if (!ref) return;
  const existing = nodes.get(ref.id);
  if (!existing) nodes.set(ref.id, { label: ref.label || ref.id, shape: ref.shape || 'rect' });
  else if (ref.label && existing.label === existing.id) existing.label = ref.label;
}

// 解析节点：`id`、`id[Label]`、`id(Label)`、`id{Label}`、`id((Label))`
function parseNode(text) {
  text = text.trim();
  if (!text) return null;
  let m;
  m = text.match(/^([A-Za-z0-9_-]+)\s*\[\(([^)\]]+)\)\]\s*$/); // stadium
  if (m) return { id: m[1], label: m[2], shape: 'stadium' };
  m = text.match(/^([A-Za-z0-9_-]+)\s*\(\(([^)]+)\)\)\s*$/); // circle
  if (m) return { id: m[1], label: m[2], shape: 'circle' };
  m = text.match(/^([A-Za-z0-9_-]+)\s*\[([^\]]+)\]\s*$/); // rect
  if (m) return { id: m[1], label: m[2], shape: 'rect' };
  m = text.match(/^([A-Za-z0-9_-]+)\s*\(([^)]+)\)\s*$/); // rounded
  if (m) return { id: m[1], label: m[2], shape: 'round' };
  m = text.match(/^([A-Za-z0-9_-]+)\s*\{([^}]+)\}\s*$/); // rhombus
  if (m) return { id: m[1], label: m[2], shape: 'rhombus' };
  m = text.match(/^([A-Za-z0-9_-]+)\s*$/); // 单纯 id
  if (m) return { id: m[1], label: m[1], shape: 'rect' };
  return null;
}

// 解析边：返回 { from, to, label, arrow }
function parseEdge(text) {
  const arrows = [
    { re: /-->/,    type: '-->' },
    { re: /==>/,    type: '==>' },
    { re: /-\.->/,  type: '-.->' },
    { re: /---/,    type: '---' },
    { re: /==/,     type: '==' }
  ];
  for (const a of arrows) {
    const arrowMatch = text.match(a.re);
    if (!arrowMatch) continue;
    const arrowIdx = arrowMatch.index;
    const arrowLen = arrowMatch[0].length;
    let lhs = text.slice(0, arrowIdx).trim();
    let rhs = text.slice(arrowIdx + arrowLen).trim();
    // 可能的 `|label|` 紧跟箭头
    let label = '';
    const lblPipe = rhs.match(/^\|([^|]+)\|\s*/);
    if (lblPipe) { label = lblPipe[1]; rhs = rhs.slice(lblPipe[0].length).trim(); }
    const from = parseNode(lhs);
    const to = parseNode(rhs);
    if (!from || !to) continue;
    return { from, to, label, arrow: a.type };
  }
  return null;
}

// 把状态映射成 mermaid 节点 class
function stateToClass(state) {
  if (state === 'missing') return 'mm-missing';
  if (state === 'deviation') return 'mm-deviation';
  if (state === 'ok' || state === 'matched') return 'mm-ok';
  return null;
}

// 跨需求合并：worst-state 优先（missing > deviation > matched）
function worsestState(a, b) {
  const order = { missing: 3, deviation: 2, ok: 1 };
  if (!a) return b;
  if (!b) return a;
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}

// 主入口：把多个 PRD 的 mermaid + 各自 audit 合并成大图
//   prdsWithAudit: [ { reqId, prd, audit, status } ]
// 返回 { mermaid: '...', sources: { nodeId: [reqId,...] }, stateMap: { nodeId: state } }
export function mergeProjectArchitecture(prdsWithAudit) {
  const allNodes = new Map(); // id → { label, shape }
  const allEdges = new Map(); // `${from}|${to}` → { from, to, label }
  const sources = new Map();  // node id → Set<reqId>
  const stateMap = new Map(); // node id → 'ok' | 'missing' | 'deviation'

  for (const { reqId, prd, audit, status } of prdsWithAudit) {
    if (!prd?.mermaid?.length) continue;
    for (const block of prd.mermaid) {
      if (!detectType(block)) continue;
      const { nodes, edges } = parseFlowchart(block);
      for (const [id, info] of nodes) {
        if (!allNodes.has(id)) allNodes.set(id, info);
        if (!sources.has(id)) sources.set(id, new Set());
        sources.get(id).add(reqId);
        // 状态着色：先看 audit 是否提到这个 id 或 label
        const stateForThisReq = inferState(id, info.label, audit, status);
        if (stateForThisReq) {
          stateMap.set(id, worsestState(stateMap.get(id), stateForThisReq));
        }
      }
      for (const e of edges) {
        const key = `${e.from}|${e.to}`;
        if (!allEdges.has(key)) allEdges.set(key, e);
        else if (e.label && !allEdges.get(key).label) allEdges.get(key).label = e.label;
      }
    }
  }

  if (!allNodes.size) {
    return { mermaid: '', sources: {}, stateMap: {}, empty: true };
  }

  // 生成 mermaid 文本
  const lines = ['flowchart LR'];
  for (const [id, info] of allNodes) {
    const sourceList = [...(sources.get(id) || [])].sort();
    const tooltip = sourceList.length > 1 ? ` 〔${sourceList.join(', ')}〕` : '';
    const labelText = escapeMermaidLabel(info.label) + tooltip;
    lines.push(`  ${id}${renderShape(info.shape, labelText)}`);
  }
  for (const { from, to, label, arrow } of allEdges.values()) {
    const arr = arrow || '-->';
    if (label) lines.push(`  ${from} ${arr}|${escapeMermaidLabel(label)}| ${to}`);
    else lines.push(`  ${from} ${arr} ${to}`);
  }

  // classDef 声明（页面 CSS 也有覆盖）
  lines.push('  classDef mm-ok fill:#1c4d2c,stroke:#56d364,color:#fff;');
  lines.push('  classDef mm-missing fill:#4d1c22,stroke:#f85149,color:#fff;');
  lines.push('  classDef mm-deviation fill:#4d3a1c,stroke:#d29922,color:#fff;');
  for (const [id, state] of stateMap) {
    const cls = stateToClass(state);
    if (cls) lines.push(`  class ${id} ${cls};`);
  }

  return {
    mermaid: lines.join('\n'),
    sources: Object.fromEntries([...sources].map(([k, v]) => [k, [...v]])),
    stateMap: Object.fromEntries(stateMap),
    nodeCount: allNodes.size,
    edgeCount: allEdges.size,
    empty: false
  };
}

function renderShape(shape, label) {
  switch (shape) {
    case 'circle':   return `((${label}))`;
    case 'stadium':  return `[(${label})]`;
    case 'round':    return `(${label})`;
    case 'rhombus':  return `{${label}}`;
    case 'rect':
    default:         return `[${label}]`;
  }
}

function escapeMermaidLabel(s) {
  return String(s).replace(/[\[\]\{\}\(\)|"]/g, ' ').trim();
}

// 推断节点状态：根据 audit 结果在 routes / handlers / hooks / db_models 里找
function inferState(nodeId, label, audit, reqStatus) {
  if (!audit) {
    // 没有 audit 时根据 req status 给颜色：done → ok, in_progress → ok（暂不区分），backlog → missing
    if (reqStatus === 'done') return 'ok';
    if (reqStatus === 'in_progress') return null; // 不确定
    if (reqStatus === 'backlog') return 'missing';
    return null;
  }
  const idLower = String(nodeId).toLowerCase();
  const lblLower = String(label || '').toLowerCase();
  const matches = (item, kind) => {
    const candidates = [];
    if (kind === 'routes') candidates.push(item.path?.toLowerCase());
    if (item.name) candidates.push(item.name.toLowerCase());
    if (typeof item.ref === 'string') candidates.push(item.ref.toLowerCase());
    return candidates.some(c => c && (c.includes(idLower) || c.includes(lblLower) || idLower.includes(c) || lblLower.includes(c)));
  };
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    const d = audit[cat];
    if (!d) continue;
    for (const m of d.matched || []) if (matches(m, cat)) return m.deviation ? 'deviation' : 'ok';
    for (const m of d.missing || []) if (matches(m, cat)) return 'missing';
  }
  return null;
}

// 给定 repo 路径，自动加载所有需求并合并
export function mergeFromRepo(reqs, repo, auditFn) {
  const prdsWithAudit = [];
  for (const r of reqs) {
    if (!r.file) continue;
    let prd, audit;
    try { prd = parsePRD(path.resolve(repo, r.file)); } catch { continue; }
    try { audit = auditFn ? auditFn(prd) : null; } catch { audit = null; }
    prdsWithAudit.push({ reqId: r.id, prd, audit, status: r.status });
  }
  return mergeProjectArchitecture(prdsWithAudit);
}
