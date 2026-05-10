import path from 'node:path';
import fs from 'node:fs';
import { walkSource, readSafe } from './walk.js';

const PATTERNS = [
  /export\s+(?:async\s+)?function\s+(\w+)/g,
  /export\s+const\s+(\w+)\s*=/g,
  /export\s+class\s+(\w+)/g,
  /export\s+default\s+(?:async\s+)?function\s+(\w+)/g,
  /func\s+(\w+)\s*\(/g,
  /def\s+(\w+)\s*\(/g
];

export function scanHandlers(repo) {
  const files = walkSource(repo);
  const items = [];
  for (const f of files) {
    const text = readSafe(f);
    const seen = new Set();
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        items.push({ name, file: path.relative(repo, f) });
      }
    }
  }
  return items;
}

export function diffHandlers(expected, actual, repoRoot) {
  if (!expected) return { matched: [], missing: [], extra: [] };
  const matched = [], missing = [];
  for (const e of expected) {
    const { file, name } = parseRef(e);
    const hit = actual.find(a => a.name === name && (!file || sameFile(a.file, file)));
    if (hit) matched.push({ ref: e, file: hit.file, name });
    else {
      const looseHit = actual.find(a => a.name === name);
      if (looseHit) matched.push({ ref: e, file: looseHit.file, name, deviation: file ? `expected at ${file}, found at ${looseHit.file}` : null });
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

function sameFile(a, b) {
  return path.normalize(a) === path.normalize(b);
}
