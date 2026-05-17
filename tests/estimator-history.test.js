import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTempRepo, cleanupRepo } from './helpers.js';
import { appendHistory } from '../src/store.js';
import { estimateByHistory } from '../src/estimator/history.js';

describe('estimateByHistory', () => {
  let repo;
  beforeEach(() => {
    repo = makeTempRepo();
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    cleanupRepo(repo);
    vi.unstubAllGlobals();
  });

  it('cold-starts when history has < 3 entries', async () => {
    appendHistory({ id: 'h1', actual_tokens: 1000, actual_hours: 2, tags: ['x'], prd: { title: 'a', body: '', tags: ['x'] } }, repo);
    const r = await estimateByHistory({ title: 'test', tags: ['x'], body: '' }, repo);
    expect(r.layer).toBe('history');
    expect(r.tokens).toBeNull();
    expect(r.reason).toBe('cold-start');
  });

  it('uses Jaccard fallback when no embedding API key', async () => {
    for (let i = 0; i < 5; i++) {
      appendHistory({
        id: `h${i}`, title: `task ${i}`, tags: ['auth', 'backend'],
        actual_tokens: 10000 + i * 1000, actual_hours: 2 + i,
        prd: { title: `task ${i}`, body: 'login session jwt user password', tags: ['auth', 'backend'] }
      }, repo);
    }
    const r = await estimateByHistory({
      title: 'add login', tags: ['auth', 'backend'],
      body: 'login flow session jwt user password endpoint'
    }, repo, { skipNetwork: true });
    expect(r.method).toBe('jaccard');
    expect(r.tokens).not.toBeNull();
    expect(r.tokens[0]).toBeLessThan(r.tokens[1]);
    expect(r.neighbors).toBeDefined();
    expect(r.neighbors.length).toBeGreaterThan(0);
  });

  it('uses embedding when API key set and skipNetwork=false', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    // Each call returns a slightly different vector — close-but-not-identical
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      i++;
      const vec = [Math.sin(i), Math.cos(i), i / 10];
      return new Response(JSON.stringify({ data: [{ embedding: vec }] }), { status: 200 });
    }));
    for (let j = 0; j < 5; j++) {
      appendHistory({
        id: `h${j}`, title: `task ${j}`, tags: ['x'],
        actual_tokens: 20000, actual_hours: 4,
        prd: { title: `task ${j}`, body: 'body', tags: ['x'] }
      }, repo);
    }
    const r = await estimateByHistory({
      title: 'new req', tags: ['x'], body: 'related work'
    }, repo);
    expect(r.method).toBe('embedding');
    expect(r.tokens).not.toBeNull();
  });

  it('downgrades to Jaccard gracefully when embed call fails', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    for (let j = 0; j < 5; j++) {
      appendHistory({
        id: `h${j}`, title: `t${j}`, tags: ['a'],
        actual_tokens: 10000, actual_hours: 2,
        prd: { title: `t${j}`, body: 'body', tags: ['a'] }
      }, repo);
    }
    const r = await estimateByHistory({ title: 't', tags: ['a'], body: 'body' }, repo);
    expect(r.method).toBe('jaccard'); // fell back
    expect(r.tokens).not.toBeNull();
  });
});
