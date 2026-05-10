import { drawProjectBurnup, drawReqBurnup, drawCalibration, drawCFD, drawGantt } from '/charts.js';

const md = window.markdownit({ html: true, linkify: true, breaks: false }).use(window.markdownitTaskLists);
mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

const state = {
  view: 'reqs',
  selectedId: null,
  activeTab: 'design',
  data: null,
  audit: null,
  detail: null,
  charts: { project: null, req: null, calibration: null, cfd: null, gantt: null }
};

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
    ? `<div class="stat"><div class="num">${c.accuracy}%</div><div class="lbl">Estimate accuracy (n=${c.n})</div></div>`
    : `<div class="stat"><div class="num">—</div><div class="lbl">Accuracy (need history)</div></div>`;
  const wipStat = cfdSummary
    ? `<div class="stat ${cfdSummary.wipWarning ? 'warn' : ''}"><div class="num">${cfdSummary.in_progress}</div><div class="lbl">In progress${cfdSummary.wipWarning ? ' ⚠️' : ''}</div></div>`
    : '';
  el.innerHTML = `
    <div class="stat"><div class="num">${s.reqsDone}/${s.reqsTotal}</div><div class="lbl">Requirements done</div></div>
    ${wipStat}
    <div class="stat"><div class="num">${fmtK(s.actualTokens)}</div><div class="lbl">Actual tokens</div></div>
    <div class="stat"><div class="num">${fmtK(s.estimatedRange[0])}–${fmtK(s.estimatedRange[1])}</div><div class="lbl">Estimated tokens</div></div>
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
  const reqs = state.data?.requirements || [];
  document.getElementById('topReqCount').textContent = `${reqs.length} reqs`;
  const totalEst = reqs.reduce((s, r) => s + (r.estimate?.combined?.tokens?.[1] || 0), 0);
  const totalAct = reqs.reduce((s, r) => s + (r.actual?.tokens || 0), 0);
  document.getElementById('topTokens').textContent = `${fmtK(totalAct)} / ${fmtK(totalEst)} tok`;

  const history = state.data?.history || [];
  const hits = history.filter(h => {
    const e = h.estimated;
    return e && h.actual_tokens >= e.tokens?.[0] && h.actual_tokens <= e.tokens?.[1];
  }).length;
  document.getElementById('topAccuracy').textContent =
    history.length ? `accuracy: ${Math.round(hits / history.length * 100)}% (${hits}/${history.length})` : 'accuracy: —';
}

function renderReqList() {
  const reqs = (state.data?.requirements || []).slice();
  const groups = { in_progress: [], backlog: [], done: [] };
  for (const r of reqs) (groups[r.status] || groups.backlog).push(r);
  const wrap = document.getElementById('reqList');
  wrap.innerHTML = STATUS_ORDER.map(g => {
    const items = groups[g];
    if (!items.length) return '';
    return `<div class="kanban-group">${g.replace('_', ' ')} · ${items.length}</div>` +
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
  if (!state.detail) { det.innerHTML = '<div class="placeholder">Loading...</div>'; return; }
  const r = state.detail.requirement;
  const prd = state.detail.prd;

  const tabs = ['design', 'audit', 'estimate', 'history'];
  det.innerHTML = `
    <div class="detail-head">
      <h1>${esc(r.title)} <span style="font-size:13px;color:#8b949e;font-weight:400">(${r.id})</span></h1>
      <div class="meta">
        <span>status: ${r.status}</span>
        <span>progress: ${r.progress || 0}%</span>
        <span>priority: ${r.priority || 'P2'}</span>
        ${(r.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}
        <span>PRD: ${esc(r.file || '—')}</span>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(t => `<div class="tab ${state.activeTab === t ? 'active' : ''}" data-tab="${t}">${tabLabel(t)}</div>`).join('')}
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

function tabLabel(t) {
  return { design: 'Design Doc', audit: 'Design ↔ Reality', estimate: 'Estimate', history: 'History' }[t];
}

function renderDesignTab(c, r, prd) {
  if (!prd || prd.error) { c.innerHTML = `<div class="placeholder">No PRD available${prd?.error ? `: ${esc(prd.error)}` : ''}.</div>`; return; }
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
  if (!state.audit) { c.innerHTML = '<div class="placeholder">No audit data. Run /audit ' + r.id + '</div>'; return; }
  const a = state.audit;
  c.innerHTML = `
    <div class="audit-summary">
      <div class="audit-stat matched"><div class="num">${a.summary.matched}</div><div class="lbl">Matched</div></div>
      <div class="audit-stat missing"><div class="num">${a.summary.missing}</div><div class="lbl">Missing</div></div>
      <div class="audit-stat deviation"><div class="num">${a.summary.deviations}</div><div class="lbl">Deviations</div></div>
      <div class="audit-stat"><div class="num">${a.summary.completion}%</div><div class="lbl">Completion</div></div>
    </div>
    ${renderAuditMermaid(r)}
    ${renderAuditSection('Routes', a.routes, formatRoute)}
    ${renderAuditSection('Handlers', a.handlers, formatNamed)}
    ${renderAuditSection('Hooks', a.hooks, formatNamed)}
    ${renderAuditSection('DB Models', a.db_models, formatNamed)}
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
  if (!r.estimate) { c.innerHTML = '<div class="placeholder">No estimate. Run /estimate ' + r.id + '</div>'; return; }
  const cb = r.estimate.combined;
  const layers = r.estimate.layers || {};
  const actTok = r.actual?.tokens || 0;
  c.innerHTML = `
    <div class="estimate-grid">
      <div class="estimate-card">
        <h3>Tokens (combined)</h3>
        <div class="big">${fmtK(cb.tokens[0])} – ${fmtK(cb.tokens[1])}</div>
        <div class="small">actual so far: ${fmtK(actTok)} (${pct(actTok, cb.tokens[1])}% of upper)</div>
      </div>
      <div class="estimate-card">
        <h3>Hours (combined)</h3>
        <div class="big">${cb.hours[0]} – ${cb.hours[1]} h</div>
        <div class="small">confidence: ${cb.confidence}</div>
      </div>
    </div>
    <div class="chart-card" style="margin-top:18px">
      <canvas id="reqBurnupCanvas"></canvas>
    </div>
    <table class="layer-table" style="margin-top:18px">
      <tr><th>Layer</th><th>Tokens</th><th>Hours</th><th>Conf.</th><th>Note</th></tr>
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
  if (!history.length) { c.innerHTML = '<div class="placeholder">No history yet. Complete a requirement to populate.</div>'; return; }
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

for (const t of document.querySelectorAll('.topnav .navtab')) {
  t.onclick = () => setView(t.dataset.view);
}

refreshAll();
setInterval(refreshAll, 5000);
