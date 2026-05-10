import path from 'node:path';
import { walkSource, readSafe } from './walk.js';

const PRISMA = /^model\s+(\w+)\s*\{/gm;
const TYPEORM = /@Entity\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
const SEQUELIZE = /(?:sequelize|db)\.define\s*\(\s*['"`](\w+)['"`]/g;
const SQLALCHEMY = /class\s+(\w+)\s*\([^)]*Base[^)]*\)\s*:/g;
const DJANGO = /class\s+(\w+)\s*\(\s*models\.Model\s*\)\s*:/g;
const MONGOOSE = /(?:mongoose\.)?model\s*\(\s*['"`](\w+)['"`]/g;

const ALL = [PRISMA, TYPEORM, SEQUELIZE, SQLALCHEMY, DJANGO, MONGOOSE];

export function scanDbModels(repo) {
  const files = walkSource(repo);
  const items = [];
  for (const f of files) {
    const text = readSafe(f);
    const rel = path.relative(repo, f);
    for (const re of ALL) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        items.push({ name: m[1], file: rel });
      }
    }
  }
  return dedup(items, x => x.name);
}

export function diffDbModels(expected, actual) {
  if (!expected) return { matched: [], missing: [], extra: [] };
  const matched = [], missing = [];
  const exp = expected.map(e => typeof e === 'string' ? { name: e } : e);
  for (const e of exp) {
    const hit = actual.find(a => a.name === e.name);
    if (hit) matched.push({ ref: e, file: hit.file, name: e.name });
    else missing.push({ ref: e, name: e.name });
  }
  return { matched, missing, extra: [] };
}

function dedup(arr, keyFn) {
  const seen = new Set();
  return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; });
}
