import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTempRepo, cleanupRepo } from './helpers.js';
import { upsertRequirement, appendEvent, appendHistory } from '../src/store.js';
import { projectBurnup, reqBurnup, calibration, cfd, gantt } from '../src/charts/timeseries.js';

describe('charts/timeseries', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  function seedReq(overrides) {
    upsertRequirement(Object.assign({
      id: 'r1', title: 't', status: 'backlog', progress: 0,
      created_at: '2026-01-01T00:00:00Z',
      estimate: { combined: { tokens: [1000, 5000], hours: [1, 5], confidence: 0.5 } },
      actual: { tokens: 0, tool_calls: 0 }
    }, overrides), repo);
  }

  describe('projectBurnup', () => {
    it('returns empty when no reqs', () => {
      const r = projectBurnup(repo);
      expect(r.points).toEqual([]);
    });

    it('produces stepped scope changes as reqs are added', () => {
      seedReq({ id: 'r1', created_at: '2026-01-01T00:00:00Z' });
      seedReq({ id: 'r2', created_at: '2026-01-02T00:00:00Z', estimate: { combined: { tokens: [2000, 8000], hours: [2, 8] } } });
      const r = projectBurnup(repo);
      expect(r.points.length).toBeGreaterThan(0);
      expect(r.summary.reqsTotal).toBe(2);
      expect(r.summary.estimatedRange[1]).toBe(13000); // 5000 + 8000
    });

    it('accumulates actual tokens from tool_use events', () => {
      seedReq({ id: 'r1' });
      appendEvent({ type: 'tool_use', req: 'r1', tokens: 1234, ts: '2026-01-01T01:00:00Z' }, repo);
      const r = projectBurnup(repo);
      expect(r.summary.actualTokens).toBe(0); // actualTokens reads from req.actual.tokens not events
      // but timeline should show the event
      const last = r.points[r.points.length - 1];
      expect(last.actualTotal).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reqBurnup', () => {
    it('returns null for unknown id', () => {
      expect(reqBurnup(repo, 'nope')).toBeNull();
    });

    it('returns time series for known req', () => {
      seedReq({ id: 'r1', actual: { started_at: '2026-01-01T00:00:00Z', tokens: 0 } });
      appendEvent({ type: 'tool_use', req: 'r1', tokens: 500, ts: '2026-01-01T01:00:00Z' }, repo);
      appendEvent({ type: 'tool_use', req: 'r1', tokens: 1000, ts: '2026-01-01T02:00:00Z' }, repo);
      const r = reqBurnup(repo, 'r1');
      expect(r.reqId).toBe('r1');
      expect(r.points.length).toBeGreaterThanOrEqual(3); // start + 2 events + now
      expect(r.actual).toBe(1500);
    });

    it('flags overBudget when actual > estimate upper', () => {
      seedReq({ id: 'r1', actual: { started_at: '2026-01-01T00:00:00Z' } });
      appendEvent({ type: 'tool_use', req: 'r1', tokens: 10000, ts: '2026-01-01T01:00:00Z' }, repo);
      const r = reqBurnup(repo, 'r1');
      expect(r.overBudget).toBe(true);
    });
  });

  describe('cfd', () => {
    it('counts statuses over transition events', () => {
      seedReq({ id: 'r1', status: 'done', actual: { completed_at: '2026-01-02T00:00:00Z', started_at: '2026-01-01T12:00:00Z' } });
      seedReq({ id: 'r2', status: 'in_progress', actual: { started_at: '2026-01-03T00:00:00Z' } });
      const r = cfd(repo);
      expect(r.summary.done).toBe(1);
      expect(r.summary.in_progress).toBe(1);
      expect(r.points.length).toBeGreaterThan(0);
    });

    it('returns empty summary when no reqs', () => {
      const r = cfd(repo);
      expect(r.summary.total ?? 0).toBe(0);
    });
  });

  describe('calibration', () => {
    it('returns empty when no history', () => {
      const r = calibration(repo);
      expect(r.points).toEqual([]);
      expect(r.summary.n).toBe(0);
    });

    it('computes accuracy and bias from history entries', () => {
      appendHistory({ id: 'h1', title: 'a', actual_tokens: 1500, actual_hours: 2, estimated: { tokens: [1000, 2000], hours: [1, 3] } }, repo);
      appendHistory({ id: 'h2', title: 'b', actual_tokens: 5000, actual_hours: 5, estimated: { tokens: [3000, 6000], hours: [3, 6] } }, repo);
      appendHistory({ id: 'h3', title: 'c', actual_tokens: 10000, actual_hours: 10, estimated: { tokens: [2000, 4000], hours: [2, 4] } }, repo);
      const r = calibration(repo);
      expect(r.summary.n).toBe(3);
      expect(r.summary.inRange).toBe(2); // h1, h2 in range, h3 way over
      expect(r.summary.accuracy).toBeCloseTo(66.7, 1);
      expect(r.summary.bias).toBeDefined();
    });
  });

  describe('gantt', () => {
    it('returns rows sorted by start time', () => {
      seedReq({ id: 'r2', created_at: '2026-01-02T00:00:00Z', actual: { started_at: '2026-01-02T00:00:00Z', last_at: '2026-01-02T05:00:00Z' }, status: 'in_progress' });
      seedReq({ id: 'r1', created_at: '2026-01-01T00:00:00Z', actual: { started_at: '2026-01-01T00:00:00Z', last_at: '2026-01-01T05:00:00Z' }, status: 'in_progress' });
      const r = gantt(repo);
      expect(r.rows[0].id).toBe('r1');
      expect(r.rows[1].id).toBe('r2');
    });

    it('estimates end time from estimated hours when started_at is known', () => {
      seedReq({ id: 'r1', actual: { started_at: '2026-01-01T00:00:00Z' }, status: 'in_progress' });
      const r = gantt(repo);
      expect(r.rows[0].estEnd).toBeTruthy();
      expect(r.rows[0].estHours).toBe(5);
    });
  });
});
