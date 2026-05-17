import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRepo, cleanupRepo, writeFile } from './helpers.js';
import { extractTokenUsage, encodeRepoPath } from '../src/jsonl-parser.js';
import { estimate } from '../src/estimator/combine.js';
import { extractSnippet, renderSnippetHtml } from '../src/report/snippets.js';
import { rewriteMermaidInHtml, buildAuditStateMap, buildAuditMermaidHtml } from '../src/report/mermaid-static.js';
import { inlineAssets } from '../src/report/inline-assets.js';
import { loadConfig } from '../src/store.js';

describe('jsonl-parser', () => {
  describe('extractTokenUsage', () => {
    it('extracts usage from message.usage', () => {
      const evt = { message: { usage: { input_tokens: 100, output_tokens: 50 } } };
      expect(extractTokenUsage(evt)).toEqual({
        input: 100, output: 50, cacheCreate: 0, cacheRead: 0, total: 150
      });
    });

    it('extracts cache token fields', () => {
      const evt = { usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000 } };
      const u = extractTokenUsage(evt);
      expect(u.cacheCreate).toBe(200);
      expect(u.cacheRead).toBe(1000);
    });

    it('returns null when no usage present', () => {
      expect(extractTokenUsage({})).toBeNull();
      expect(extractTokenUsage(null)).toBeNull();
    });
  });

  describe('encodeRepoPath', () => {
    it('replaces path separators and colons with dashes (POSIX)', () => {
      expect(encodeRepoPath('/Users/x/project')).toBe('Users-x-project');
    });
    it('handles Windows paths (colon + backslash each become a dash)', () => {
      // C:\ → C--, then \Users → -Users, etc.  ~/.claude/projects/ uses this encoding.
      expect(encodeRepoPath('C:\\Users\\x\\project')).toBe('C--Users-x-project');
    });
  });
});

describe('estimator/combine', () => {
  let repo;
  beforeEach(() => {
    repo = makeTempRepo();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => cleanupRepo(repo));

  it('combines three layers conservatively (min/max envelope)', async () => {
    const cfg = loadConfig(repo);
    const prd = {
      body: 'feature description',
      tags: [],
      expects: { routes: [{ method: 'GET', path: '/a' }] },
      pathHints: ['src/a.ts'],
      acceptance: [{ text: 'criterion', done: false }],
      raw: '---\nid: r\n---\nfeature description',
      title: 'r'
    };
    const result = await estimate(prd, repo, cfg, { skipNetwork: true });
    expect(result.layers.rules).toBeDefined();
    expect(result.layers.history).toBeDefined();
    expect(result.layers.ai).toBeDefined();
    expect(result.combined.tokens[0]).toBeLessThanOrEqual(result.combined.tokens[1]);
    expect(result.combined.hours[0]).toBeLessThanOrEqual(result.combined.hours[1]);
    expect(result.combined.confidence).toBeGreaterThanOrEqual(0);
    expect(result.combined.confidence).toBeLessThanOrEqual(1);
  });

  it('falls back gracefully when AI layer disabled', async () => {
    const cfg = loadConfig(repo);
    const prd = { body: 'a', tags: [], expects: {}, pathHints: [], acceptance: [], raw: '', title: '' };
    const result = await estimate(prd, repo, cfg, { skipNetwork: true });
    expect(result.layers.ai.tokens).toBeDefined();
    expect(result.combined.tokens[1]).toBeGreaterThan(0);
  });
});

describe('report/snippets', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  it('extracts function body by name', () => {
    writeFile(repo, 'src/h.ts', `
import { x } from 'y';

export function loginHandler(req, res) {
  if (!req.body.user) return res.status(401);
  return res.json({ ok: true });
}

export function otherFn() { return 1; }
`);
    const snip = extractSnippet(repo, 'src/h.ts', 'loginHandler');
    expect(snip).not.toBeNull();
    expect(snip.lines.length).toBeGreaterThan(0);
    expect(snip.lines.some(l => l.text.includes('loginHandler'))).toBe(true);
  });

  it('returns null when symbol not found', () => {
    writeFile(repo, 'src/h.ts', `export function a() {}`);
    expect(extractSnippet(repo, 'src/h.ts', 'doesNotExist')).toBeNull();
  });

  it('returns null when file does not exist', () => {
    expect(extractSnippet(repo, 'nope.ts', 'x')).toBeNull();
  });

  it('renderSnippetHtml produces escaped HTML', () => {
    const snip = {
      file: 'src/x.ts', name: 'fn',
      lines: [{ n: 1, text: 'function fn() {' }, { n: 2, text: '  return "<x>";' }, { n: 3, text: '}' }]
    };
    const html = renderSnippetHtml(snip);
    expect(html).toContain('snippet');
    expect(html).toContain('fn');
    expect(html).toContain('&lt;x&gt;'); // angle brackets escaped
  });
});

