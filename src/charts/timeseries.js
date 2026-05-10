import fs from 'node:fs';
import { paths } from '../paths.js';
import { loadRequirements, loadHistory } from '../store.js';

export function readEvents(repo) {
  const p = paths(repo);
  if (!fs.existsSync(p.events)) return [];
  return fs.readFileSync(p.events, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function projectBurnup(repo, opts = {}) {
  const events = readEvents(repo);
  const data = loadRequirements(repo);
  const reqs = data.requirements;

  if (!reqs.length) {
    return { points: [], scopeUpper: 0, scopeLower: 0, started: null, now: new Date().toISOString() };
  }

  const reqMeta = new Map(reqs.map(r => [r.id, {
    estLow: r.estimate?.combined?.tokens?.[0] || 0,
    estHigh: r.estimate?.combined?.tokens?.[1] || 0,
    estLowH: r.estimate?.combined?.hours?.[0] || 0,
    estHighH: r.estimate?.combined?.hours?.[1] || 0,
    createdAt: r.created_at,
    completedAt: r.actual?.completed_at,
    status: r.status
  }]));

  const interestEvents = [];
  for (const r of reqs) {
    if (r.created_at) {
      interestEvents.push({ ts: r.created_at, type: 'req_added', req: r.id });
    }
    if (r.actual?.completed_at) {
      interestEvents.push({ ts: r.actual.completed_at, type: 'req_done', req: r.id });
    }
  }
  for (const e of events) {
    if (e.type === 'tool_use' && e.req && e.tokens) {
      interestEvents.push({ ts: e.ts, type: 'tool_use', req: e.req, tokens: e.tokens });
    }
  }
  interestEvents.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const cumActualByReq = new Map();
  const knownReqs = new Set();
  const completedReqs = new Set();
  const points = [];

  if (interestEvents.length) {
    points.push({
      ts: interestEvents[0].ts,
      scopeUpper: 0, scopeLower: 0,
      actualTotal: 0, completedScope: 0,
      reqsKnown: 0, reqsDone: 0
    });
  }

  let scopeUpper = 0, scopeLower = 0;
  let actualTotal = 0, completedScope = 0;

  for (const e of interestEvents) {
    if (e.type === 'req_added') {
      const m = reqMeta.get(e.req);
      if (m && !knownReqs.has(e.req)) {
        knownReqs.add(e.req);
        scopeUpper += m.estHigh;
        scopeLower += m.estLow;
      }
    } else if (e.type === 'tool_use') {
      const cur = cumActualByReq.get(e.req) || 0;
      cumActualByReq.set(e.req, cur + e.tokens);
      actualTotal += e.tokens;
    } else if (e.type === 'req_done') {
      const m = reqMeta.get(e.req);
      if (m && !completedReqs.has(e.req)) {
        completedReqs.add(e.req);
        completedScope += m.estHigh;
      }
    }
    points.push({
      ts: e.ts,
      scopeUpper,
      scopeLower,
      actualTotal,
      completedScope,
      reqsKnown: knownReqs.size,
      reqsDone: completedReqs.size
    });
  }

  const totalUpper = reqs.reduce((s, r) => s + (r.estimate?.combined?.tokens?.[1] || 0), 0);
  const totalLower = reqs.reduce((s, r) => s + (r.estimate?.combined?.tokens?.[0] || 0), 0);
  const totalActual = reqs.reduce((s, r) => s + (r.actual?.tokens || 0), 0);
  const nowPoint = {
    ts: new Date().toISOString(),
    scopeUpper: totalUpper,
    scopeLower: totalLower,
    actualTotal: totalActual,
    completedScope,
    reqsKnown: reqs.length,
    reqsDone: reqs.filter(r => r.status === 'done').length,
    isNow: true
  };
  points.push(nowPoint);

  return {
    points,
    scopeUpper: totalUpper,
    scopeLower: totalLower,
    started: points[0]?.ts || null,
    now: nowPoint.ts,
    summary: {
      reqsTotal: reqs.length,
      reqsDone: nowPoint.reqsDone,
      actualTokens: totalActual,
      estimatedRange: [totalLower, totalUpper]
    }
  };
}

export function cfd(repo) {
  const data = loadRequirements(repo);
  const reqs = data.requirements;
  if (!reqs.length) return { points: [], summary: { backlog: 0, in_progress: 0, done: 0 } };

  const transitions = [];
  for (const r of reqs) {
    if (r.created_at) transitions.push({ ts: r.created_at, req: r.id, to: 'backlog' });
    if (r.actual?.started_at) transitions.push({ ts: r.actual.started_at, req: r.id, to: 'in_progress' });
    if (r.actual?.completed_at) transitions.push({ ts: r.actual.completed_at, req: r.id, to: 'done' });
    if (r.status === 'in_progress' && !r.actual?.started_at && r.created_at) {
      transitions.push({ ts: r.created_at, req: r.id, to: 'in_progress' });
    }
    if (r.status === 'done' && !r.actual?.completed_at && r.created_at) {
      transitions.push({ ts: r.created_at, req: r.id, to: 'done' });
    }
  }
  transitions.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const reqState = new Map();
  const points = [];
  if (transitions.length) {
    points.push({
      ts: transitions[0].ts,
      backlog: 0, in_progress: 0, done: 0
    });
  }

  for (const t of transitions) {
    reqState.set(t.req, t.to);
    const counts = { backlog: 0, in_progress: 0, done: 0 };
    for (const s of reqState.values()) counts[s] = (counts[s] || 0) + 1;
    points.push({ ts: t.ts, ...counts });
  }

  const finalCounts = { backlog: 0, in_progress: 0, done: 0 };
  for (const r of reqs) finalCounts[r.status] = (finalCounts[r.status] || 0) + 1;
  points.push({
    ts: new Date().toISOString(),
    ...finalCounts,
    isNow: true
  });

  const maxInProgress = Math.max(0, ...points.map(p => p.in_progress));

  return {
    points,
    summary: {
      ...finalCounts,
      total: reqs.length,
      maxInProgress,
      wipWarning: maxInProgress >= 4
    }
  };
}

export function gantt(repo) {
  const data = loadRequirements(repo);
  const reqs = data.requirements;
  const nowIso = new Date().toISOString();

  const rows = reqs.map(r => {
    const start = r.actual?.started_at || r.created_at || nowIso;
    const end = r.actual?.completed_at || (r.status !== 'backlog' ? (r.actual?.last_at || nowIso) : start);
    const estHours = r.estimate?.combined?.hours?.[1] || 0;
    let estEnd = null;
    if (estHours > 0 && r.actual?.started_at) {
      estEnd = new Date(new Date(r.actual.started_at).getTime() + estHours * 3_600_000).toISOString();
    } else if (estHours > 0 && r.created_at) {
      estEnd = new Date(new Date(r.created_at).getTime() + estHours * 3_600_000).toISOString();
    }
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      start,
      end,
      estStart: r.actual?.started_at || r.created_at,
      estEnd,
      estHours,
      actualTokens: r.actual?.tokens || 0,
      estTokens: r.estimate?.combined?.tokens || null,
      progress: r.progress || 0
    };
  });

  rows.sort((a, b) => new Date(a.start) - new Date(b.start));

  return { rows };
}

export function calibration(repo) {
  const history = loadHistory(repo);
  const points = [];
  for (const h of history) {
    if (!h.estimated || h.actual_tokens == null) continue;
    const tok = h.estimated.tokens;
    const hr = h.estimated.hours;
    if (!Array.isArray(tok)) continue;
    const tokMid = (tok[0] + tok[1]) / 2;
    const tokUpper = tok[1];
    const tokLower = tok[0];
    const hrMid = hr ? (hr[0] + hr[1]) / 2 : null;
    points.push({
      id: h.id,
      title: h.title || h.id,
      ts: h.ts,
      tokens: {
        mid: tokMid,
        upper: tokUpper,
        lower: tokLower,
        actual: h.actual_tokens,
        inRange: h.actual_tokens >= tokLower && h.actual_tokens <= tokUpper,
        ratio: tokMid ? h.actual_tokens / tokMid : null
      },
      hours: hr && h.actual_hours != null ? {
        mid: hrMid,
        upper: hr[1],
        lower: hr[0],
        actual: h.actual_hours,
        inRange: h.actual_hours >= hr[0] && h.actual_hours <= hr[1]
      } : null
    });
  }

  const inRangeTok = points.filter(p => p.tokens.inRange).length;
  const accuracy = points.length ? Math.round(inRangeTok / points.length * 1000) / 10 : 0;
  const meanRatio = points.length
    ? Math.round(points.reduce((s, p) => s + (p.tokens.ratio || 1), 0) / points.length * 100) / 100
    : 1;

  let maxValue = 0;
  for (const p of points) {
    maxValue = Math.max(maxValue, p.tokens.upper, p.tokens.actual);
  }

  return {
    points,
    summary: {
      n: points.length,
      inRange: inRangeTok,
      accuracy,
      meanRatio,
      bias: meanRatio < 1 ? 'overestimate' : meanRatio > 1 ? 'underestimate' : 'neutral'
    },
    maxValue: maxValue || 1
  };
}

export function reqBurnup(repo, reqId) {
  const events = readEvents(repo);
  const data = loadRequirements(repo);
  const r = data.requirements.find(x => x.id === reqId);
  if (!r) return null;

  const tu = events
    .filter(e => e.type === 'tool_use' && e.req === reqId && e.tokens)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const startTs = r.actual?.started_at || r.created_at || tu[0]?.ts || new Date().toISOString();
  const points = [{ ts: startTs, cumulative: 0 }];
  let cum = 0;
  for (const e of tu) {
    cum += e.tokens;
    points.push({ ts: e.ts, cumulative: cum });
  }
  if (!tu.length || points[points.length - 1].ts !== new Date().toISOString()) {
    points.push({
      ts: r.actual?.completed_at || r.actual?.last_at || new Date().toISOString(),
      cumulative: cum,
      isNow: !r.actual?.completed_at
    });
  }

  return {
    reqId,
    title: r.title,
    estimate: r.estimate?.combined?.tokens || null,
    estimateLayers: {
      rules: r.estimate?.layers?.rules?.tokens || null,
      history: r.estimate?.layers?.history?.tokens || null,
      ai: r.estimate?.layers?.ai?.tokens || null
    },
    points,
    actual: cum,
    overBudget: r.estimate?.combined?.tokens?.[1] ? cum > r.estimate.combined.tokens[1] : false
  };
}
