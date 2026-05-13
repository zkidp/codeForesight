#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, paths, ensureCodeprDir } from '../src/paths.js';
import {
  loadConfig, loadRequirements, saveRequirements,
  upsertRequirement, getRequirement, removeRequirement,
  writeActiveReq, readActiveReq, appendEvent, appendHistory
} from '../src/store.js';
import { parsePRD } from '../src/prd-parser.js';
import { estimate } from '../src/estimator/combine.js';
import { auditRequirement } from '../src/scanner/diff.js';
import { t, setLang, detectLang } from '../src/i18n/index.js';

const rawArgs = process.argv.slice(2);
const langIdx = rawArgs.findIndex(a => a === '--lang');
if (langIdx >= 0 && rawArgs[langIdx + 1]) {
  setLang(rawArgs[langIdx + 1]);
  rawArgs.splice(langIdx, 2);
} else {
  setLang(detectLang());
}
const args = rawArgs;
const cmd = args[0];
const rest = args.slice(1);
const repo = findRepoRoot();

main().catch(err => {
  console.error(`codepr: ${err.message}`);
  process.exit(1);
});

async function main() {
  switch (cmd) {
    case 'req':       return reqCmd(rest);
    case 'estimate':  return estimateCmd(rest);
    case 'progress':  return progressCmd(rest);
    case 'sync':      return syncCmd(rest);
    case 'audit':     return auditCmd(rest);
    case 'scaffold':  return scaffoldCmd(rest);
    case 'status':    return statusCmd();
    case 'report':    return reportCmd(rest);
    case 'seed-demo': return seedDemoCmd();
    case 'seed-real': return seedRealCmd();
    case 'snapshot': return snapshotCmd(rest);
    case 'diff':     return diffCmd(rest);
    case 'help':
    case undefined:   return helpCmd();
    default:
      console.error(`Unknown command: ${cmd}`);
      helpCmd();
      process.exit(1);
  }
}

