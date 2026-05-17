import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRepo, cleanupRepo } from './helpers.js';
import { embed, cosineSimilarity, embeddingsAvailable } from '../src/estimator/embeddings.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });
  it('returns 0 on null / length-mismatch / zero vectors', () => {
    expect(cosineSimilarity(null, [1])).toBe(0);
    expect(cosineSimilarity([1], null)).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe('embeddingsAvailable', () => {
  beforeEach(() => {
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  it('returns false when no provider key set', () => {
    expect(embeddingsAvailable()).toBe(false);
  });
  it('returns true when VOYAGE_API_KEY set', () => {
    process.env.VOYAGE_API_KEY = 'test';
    expect(embeddingsAvailable()).toBe(true);
    delete process.env.VOYAGE_API_KEY;
  });
  it('returns true when OPENAI_API_KEY set', () => {
    process.env.OPENAI_API_KEY = 'test';
    expect(embeddingsAvailable()).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });
});

describe('embed', () => {
  let repo;
  beforeEach(() => {
    repo = makeTempRepo();
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    cleanupRepo(repo);
    delete process.env.VOYAGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it('returns null when no provider key and no skipNetwork', async () => {
    const v = await embed('hello', repo);
    expect(v).toBeNull();
  });

  it('returns null when skipNetwork even with key set', async () => {
    process.env.VOYAGE_API_KEY = 'test';
    const v = await embed('hello', repo, { skipNetwork: true });
    expect(v).toBeNull();
  });

  it('calls Voyage API and caches result', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    const mockVec = [0.1, 0.2, 0.3];
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls++;
      expect(url).toContain('voyage');
      return new Response(JSON.stringify({ data: [{ embedding: mockVec }] }), { status: 200 });
    }));
    const v1 = await embed('first text', repo);
    expect(v1).toEqual(mockVec);
    // Second call with same text should hit cache, not API
    const v2 = await embed('first text', repo);
    expect(v2).toEqual(mockVec);
    expect(calls).toBe(1);
    // Cache file should exist
    const cacheDir = path.join(repo, '.codepr/cache/embeddings');
    expect(fs.existsSync(cacheDir)).toBe(true);
    expect(fs.readdirSync(cacheDir).length).toBe(1);
  });

  it('prefers Voyage over OpenAI when both set', async () => {
    process.env.VOYAGE_API_KEY = 'v';
    process.env.OPENAI_API_KEY = 'o';
    const seenUrls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      seenUrls.push(url);
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200 });
    }));
    await embed('test', repo);
    expect(seenUrls[0]).toContain('voyage');
  });

  it('falls back to null on API error', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const v = await embed('text', repo);
    expect(v).toBeNull();
  });

  it('returns null for empty input', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    const v = await embed('   ', repo);
    expect(v).toBeNull();
  });
});
