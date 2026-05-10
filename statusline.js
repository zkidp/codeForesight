#!/usr/bin/env node
import { findRepoRoot } from './src/paths.js';
import { readActiveReq, getRequirement } from './src/store.js';

let evt = {};
try {
  if (!process.stdin.isTTY) {
    let data = '';
    process.stdin.setEncoding('utf8');
    for await (const c of process.stdin) data += c;
    if (data) { try { evt = JSON.parse(data); } catch {} }
  }
} catch {}

try {
  const repo = evt.cwd || findRepoRoot();
  const active = readActiveReq(repo);
  if (!active) { process.stdout.write(''); process.exit(0); }
  const r = getRequirement(active, repo);
  if (!r) { process.stdout.write(''); process.exit(0); }

  const tok = r.actual?.tokens || 0;
  const tokHigh = r.estimate?.combined?.tokens?.[1] || 0;
  const pct = r.progress || 0;
  const bar = makeBar(pct);
  const tokPart = tokHigh ? `${fmtK(tok)}/${fmtK(tokHigh)}tok` : `${fmtK(tok)}tok`;
  process.stdout.write(`📋 ${r.id} ${truncate(r.title, 16)} ${bar} ${pct}% · ${tokPart}`);
} catch {
  process.stdout.write('');
}

function makeBar(pct, width = 8) {
  const filled = Math.max(0, Math.min(width, Math.round(pct / 100 * width)));
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}
function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function truncate(s, n) { s = String(s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
