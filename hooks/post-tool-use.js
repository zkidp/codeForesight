#!/usr/bin/env node
import { readStdinJSON, safe } from './_lib.js';
import { findRepoRoot } from '../src/paths.js';
import {
  readActiveReq, getRequirement, upsertRequirement, appendEvent
} from '../src/store.js';
import { extractTokenUsage } from '../src/jsonl-parser.js';

await safe(async () => {
  const evt = await readStdinJSON();
  const repo = evt.cwd || findRepoRoot();
  const active = readActiveReq(repo);
  if (!active) { process.exit(0); return; }

  const usage = extractTokenUsage(evt.tool_response) ||
                extractTokenUsage(evt) ||
                evt.usage ? extractTokenUsage(evt) : null;

  const req = getRequirement(active, repo);
  if (!req) { process.exit(0); return; }

  if (!req.actual) req.actual = { tokens: 0, tool_calls: 0, started_at: new Date().toISOString() };
  req.actual.tool_calls = (req.actual.tool_calls || 0) + 1;
  if (usage) req.actual.tokens = (req.actual.tokens || 0) + (usage.total || 0);
  if (req.status === 'backlog') req.status = 'in_progress';
  req.actual.last_at = new Date().toISOString();

  upsertRequirement(req, repo);
  appendEvent({
    type: 'tool_use',
    req: active,
    session_id: evt.session_id,
    tool: evt.tool_name,
    tokens: usage?.total || 0
  }, repo);
  process.exit(0);
})();
