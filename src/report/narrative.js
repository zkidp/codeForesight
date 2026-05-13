import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, ensureCodeprDir } from '../paths.js';

export async function buildNarrative(req, prd, audit, repo, opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const cacheKey = hashFor(req, prd, audit);
  const cachePath = cacheFile(repo, req.id, cacheKey);

  if (!opts.force && fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  }

  if (!apiKey || opts.skipNetwork) {
    const fallback = heuristicNarrative(req, audit);
    return { ...fallback, source: 'heuristic' };
  }

  const result = await callClaude(req, prd, audit, apiKey).catch(() => null);
  if (!result) {
    return { ...heuristicNarrative(req, audit), source: 'heuristic-fallback' };
  }

  ensureCodeprDir(repo);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(result));
  return result;
}

export async function buildProjectNarrative(reqs, summary, repo, opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const cacheKey = projectHash(reqs, summary);
  const cachePath = projectCacheFile(repo, cacheKey);

  if (!opts.force && fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  }

  if (!apiKey || opts.skipNetwork) {
    return { ...heuristicProjectNarrative(reqs, summary), source: 'heuristic' };
  }

  const model = process.env.CODEPR_AI_MODEL || 'claude-haiku-4-5-20251001';
  const reqList = reqs.map(r => {
    const tok = r.actual?.tokens || 0;
    const est = r.estimate?.combined?.tokens || [];
    return `- ${r.id} [${r.status}] ${r.title} · 进度 ${r.progress || 0}% · ${fmtK(tok)}/${fmtK(est[1] || 0)} tok`;
  }).join('\n');

  const prompt = `你是项目状态汇报员。基于下面整个项目的需求清单和汇总数据，写一段简洁的中文项目状态报告给 PM 看。

项目汇总：
- 需求总数: ${summary.reqsTotal}
- 已完成: ${summary.reqsDone}
- 进行中: ${summary.inProgress}
- 总 token 实际/估算上界: ${fmtK(summary.actualTokens)}/${fmtK(summary.estimatedUpper)}
- 估算命中率: ${summary.accuracy ?? '—'}%

需求列表:
${reqList}

返回严格 JSON 格式（不要 markdown 代码块）：
{
  "overview": "1-2 句话总结项目整体进展、token 消耗、估算准确性",
  "risks": "1-2 句话指出最需要关注的风险或瓶颈（具体到 req-id）",
  "next_steps": "1-2 句话 actionable 建议，优先级最高的下一步"
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) return { ...heuristicProjectNarrative(reqs, summary), source: 'heuristic-fallback' };
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ...heuristicProjectNarrative(reqs, summary), source: 'heuristic-fallback' };
    const parsed = JSON.parse(m[0]);
    const result = {
      overview: parsed.overview || '',
      risks: parsed.risks || '',
      next_steps: parsed.next_steps || '',
      source: 'ai'
    };
    ensureCodeprDir(repo);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(result));
    return result;
  } catch {
    return { ...heuristicProjectNarrative(reqs, summary), source: 'heuristic-fallback' };
  }
}

function heuristicProjectNarrative(reqs, summary) {
  const inProgRedFlags = reqs.filter(r =>
    r.status === 'in_progress' &&
    r.estimate?.combined?.tokens?.[1] &&
    (r.actual?.tokens || 0) > r.estimate.combined.tokens[1]
  );
  const overview = `项目共 ${summary.reqsTotal} 个需求，已完成 ${summary.reqsDone} 个、进行中 ${summary.inProgress} 个。总实际 token ${fmtK(summary.actualTokens)} / 估算上界 ${fmtK(summary.estimatedUpper)}${summary.accuracy != null ? `，估算命中率 ${summary.accuracy}%` : ''}。`;
  const risks = inProgRedFlags.length
    ? `${inProgRedFlags.length} 个进行中需求已超 token 上界：${inProgRedFlags.map(r => r.id).join(', ')}。需要重估或拆分。`
    : (summary.inProgress >= 4 ? `WIP=${summary.inProgress}，并发偏高，建议优先收敛再起新需求。` : '当前无明显风险信号。');
  const next = summary.inProgress > 0
    ? `优先推动进行中需求落地。WIP > 1 时建议串行而非并行。`
    : (summary.reqsTotal === summary.reqsDone ? '所有需求已完成。' : 'Backlog 有未启动需求，按优先级选取下一个 active。');
  return { overview, risks, next_steps: next };
}

function projectHash(reqs, summary) {
  const h = crypto.createHash('sha256');
  h.update(String(summary.reqsTotal));
  h.update(String(summary.reqsDone));
  h.update(String(summary.actualTokens));
  for (const r of reqs) {
    h.update(r.id);
    h.update(r.status);
    h.update(String(r.actual?.tokens || 0));
  }
  return h.digest('hex').slice(0, 12);
}

function projectCacheFile(repo, hash) {
  return path.join(paths(repo).base, 'cache', 'narratives', `project-${hash}.json`);
}

function heuristicNarrative(req, audit) {
  const sum = audit?.summary || { matched: 0, missing: 0, deviations: 0, completion: 0 };
  const tokActual = req.actual?.tokens || 0;
  const tokUpper = req.estimate?.combined?.tokens?.[1] || 0;
  const overBudget = tokUpper && tokActual > tokUpper;

  const current = `当前状态：${req.status}，进度 ${req.progress || 0}%。已消耗 ${fmtK(tokActual)} tokens（估算上界 ${fmtK(tokUpper)}）${overBudget ? '，已超出估算上界 ⚠️' : ''}。`;
  const completion = sum.matched + sum.missing > 0
    ? `设计↔实现：${sum.matched} 项已落地，${sum.missing} 项尚未实现，完成度 ${sum.completion}%。${sum.deviations ? `有 ${sum.deviations} 项偏离原设计。` : ''}`
    : `尚未通过 audit 检测，运行 codepr audit ${req.id} 获取设计↔实现对照。`;
  const next = sum.missing > 0
    ? `下一步建议：补齐缺失的 ${sum.missing} 项，可考虑跑 codepr scaffold ${req.id} 生成空骨架。`
    : (req.status === 'done' ? '需求已完成。' : '验收清单尚未完全勾选，关注剩余 todo 项。');

  return {
    current_state: current,
    missing: completion,
    next_steps: next,
    source: 'heuristic'
  };
}

async function callClaude(req, prd, audit, apiKey) {
  const model = process.env.CODEPR_AI_MODEL || 'claude-haiku-4-5-20251001';
  const sum = audit?.summary || {};
  const missingList = collectMissing(audit).slice(0, 12).join(', ') || '(无)';
  const matchedList = collectMatched(audit).slice(0, 8).join(', ') || '(无)';

  const prompt = `你是项目状态汇报员。基于下面的数据，写一段简洁的中文状态报告给 PM 看。

需求 ID: ${req.id}
标题: ${req.title}
状态: ${req.status}
进度: ${req.progress || 0}%
估算: ${fmtK(req.estimate?.combined?.tokens?.[0] || 0)}-${fmtK(req.estimate?.combined?.tokens?.[1] || 0)} tokens
实际消耗: ${fmtK(req.actual?.tokens || 0)} tokens
设计↔实现完成度: ${sum.completion ?? 0}%
已实现组件: ${matchedList}
缺失组件: ${missingList}

PRD 摘要（前 600 字）:
${(prd?.body || '').slice(0, 600)}

返回严格 JSON 格式（不要包代码块、不要前后文）：
{
  "current_state": "1-2 句话总结当前状态、消耗、与估算的对比",
  "missing": "1-2 句话说明设计↔实现差距，列出最关键的 1-2 项缺失",
  "next_steps": "1-2 句具体建议，必须 actionable"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    return {
      current_state: parsed.current_state || '',
      missing: parsed.missing || '',
      next_steps: parsed.next_steps || '',
      source: 'ai'
    };
  } catch { return null; }
}

function collectMissing(audit) {
  if (!audit) return [];
  const out = [];
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    for (const m of (audit[cat]?.missing || [])) {
      out.push(m.name || (m.method ? `${m.method} ${m.path}` : JSON.stringify(m.ref)));
    }
  }
  return out;
}

function collectMatched(audit) {
  if (!audit) return [];
  const out = [];
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    for (const m of (audit[cat]?.matched || [])) {
      out.push(m.name || (m.method ? `${m.method} ${m.path}` : ''));
    }
  }
  return out.filter(Boolean);
}

function hashFor(req, prd, audit) {
  const h = crypto.createHash('sha256');
  h.update(req.id);
  h.update(String(req.status));
  h.update(String(req.progress || 0));
  h.update(String(req.actual?.tokens || 0));
  h.update(String(prd?.raw?.length || 0));
  h.update(String(audit?.summary?.matched || 0));
  h.update(String(audit?.summary?.missing || 0));
  return h.digest('hex').slice(0, 12);
}

function cacheFile(repo, reqId, hash) {
  return path.join(paths(repo).base, 'cache', 'narratives', `${reqId}-${hash}.json`);
}

function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }
