import { drawProjectBurnup, drawReqBurnup, drawCalibration, drawCFD, drawGantt } from '/charts.js';

const md = window.markdownit({ html: true, linkify: true, breaks: false }).use(window.markdownitTaskLists);

const state = {
  view: 'reqs',
  selectedId: null,
  activeTab: 'design',
  data: null,
  audit: null,
  detail: null,
  charts: { project: null, req: null, calibration: null, cfd: null, gantt: null },
  lang: 'zh',
  theme: 'dark',
  locales: { zh: {}, en: {} }
};

// 启动时拉 CC 主题 + locales
async function bootSettings() {
  try {
    const cfg = await fetchJSON('/api/settings');
    state.locales = cfg.locales || { zh: {}, en: {} };
    state.lang = (localStorage.getItem('codeforesight.lang') || cfg.lang || 'zh');
    let theme = localStorage.getItem('codeforesight.theme') || cfg.theme || 'dark';
    if (theme === 'system') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    state.theme = theme;
    applyLangAndTheme();
  } catch (e) { console.error('boot settings', e); }
}

function t(key, params) {
  const dict = state.locales[state.lang] || {};
  const fallback = state.locales.zh || {};
  let s = dict[key] != null ? dict[key] : (fallback[key] != null ? fallback[key] : key);
  if (params) for (const [k, v] of Object.entries(params)) {
    s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
  }
  return s;
}
window.__T__ = t;

function applyLangAndTheme() {
  document.documentElement.lang = state.lang;
  document.documentElement.dataset.theme = state.theme;
  mermaid.initialize({ startOnLoad: false, theme: state.theme === 'light' ? 'default' : 'dark', securityLevel: 'loose' });
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === state.lang));
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === state.theme));
  // 触发图表重绘
  if (state.view === 'overview') refreshOverview();
  if (state.selectedId) renderDetail();
  renderTopStats();
  renderReqList();
}

document.querySelectorAll('.lang-btn').forEach(b => {
  b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    try { localStorage.setItem('codeforesight.lang', state.lang); } catch {}
    applyLangAndTheme();
  });
});
document.querySelectorAll('.theme-btn').forEach(b => {
  b.addEventListener('click', () => {
    state.theme = b.dataset.theme;
    try { localStorage.setItem('codeforesight.theme', state.theme); } catch {}
    applyLangAndTheme();
  });
});

const STATUS_ORDER = ['in_progress', 'backlog', 'done'];

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function refreshAll() {
  state.data = await fetchJSON('/api/state');
  renderTopStats();
  renderReqList();
  if (state.view === 'overview') await refreshOverview();
  if (state.selectedId) await refreshDetail();
}

async function refreshOverview() {
  try {
    const [burn, calib, cfd, gantt] = await Promise.all([
      fetchJSON('/api/charts/project-burnup'),
      fetchJSON('/api/charts/calibration'),
      fetchJSON('/api/charts/cfd'),
      fetchJSON('/api/charts/gantt')
    ]);
    const burnCanvas = document.getElementById('projectBurnupCanvas');
    if (burnCanvas) state.charts.project = drawProjectBurnup(burnCanvas, burn, state.charts.project);
    const calCanvas = document.getElementById('calibrationCanvas');
    if (calCanvas) state.charts.calibration = drawCalibration(calCanvas, calib, state.charts.calibration);
    const cfdCanvas = document.getElementById('cfdCanvas');
    if (cfdCanvas) state.charts.cfd = drawCFD(cfdCanvas, cfd, state.charts.cfd);
    const ganttCanvas = document.getElementById('ganttCanvas');
    if (ganttCanvas) {
      const rows = gantt.rows?.length || 0;
      ganttCanvas.parentElement.style.height = `${Math.max(220, rows * 36 + 80)}px`;
      state.charts.gantt = drawGantt(ganttCanvas, gantt, state.charts.gantt);
    }
    renderOverviewSummary(burn.summary, calib.summary, cfd.summary);
  } catch (e) { console.error('overview refresh', e); }
}

function renderOverviewSummary(s, c, cfdSummary) {
  const el = document.getElementById('overviewSummary');
  if (!el || !s) return;
  const calibStat = c && c.n > 0
    ? `<div class="stat"><div class="num">${c.accuracy}%</div><div class="lbl">${t('dashboard.stat.accuracy')} (n=${c.n})</div></div>`
    : `<div class="stat"><div class="num">—</div><div class="lbl">${t('dashboard.stat.accuracy_need_history')}</div></div>`;
  const wipStat = cfdSummary
    ? `<div class="stat ${cfdSummary.wipWarning ? 'warn' : ''}"><div class="num">${cfdSummary.in_progress}</div><div class="lbl">${cfdSummary.wipWarning ? t('dashboard.stat.in_progress_warn') : t('dashboard.stat.in_progress')}</div></div>`
    : '';
  el.innerHTML = `
    <div class="stat"><div class="num">${s.reqsDone}/${s.reqsTotal}</div><div class="lbl">${t('dashboard.stat.reqs_done')}</div></div>
    ${wipStat}
    <div class="stat"><div class="num">${fmtK(s.actualTokens)}</div><div class="lbl">${t('dashboard.stat.actual_tokens')}</div></div>
    <div class="stat"><div class="num">${fmtK(s.estimatedRange[0])}–${fmtK(s.estimatedRange[1])}</div><div class="lbl">${t('dashboard.stat.estimated_range')}</div></div>
    ${calibStat}
  `;
}

function setView(view) {
  state.view = view;
  for (const t of document.querySelectorAll('.topnav .navtab')) {
    t.classList.toggle('active', t.dataset.view === view);
  }
  document.querySelector('main').hidden = view !== 'reqs';
  document.getElementById('overview').hidden = view !== 'overview';
  if (view === 'overview') refreshOverview();
}

async function refreshDetail() {
  if (!state.selectedId) return;
  state.detail = await fetchJSON('/api/req?id=' + encodeURIComponent(state.selectedId));
  state.audit = await fetchJSON('/api/audit?id=' + encodeURIComponent(state.selectedId)).catch(() => null);
  renderDetail();
}

function renderTopStats() {
  if (!state.data) return;
  const reqs = state.data?.requirements || [];
  document.getElementById('topReqCount').textContent = t('report.req_card.chip_requirements', { n: reqs.length });
  const totalEst = reqs.reduce((s, r) => s + (r.estimate?.combined?.tokens?.[1] || 0), 0);
  const totalAct = reqs.reduce((s, r) => s + (r.actual?.tokens || 0), 0);
  document.getElementById('topTokens').textContent = `${fmtK(totalAct)} / ${fmtK(totalEst)} tok`;

  const history = state.data?.history || [];
  const hits = history.filter(h => {
    const e = h.estimated;
    return e && h.actual_tokens >= e.tokens?.[0] && h.actual_tokens <= e.tokens?.[1];
  }).length;
  document.getElementById('topAccuracy').textContent =
    history.length ? `${t('dashboard.stat.accuracy')}: ${Math.round(hits / history.length * 100)}% (${hits}/${history.length})` : `${t('dashboard.stat.accuracy_need_history')}`;
}

function renderReqList() {
  if (!state.data) return;
  const reqs = (state.data?.requirements || []).slice();
  const groups = { in_progress: [], backlog: [], done: [] };
  for (const r of reqs) (groups[r.status] || groups.backlog).push(r);
  const wrap = document.getElementById('reqList');
  const groupLabels = {
    in_progress: t('dashboard.kanban.in_progress'),
    backlog: t('dashboard.kanban.backlog'),
    done: t('dashboard.kanban.done')
  };
  wrap.innerHTML = STATUS_ORDER.map(g => {
    const items = groups[g];
    if (!items.length) return '';
    return `<div class="kanban-group">${groupLabels[g]} · ${items.length}</div>` +
      items.map(r => renderCard(r)).join('');
  }).join('');
  for (const el of wrap.querySelectorAll('.req-card')) {
    el.onclick = () => selectReq(el.dataset.id);
  }
}

function renderCard(r) {
  const tok = r.estimate?.combined?.tokens;
  const tokFmt = tok ? `~${fmtK(tok[0])}-${fmtK(tok[1])}tok` : '';
  const isActive = r.id === state.selectedId;
  return `
  <div class="req-card ${r.status} ${isActive ? 'active' : ''}" data-id="${r.id}">
    <div class="row1">
      <span class="id">${r.id}</span>
      <span class="badge ${r.status}">${r.status}</span>
    </div>
    <div class="title">${esc(r.title)}</div>
    <div style="font-size:11px;color:#8b949e;">${tokFmt} · ${r.progress || 0}%</div>
    <div class="progress-bar"><div style="width:${r.progress || 0}%"></div></div>
  </div>`;
}

async function selectReq(id) {
  state.selectedId = id;
  renderReqList();
  await refreshDetail();
}

function setTab(tab) {
  state.activeTab = tab;
  renderDetail();
}

function renderDetail() {
  const det = document.getElementById('detail');
  if (!state.detail) { det.innerHTML = `<div class="placeholder">${t('dashboard.empty.loading')}</div>`; return; }
  const r = state.detail.requirement;
  const prd = state.detail.prd;

  const tabs = ['design', 'audit', 'estimate', 'history'];
  det.innerHTML = `
    <div class="detail-head">
      <h1>${esc(r.title)} <span style="font-size:13px;color:var(--text-muted);font-weight:400">(${r.id})</span></h1>
      <div class="meta">
        <span>${t('dashboard.detail.meta.status', { v: r.status })}</span>
        <span>${t('dashboard.detail.meta.progress', { v: r.progress || 0 })}</span>
        <span>${t('dashboard.detail.meta.priority', { v: r.priority || 'P2' })}</span>
        ${(r.tags || []).map(tg => `<span>#${esc(tg)}</span>`).join('')}
        <span>${t('dashboard.detail.meta.prd', { v: esc(r.file || '—') })}</span>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(tab => `<div class="tab ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">${tabLabel(tab)}</div>`).join('')}
    </div>
    <div class="tab-content" id="tabContent"></div>
  `;
  for (const el of det.querySelectorAll('.tab')) {
    el.onclick = () => setTab(el.dataset.tab);
  }
  const c = document.getElementById('tabContent');
  if (state.activeTab === 'design') renderDesignTab(c, r, prd);
  else if (state.activeTab === 'audit') renderAuditTab(c, r);
  else if (state.activeTab === 'estimate') renderEstimateTab(c, r);
  else if (state.activeTab === 'history') renderHistoryTab(c, r);
}

function tabLabel(tab) {
  return {
    design: t('dashboard.tab.design'),
    audit: t('dashboard.tab.audit'),
    estimate: t('dashboard.tab.estimate'),
    history: t('dashboard.tab.history')
  }[tab];
}

function renderDesignTab(c, r, prd) {
  if (!prd || prd.error) { c.innerHTML = `<div class="placeholder">${t('dashboard.detail.no_prd')}${prd?.error ? `: ${esc(prd.error)}` : ''}.</div>`; return; }
  const html = md.render(prd.body || '');
  c.innerHTML = `<div class="markdown-body">${html}</div>`;
  for (const el of c.querySelectorAll('pre code')) {
    if (el.className.includes('mermaid') || el.parentElement?.querySelector('code.language-mermaid')) {}
  }
  // Render mermaid blocks: markdown-it leaves them as <pre><code class="language-mermaid">…</code></pre>
  const blocks = c.querySelectorAll('code.language-mermaid');
  blocks.forEach(async (block, i) => {
    const code = block.textContent;
    const wrap = document.createElement('div');
    wrap.className = 'mermaid-wrap';
    wrap.id = `mm-${i}-${Date.now()}`;
    block.parentElement.replaceWith(wrap);
    try {
      const { svg } = await mermaid.render(`mmid-${i}-${Date.now()}`, code);
      wrap.innerHTML = svg;
    } catch (e) { wrap.textContent = '[mermaid render error] ' + e.message; }
  });
}

function renderAuditTab(c, r) {
  if (!state.audit) { c.innerHTML = `<div class="placeholder">${t('dashboard.detail.no_audit', { id: r.id })}</div>`; return; }
  const a = state.audit;
  c.innerHTML = `
    <div class="audit-summary">
      <div class="audit-stat matched"><div class="num">${a.summary.matched}</div><div class="lbl">${t('report.audit.matched')}</div></div>
      <div class="audit-stat missing"><div class="num">${a.summary.missing}</div><div class="lbl">${t('report.audit.missing')}</div></div>
      <div class="audit-stat deviation"><div class="num">${a.summary.deviations}</div><div class="lbl">${t('report.audit.deviations')}</div></div>
      <div class="audit-stat"><div class="num">${a.summary.completion}%</div><div class="lbl">${t('report.audit.completion')}</div></div>
    </div>
    ${renderAuditMermaid(r)}
    ${renderAuditSection(t('report.audit.section.routes'), a.routes, formatRoute)}
    ${renderAuditSection(t('report.audit.section.handlers'), a.handlers, formatNamed)}
    ${renderAuditSection(t('report.audit.section.hooks'), a.hooks, formatNamed)}
    ${renderAuditSection(t('report.audit.section.db_models'), a.db_models, formatNamed)}
  `;
  applyMermaidStateColoring();
}

function renderAuditMermaid(r) {
  const prd = state.detail?.prd;
  if (!prd?.mermaid?.length) return '';
  return prd.mermaid.map((code, i) => `<div class="mermaid-wrap" data-mm-idx="${i}" id="audit-mm-${i}">${esc(code)}</div>`).join('');
}

async function applyMermaidStateColoring() {
  const wraps = document.querySelectorAll('.mermaid-wrap[data-mm-idx]');
  if (!wraps.length) return;
  const a = state.audit;
  const stateMap = new Map();
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    for (const m of a[cat].matched) {
      const k = m.name || (m.path ? `${m.method}_${m.path}` : null);
      if (k) stateMap.set(k.toLowerCase(), m.deviation ? 'deviation' : 'ok');
    }
    for (const m of a[cat].missing) {
      const k = m.name || (m.path ? `${m.method}_${m.path}` : null);
      if (k) stateMap.set(k.toLowerCase(), 'missing');
    }
  }
  for (const wrap of wraps) {
    const code = wrap.textContent;
    try {
      const { svg } = await mermaid.render(`mmid-audit-${wrap.dataset.mmIdx}-${Date.now()}`, code);
      wrap.innerHTML = svg;
      const nodes = wrap.querySelectorAll('g.node');
      for (const n of nodes) {
        const text = (n.textContent || '').trim().toLowerCase();
        for (const [k, v] of stateMap) {
          if (text.includes(k.replace(/^post_|^get_|^put_|^delete_|^patch_/, ''))) {
            n.classList.add(`node-${v}`);
            break;
          }
        }
      }
    } catch (e) { wrap.textContent = '[mermaid render error] ' + e.message; }
  }
}

function renderAuditSection(title, d, fmt) {
  const all = [
    ...d.matched.map(x => ({ ...x, _state: x.deviation ? 'deviation' : 'matched' })),
    ...d.missing.map(x => ({ ...x, _state: 'missing' }))
  ];
  if (!all.length) return '';
  return `
    <div class="audit-section">
      <h3>${title}</h3>
      <table class="audit-table">
        ${all.map(x => `
          <tr class="${x._state}">
            <td class="status">${x._state === 'matched' ? '✅' : x._state === 'deviation' ? '⚠️' : '❌'}</td>
            <td>${fmt(x)}</td>
            <td class="file">${esc(x.file || '')}</td>
          </tr>`).join('')}
      </table>
    </div>`;
}

function formatRoute(x) { return `<code>${esc(x.method || 'ANY')} ${esc(x.path)}</code>${x.deviation ? ' — ' + esc(x.deviation) : ''}`; }
function formatNamed(x) { return `<code>${esc(x.name || JSON.stringify(x.ref))}</code>${x.deviation ? ' — ' + esc(x.deviation) : ''}`; }

function renderEstimateTab(c, r) {
  if (!r.estimate) { c.innerHTML = `<div class="placeholder">${t('dashboard.detail.no_estimate', { id: r.id })}</div>`; return; }
  const cb = r.estimate.combined;
  const layers = r.estimate.layers || {};
  const actTok = r.actual?.tokens || 0;
  c.innerHTML = `
    <div class="estimate-grid">
      <div class="estimate-card">
        <h3>${t('cli.estimate.tokens')}</h3>
        <div class="big">${fmtK(cb.tokens[0])} – ${fmtK(cb.tokens[1])}</div>
        <div class="small">${t('cli.req.actual')}: ${fmtK(actTok)} (${pct(actTok, cb.tokens[1])}%)</div>
      </div>
      <div class="estimate-card">
        <h3>${t('cli.estimate.hours')}</h3>
        <div class="big">${cb.hours[0]} – ${cb.hours[1]} h</div>
        <div class="small">${t('cli.req.confidence')}: ${cb.confidence}</div>
      </div>
    </div>
    <div class="chart-card" style="margin-top:18px">
      <canvas id="reqBurnupCanvas"></canvas>
    </div>
    <table class="layer-table" style="margin-top:18px">
      <tr><th>Layer</th><th>${t('cli.estimate.tokens')}</th><th>${t('cli.estimate.hours')}</th><th>${t('cli.req.confidence')}</th><th>${t('cli.estimate.reasoning')}</th></tr>
      ${Object.entries(layers).map(([name, l]) => `
        <tr>
          <td><b>${name}</b></td>
          <td>${l.tokens ? `${fmtK(l.tokens[0])}–${fmtK(l.tokens[1])}` : '—'}</td>
          <td>${l.hours ? `${l.hours[0]}–${l.hours[1]}` : '—'}</td>
          <td>${l.confidence ?? '—'}</td>
          <td>${esc(l.reasoning || l.reason || '')}</td>
        </tr>`).join('')}
    </table>
  `;
  refreshReqBurnup(r.id);
}

async function refreshReqBurnup(id) {
  try {
    const data = await fetchJSON('/api/charts/req-burnup?id=' + encodeURIComponent(id));
    const canvas = document.getElementById('reqBurnupCanvas');
    if (canvas) state.charts.req = drawReqBurnup(canvas, data, state.charts.req);
  } catch (e) { console.error('req-burnup', e); }
}

function renderHistoryTab(c, r) {
  const history = state.data?.history || [];
  if (!history.length) { c.innerHTML = `<div class="placeholder">${t('dashboard.detail.no_history')}</div>`; return; }
  c.innerHTML = `<div class="history-list">${history.map(h => `
    <div class="history-row">
      <span style="font-family:ui-monospace,monospace;color:#8b949e">${esc(h.id)}</span>
      <span style="flex:1">${esc(h.title || '')}</span>
      <span>${fmtK(h.actual_tokens)} tok</span>
      <span>${h.actual_hours} h</span>
      <span style="color:#8b949e">${esc((h.tags || []).join(', '))}</span>
    </div>`).join('')}</div>`;
}

function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }
function pct(a, b) { if (!b) return 0; return Math.round(a / b * 100); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

for (const el of document.querySelectorAll('.topnav .navtab')) {
  el.onclick = () => setView(el.dataset.view);
}

// SSE 实时推送：hook 写文件 → 服务器 fs.watch → 推送 → dashboard 立即刷新
// 失败时降级为 5 秒轮询
let sseRef = null;
let pollTimer = null;
let lastEventAt = 0;

function connectSSE() {
  try {
    sseRef = new EventSource('/api/events');
    sseRef.onmessage = (e) => {
      lastEventAt = Date.now();
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'change') refreshAll();
      } catch {}
    };
    sseRef.onerror = () => {
      // 连接断开时降级到轮询
      try { sseRef?.close(); } catch {}
      sseRef = null;
      if (!pollTimer) pollTimer = setInterval(refreshAll, 5000);
      // 5s 后尝试重连
      setTimeout(() => {
        if (!sseRef) {
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          connectSSE();
        }
      }, 5000);
    };
  } catch {
    // 浏览器不支持 EventSource —— 永久降级
    if (!pollTimer) pollTimer = setInterval(refreshAll, 5000);
  }
}

// 启动顺序：先取 lang + theme + locales，再做首次刷新，最后接 SSE
(async () => {
  await bootSettings();
  await refreshAll();
  connectSSE();
  // 兜底：30 秒强制刷新一次，避免 SSE 漏推
  setInterval(() => {
    if (Date.now() - lastEventAt > 30_000) refreshAll();
  }, 30_000);
})();