async function reportCmd(args) {
  const force = args.includes('--force');
  const skipNetwork = args.includes('--no-network');
  const all = args.includes('--all');
  const themeIdx = args.indexOf('--theme');
  const theme = themeIdx >= 0 ? args[themeIdx + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--theme');

  const { generateReqReport, generateProjectReport } = await import('../src/report/generator.js');

  if (all) {
    const { outFile, narrative, summary, inlineSizeKb } = await generateProjectReport(repo, { force, skipNetwork, theme });
    console.log(t('cli.report.generated', { file: outFile }));
    console.log('   ' + t('cli.report.project_summary', { total: summary.reqsTotal, done: summary.reqsDone, wip: summary.inProgress }));
    console.log('   ' + t('cli.report.narrative_source', { source: narrative?.source || 'n/a' }));
    console.log('   ' + (inlineSizeKb ? t('cli.report.inlined', { kb: inlineSizeKb }) : t('cli.report.inlined_skipped')));
    console.log('   ' + t('cli.report.open_with', { path: outFile.replace(/\\/g, '/') }));
    return;
  }

  const id = positional[0];
  if (!id) throw new Error(t('cli.report.usage'));
  const { outFile, narrative, inlineSizeKb } = await generateReqReport(repo, id, { force, skipNetwork, theme });
  console.log(t('cli.report.generated', { file: outFile }));
  console.log('   ' + t('cli.report.narrative_source', { source: narrative?.source || 'n/a' }));
  console.log('   ' + (inlineSizeKb ? t('cli.report.inlined', { kb: inlineSizeKb }) : t('cli.report.inlined_skipped')));
  console.log('   ' + t('cli.report.open_with', { path: outFile.replace(/\\/g, '/') }));
}

function seedRealCmd() {
  // Dogfood: 把 codePR 自己的开发历程作为真实数据回填进去。
  // 数据基于 docs/PROGRESS.md 的里程碑和实际花费的相对时间。
  const data = loadRequirements(repo);
  const now = Date.now();
  const hours = h => new Date(now - h * 3_600_000).toISOString();

  const config = {
    'req-001': { status: 'done',        tokens: 82000, startedHoursAgo: 78, durationH: 16, progress: 100 },
    'req-002': { status: 'done',        tokens: 58000, startedHoursAgo: 56, durationH: 12, progress: 100 },
    'req-003': { status: 'done',        tokens: 71000, startedHoursAgo: 36, durationH: 14, progress: 100 },
    'req-004': { status: 'in_progress', tokens: 38000, startedHoursAgo: 10, durationH: null, progress: 85 },
  };

  let touched = 0;
  for (const r of data.requirements) {
    const cfg = config[r.id];
    if (!cfg) continue;
    r.status = cfg.status;
    r.progress = cfg.progress;
    r.created_at = hours(cfg.startedHoursAgo + 4);
    r.actual = r.actual || {};
    r.actual.started_at = hours(cfg.startedHoursAgo);
    r.actual.tokens = cfg.tokens;
    if (cfg.status === 'done') {
      const completedHoursAgo = cfg.startedHoursAgo - (cfg.durationH || 8);
      r.actual.completed_at = hours(Math.max(0, completedHoursAgo));
      r.actual.last_at = r.actual.completed_at;
      r.actual.hours = cfg.durationH;
    } else {
      r.actual.last_at = hours(0);
    }

    // 生成事件流：8-12 个 tool_use 事件分布在工期内
    const burst = 9 + Math.floor(Math.random() * 4);
    let consumed = 0;
    const target = cfg.tokens;
    const span = cfg.startedHoursAgo - (cfg.status === 'done' ? Math.max(0, cfg.startedHoursAgo - cfg.durationH) : 0);
    for (let i = 0; i < burst; i++) {
      let portion = i === burst - 1
        ? Math.max(0, target - consumed)
        : Math.round(target * (0.05 + Math.random() * 0.16));
      if (consumed + portion > target) portion = Math.max(0, target - consumed);
      consumed += portion;
      const tsAgo = cfg.startedHoursAgo - (i + 1) * (span / (burst + 1));
      appendEvent({
        ts: hours(tsAgo),
        type: 'tool_use',
        req: r.id,
        session_id: `real-${r.id}`,
        tool: ['Edit', 'Write', 'Read', 'Bash', 'Grep'][i % 5],
        tokens: portion
      }, repo);
    }

    // 完成后归档 history
    if (cfg.status === 'done') {
      appendHistory({
        id: r.id,
        title: r.title,
        tags: r.tags,
        actual_tokens: cfg.tokens,
        actual_hours: cfg.durationH,
        estimated: r.estimate?.combined,
        prd: { title: r.title, body: '', tags: r.tags }
      }, repo);
    }
    upsertRequirement(r, repo);
    touched++;
  }
  console.log(t('cli.seed_real.done', { n: touched }));
  console.log(t('cli.seed_real.legend'));
}

function seedDemoCmd() {
  const data = loadRequirements(repo);
  if (!data.requirements.length) throw new Error('register at least one PRD with `codepr req add` first');
  const now = Date.now();
  const hours = h => new Date(now - h * 3_600_000).toISOString();
  seedDemoHistory(now);

  const reqs = data.requirements;
  for (let idx = 0; idx < reqs.length; idx++) {
    const r = reqs[idx];
    const upper = r.estimate?.combined?.tokens?.[1] || 50000;
    const target = Math.round(upper * (0.3 + Math.random() * 0.6));
    const burst = 8 + Math.floor(Math.random() * 6);
    const startHoursAgo = (reqs.length - idx) * 18 + 6;
    const markDone = idx < Math.floor(reqs.length / 2);

    r.actual = r.actual || {};
    r.actual.started_at = hours(startHoursAgo);
    r.actual.tokens = 0;
    r.actual.tool_calls = 0;
    r.status = markDone ? 'done' : 'in_progress';
    r.created_at = hours(startHoursAgo + 6);

    let consumed = 0;
    for (let i = 0; i < burst; i++) {
      let portion = i === burst - 1
        ? Math.max(0, target - consumed)
        : Math.round(target * (0.05 + Math.random() * 0.15));
      if (consumed + portion > target) portion = Math.max(0, target - consumed);
      consumed += portion;
      const tsAgo = startHoursAgo - (i + 1) * (startHoursAgo / (burst + 1));
      const evt = {
        ts: hours(tsAgo),
        type: 'tool_use',
        req: r.id,
        session_id: `demo-${r.id}`,
        tool: ['Edit', 'Read', 'Bash', 'Grep'][i % 4],
        tokens: portion
      };
      appendEvent(evt, repo);
    }
    r.actual.tokens = consumed;
    r.actual.tool_calls = burst;
    r.actual.last_at = hours(0);
    if (markDone) {
      r.actual.completed_at = hours(Math.max(0, startHoursAgo - burst));
      r.progress = 100;
    } else {
      r.progress = Math.round((consumed / upper) * 100);
    }
    upsertRequirement(r, repo);
  }
  console.log(t('cli.seed_demo.events', { n: data.requirements.length }));
}

function seedDemoHistory(now) {
  const samples = [
    { id: 'demo-001', title: '用户注册', tags: ['auth', 'backend'], midTok: 18000, midH: 3 },
    { id: 'demo-002', title: 'CSV 导入', tags: ['ingest'], midTok: 12000, midH: 2 },
    { id: 'demo-003', title: '权限 RBAC', tags: ['auth', 'backend'], midTok: 35000, midH: 6 },
    { id: 'demo-004', title: '邮件通知', tags: ['notification'], midTok: 9000, midH: 1.5 },
    { id: 'demo-005', title: '订单结算', tags: ['payment'], midTok: 42000, midH: 7.5 },
    { id: 'demo-006', title: '搜索建议', tags: ['ui', 'backend'], midTok: 16000, midH: 2.5 },
    { id: 'demo-007', title: '日志归档', tags: ['infra'], midTok: 22000, midH: 4 },
    { id: 'demo-008', title: '密码重置', tags: ['auth'], midTok: 11000, midH: 2 }
  ];
  ensureCodeprDir(repo);
  const histPath = paths(repo).history;
  const lines = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const hoursAgo = (samples.length - i) * 24 + Math.random() * 12;
    const ts = new Date(now - hoursAgo * 3_600_000).toISOString();
    const lower = Math.round(s.midTok * 0.6);
    const upper = Math.round(s.midTok * 1.6);
    const noise = 0.7 + Math.random() * 0.7;
    const actualTok = Math.round(s.midTok * noise);
    const actualH = Math.round(s.midH * noise * 10) / 10;
    lines.push(JSON.stringify({
      ts,
      id: s.id,
      title: s.title,
      tags: s.tags,
      actual_tokens: actualTok,
      actual_hours: actualH,
      estimated: {
        tokens: [lower, upper],
        hours: [Math.round(s.midH * 0.6 * 10) / 10, Math.round(s.midH * 1.6 * 10) / 10],
        confidence: 0.5
      },
      prd: { title: s.title, body: '', tags: s.tags }
    }));
  }
  fs.appendFileSync(histPath, lines.join('\n') + '\n');
  console.log(t('cli.seed_demo.history', { n: samples.length }));
}

