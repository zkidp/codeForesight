#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, paths, ensureCodeprDir } from '../src/paths.js';
import {
  loadConfig, loadRequirements, saveRequirements,
  upsertRequirement, getRequirement, removeRequirement,
  writeActiveReq, readActiveReq, appendEvent
} from '../src/store.js';
import { parsePRD } from '../src/prd-parser.js';
import { estimate } from '../src/estimator/combine.js';
import { auditRequirement } from '../src/scanner/diff.js';

const args = process.argv.slice(2);
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
    case 'seed-demo': return seedDemoCmd();
    case 'help':
    case undefined:   return helpCmd();
    default:
      console.error(`Unknown command: ${cmd}`);
      helpCmd();
      process.exit(1);
  }
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
  console.log(`seeded events for ${data.requirements.length} requirement(s).`);
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
  console.log(`seeded ${samples.length} history entries.`);
}

function helpCmd() {
  console.log(`codepr — Claude Code requirement-driven progress board

Usage:
  codepr req add <file.md>      Register a PRD as a requirement (auto-estimates)
  codepr req list               List requirements with status
  codepr req show <id>          Show one requirement detail
  codepr req done <id>          Mark requirement as done
  codepr req active <id|none>   Set / clear current active requirement
  codepr req rm <id>            Remove
  codepr estimate <id>          Re-run three-layer estimator
  codepr audit <id>             Diff design (PRD expects.*) vs actual code
  codepr scaffold <id>          Create empty placeholders for missing items
  codepr sync                   Scan PRD dir for new files
  codepr progress [--port N]    Launch dashboard at localhost:7878
  codepr status                 One-line status (used by statusline)
  codepr seed-demo              Generate demo events for chart preview
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
      console.log(`Estimating ${prd.id} "${prd.title}"...`);
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
      if (!data.requirements.length) { console.log('(no requirements)'); return; }
      const active = readActiveReq(repo);
      for (const r of data.requirements) {
        const mark = r.id === active ? '★' : ' ';
        const tok = r.estimate?.combined?.tokens;
        const hr = r.estimate?.combined?.hours;
        const tokFmt = tok ? `~${fmtK(tok[0])}-${fmtK(tok[1])}tok` : 'no estimate';
        const hrFmt = hr ? `~${hr[0]}-${hr[1]}h` : '';
        console.log(`${mark} ${pad(r.id, 14)} [${pad(r.status, 11)}] ${pad(`${r.progress || 0}%`, 5)} ${pad(tokFmt, 20)} ${hrFmt}  ${r.title}`);
      }
      return;
    }
    case 'show': {
      const id = args[1];
      const r = getRequirement(id, repo);
      if (!r) throw new Error(`not found: ${id}`);
      printReq(r);
      return;
    }
    case 'done': {
      const id = args[1];
      const r = getRequirement(id, repo);
      if (!r) throw new Error(`not found: ${id}`);
      r.status = 'done'; r.progress = 100;
      r.actual = r.actual || {}; r.actual.completed_at = new Date().toISOString();
      upsertRequirement(r, repo);
      console.log(`done: ${id}`);
      return;
    }
    case 'active': {
      const id = args[1];
      if (!id || id === 'none') { writeActiveReq(null, repo); console.log('active: (cleared)'); return; }
      const r = getRequirement(id, repo);
      if (!r) throw new Error(`not found: ${id}`);
      writeActiveReq(id, repo);
      console.log(`active: ${id}`);
      return;
    }
    case 'rm': {
      const id = args[1];
      const n = removeRequirement(id, repo);
      console.log(n ? `removed: ${id}` : `not found: ${id}`);
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
  if (!req.audit) throw new Error(`run 'codepr audit ${id}' first`);
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
  console.log(created.length ? `scaffolded ${created.length} files:\n  ${created.join('\n  ')}` : '(nothing missing or all already present)');
}

function syncCmd() {
  const config = loadConfig(repo);
  const dir = path.resolve(repo, config.prdDir);
  if (!fs.existsSync(dir)) { console.log(`(no PRD dir: ${config.prdDir})`); return; }
  const data = loadRequirements(repo);
  const known = new Set(data.requirements.map(r => r.file));
  const news = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    .map(f => path.relative(repo, path.join(dir, f)))
    .filter(f => !known.has(f));
  if (!news.length) { console.log('(no new PRDs)'); return; }
  console.log(`Found ${news.length} new PRD(s). Run:`);
  for (const f of news) console.log(`  codepr req add "${f}"`);
}

async function progressCmd(args) {
  const port = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : null; })();
  const config = loadConfig(repo);
  const usePort = port || config.dashboardPort;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = path.join(here, '..', 'src', 'dashboard', 'server.js');
  console.log(`Starting dashboard on http://localhost:${usePort}`);
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
  console.log(`  status: ${r.status}  progress: ${r.progress || 0}%  priority: ${r.priority}  tags: ${(r.tags || []).join(', ')}`);
  console.log(`  PRD: ${r.file}`);
  if (r.estimate?.combined) {
    const c = r.estimate.combined;
    console.log(`  estimate: ${fmtK(c.tokens[0])}-${fmtK(c.tokens[1])} tokens, ${c.hours[0]}-${c.hours[1]} hours (conf ${c.confidence})`);
  }
  if (r.actual) {
    console.log(`  actual:   ${fmtK(r.actual.tokens || 0)} tokens, ${r.actual.tool_calls || 0} tool calls`);
  }
  console.log('');
}

function printEstimate(est) {
  const c = est.combined;
  console.log(`\nFinal estimate (combined):`);
  console.log(`  tokens: ${fmtK(c.tokens[0])} – ${fmtK(c.tokens[1])}`);
  console.log(`  hours:  ${c.hours[0]} – ${c.hours[1]}`);
  console.log(`  confidence: ${c.confidence}`);
  console.log(`\nLayer breakdown:`);
  for (const [name, l] of Object.entries(est.layers)) {
    if (!l.tokens) { console.log(`  ${pad(name, 8)} (skipped: ${l.reason || 'n/a'})`); continue; }
    console.log(`  ${pad(name, 8)} tokens=${fmtK(l.tokens[0])}-${fmtK(l.tokens[1])} hours=${l.hours[0]}-${l.hours[1]} conf=${l.confidence}`);
    if (l.reasoning) console.log(`           reasoning: ${l.reasoning}`);
  }
  console.log('');
}

function printAudit(r) {
  console.log(`\nDesign ↔ Implementation audit:`);
  console.log(`  matched: ${r.summary.matched}  missing: ${r.summary.missing}  deviations: ${r.summary.deviations}  completion: ${r.summary.completion}%`);
  for (const cat of ['routes', 'handlers', 'hooks', 'db_models']) {
    const d = r[cat];
    if (!d.matched.length && !d.missing.length) continue;
    console.log(`\n  [${cat}]`);
    for (const m of d.matched) {
      const dev = m.deviation ? `  ⚠️  ${m.deviation}` : '';
      console.log(`    ✅ ${formatItem(cat, m)}${dev}`);
    }
    for (const m of d.missing) {
      console.log(`    ❌ ${formatItem(cat, m)}  (missing)`);
    }
  }
  console.log('');
}

function formatItem(cat, m) {
  if (cat === 'routes') return `${m.method || 'ANY'} ${m.path}${m.file ? '  → ' + m.file : ''}`;
  return `${m.name || JSON.stringify(m.ref)}${m.file ? '  → ' + m.file : ''}`;
}
