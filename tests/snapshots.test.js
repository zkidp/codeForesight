import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempRepo, cleanupRepo } from './helpers.js';
import { upsertRequirement, appendHistory } from '../src/store.js';
import { archiveSnapshot, listSnapshots, loadSnapshotByTs, diffSnapshots, snapshotData } from '../src/report/snapshots.js';

describe('snapshots', () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => cleanupRepo(repo));

  describe('snapshotData', () => {
    it('captures current requirements + history with timestamp', () => {
      upsertRequirement({ id: 'r1', status: 'done', title: 't' }, repo);
      appendHistory({ id: 'r1', actual_tokens: 100 }, repo);
      const snap = snapshotData(repo);
      expect(snap.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(snap.requirements).toHaveLength(1);
      expect(snap.history).toHaveLength(1);
    });
  });

  describe('archiveSnapshot', () => {
    it('creates a folder with data.json (and index.html if provided)', () => {
      upsertRequirement({ id: 'r1' }, repo);
      const { folder, ts } = archiveSnapshot(repo, '<html>test</html>');
      expect(fs.existsSync(path.join(folder, 'data.json'))).toBe(true);
      expect(fs.existsSync(path.join(folder, 'index.html'))).toBe(true);
      expect(ts).toMatch(/^\d{4}/);
    });

    it('skips writing index.html when content not provided', () => {
      upsertRequirement({ id: 'r1' }, repo);
      const { folder } = archiveSnapshot(repo);
      expect(fs.existsSync(path.join(folder, 'data.json'))).toBe(true);
      expect(fs.existsSync(path.join(folder, 'index.html'))).toBe(false);
    });
  });

  describe('listSnapshots', () => {
    it('returns empty when no snapshots dir', () => {
      expect(listSnapshots(repo)).toEqual([]);
    });

    it('lists snapshots sorted by ts ascending', async () => {
      upsertRequirement({ id: 'r1', status: 'done' }, repo);
      archiveSnapshot(repo);
      await new Promise(r => setTimeout(r, 5));
      upsertRequirement({ id: 'r2', status: 'backlog' }, repo);
      archiveSnapshot(repo);
      const list = listSnapshots(repo);
      expect(list).toHaveLength(2);
      expect(new Date(list[0].ts).getTime()).toBeLessThanOrEqual(new Date(list[1].ts).getTime());
      expect(list[1].reqsTotal).toBe(2);
    });
  });

  describe('loadSnapshotByTs', () => {
    it('matches exact and prefix', () => {
      upsertRequirement({ id: 'r1' }, repo);
      const { ts } = archiveSnapshot(repo);
      // Exact match
      expect(loadSnapshotByTs(repo, ts)).not.toBeNull();
      // Prefix match (drop the seconds)
      const prefix = ts.slice(0, 16); // 2026-05-15T01:23
      expect(loadSnapshotByTs(repo, prefix)).not.toBeNull();
    });

    it('returns null for unknown ts', () => {
      expect(loadSnapshotByTs(repo, '1999-01-01')).toBeNull();
    });
  });

  describe('diffSnapshots', () => {
    it('detects added / removed / changed reqs', () => {
      const a = {
        ts: '2026-01-01',
        requirements: [
          { id: 'r1', title: 'one', status: 'backlog', progress: 0, actual: { tokens: 0 } },
          { id: 'r2', title: 'two', status: 'done',    progress: 100, actual: { tokens: 5000 } }
        ],
        history: []
      };
      const b = {
        ts: '2026-01-02',
        requirements: [
          { id: 'r1', title: 'one', status: 'in_progress', progress: 50, actual: { tokens: 2000 } },
          { id: 'r3', title: 'three', status: 'backlog', progress: 0 }
        ],
        history: [{ id: 'r2' }]
      };
      const d = diffSnapshots(a, b);
      expect(d.added.map(r => r.id)).toEqual(['r3']);
      expect(d.removed.map(r => r.id)).toEqual(['r2']);
      expect(d.changed).toHaveLength(1);
      expect(d.changed[0].id).toBe('r1');
      const fields = d.changed[0].diffs.map(x => x.field);
      expect(fields).toContain('status');
      expect(fields).toContain('progress');
      expect(fields).toContain('tokens');
      expect(d.summary.historyDelta).toBe(1);
      expect(d.summary.totalTokenDelta).toBe(2000 - 5000); // -3000
    });

    it('returns empty change set for identical snapshots', () => {
      const a = { ts: 't1', requirements: [{ id: 'r1', status: 'done', progress: 100, actual: { tokens: 100 } }], history: [] };
      const b = { ts: 't2', requirements: [{ id: 'r1', status: 'done', progress: 100, actual: { tokens: 100 } }], history: [] };
      const d = diffSnapshots(a, b);
      expect(d.added).toHaveLength(0);
      expect(d.removed).toHaveLength(0);
      expect(d.changed).toHaveLength(0);
    });
  });
});