async function snapshotCmd(args) {
  const sub = args[0] || 'list';
  const { listSnapshots, archiveSnapshot } = await import('../src/report/snapshots.js');
  if (sub === 'list') {
    const list = listSnapshots(repo);
    if (!list.length) { console.log(t('cli.snapshot.list_empty')); return; }
    console.log(t('cli.snapshot.list_title'));
    for (const s of list) {
      console.log(`  ${s.ts}  reqs=${s.reqsTotal} done=${s.reqsDone} history=${s.historyCount}`);
    }
    return;
  }
  if (sub === 'now') {
    const { generateProjectReport } = await import('../src/report/generator.js');
    const { outFile } = await generateProjectReport(repo, { skipNetwork: true });
    const html = fs.readFileSync(outFile, 'utf8');
    const { folder } = archiveSnapshot(repo, html);
    console.log(t('cli.snapshot.archived', { file: folder }));
    return;
  }
  throw new Error('usage: codeforesight snapshot [list|now]');
}

async function diffCmd(args) {
  const [a, b] = args.filter(a => !a.startsWith('--'));
  if (!a || !b) throw new Error(t('cli.diff.usage'));
  const { loadSnapshotByTs, diffSnapshots } = await import('../src/report/snapshots.js');
  const snapA = loadSnapshotByTs(repo, a);
  if (!snapA) throw new Error(t('cli.diff.not_found', { ts: a }));
  const snapB = loadSnapshotByTs(repo, b);
  if (!snapB) throw new Error(t('cli.diff.not_found', { ts: b }));
  const diff = diffSnapshots(snapA, snapB);
  console.log('\n' + t('cli.diff.title', { a: snapA.ts, b: snapB.ts }));
  const s = diff.summary;
  console.log(`  reqs Δ${signed(s.reqDelta)}  done Δ${signed(s.doneDelta)}  tokens Δ${signed(s.totalTokenDelta)}  history Δ${signed(s.historyDelta)}`);
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
    console.log('  ' + t('cli.diff.no_changes'));
    return;
  }
  if (diff.added.length) {
    console.log('\n  ➕ added:');
    for (const r of diff.added) console.log(`    ${r.id} [${r.status}] ${r.title}`);
  }
  if (diff.removed.length) {
    console.log('\n  ➖ removed:');
    for (const r of diff.removed) console.log(`    ${r.id} ${r.title}`);
  }
  if (diff.changed.length) {
    console.log('\n  Δ changed:');
    for (const c of diff.changed) {
      console.log(`    ${c.id} ${c.title}`);
      for (const d of c.diffs) {
        const deltaStr = d.delta != null ? ` (Δ${signed(d.delta)})` : '';
        console.log(`      ${d.field}: ${d.from} → ${d.to}${deltaStr}`);
      }
    }
  }
  console.log('');
}

