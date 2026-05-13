import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, ensureCodeprDir, findRepoRoot } from '../paths.js';
import { getRequirement, loadRequirements, loadHistory } from '../store.js';
import { parsePRD } from '../prd-parser.js';
import { auditRequirement } from '../scanner/diff.js';
import { reqBurnup, projectBurnup, cfd, gantt, calibration } from '../charts/timeseries.js';
import { extractSnippet, renderSnippetHtml } from './snippets.js';
import { renderMarkdown } from './minimal-md.js';
import { rewriteMermaidInHtml, buildAuditMermaidHtml, buildAuditStateMap, MERMAID_PAGE_SCRIPT } from './mermaid-static.js';
import { buildNarrative, buildProjectNarrative } from './narrative.js';
import { inlineAssets } from './inline-assets.js';
import { readCCTheme } from './cc-settings.js';
import { mergeProjectArchitecture } from './mermaid-merger.js';
import { t, setLang, detectLang, loadAllLocales } from '../i18n/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TPL_DIR = path.join(__dirname, 'templates');
const VERSION = '0.4.0';

function resolveLang(opts) {
  const lang = opts?.lang || detectLang();
  setLang(lang);
  return lang;
}

function resolveTheme(opts) {
  if (opts?.theme === 'light' || opts?.theme === 'dark') return opts.theme;
  return readCCTheme(); // 'dark' | 'light' | 'system'
}

function readTpl(name) {
  return fs.readFileSync(path.join(TPL_DIR, name), 'utf8');
}

