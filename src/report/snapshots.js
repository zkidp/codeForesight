// 项目快照：在 req 完成时归档完整状态，可后续 diff 看一段时间内的变化。
//
// 快照目录结构：
//   .codepr/snapshots/<ISO-timestamp>/
//     index.html        — 完整项目 HTML 报告
//     data.json         — 当时的 requirements + history 快照
//
// diff 算法：纯数据 diff（不依赖 HTML），所以即使报告模板变更也能比较旧快照。

import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureCodeprDir } from '../paths.js';
import { loadRequirements, loadHistory } from '../store.js';

function snapshotsDir(repo) {
  return path.join(paths(repo).base, 'snapshots');
}

function safeStamp(ts) {
  // Windows 文件名不能含 ':'，这里把 ISO 时间戳转成文件名安全的形式
  return String(ts).replace(/[:.]/g, '-');
}

export function snapshotData(repo) {
  return {
    ts: new Date().toISOString(),
    requirements: loadRequirements(repo).requirements,
    history: loadHistory(repo)
  };
}

export function archiveSnapshot(repo, htmlContent) {
  ensureCodeprDir(repo);
  const dir = snapshotsDir(repo);
  fs.mkdirSync(dir, { recursive: true });
  const snap = snapshotData(repo);
  const folderName = safeStamp(snap.ts);
  const folder = path.join(dir, folderName);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'data.json'), JSON.stringify(snap, null, 2));
  if (htmlContent) {
    fs.writeFileSync(path.join(folder, 'index.html'), htmlContent);
  }
  return { folder, ts: snap.ts };
}

export function listSnapshots(repo) {
  const dir = snapshotsDir(repo);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => fs.statSync(path.join(dir, name)).isDirectory())
    .map(name => {
      const folder = path.join(dir, name);
      let data = null;
      try { data = JSON.parse(fs.readFileSync(path.join(folder, 'data.json'), 'utf8')); } catch {}
      return {
        ts: data?.ts || name.replace(/-/g, ':'),
        folder,
        reqsTotal: data?.requirements?.length || 0,
        reqsDone: (data?.requirements || []).filter(r => r.status === 'done').length,
        historyCount: (data?.history || []).length
      };
    })
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

export function loadSnapshotByTs(repo, ts) {
  const dir = snapshotsDir(repo);
  if (!fs.existsSync(dir)) return null;
  // 精确匹配或前缀匹配（用户可能只给前几个字符）
  const safe = safeStamp(ts);
  const candidates = fs.readdirSync(dir);
  let folder = candidates.find(c => c === safe);
  if (!folder) folder = candidates.find(c => c.startsWith(safe));
  if (!folder) return null;
  const dataPath = path.join(dir, folder, 'data.json');
  if (!fs.existsSync(dataPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    data.folder = path.join(dir, folder);
    return data;
  } catch { return null; }
}

// 数据 diff：返回结构化变化列表
export function diffSnapshots(a, b) {
  const aReqs = new Map((a.requirements || []).map(r => [r.id, r]));
  const bReqs = new Map((b.requirements || []).map(r => [r.id, r]));

  const added = [], removed = [], changed = [];

  for (const [id, br] of bReqs) {
    if (!aReqs.has(id)) { added.push(br); continue; }
    const ar = aReqs.get(id);
    const diffs = [];
    if (ar.status !== br.status) diffs.push({ field: 'status', from: ar.status, to: br.status });
    if ((ar.progress || 0) !== (br.progress || 0)) diffs.push({ field: 'progress', from: ar.progress || 0, to: br.progress || 0 });
    const aTok = ar.actual?.tokens || 0;
    const bTok = br.actual?.tokens || 0;
    if (aTok !== bTok) diffs.push({ field: 'tokens', from: aTok, to: bTok, delta: bTok - aTok });
    if (diffs.length) changed.push({ id, title: br.title, diffs });
  }
  for (const [id, ar] of aReqs) {
    if (!bReqs.has(id)) removed.push(ar);
  }

  const summary = {
    ts: { from: a.ts, to: b.ts },
    reqDelta: (b.requirements?.length || 0) - (a.requirements?.length || 0),
    doneDelta: (b.requirements || []).filter(r => r.status === 'done').length -
               (a.requirements || []).filter(r => r.status === 'done').length,
    totalTokenDelta: (b.requirements || []).reduce((s, r) => s + (r.actual?.tokens || 0), 0) -
                     (a.requirements || []).reduce((s, r) => s + (r.actual?.tokens || 0), 0),
    historyDelta: (b.history?.length || 0) - (a.history?.length || 0)
  };

  return { summary, added, removed, changed };
}
