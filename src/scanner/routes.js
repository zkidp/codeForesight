import path from 'node:path';
import { walkSource, readSafe } from './walk.js';

const PATTERNS = [
  { re: /(?:app|router|server|fastify)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/g, lang: 'express' },
  { re: /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*['"`]([^'"`]+)['"`]/g, lang: 'nest' },
  { re: /@app\.route\s*\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/g, lang: 'flask', flaskShape: true },
  { re: /path\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g, lang: 'django', methodless: true },
  { re: /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/g, lang: 'spring' },
  { re: /(get|post|put|delete|patch)\s+['"`]([^'"`]+)['"`]/g, lang: 'rails' }
];

export function scanRoutes(repo) {
  const files = walkSource(repo);
  const found = [];
  for (const f of files) {
    const text = readSafe(f);
    for (const { re, lang, methodless, flaskShape } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        let method, p;
        if (methodless) { method = 'ANY'; p = m[1]; }
        else if (flaskShape) {
          p = m[1];
          method = m[2] ? m[2].replace(/['"\s]/g, '').split(',')[0].toUpperCase() : 'GET';
        } else { method = m[1].toUpperCase(); p = m[2]; }
        found.push({
          method: normalizeMethod(method, lang),
          path: p,
          file: path.relative(repo, f),
          lang
        });
      }
    }
  }
  return dedup(found, r => `${r.method} ${r.path}`);
}

function normalizeMethod(m, lang) {
  const map = { GETMAPPING: 'GET', POSTMAPPING: 'POST', PUTMAPPING: 'PUT', DELETEMAPPING: 'DELETE', PATCHMAPPING: 'PATCH', REQUESTMAPPING: 'ANY', ALL: 'ANY' };
  return (map[m] || m).toUpperCase();
}

function dedup(arr, keyFn) {
  const seen = new Set();
  return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function diffRoutes(expected, actual) {
  if (!expected) return { matched: [], missing: [], extra: actual };
  const norm = (e) => `${(e.method || 'ANY').toUpperCase()} ${e.path}`;
  const expSet = new Map(expected.map(e => [norm(e), e]));
  const actSet = new Map(actual.map(a => [norm(a), a]));
  const matched = [], missing = [], extra = [];
  for (const [k, e] of expSet) {
    const hit = actSet.get(k);
    if (hit) matched.push({ ...e, file: hit.file });
    else missing.push(e);
  }
  for (const [k, a] of actSet) if (!expSet.has(k)) extra.push(a);
  return { matched, missing, extra };
}
