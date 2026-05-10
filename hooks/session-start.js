#!/usr/bin/env node
import { readStdinJSON, safe } from './_lib.js';
import { findRepoRoot } from '../src/paths.js';
import { readActiveReq, appendEvent } from '../src/store.js';

await safe(async () => {
  const evt = await readStdinJSON();
  const repo = evt.cwd || findRepoRoot();
  const active = readActiveReq(repo);
  appendEvent({ type: 'session_start', session_id: evt.session_id, active_req: active }, repo);
  process.exit(0);
})();
