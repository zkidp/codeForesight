// Mermaid 渲染策略（v0.3 MVP）：
// 浏览器端渲染 — 把 markdown-it 输出里 <pre><code class="language-mermaid">...</code></pre>
// 改写为 <div class="mermaid">...</div>，由 CDN 的 mermaid runtime 在页面加载时渲染。
// v0.4 升级方案：fetch 一次 mermaid.min.js 缓存到 .codepr/cache/assets/ 并 inline 进 HTML。

export function rewriteMermaidInHtml(html, auditStates) {
  const stateAttr = auditStates
    ? ` data-mm-states='${escAttr(JSON.stringify(auditStates))}'`
    : '';
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_m, code) => `<div class="mermaid-svg"${stateAttr}><div class="mermaid">${decodeEntities(code)}</div></div>`
  );
}

function escAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildAuditMermaidHtml(mermaidBlocks, auditResult) {
  // 不再单独渲染 mermaid 块（避免与 PRD 设计文档 section 重复）。
  // 状态着色现在通过 rewriteMermaidInHtml 的 data-mm-states 直接应用在 PRD 区域的图上。
  return '';
}

export function buildAuditStateMap(auditResult) {
  return buildStateMap(auditResult);
}

function buildStateMap(auditResult) {
  const map = {};
  if (!auditResult) return map;
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    const d = auditResult[cat];
    if (!d) continue;
    for (const m of d.matched || []) {
      const k = pickKey(m);
      if (k) map[k.toLowerCase()] = m.deviation ? 'deviation' : 'ok';
    }
    for (const m of d.missing || []) {
      const k = pickKey(m);
      if (k) map[k.toLowerCase()] = 'missing';
    }
  }
  return map;
}

function pickKey(m) {
  if (m.name) return m.name;
  if (m.path) return m.path.replace(/^\//, '').replace(/[/:]/g, '_');
  return null;
}

export const MERMAID_PAGE_SCRIPT = `
(function () {
  if (!window.mermaid) return;
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

  async function renderAll() {
    const nodes = document.querySelectorAll('.mermaid');
    for (const node of nodes) {
      const code = node.textContent;
      const id = 'mm-' + Math.random().toString(36).slice(2);
      try {
        const { svg } = await mermaid.render(id, code);
        node.innerHTML = svg;
      } catch (e) {
        node.innerHTML = '<pre style="color:#f85149">mermaid render error: ' + (e.message || e) + '</pre>';
      }
    }
    // 状态着色：在任何带 data-mm-states 的容器内，按文本匹配着色节点
    document.querySelectorAll('[data-mm-states]').forEach(wrap => {
      let stateMap = {};
      try { stateMap = JSON.parse(wrap.dataset.mmStates || '{}'); } catch {}
      const gnodes = wrap.querySelectorAll('g.node');
      for (const n of gnodes) {
        const text = (n.textContent || '').trim().toLowerCase();
        for (const [k, v] of Object.entries(stateMap)) {
          const cleanK = k.replace(/^(post|get|put|delete|patch)_/i, '');
          if (cleanK && text.includes(cleanK)) { n.classList.add('node-' + v); break; }
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll);
  } else {
    renderAll();
  }
})();
`;

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
