import path from 'node:path';
import fs from 'node:fs';

export function findRepoRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (fs.existsSync(path.join(dir, '.codepr'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function codeprDir(repo = findRepoRoot()) {
  return path.join(repo, '.codepr');
}

export function ensureCodeprDir(repo = findRepoRoot()) {
  const dir = codeprDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function paths(repo = findRepoRoot()) {
  const base = codeprDir(repo);
  return {
    repo,
    base,
    requirements: path.join(base, 'requirements.json'),
    events: path.join(base, 'events.jsonl'),
    history: path.join(base, 'history.jsonl'),
    config: path.join(base, 'config.json'),
    activeReq: path.join(base, 'active-req'),
    cache: path.join(base, 'cache'),
  };
}
