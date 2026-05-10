#!/usr/bin/env node
import { readStdinJSON, safe } from './_lib.js';
import { findRepoRoot } from '../src/paths.js';
import {
  readActiveReq, getRequirement, upsertRequirement,
  appendEvent, appendHistory
} from '../src/store.js';
import { parsePRD } from '../src/prd-parser.js';
import fs from 'node:fs';

await safe(async () => {
  const evt = await readStdinJSON();
  const repo = evt.cwd || findRepoRoot();
  const active = readActiveReq(repo);
  if (!active) { process.exit(0); return; }

  const req = getRequirement(active, repo);
  if (!req) { process.exit(0); return; }

  if (req.file && fs.existsSync(req.file)) {
    try {
      const prd = parsePRD(req.file);
      const total = prd.acceptance.length;
      const done = prd.acceptance.filter(a => a.done).length;
      req.progress = total ? Math.round(done / total * 100) : (req.progress || 0);
      if (total > 0 && done === total && req.status !== 'done') {
        req.status = 'done';
        req.actual = req.actual || {};
        req.actual.completed_at = new Date().toISOString();
        const startedTs = req.actual.started_at ? new Date(req.actual.started_at).getTime() : Date.now();
        const hours = (Date.now() - startedTs) / 3_600_000;
        req.actual.hours = Math.round(hours * 10) / 10;
        appendHistory({
          id: req.id,
          title: req.title,
          tags: req.tags,
          actual_tokens: req.actual.tokens || 0,
          actual_hours: req.actual.hours,
          estimated: req.estimate?.combined,
          prd: { title: req.title, body: prd.body.slice(0, 4000), tags: req.tags }
        }, repo);
      }
      upsertRequirement(req, repo);
    } catch {}
  }
  appendEvent({ type: 'session_stop', req: active, session_id: evt.session_id }, repo);
  process.exit(0);
})();
