import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRepo, cleanupRepo } from './helpers.js';
import {
  loadConfig, loadRequirements, saveRequirements, upsertRequirement,
  getRequirement, removeRequirement, appendEvent, appendHistory,
  loadHistory, readActiveReq, writeActiveReq
} from '../src/store.js';

describe('store', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  describe('config', () => {
    it('creates default config on first load', () => {
      const cfg = loadConfig(repo);
      expect(cfg.prdDir).toBe('docs/prd');
      expect(cfg.dashboardPort).toBe(7878);
      expect(cfg.estimator.weights.rules).toBe(0.2);
      expect(fs.existsSync(path.join(repo, '.codepr/config.json'))).toBe(true);
    });

    it('merges user config over defaults', () => {
      fs.mkdirSync(path.join(repo, '.codepr'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.codepr/config.json'),
        JSON.stringify({ dashboardPort: 9000, estimator: { weights: { ai: 0.7 } } }));
      const cfg = loadConfig(repo);
      expect(cfg.dashboardPort).toBe(9000);
      expect(cfg.estimator.weights.ai).toBe(0.7);
      expect(cfg.estimator.weights.rules).toBe(0.2); // default preserved
    });
  });

  describe('requirements', () => {
    it('returns empty list on first load', () => {
      const data = loadRequirements(repo);
      expect(data.requirements).toEqual([]);
    });

    it('upsert adds new and updates existing', () => {
      upsertRequirement({ id: 'r1', title: 'one', status: 'backlog' }, repo);
      upsertRequirement({ id: 'r2', title: 'two', status: 'backlog' }, repo);
      let data = loadRequirements(repo);
      expect(data.requirements).toHaveLength(2);

      upsertRequirement({ id: 'r1', title: 'one-updated', status: 'in_progress' }, repo);
      data = loadRequirements(repo);
      expect(data.requirements).toHaveLength(2);
      const r1 = data.requirements.find(r => r.id === 'r1');
      expect(r1.title).toBe('one-updated');
      expect(r1.status).toBe('in_progress');
    });

    it('getRequirement returns the matching req or undefined', () => {
      upsertRequirement({ id: 'r1', title: 'one' }, repo);
      expect(getRequirement('r1', repo).title).toBe('one');
      expect(getRequirement('missing', repo)).toBeUndefined();
    });

    it('removeRequirement deletes and returns count', () => {
      upsertRequirement({ id: 'r1' }, repo);
      upsertRequirement({ id: 'r2' }, repo);
      expect(removeRequirement('r1', repo)).toBe(1);
      expect(loadRequirements(repo).requirements.map(r => r.id)).toEqual(['r2']);
      expect(removeRequirement('does-not-exist', repo)).toBe(0);
    });
  });

  describe('events.jsonl', () => {
    it('appends each event as a JSON line with ts', () => {
      appendEvent({ type: 'a' }, repo);
      appendEvent({ type: 'b', req: 'r1' }, repo);
      const events = fs.readFileSync(path.join(repo, '.codepr/events.jsonl'), 'utf8')
        .split('\n').filter(Boolean).map(l => JSON.parse(l));
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('a');
      expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(events[1].req).toBe('r1');
    });
  });

  describe('history.jsonl', () => {
    it('appendHistory and loadHistory round-trip', () => {
      appendHistory({ id: 'h1', actual_tokens: 1000, actual_hours: 2 }, repo);
      appendHistory({ id: 'h2', actual_tokens: 2500, actual_hours: 4 }, repo);
      const history = loadHistory(repo);
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('h1');
      expect(history[1].actual_tokens).toBe(2500);
    });

    it('loadHistory returns empty when file does not exist', () => {
      expect(loadHistory(repo)).toEqual([]);
    });

    it('loadHistory skips malformed lines silently', () => {
      fs.mkdirSync(path.join(repo, '.codepr'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.codepr/history.jsonl'),
        '{"id":"ok"}\nnot-json-at-all\n{"id":"ok2"}\n');
      const history = loadHistory(repo);
      expect(history.map(h => h.id)).toEqual(['ok', 'ok2']);
    });
  });

  describe('active req', () => {
    it('readActiveReq returns null when unset', () => {
      expect(readActiveReq(repo)).toBeNull();
    });

    it('writeActiveReq + read round-trip', () => {
      writeActiveReq('req-007', repo);
      expect(readActiveReq(repo)).toBe('req-007');
    });

    it('writeActiveReq(null) clears the file', () => {
      writeActiveReq('req-007', repo);
      writeActiveReq(null, repo);
      expect(readActiveReq(repo)).toBeNull();
    });
  });
});
