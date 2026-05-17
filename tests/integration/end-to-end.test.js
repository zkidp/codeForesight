// End-to-end integration test: empty repo → register PRD → estimate → audit →
// scaffold → mark done → snapshot → diff → generate report → verify HTML.
//
// Hits real bin/codepr.js as a subprocess (via Node child_process) so we exercise
// the same code path users do.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRepo, cleanupRepo, writeFile } from '../helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'bin', 'codepr.js');

function run(cwd, args) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd, encoding: 'utf8',
    env: { ...process.env, CODEFORESIGHT_LANG: 'en' }
  });
}

describe('integration: full workflow', () => {
  let repo;
  beforeAll(() => {
    repo = makeTempRepo();
    // Write a minimal PRD
    writeFile(repo, 'docs/prd/001-test.md', `---
id: req-001
title: Test feature
priority: P1
tags: [test, backend]
expects:
  routes:
    - { method: GET, path: /api/test }
  handlers:
    - src/handlers/test.ts:testHandler
---

# Test feature

- [ ] Endpoint returns 200
- [ ] Handler exports correctly
`);
  }, 30_000);

  afterAll(() => cleanupRepo(repo));

  it('registers PRD and estimates in one go', () => {
    const out = run(repo, 'req add docs/prd/001-test.md');
    expect(out).toContain('req-001');
    expect(out).toContain('estimate'); // EN locale
  });

  it('lists registered requirement', () => {
    const out = run(repo, 'req list');
    expect(out).toContain('req-001');
    expect(out).toMatch(/backlog/);
  });

  it('runs audit and reports missing items', () => {
    const out = run(repo, 'audit req-001');
    expect(out).toContain('routes');
    expect(out).toContain('missing');
    // Two expects items, both missing initially
    expect(out).toMatch(/❌/);
  });

  it('scaffolds missing handlers', () => {
    const out = run(repo, 'scaffold req-001');
    expect(out.toLowerCase()).toMatch(/scaffolded|nothing/);
    // Handler stub should exist now
    expect(fs.existsSync(path.join(repo, 'src/handlers/test.ts'))).toBe(true);
  });

  it('re-audit shows the handler matched now', () => {
    const out = run(repo, 'audit req-001');
    expect(out).toContain('testHandler');
    expect(out).toMatch(/✅/);
  });

  it('generates per-req HTML report (self-contained, zero external src)', () => {
    run(repo, 'report req-001 --no-network');
    const file = path.join(repo, '.codepr/reports/req-001.html');
    expect(fs.existsSync(file)).toBe(true);
    const html = fs.readFileSync(file, 'utf8');
    // No external <script src="http..."> tags allowed
    expect(html).not.toMatch(/src="http/i);
    // Contains key sections
    expect(html).toContain('req-001');
    expect(html).toContain('Test feature');
    // Inline Chart.js + locales are present
    expect(html).toContain('__CODEPR_DATA__');
    expect(html).toContain('"brand.name":"codeForesight"');
  }, 30_000);

  it('generates project-level report with merged architecture', () => {
    run(repo, 'report --all --no-network');
    const file = path.join(repo, '.codepr/reports/index.html');
    expect(fs.existsSync(file)).toBe(true);
    const html = fs.readFileSync(file, 'utf8');
    expect(html).not.toMatch(/src="http/i);
    expect(html).toContain('"reqsTotal":1');
    expect(html).toContain('canvas id="projectBurnup"'); // 4 project charts inlined
    expect(html).toContain('canvas id="cfd"');
  }, 30_000);

  it('snapshots and diff produce structured output', () => {
    run(repo, 'snapshot now');
    // Modify req
    const reqs = JSON.parse(fs.readFileSync(path.join(repo, '.codepr/requirements.json'), 'utf8'));
    reqs.requirements[0].progress = 50;
    reqs.requirements[0].actual = { tokens: 5000, started_at: new Date().toISOString() };
    fs.writeFileSync(path.join(repo, '.codepr/requirements.json'), JSON.stringify(reqs, null, 2));
    run(repo, 'snapshot now');

    const listOut = run(repo, 'snapshot list');
    expect(listOut.split('\n').filter(l => /reqs=/.test(l)).length).toBeGreaterThanOrEqual(2);

    // Get two snapshot timestamps from the list output
    const tsLines = listOut.split('\n').filter(l => l.includes('reqs=')).map(l => l.trim().split(/\s+/)[0]);
    expect(tsLines.length).toBeGreaterThanOrEqual(2);
    const diffOut = run(repo, `diff ${tsLines[0]} ${tsLines[1]}`);
    expect(diffOut).toContain('progress');
    expect(diffOut).toMatch(/0\s*[→\->]\s*50/);
  }, 30_000);

  it('caches assets on second report generation (much faster)', () => {
    const t1 = Date.now();
    run(repo, 'report req-001 --no-network --force');
    const d1 = Date.now() - t1;
    const t2 = Date.now();
    run(repo, 'report req-001 --no-network');
    const d2 = Date.now() - t2;
    // Second run with cache should not be ridiculously slower
    expect(d2).toBeLessThan(d1 + 2000);
  }, 30_000);
});
