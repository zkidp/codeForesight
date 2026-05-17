import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Create an isolated temp repo for tests. Caller is responsible for cleanup.
export function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-test-'));
  fs.writeFileSync(path.join(dir, '.gitattributes'), '');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true }); // marker for findRepoRoot
  return dir;
}

export function cleanupRepo(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

export function writeFile(repo, relPath, content) {
  const full = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// Quick PRD factory for tests
export function makePRD(overrides = {}) {
  const id = overrides.id || `req-${randomBytes(3).toString('hex')}`;
  const frontmatter = Object.assign({
    id,
    title: 'Test requirement',
    priority: 'P1',
    tags: ['test'],
    expects: {}
  }, overrides);
  const fmLines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k === 'expects' && Object.keys(v).length) {
      fmLines.push('expects:');
      for (const [cat, items] of Object.entries(v)) {
        fmLines.push(`  ${cat}:`);
        for (const item of items) fmLines.push(`    - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
      }
    } else if (Array.isArray(v)) {
      fmLines.push(`${k}: [${v.join(', ')}]`);
    } else {
      fmLines.push(`${k}: ${v}`);
    }
  }
  fmLines.push('---', '');
  const body = overrides.body || '# Test\n\nDescription.\n\n- [ ] criterion 1\n- [ ] criterion 2';
  return { id, content: fmLines.join('\n') + body };
}
