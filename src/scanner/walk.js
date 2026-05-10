import fs from 'node:fs';
import path from 'node:path';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.codepr', 'venv', '__pycache__', 'target', '.idea', '.vscode']);

export function walkSource(repo, opts = {}) {
  const exts = opts.exts || ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb', '.cs', '.php', '.prisma', '.sql'];
  const out = [];
  walk(repo, out, exts, opts.maxFiles || 5000);
  return out;
}

function walk(dir, out, exts, max) {
  if (out.length >= max) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= max) return;
    if (IGNORE.has(e.name)) continue;
    if (e.name.startsWith('.') && e.name !== '.claude-plugin') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out, exts, max);
    } else if (e.isFile()) {
      if (exts.includes(path.extname(e.name))) out.push(full);
    }
  }
}

export function readSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