function signed(n) { return (n > 0 ? '+' : '') + n; }

function helpCmd() {
  console.log(`${t('cli.help.title')}

${t('cli.help.usage')}:
  codeforesight req add <file.md>     ${t('cli.help.req_add')}
  codeforesight req list              ${t('cli.help.req_list')}
  codeforesight req show <id>         ${t('cli.help.req_show')}
  codeforesight req done <id>         ${t('cli.help.req_done')}
  codeforesight req active <id|none>  ${t('cli.help.req_active')}
  codeforesight req rm <id>           ${t('cli.help.req_rm')}
  codeforesight estimate <id>         ${t('cli.help.estimate')}
  codeforesight audit <id>            ${t('cli.help.audit')}
  codeforesight scaffold <id>         ${t('cli.help.scaffold')}
  codeforesight sync                  ${t('cli.help.sync')}
  codeforesight progress [--port N]   ${t('cli.help.progress')}
  codeforesight status                ${t('cli.help.status')}
  codeforesight report <id>           ${t('cli.help.report')}
  codeforesight report --all          ${t('cli.help.report_all')}
  codeforesight seed-demo             ${t('cli.help.seed_demo')}
  codeforesight seed-real             ${t('cli.help.seed_real')}
  codeforesight snapshot list|now     列出 / 立刻归档项目状态快照
  codeforesight diff <ts1> <ts2>      对比两份快照

Aliases: codeforesight | cf | codepr      Add --lang en|zh to override locale.
`);
}

async function reqCmd(args) {
  const sub = args[0];
  ensureCodeprDir(repo);
  switch (sub) {
    case 'add': {
      const file = args[1];
      if (!file) throw new Error('usage: codepr req add <file.md>');
      const abs = path.resolve(repo, file);
      if (!fs.existsSync(abs)) throw new Error(`PRD not found: ${abs}`);
      const prd = parsePRD(abs);
      const config = loadConfig(repo);
      console.log(t('cli.req.estimating', { id: prd.id, title: prd.title }));
      const est = await estimate(prd, repo, config);
      const req = {
        id: prd.id,
        title: prd.title,
        priority: prd.priority,
        tags: prd.tags,
        file: path.relative(repo, abs),
        status: 'backlog',
        progress: 0,
        created_at: new Date().toISOString(),
        estimate: est,
        actual: { tokens: 0, tool_calls: 0 }
      };
      upsertRequirement(req, repo);
      appendEvent({ type: 'req_added', req: req.id }, repo);
      printReq(req);
      return;
    }
    case 'list': {
      const data = loadRequirements(repo);
      if (!data.requirements.length) { console.log(t('cli.req.no_requirements')); return; }
      const active = readActiveReq(repo);
      for (const r of data.requirements) {
        const mark = r.id === active ? '★' : ' ';
        const tok = r.estimate?.combined?.tokens;
        const hr = r.estimate?.combined?.hours;
        const tokFmt = tok ? `~${fmtK(tok[0])}-${fmtK(tok[1])}tok` : t('cli.req.no_estimate');
        const hrFmt = hr ? `~${hr[0]}-${hr[1]}h` : '';
        console.log(`${mark} ${pad(r.id, 14)} [${pad(r.status, 11)}] ${pad(`${r.progress || 0}%`, 5)} ${pad(tokFmt, 20)} ${hrFmt}  ${r.title}`);
      }
      return;
    }
    case 'show': {
      const id = args[1];
      const r = getRequirement(id, repo);
      if (!r) throw new Error(t('cli.req.not_found', { id }));
      printReq(r);
      return;
    }
    case 'done': {
      const id = args[1];
      const r = getRequirement(id, repo);
      if (!r) throw new Error(t('cli.req.not_found', { id }));
      r.status = 'done'; r.progress = 100;
      r.actual = r.actual || {}; r.actual.completed_at = new Date().toISOString();
      upsertRequirement(r, repo);
      console.log(t('cli.req.done', { id }));
      return;
    }
    case 'active': {
      const id = args[1];
      if (!id || id === 'none') { writeActiveReq(null, repo); console.log(t('cli.req.active_cleared')); return; }
      const r = getRequirement(id, repo);
      if (!r) throw new Error(t('cli.req.not_found', { id }));
      writeActiveReq(id, repo);
      console.log(t('cli.req.active_set', { id }));
      return;
    }
    case 'rm': {
      const id = args[1];
      const n = removeRequirement(id, repo);
      console.log(n ? t('cli.req.removed', { id }) : t('cli.req.not_found', { id }));
      return;
    }
    default:
      throw new Error('usage: codepr req <add|list|show|done|active|rm>');
  }
}

