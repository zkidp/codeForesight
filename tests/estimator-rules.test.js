import { describe, it, expect } from 'vitest';
import { estimateByRules } from '../src/estimator/rules.js';
import { loadConfig } from '../src/store.js';
import { makeTempRepo, cleanupRepo } from './helpers.js';

function configFor(repo) {
  return loadConfig(repo);
}

function fakePRD(overrides = {}) {
  return Object.assign({
    body: 'some description',
    tags: [],
    expects: {},
    pathHints: [],
    acceptance: []
  }, overrides);
}

describe('estimateByRules', () => {
  it('produces a sane baseline for a minimal PRD', () => {
    const repo = makeTempRepo();
    const cfg = configFor(repo);
    const r = estimateByRules(fakePRD(), cfg);
    expect(r.layer).toBe('rules');
    expect(r.tokens).toHaveLength(2);
    expect(r.hours).toHaveLength(2);
    expect(r.tokens[0]).toBeLessThan(r.tokens[1]);
    expect(r.hours[0]).toBeLessThan(r.hours[1]);
    expect(r.confidence).toBeGreaterThan(0);
    cleanupRepo(repo);
  });

  it('scales up with more expects.* declarations', () => {
    const repo = makeTempRepo();
    const cfg = configFor(repo);
    const small = estimateByRules(fakePRD({
      expects: { routes: [{ method: 'GET', path: '/a' }] },
      acceptance: [{ text: 'a', done: false }]
    }), cfg);
    const large = estimateByRules(fakePRD({
      expects: {
        routes: Array(5).fill({ method: 'GET', path: '/x' }),
        handlers: Array(5).fill('src/a.ts:f'),
        db_models: Array(3).fill('M')
      },
      acceptance: Array(8).fill({ text: 'a', done: false })
    }), cfg);
    expect(large.tokens[1]).toBeGreaterThan(small.tokens[1]);
    expect(large.hours[1]).toBeGreaterThan(small.hours[1]);
    cleanupRepo(repo);
  });

  it('applies complexity multiplier when keyword found in body or tags', () => {
    const repo = makeTempRepo();
    const cfg = configFor(repo);
    const plain = estimateByRules(fakePRD({
      body: 'simple feature',
      acceptance: [{ text: 'a', done: false }, { text: 'b', done: false }]
    }), cfg);
    const authPRD = estimateByRules(fakePRD({
      body: 'auth flow with sessions',
      tags: ['auth'],
      acceptance: [{ text: 'a', done: false }, { text: 'b', done: false }]
    }), cfg);
    // auth multiplier is 1.6 in defaults; range should be wider
    expect(authPRD.tokens[1]).toBeGreaterThan(plain.tokens[1]);
    expect(authPRD.signals.complexityMult).toBe(1.6);
    cleanupRepo(repo);
  });

  it('exposes signal details', () => {
    const repo = makeTempRepo();
    const cfg = configFor(repo);
    const r = estimateByRules(fakePRD({
      expects: { routes: [{}, {}, {}] },
      acceptance: [{ text: 'a', done: false }]
    }), cfg);
    expect(r.signals.fileSignal).toBeGreaterThanOrEqual(3);
    expect(r.signals.acceptanceSignal).toBe(1);
    cleanupRepo(repo);
  });
});
