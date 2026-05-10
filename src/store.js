import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureCodeprDir } from './paths.js';

const DEFAULT_CONFIG = {
  prdDir: 'docs/prd',
  dashboardPort: 7878,
  estimator: {
    weights: { rules: 0.2, history: 0.4, ai: 0.4 },
    weightsNoHistory: { rules: 0.3, ai: 0.7 },
    rules: {
      baseTokensPerFile: 4000,
      baseHoursPerFile: 0.6,
      baseTokensPerAcceptance: 2500,
      baseHoursPerAcceptance: 0.4,
      complexityMultipliers: {
        auth: 1.6,
        migration: 1.8,
        refactor: 1.5,
        encryption: 1.7,
        infra: 1.4,
        ui: 1.0,
        crud: 0.8,
        bugfix: 0.7
      }
    }
  }
};

export function loadConfig(repo) {
  const p = paths(repo);
  ensureCodeprDir(repo);
  if (!fs.existsSync(p.config)) {
    fs.writeFileSync(p.config, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }
  try {
    const user = JSON.parse(fs.readFileSync(p.config, 'utf8'));
    return deepMerge(DEFAULT_CONFIG, user);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function loadRequirements(repo) {
  const p = paths(repo);
  ensureCodeprDir(repo);
  if (!fs.existsSync(p.requirements)) {
    fs.writeFileSync(p.requirements, JSON.stringify({ requirements: [] }, null, 2));
    return { requirements: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p.requirements, 'utf8'));
  } catch {
    return { requirements: [] };
  }
}

export function saveRequirements(data, repo) {
  const p = paths(repo);
  ensureCodeprDir(repo);
  fs.writeFileSync(p.requirements, JSON.stringify(data, null, 2));
}

export function upsertRequirement(req, repo) {
  const data = loadRequirements(repo);
  const i = data.requirements.findIndex(r => r.id === req.id);
  if (i >= 0) data.requirements[i] = { ...data.requirements[i], ...req };
  else data.requirements.push(req);
  saveRequirements(data, repo);
  return req;
}

export function getRequirement(id, repo) {
  const data = loadRequirements(repo);
  return data.requirements.find(r => r.id === id);
}

export function removeRequirement(id, repo) {
  const data = loadRequirements(repo);
  const before = data.requirements.length;
  data.requirements = data.requirements.filter(r => r.id !== id);
  saveRequirements(data, repo);
  return before - data.requirements.length;
}

export function appendEvent(event, repo) {
  const p = paths(repo);
  ensureCodeprDir(repo);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(p.events, line);
}

export function appendHistory(entry, repo) {
  const p = paths(repo);
  ensureCodeprDir(repo);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(p.history, line);
}

export function loadHistory(repo) {
  const p = paths(repo);
  if (!fs.existsSync(p.history)) return [];
  return fs.readFileSync(p.history, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function readActiveReq(repo) {
  const p = paths(repo);
  if (!fs.existsSync(p.activeReq)) return null;
  const v = fs.readFileSync(p.activeReq, 'utf8').trim();
  return v || null;
}

export function writeActiveReq(id, repo) {
  const p = paths(repo);
  ensureCodeprDir(repo);
  if (id == null) {
    if (fs.existsSync(p.activeReq)) fs.unlinkSync(p.activeReq);
  } else {
    fs.writeFileSync(p.activeReq, String(id));
  }
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  if (typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}