async function estimateCmd(args) {
  const id = args[0];
  const req = getRequirement(id, repo);
  if (!req) throw new Error(`not found: ${id}`);
  if (!req.file) throw new Error(`requirement has no PRD file`);
  const prd = parsePRD(path.resolve(repo, req.file));
  const config = loadConfig(repo);
  const est = await estimate(prd, repo, config);
  req.estimate = est;
  upsertRequirement(req, repo);
  printEstimate(est);
}

async function auditCmd(args) {
  const id = args[0];
  const req = getRequirement(id, repo);
  if (!req) throw new Error(`not found: ${id}`);
  if (!req.file) throw new Error(`requirement has no PRD file`);
  const prd = parsePRD(path.resolve(repo, req.file));
  const result = auditRequirement(prd, repo);
  req.audit = result;
  upsertRequirement(req, repo);
  printAudit(result);
}

async function scaffoldCmd(args) {
  const id = args[0];
  const req = getRequirement(id, repo);
  if (!req) throw new Error(`not found: ${id}`);
  if (!req.audit) throw new Error(t('cli.scaffold.no_audit', { id }));
  const created = [];
  for (const m of req.audit.handlers.missing || []) {
    const file = (typeof m.ref === 'string' && m.ref.includes(':')) ? m.ref.split(':')[0] : `src/handlers/${m.name}.ts`;
    const target = path.resolve(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const stub = `\nexport function ${m.name}(/* TODO */) {\n  throw new Error('not implemented');\n}\n`;
    if (fs.existsSync(target)) {
      const existing = fs.readFileSync(target, 'utf8');
      const re = new RegExp(`\\bfunction\\s+${m.name}\\b|\\bconst\\s+${m.name}\\b`);
      if (re.test(existing)) continue;
      fs.appendFileSync(target, stub);
    } else {
      fs.writeFileSync(target, `// codepr scaffold for ${req.id}: ${m.name}\n${stub}`);
    }
    created.push(`${file}::${m.name}`);
  }
  for (const m of req.audit.db_models.missing || []) {
    const file = `src/models/${m.name}.ts`;
    const target = path.resolve(repo, file);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target,
      `// codepr scaffold for ${req.id}: ${m.name}\nexport class ${m.name} {\n  // TODO: fields\n}\n`);
    created.push(file);
  }
  console.log(created.length
    ? t('cli.scaffold.scaffolded', { n: created.length }) + '\n  ' + created.join('\n  ')
    : t('cli.scaffold.nothing'));
}

function syncCmd() {
  const config = loadConfig(repo);
  const dir = path.resolve(repo, config.prdDir);
  if (!fs.existsSync(dir)) { console.log(t('cli.sync.no_dir', { dir: config.prdDir })); return; }
  const data = loadRequirements(repo);
  const known = new Set(data.requirements.map(r => r.file));
  const news = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    .map(f => path.relative(repo, path.join(dir, f)))
    .filter(f => !known.has(f));
  if (!news.length) { console.log(t('cli.sync.no_new')); return; }
  console.log(t('cli.sync.found', { n: news.length }));
  for (const f of news) console.log(`  codeforesight req add "${f}"`);
}

async function progressCmd(args) {
  const port = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : null; })();
  const config = loadConfig(repo);
  const usePort = port || config.dashboardPort;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = path.join(here, '..', 'src', 'dashboard', 'server.js');
  console.log(t('cli.progress.starting', { port: usePort }));
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [server], {
    stdio: 'inherit',
    env: { ...process.env, CODEPR_REPO: repo, CODEPR_PORT: String(usePort) },
    detached: false
  });
  child.on('close', code => process.exit(code || 0));
}