export async function generateReqReport(repo, reqId, opts = {}) {
  const r = getRequirement(reqId, repo);
  if (!r) throw new Error(t('cli.req.not_found', { id: reqId }));
  if (!r.file) throw new Error(t('cli.req.no_prd'));

  const lang = resolveLang(opts);
  const theme = resolveTheme(opts);

  const prd = parsePRD(path.resolve(repo, r.file));
  const audit = auditRequirement(prd, repo);
  const burnup = reqBurnup(repo, reqId);
  const narrative = await buildNarrative(r, prd, audit, repo, opts);
  const inline = await inlineAssets(repo, opts);

  const template = readTpl('req.html');
  const styles = readTpl('styles.css');
  const controlsScript = readTpl('controls.js');
  const locales = loadAllLocales();

  const html = template
    .replace(/\{\{title\}\}/g, esc(r.title))
    .replace('{{titleSuffix}}', t('report.title_suffix'))
    .replace('{{lang}}', lang)
    .replace('{{lang}}', lang)
    .replace('{{theme}}', theme)
    .replace('{{theme}}', theme)
    .replace('{{styles}}', styles)
    .replace('{{reqId}}', esc(r.id))
    .replace('{{metaChips}}', buildMetaChips(r))
    .replace('{{headStats}}', buildHeadStats(r, audit))
    .replace('{{narrativeSectionTitle}}', t('report.section.narrative'))
    .replace('{{narrative}}', buildNarrativeHtml(narrative))
    .replace('{{prdSectionTitle}}', t('report.section.prd'))
    .replace('{{prdHtml}}', buildPrdHtml(prd, audit))
    .replace('{{auditSectionTitle}}', t('report.section.audit'))
    .replace('{{auditSummary}}', buildAuditSummary(audit))
    .replace('{{auditMermaid}}', '')
    .replace('{{auditTables}}', buildAuditTables(audit))
    .replace('{{burnupSectionTitle}}', t('report.section.burnup'))
    .replace('{{snippetsSectionTitle}}', t('report.section.snippets'))
    .replace('{{snippets}}', buildSnippets(repo, audit))
    .replace('{{dataJson}}', JSON.stringify({ burnup }))
    .replace('{{i18nJson}}', JSON.stringify(locales))
    .replace('{{inlineLibs}}', inline.scripts || `<!-- inline libs unavailable: ${inline.error || 'unknown'} -->`)
    .replace('{{controlsScript}}', controlsScript)
    .replace('{{version}}', VERSION)
    .replace('{{footVersion}}', t('report.foot.version', { v: VERSION }))
    .replace('{{footGenerated}}', t('report.foot.generated_at', { ts: new Date().toISOString() }))
    .replace('{{footSnapshot}}', t('report.foot.snapshot_at', { ts: r.actual?.last_at || r.created_at || '—' }));

  const withMermaidScript = html.replace('</body>', `<script>${MERMAID_PAGE_SCRIPT}</script>\n</body>`);

  ensureCodeprDir(repo);
  const reportsDir = path.join(paths(repo).base, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const outFile = path.join(reportsDir, `${reqId}.html`);
  fs.writeFileSync(outFile, withMermaidScript);
  return { outFile, narrative, inlineSizeKb: inline.sizeKb, lang, theme };
}

export async function generateProjectReport(repo, opts = {}) {
  const data = loadRequirements(repo);
  const reqs = data.requirements;
  if (!reqs.length) throw new Error('no requirements registered — run `codeforesight req add <file.md>` first');

  const lang = resolveLang(opts);
  const theme = resolveTheme(opts);

  const burnup = projectBurnup(repo);
  const cfdData = cfd(repo);
  const calibData = calibration(repo);
  const ganttData = gantt(repo);

  const summary = {
    reqsTotal: reqs.length,
    reqsDone: reqs.filter(r => r.status === 'done').length,
    inProgress: reqs.filter(r => r.status === 'in_progress').length,
    backlog: reqs.filter(r => r.status === 'backlog').length,
    actualTokens: reqs.reduce((s, r) => s + (r.actual?.tokens || 0), 0),
    estimatedUpper: reqs.reduce((s, r) => s + (r.estimate?.combined?.tokens?.[1] || 0), 0),
    estimatedLower: reqs.reduce((s, r) => s + (r.estimate?.combined?.tokens?.[0] || 0), 0),
    accuracy: calibData.summary?.n > 0 ? calibData.summary.accuracy : null,
    maxWIP: cfdData.summary?.maxInProgress || 0
  };

  const narrative = await buildProjectNarrative(reqs, summary, repo, opts);
  const inline = await inlineAssets(repo, opts);

  // 合并所有 PRD 的 flowchart 为项目大图
  const prdsForMerge = reqs.map(r => {
    if (!r.file) return null;
    let prd, audit;
    try { prd = parsePRD(path.resolve(repo, r.file)); } catch { return null; }
    try { audit = auditRequirement(prd, repo); } catch {}
    return { reqId: r.id, prd, audit, status: r.status };
  }).filter(Boolean);
  const merged = mergeProjectArchitecture(prdsForMerge);
  const architectureHtml = merged.empty
    ? `<p style="color:var(--text-muted)">${t('report.architecture.empty')}</p>`
    : `<div class="prd-body">
         <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${t('report.architecture.legend', { nodes: merged.nodeCount, edges: merged.edgeCount })}</p>
         <div class="mermaid-svg"><div class="mermaid">${escMermaid(merged.mermaid)}</div></div>
       </div>`;

  const template = readTpl('project.html');
  const styles = readTpl('styles.css');
  const chartScript = readTpl('project-charts.js');
  const controlsScript = readTpl('controls.js');
  const locales = loadAllLocales();

  const dataJson = JSON.stringify({ burnup, cfd: cfdData, calibration: calibData, gantt: ganttData });
  const ganttHeight = Math.max(240, reqs.length * 36 + 80);
  const projectName = path.basename(repo) || 'codeForesight Project';

  const html = template
    .replace(/\{\{projectName\}\}/g, esc(projectName))
    .replace('{{titleSuffix}}', t('report.title_suffix'))
    .replace('{{lang}}', lang)
    .replace('{{lang}}', lang)
    .replace('{{theme}}', theme)
    .replace('{{theme}}', theme)
    .replace('{{styles}}', styles)
    .replace('{{headerKicker}}', `PROJECT REPORT · codeForesight v${VERSION}`)
    .replace('{{projectChips}}', buildProjectChips(summary))
    .replace('{{projectStats}}', buildProjectStats(summary))
    .replace('{{projectNarrativeTitle}}', t('report.section.project_narrative'))
    .replace('{{projectNarrative}}', buildProjectNarrativeHtml(narrative))
    .replace('{{archSectionTitle}}', t('report.section.architecture'))
    .replace('{{architectureHtml}}', architectureHtml)
    .replace('{{burnupSectionTitle}}', t('report.section.project_burnup'))
    .replace('{{cfdSectionTitle}}', t('report.section.cfd'))
    .replace('{{calibSectionTitle}}', t('report.section.calibration'))
    .replace('{{ganttSectionTitle}}', t('report.section.gantt'))
    .replace('{{reqListSectionTitle}}', t('report.section.req_list'))
    .replace('{{reqCards}}', buildReqCards(reqs, repo))
    .replace('{{ganttHeight}}', String(ganttHeight))
    .replace('{{dataJson}}', dataJson)
    .replace('{{i18nJson}}', JSON.stringify(locales))
    .replace('{{inlineLibs}}', inline.scripts || `<!-- inline libs unavailable: ${inline.error || 'unknown'} -->`)
    .replace('{{controlsScript}}', controlsScript)
    .replace('{{chartScript}}', chartScript)
    .replace('{{version}}', VERSION)
    .replace('{{footVersion}}', t('report.foot.version', { v: VERSION }))
    .replace('{{footGenerated}}', t('report.foot.generated_at', { ts: new Date().toISOString() }))
    .replace('{{footReqCount}}', t('report.foot.req_count', { n: reqs.length }))
    .replace('{{footType}}', t('report.foot.type', { v: t('report.head.report_type_project') }));

  const withMermaidScript = html.replace('</body>', `<script>${MERMAID_PAGE_SCRIPT}</script>\n</body>`);

  ensureCodeprDir(repo);
  const reportsDir = path.join(paths(repo).base, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const outFile = path.join(reportsDir, 'index.html');
  fs.writeFileSync(outFile, withMermaidScript);
  return { outFile, narrative, summary, inlineSizeKb: inline.sizeKb, lang, theme, mergedArch: merged };
}

function buildMetaChips(r) {
  const chips = [
    `<span class="chip status-${r.status}">${r.status}</span>`,
    `<span class="chip priority-${r.priority || 'P2'}">${r.priority || 'P2'}</span>`,
    `<span class="chip">${r.progress || 0}%</span>`,
    ...(r.tags || []).map(t => `<span class="chip">#${esc(t)}</span>`)
  ];
  return chips.join('');
}

function buildHeadStats(r, audit) {
  const est = r.estimate?.combined;
  const tokActual = r.actual?.tokens || 0;
  const tokUpper = est?.tokens?.[1] || 0;
  const overBudget = tokUpper && tokActual > tokUpper;
  const tokClass = overBudget ? 'over' : (tokUpper && tokActual > tokUpper * 0.8 ? 'warn' : 'ok');

  return `
    <div class="stat">
      <div class="stat-lbl">${t('report.head.estimated_tokens')}</div>
      <div class="stat-val">${est ? `${fmtK(est.tokens[0])}–${fmtK(est.tokens[1])}` : '—'}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">${t('report.head.actual_tokens')}</div>
      <div class="stat-val ${tokClass}">${fmtK(tokActual)}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">${t('report.head.estimated_hours')}</div>
      <div class="stat-val">${est ? `${est.hours[0]}–${est.hours[1]} h` : '—'}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">${t('report.head.completion')}</div>
      <div class="stat-val ${audit?.summary?.completion >= 80 ? 'ok' : audit?.summary?.completion >= 40 ? 'warn' : 'over'}">${audit?.summary?.completion ?? 0}%</div>
    </div>`;
}

function buildProjectChips(s) {
  return [
    `<span class="chip">${t('report.req_card.chip_requirements', { n: s.reqsTotal })}</span>`,
    `<span class="chip status-done">${t('report.req_card.chip_done', { n: s.reqsDone })}</span>`,
    `<span class="chip status-in_progress">${t('report.req_card.chip_in_progress', { n: s.inProgress })}</span>`,
    `<span class="chip">${t('report.req_card.chip_backlog', { n: s.backlog })}</span>`,
    s.maxWIP >= 4 ? `<span class="chip" style="border-color:var(--warning);color:var(--warning)">${t('report.req_card.chip_wip_warn', { n: s.maxWIP })}</span>` : ''
  ].join('');
}

function buildProjectStats(s) {
  const tokRatio = s.estimatedUpper ? Math.round(s.actualTokens / s.estimatedUpper * 100) : 0;
  const tokClass = tokRatio > 100 ? 'over' : tokRatio > 80 ? 'warn' : 'ok';
  const accClass = s.accuracy == null ? '' : s.accuracy >= 70 ? 'ok' : s.accuracy >= 40 ? 'warn' : 'over';
  return `
    <div class="stat">
      <div class="stat-lbl">${t('report.head.actual_estimate')}</div>
      <div class="stat-val ${tokClass}">${fmtK(s.actualTokens)} / ${fmtK(s.estimatedUpper)}</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">${t('report.head.req_progress')}</div>
      <div class="stat-val">${s.reqsDone}/${s.reqsTotal} (${Math.round(s.reqsDone / s.reqsTotal * 100)}%)</div>
    </div>
    <div class="stat">
      <div class="stat-lbl">${t('report.head.estimate_accuracy')}</div>
      <div class="stat-val ${accClass}">${s.accuracy != null ? s.accuracy + '%' : '—'}</div>
    </div>`;
}

function buildNarrativeHtml(n) {
  if (!n) return `<p class="narrative-empty">${t('report.narrative.empty')}</p>`;
  const sourceTag = n.source === 'ai'
    ? `<span style="font-size:11px;color:var(--purple)">${t('report.narrative.source_ai')}</span>`
    : `<span style="font-size:11px;color:var(--text-muted)">${t('report.narrative.source_heuristic')}</span>`;
  return `
    <div class="narrative-section">
      <div class="narrative-label">${t('report.narrative.current_state')}</div>
      <p>${escLight(n.current_state || '')}</p>
    </div>
    <div class="narrative-section">
      <div class="narrative-label">${t('report.narrative.missing')}</div>
      <p>${escLight(n.missing || '')}</p>
    </div>
    <div class="narrative-section">
      <div class="narrative-label">${t('report.narrative.next_steps')}</div>
      <p>${escLight(n.next_steps || '')}</p>
    </div>
    <div style="text-align:right;margin-top:8px">${sourceTag}</div>`;
}

function buildProjectNarrativeHtml(n) {
  if (!n) return `<p class="narrative-empty">${t('report.narrative.empty')}</p>`;
  const tag = n.source === 'ai'
    ? `<span style="font-size:11px;color:var(--purple)">${t('report.narrative.source_ai')}</span>`
    : `<span style="font-size:11px;color:var(--text-muted)">${t('report.narrative.source_heuristic_short')}</span>`;
  return `
    <div class="narrative-section">
      <div class="narrative-label">${t('report.narrative.overview')}</div>
      <p>${escLight(n.overview || '')}</p>
    </div>
    <div class="narrative-section">
      <div class="narrative-label">${t('report.narrative.risks')}</div>
      <p>${escLight(n.risks || '')}</p>
    </div>
    <div class="narrative-section">
      <div class="narrative-label">${t('report.narrative.next_steps')}</div>
      <p>${escLight(n.next_steps || '')}</p>
    </div>
    <div style="text-align:right;margin-top:8px">${tag}</div>`;
}

function buildPrdHtml(prd, audit) {
  const html = renderMarkdown(prd.body || '');
  const stateMap = audit ? buildAuditStateMap(audit) : null;
  return rewriteMermaidInHtml(html, stateMap);
}

function buildAuditSummary(audit) {
  if (!audit) return '';
  const s = audit.summary;
  return `
    <div class="audit-stat matched"><div class="num">${s.matched}</div><div class="lbl">${t('report.audit.matched')}</div></div>
    <div class="audit-stat missing"><div class="num">${s.missing}</div><div class="lbl">${t('report.audit.missing')}</div></div>
    <div class="audit-stat deviation"><div class="num">${s.deviations}</div><div class="lbl">${t('report.audit.deviations')}</div></div>
    <div class="audit-stat"><div class="num">${s.completion}%</div><div class="lbl">${t('report.audit.completion')}</div></div>`;
}

function buildAuditTables(audit) {
  if (!audit) return '';
  const titleMap = {
    routes: t('report.audit.section.routes'),
    handlers: t('report.audit.section.handlers'),
    hooks: t('report.audit.section.hooks'),
    db_models: t('report.audit.section.db_models')
  };
  return Object.entries(titleMap).map(([cat, title]) => {
    const d = audit[cat];
    if (!d) return '';
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
              <td class="status-col">${x._state === 'matched' ? '✅' : x._state === 'deviation' ? '⚠️' : '❌'}</td>
              <td>${formatItem(cat, x)}</td>
              <td class="file">${esc(x.file || '')}</td>
            </tr>`).join('')}
        </table>
      </div>`;
  }).join('');
}

function formatItem(cat, m) {
  if (cat === 'routes') return `<code>${esc(m.method || 'ANY')} ${esc(m.path)}</code>${m.deviation ? ' — ' + esc(m.deviation) : ''}`;
  return `<code>${esc(m.name || JSON.stringify(m.ref))}</code>${m.deviation ? ' — ' + esc(m.deviation) : ''}`;
}

function buildSnippets(repo, audit) {
  if (!audit) return `<p style="color:var(--text-muted)">${t('report.snippets.no_audit')}</p>`;
  const out = [];
  for (const m of (audit.handlers?.matched || []).slice(0, 4)) {
    if (!m.file || !m.name) continue;
    const snip = extractSnippet(repo, m.file, m.name);
    if (snip) out.push(renderSnippetHtml(snip));
  }
  if (!out.length) return `<p style="color:var(--text-muted)">${t('report.snippets.empty')}</p>`;
  return out.join('');
}

function buildReqCards(reqs, repo) {
  return reqs.map(r => {
    const tok = r.actual?.tokens || 0;
    const est = r.estimate?.combined?.tokens || [];
    const tokClass = est[1] && tok > est[1] ? 'over' : '';
    let summary = '';
    try {
      if (r.file) {
        const prd = parsePRD(path.resolve(repo, r.file));
        summary = extractPlainSummary(prd.body || '', 180);
      }
    } catch {}
    const linkPath = `./${r.id}.html`;
    return `
      <div class="req-card-pr ${r.status}">
        <div class="pr-id">${esc(r.id)}</div>
        <div class="pr-title">${esc(r.title)}</div>
        <div class="pr-bar"><div style="width:${r.progress || 0}%"></div></div>
        <div class="pr-stats">
          <div>${t('report.req_card.status')}<span class="val">${esc(r.status)}</span></div>
          <div>${t('report.req_card.progress')}<span class="val">${r.progress || 0}%</span></div>
          <div>${t('report.req_card.actual_token')}<span class="val ${tokClass}">${fmtK(tok)}</span></div>
          <div>${t('report.req_card.estimate_upper')}<span class="val">${fmtK(est[1] || 0)}</span></div>
        </div>
        ${summary ? `<div class="pr-summary">${esc(summary)}</div>` : ''}
        <a class="pr-link" href="${esc(linkPath)}">${t('report.req_card.view_full')}</a>
      </div>`;
  }).join('');
}

function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escMermaid(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escLight(s) { return esc(s).replace(/\n/g, '<br>'); }

function extractPlainSummary(body, maxLen) {
  let s = body;
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/~~~[\s\S]*?~~~/g, ' ');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/^#{1,6}\s+.*$/gm, ' ');
  s = s.replace(/^[\t ]*[-*]\s+\[[ xX]\]\s+/gm, '');
  s = s.replace(/^[\t ]*[-*]\s+/gm, '');
  s = s.replace(/^[\t ]*\d+\.\s+/gm, '');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}
