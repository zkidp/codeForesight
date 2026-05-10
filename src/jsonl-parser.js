import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function claudeProjectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

export function encodeRepoPath(repoPath) {
  return repoPath.replace(/[\\/:]/g, '-').replace(/^-/, '');
}

export function findProjectDir(repoPath) {
  const root = claudeProjectsRoot();
  if (!fs.existsSync(root)) return null;
  const target = encodeRepoPath(path.resolve(repoPath));
  const candidates = fs.readdirSync(root);
  const exact = candidates.find(c => c === target || c.toLowerCase() === target.toLowerCase());
  if (exact) return path.join(root, exact);
  const fuzzy = candidates.find(c => c.toLowerCase().endsWith(path.basename(repoPath).toLowerCase()));
  return fuzzy ? path.join(root, fuzzy) : null;
}

export function readSessionEvents(sessionId, repoPath) {
  const dir = findProjectDir(repoPath);
  if (!dir) return [];
  const file = path.join(dir, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function extractTokenUsage(event) {
  const u = event?.message?.usage || event?.usage;
  if (!u) return null;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    total: (u.input_tokens || 0) + (u.output_tokens || 0)
  };
}
