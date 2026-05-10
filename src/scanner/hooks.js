import path from 'node:path';
import { walkSource, readSafe } from './walk.js';

const FRONTEND_HOOK = /export\s+(?:default\s+)?(?:function|const)\s+(use[A-Z]\w*)/g;
const MIDDLEWARE = /(?:export\s+(?:default\s+)?(?:function|const)\s+(\w*[Mm]iddleware\w*)|app\.use\s*\(\s*(\w+))/g;
const CC_HOOKS = /(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop|SubagentStop|PreCompact|Notification)/g;

export function scanHooks(repo) {
  const files = walkSource(repo);
  const items = [];
  for (const f of files) {
    const text = readSafe(f);
    const rel = path.relative(repo, f);
    let m;
    FRONTEND_HOOK.lastIndex = 0;
    while ((m = FRONTEND_HOOK.exec(text))) items.push({ name: m[1], kind: 'react-hook', file: rel });
    MIDDLEWARE.lastIndex = 0;
    while ((m = MIDDLEWARE.exec(text))) {
      const name = m[1] || m[2];
      if (name) items.push({ name, kind: 'middleware', file: rel });
    }
    if (rel.includes('hooks') && (rel.endsWith('.json') || rel.endsWith('.js'))) {
      CC_HOOKS.lastIndex = 0;
      while ((m = CC_HOOKS.exec(text))) items.push({ name: m[1], kind: 'cc-hook', file: rel });
    }
  }
  return dedup(items, x => `${x.kind}:${x.name}:${x.file}`);
}

export function diffHooks(expected, actual) {
  if (!expected) return { matched: [], missing: [], extra: [] };
  const matched = [], missing = [];
  for (const e of expected) {
    const { name, file } = parseRef(e);
    const hit = actual.find(a => a.name === name && (!file || a.file.endsWith(file)));
    if (hit) matched.push({ ref: e, file: hit.file, name });
    else {
      const loose = actual.find(a => a.name === name);
      if (loose) matched.push({ ref: e, file: loose.file, name, deviation: `expected at ${file}, found at ${loose.file}` });
      else missing.push({ ref: e, name, file });
    }
  }
  return { matched, missing, extra: [] };
}

function parseRef(ref) {
  if (typeof ref === 'string') {
    const idx = ref.lastIndexOf(':');
    if (idx > 0) return { file: ref.slice(0, idx), name: ref.slice(idx + 1) };
    return { file: null, name: ref };
  }
  return { file: ref.file || null, name: ref.name };
}

function dedup(arr, keyFn) {
  const seen = new Set();
  return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; });
}
