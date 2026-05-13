import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths, ensureCodeprDir } from '../paths.js';

const ASSETS = [
  { name: 'chart.js',         url: 'https://cdn.jsdelivr.net/npm/chart.js@4' },
  { name: 'luxon.js',         url: 'https://cdn.jsdelivr.net/npm/luxon@3' },
  { name: 'chartjs-adapter-luxon.js', url: 'https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon@1' },
  { name: 'mermaid.min.js',   url: 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js' }
];

export async function inlineAssets(repo, opts = {}) {
  if (opts.skipNetwork) return { scripts: '', error: 'skipped (--no-network)' };

  ensureCodeprDir(repo);
  const cacheDir = path.join(paths(repo).base, 'cache', 'assets');
  fs.mkdirSync(cacheDir, { recursive: true });

  const bundles = [];
  for (const a of ASSETS) {
    const cachePath = path.join(cacheDir, a.name);
    let body = readIfFresh(cachePath, opts.maxAgeMs);
    if (!body) {
      try {
        body = await fetchText(a.url);
        fs.writeFileSync(cachePath, body);
      } catch (e) {
        return { scripts: '', error: `failed to fetch ${a.name}: ${e.message}` };
      }
    }
    bundles.push(body);
  }

  const script = bundles.map(b => `<script>${escapeScriptTag(b)}</script>`).join('\n');
  const sizeKb = Math.round(bundles.reduce((s, b) => s + b.length, 0) / 1024);
  return { scripts: script, sizeKb };
}

function readIfFresh(file, maxAgeMs = 7 * 24 * 3600 * 1000) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
  return fs.readFileSync(file, 'utf8');
}

async function fetchText(url, redirectsLeft = 3) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

function escapeScriptTag(s) {
  return s.replace(/<\/script/gi, '<\\/script');
}