describe('report/mermaid-static', () => {
  describe('rewriteMermaidInHtml', () => {
    it('converts <pre><code class="language-mermaid">...</code></pre> to <div class="mermaid">', () => {
      const html = '<pre><code class="language-mermaid">flowchart LR\n  A --&gt; B</code></pre>';
      const out = rewriteMermaidInHtml(html);
      expect(out).toContain('class="mermaid-svg"');
      expect(out).toContain('class="mermaid"');
      expect(out).not.toContain('language-mermaid');
    });

    it('decodes HTML entities inside the mermaid block', () => {
      const html = '<pre><code class="language-mermaid">A --&gt; B</code></pre>';
      const out = rewriteMermaidInHtml(html);
      expect(out).toContain('A --> B'); // entities decoded
    });

    it('attaches data-mm-states when audit states provided', () => {
      const html = '<pre><code class="language-mermaid">flowchart LR\n  A</code></pre>';
      const states = { A: 'ok', B: 'missing' };
      const out = rewriteMermaidInHtml(html, states);
      expect(out).toContain('data-mm-states');
      expect(out).toContain('ok');
    });
  });

  describe('buildAuditStateMap', () => {
    it('maps audit categories to a flat name → state object', () => {
      const audit = {
        routes: { matched: [{ name: 'login', path: '/login', method: 'POST' }], missing: [] },
        handlers: { matched: [], missing: [{ name: 'logoutHandler' }] },
        hooks: { matched: [], missing: [] },
        db_models: { matched: [], missing: [] }
      };
      const map = buildAuditStateMap(audit);
      expect(typeof map).toBe('object');
      // Some implementation detail of which keys end up — just verify it returns something usable
      expect(Object.keys(map).length).toBeGreaterThan(0);
    });
  });

  describe('buildAuditMermaidHtml', () => {
    it('returns empty string (deduplication of mermaid blocks)', () => {
      expect(buildAuditMermaidHtml([], {})).toBe('');
      expect(buildAuditMermaidHtml(['flowchart LR\nA'], {})).toBe('');
    });
  });
});

describe('report/inline-assets', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => {
    cleanupRepo(repo);
    vi.unstubAllGlobals();
  });

  it('returns empty scripts with reason when skipNetwork=true', async () => {
    const r = await inlineAssets(repo, { skipNetwork: true });
    expect(r.scripts).toBe('');
    expect(r.error).toContain('skipped');
  });

  it('fetches and caches assets on first call, reads from cache on second', async () => {
    let fetchCount = 0;
    // Return larger content so sizeKb rounds to a non-zero integer
    const big = '/* mock */ ' + 'x'.repeat(2048);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      fetchCount++;
      return new Response(big, { status: 200 });
    }));
    const r1 = await inlineAssets(repo);
    expect(r1.scripts).toContain('<script>');
    expect(r1.sizeKb).toBeGreaterThanOrEqual(1);
    expect(fetchCount).toBeGreaterThan(0);

    const firstFetchCount = fetchCount;
    const r2 = await inlineAssets(repo);
    expect(r2.scripts).toContain('<script>');
    expect(fetchCount).toBe(firstFetchCount); // no additional fetches
  });

  it('escapes </script> inside inlined content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(`var x = '</script><script>alert(1)</script>'`, { status: 200 });
    }));
    const r = await inlineAssets(repo);
    expect(r.scripts).not.toMatch(/<\/script><script>alert/);
    expect(r.scripts).toContain('<\\/script');
  });

  it('returns error message when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const r = await inlineAssets(repo);
    expect(r.scripts).toBe('');
    expect(r.error).toContain('failed to fetch');
  });
});