function statusCmd() {
  const active = readActiveReq(repo);
  if (!active) { console.log(''); return; }
  const r = getRequirement(active, repo);
  if (!r) { console.log(''); return; }
  const tok = r.actual?.tokens || 0;
  const tokHigh = r.estimate?.combined?.tokens?.[1] || 0;
  const bar = makeBar(r.progress || 0);
  console.log(`📋 ${r.id} ${truncate(r.title, 16)} ${bar} ${r.progress || 0}% · ${fmtK(tok)}${tokHigh ? '/' + fmtK(tokHigh) : ''}tok`);
}

function makeBar(pct, width = 8) {
  const filled = Math.round(pct / 100 * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function truncate(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

function printReq(r) {
  console.log(`\n${r.id}  ${r.title}`);
  console.log(`  ${t('cli.req.status')}: ${r.status}  ${t('cli.req.progress')}: ${r.progress || 0}%  ${t('cli.req.priority')}: ${r.priority}  ${t('cli.req.tags')}: ${(r.tags || []).join(', ')}`);
  console.log(`  PRD: ${r.file}`);
  if (r.estimate?.combined) {
    const c = r.estimate.combined;
    console.log(`  ${t('cli.req.estimate')}: ${fmtK(c.tokens[0])}-${fmtK(c.tokens[1])} ${t('cli.estimate.tokens')}, ${c.hours[0]}-${c.hours[1]} ${t('cli.estimate.hours')} (${t('cli.req.confidence')} ${c.confidence})`);
  }
  if (r.actual) {
    console.log(`  ${t('cli.req.actual')}:   ${fmtK(r.actual.tokens || 0)} ${t('cli.estimate.tokens')}, ${r.actual.tool_calls || 0} tool calls`);
  }
  console.log('');
}

function printEstimate(est) {
  const c = est.combined;
  console.log(`\n${t('cli.estimate.final')}:`);
  console.log(`  ${t('cli.estimate.tokens')}: ${fmtK(c.tokens[0])} – ${fmtK(c.tokens[1])}`);
  console.log(`  ${t('cli.estimate.hours')}:  ${c.hours[0]} – ${c.hours[1]}`);
  console.log(`  ${t('cli.req.confidence')}: ${c.confidence}`);
  console.log(`\n${t('cli.estimate.layer_breakdown')}:`);
  for (const [name, l] of Object.entries(est.layers)) {
    if (!l.tokens) { console.log(`  ${pad(name, 8)} (${t('cli.estimate.skipped')}: ${l.reason || 'n/a'})`); continue; }
    console.log(`  ${pad(name, 8)} ${t('cli.estimate.tokens')}=${fmtK(l.tokens[0])}-${fmtK(l.tokens[1])} ${t('cli.estimate.hours')}=${l.hours[0]}-${l.hours[1]} conf=${l.confidence}`);
    if (l.reasoning) console.log(`           ${t('cli.estimate.reasoning')}: ${l.reasoning}`);
  }
  console.log('');
}

function printAudit(r) {
  console.log(`\n${t('cli.audit.title')}:`);
  console.log(`  ${t('cli.audit.matched')}: ${r.summary.matched}  ${t('cli.audit.missing')}: ${r.summary.missing}  ${t('cli.audit.deviations')}: ${r.summary.deviations}  ${t('cli.audit.completion')}: ${r.summary.completion}%`);
  const catLabels = {
    routes: t('cli.audit.category_routes'),
    handlers: t('cli.audit.category_handlers'),
    hooks: t('cli.audit.category_hooks'),
    db_models: t('cli.audit.category_db_models')
  };
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    const d = r[cat];
    if (!d.matched.length && !d.missing.length) continue;
    console.log(`\n  [${catLabels[cat]}]`);
    for (const m of d.matched) {
      const dev = m.deviation ? `  ⚠️  ${m.deviation}` : '';
      console.log(`    ✅ ${formatItem(cat, m)}${dev}`);
    }
    for (const m of d.missing) {
      console.log(`    ❌ ${formatItem(cat, m)}  ${t('cli.audit.suffix_missing')}`);
    }
  }
  console.log('');
}

function formatItem(cat, m) {
  if (cat === 'routes') return `${m.method || 'ANY'} ${m.path}${m.file ? '  → ' + m.file : ''}`;
  return `${m.name || JSON.stringify(m.ref)}${m.file ? '  → ' + m.file : ''}`;
}
