import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, paths } from '../paths.js';
import { loadRequirements, loadHistory, getRequirement } from '../store.js';
import { parsePRD } from '../prd-parser.js';
import { auditRequirement } from '../scanner/diff.js';
import { projectBurnup, reqBurnup, calibration, cfd, gantt } from '../charts/timeseries.js';
import { loadAllLocales, detectLang } from '../i18n/index.js';
import { readCCTheme } from '../report/cc-settings.js';

const repo = process.env.CODEPR_REPO || findRepoRoot();
const port = Number(process.env.CODEPR_PORT || 7878);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const auditCache = new Map();

// SSE client registry — every active EventSource sub
const sseClients = new Set();
let watcherStarted = false;

function broadcastEvent(payload) {
  const data = `data: ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch {}
  }
}

function startWatcher() {
  if (watcherStarted) return;
  const p = paths(repo);
  if (!fs.existsSync(p.base)) {
    fs.mkdirSync(p.base, { recursive: true });
  }
  // Coalesce bursts (hooks may write 2-3 files in quick succession)
  let pending = null;
  const schedule = (kind, file) => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      // Bust audit cache so dashboard re-runs scanner on next pull
      auditCache.clear();
      broadcastEvent({ type: 'change', source: kind, file });
    }, 120);
  };
  try {
    fs.watch(p.base, { persistent: false }, (eventType, filename) => {
      if (!filename) return;
      if (filename === 'requirements.json' || filename === 'events.jsonl' || filename === 'history.jsonl' || filename === 'active-req') {
        schedule(filename, filename);
      }
    });
    watcherStarted = true;
    console.log(`codeforesight: watching ${p.base} for live updates`);
  } catch (e) {
    console.warn('codeforesight: fs.watch failed — dashboard will fall back to polling:', e.message);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/events') return handleSSE(req, res);
    if (url.pathname.startsWith('/api/')) return handleApi(url, res);
    return serveStatic(url.pathname, res);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e.stack || e.message));
  }
});

function handleSSE(req, res) {
  startWatcher();
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    'access-control-allow-origin': '*'
  });
  res.write(`: connected\n\n`);
  res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), type: 'hello' })}\n\n`);
  sseClients.add(res);
  // Keep alive ping every 25s (some proxies idle out at 30s)
  const keepalive = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 25_000);
  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
}

function handleApi(url, res) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/api/state') {
    const data = loadRequirements(repo);
    const history = loadHistory(repo);
    return send(200, { repo, requirements: data.requirements, history });
  }

  if (url.pathname === '/api/req') {
    const id = url.searchParams.get('id');
    const r = getRequirement(id, repo);
    if (!r) return send(404, { error: 'not found' });
    let prd = null;
    if (r.file) {
      try { prd = parsePRD(path.resolve(repo, r.file)); } catch (e) { prd = { error: e.message }; }
    }
    return send(200, { requirement: r, prd });
  }

  if (url.pathname === '/api/audit') {
    const id = url.searchParams.get('id');
    const r = getRequirement(id, repo);
    if (!r || !r.file) return send(404, { error: 'not found or no PRD' });
    const cached = auditCache.get(id);
    if (cached && Date.now() - cached.ts < 5000) return send(200, cached.value);
    try {
      const prd = parsePRD(path.resolve(repo, r.file));
      const value = auditRequirement(prd, repo);
      auditCache.set(id, { ts: Date.now(), value });
      return send(200, value);
    } catch (e) {
      return send(500, { error: e.message });
    }
  }

  if (url.pathname === '/api/burn') {
    const events = readEventsTail();
    return send(200, { events });
  }

  if (url.pathname === '/api/charts/project-burnup') {
    return send(200, projectBurnup(repo));
  }

  if (url.pathname === '/api/charts/req-burnup') {
    const id = url.searchParams.get('id');
    const result = reqBurnup(repo, id);
    if (!result) return send(404, { error: 'not found' });
    return send(200, result);
  }

  if (url.pathname === '/api/charts/calibration') {
    return send(200, calibration(repo));
  }

  if (url.pathname === '/api/charts/cfd') {
    return send(200, cfd(repo));
  }

  if (url.pathname === '/api/charts/gantt') {
    return send(200, gantt(repo));
  }

  if (url.pathname === '/api/settings') {
    return send(200, {
      lang: detectLang(),
      theme: readCCTheme(),
      locales: loadAllLocales()
    });
  }

  return send(404, { error: 'no such api' });
}

function readEventsTail(limit = 500) {
  const p = paths(repo);
  if (!fs.existsSync(p.events)) return [];
  const text = fs.readFileSync(p.events, 'utf8');
  const lines = text.split('\n').filter(Boolean).slice(-limit);
  return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function serveStatic(pathname, res) {
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = path.join(publicDir, pathname.replace(/^\/+/, ''));
  if (!file.startsWith(publicDir)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
  const ext = path.extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

server.listen(port, () => {
  console.log(`codeforesight dashboard: http://localhost:${port} (repo: ${repo})`);
  startWatcher();
});
