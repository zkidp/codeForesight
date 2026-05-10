#!/usr/bin/env node
import { readStdinJSON, safe } from './_lib.js';
import { findRepoRoot } from '../src/paths.js';
import { writeActiveReq, getRequirement, appendEvent } from '../src/store.js';

await safe(async () => {
  const evt = await readStdinJSON();
  const repo = evt.cwd || findRepoRoot();
  const prompt = evt.prompt || '';
  const m = prompt.match(/#(req-[\w-]+)/);
  if (m) {
    const id = m[1];
    if (getRequirement(id, repo)) {
      writeActiveReq(id, repo);
      appendEvent({ type: 'active_switch', req: id, session_id: evt.session_id }, repo);
    }
  }
  process.exit(0);
})();
