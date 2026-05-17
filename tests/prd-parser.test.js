import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { makeTempRepo, cleanupRepo, writeFile } from './helpers.js';
import { parsePRD } from '../src/prd-parser.js';

describe('parsePRD', () => {
  it('parses frontmatter, title, tags, priority', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/001.md', `---
id: req-001
title: User login
priority: P0
tags: [auth, backend]
---

# User login

Description.`);
    const prd = parsePRD(file);
    expect(prd.id).toBe('req-001');
    expect(prd.title).toBe('User login');
    expect(prd.priority).toBe('P0');
    expect(prd.tags).toEqual(['auth', 'backend']);
    cleanupRepo(repo);
  });

  it('falls back to filename-derived id when frontmatter missing', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/042-something.md', '# Title\n\nBody');
    const prd = parsePRD(file);
    expect(prd.id).toBe('req-042');
    cleanupRepo(repo);
  });

  it('extracts acceptance criteria from task list checkboxes', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/a.md', `---
id: req-1
---
- [ ] First
- [x] Second done
- [X] Third also done
- Not a task
`);
    const prd = parsePRD(file);
    expect(prd.acceptance).toEqual([
      { done: false, text: 'First' },
      { done: true, text: 'Second done' },
      { done: true, text: 'Third also done' }
    ]);
    cleanupRepo(repo);
  });

  it('extracts mermaid blocks separately', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/a.md', `---
id: req-1
---
text before

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

text middle

\`\`\`mermaid
sequenceDiagram
  Alice->>Bob: hi
\`\`\`

text after`);
    const prd = parsePRD(file);
    expect(prd.mermaid).toHaveLength(2);
    expect(prd.mermaid[0]).toContain('flowchart LR');
    expect(prd.mermaid[1]).toContain('sequenceDiagram');
    cleanupRepo(repo);
  });

  it('parses nested expects.* in frontmatter', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/a.md', `---
id: req-1
expects:
  routes:
    - { method: POST, path: /api/login }
  handlers:
    - src/handlers/auth.ts:loginHandler
  db_models:
    - User
    - Session
---
body`);
    const prd = parsePRD(file);
    expect(prd.expects.routes).toEqual([{ method: 'POST', path: '/api/login' }]);
    expect(prd.expects.handlers).toEqual(['src/handlers/auth.ts:loginHandler']);
    expect(prd.expects.db_models).toEqual(['User', 'Session']);
    cleanupRepo(repo);
  });

  it('extracts path hints from inline file references', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/a.md', `---
id: req-1
---
We need to update src/foo.ts and src/bar.py.
Also touch lib/baz.go.`);
    const prd = parsePRD(file);
    expect(prd.pathHints).toContain('src/foo.ts');
    expect(prd.pathHints).toContain('src/bar.py');
    expect(prd.pathHints).toContain('lib/baz.go');
    cleanupRepo(repo);
  });

  it('preserves <placeholder> syntax inside inline code (no HTML strip)', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/a.md', `---
id: req-1
---
Path template: \`.codepr/snapshots/<ts>.html\``);
    const prd = parsePRD(file);
    expect(prd.body).toContain('<ts>');
    cleanupRepo(repo);
  });

  it('returns empty arrays when no acceptance / mermaid / hints', () => {
    const repo = makeTempRepo();
    const file = writeFile(repo, 'docs/prd/a.md', `---
id: req-1
---
Just text.`);
    const prd = parsePRD(file);
    expect(prd.acceptance).toEqual([]);
    expect(prd.mermaid).toEqual([]);
    expect(prd.pathHints).toEqual([]);
    cleanupRepo(repo);
  });
});
