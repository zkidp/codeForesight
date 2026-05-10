import { loadHistory } from '../store.js';

export function estimateByHistory(prd, repo) {
  const history = loadHistory(repo);
  if (history.length < 3) {
    return { layer: 'history', tokens: null, hours: null, confidence: 0, neighbors: [], reason: 'cold-start' };
  }

  const target = featurize(prd);
  const scored = history
    .filter(h => h.actual_tokens && h.actual_hours)
    .map(h => ({ entry: h, score: similarity(target, featurize(h.prd || h)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (!scored.length) {
    return { layer: 'history', tokens: null, hours: null, confidence: 0, neighbors: [] };
  }

  const totalScore = scored.reduce((s, x) => s + x.score, 0) || 1;
  let tokSum = 0, hourSum = 0;
  for (const x of scored) {
    const w = x.score / totalScore;
    tokSum += w * x.entry.actual_tokens;
    hourSum += w * x.entry.actual_hours;
  }

  return {
    layer: 'history',
    tokens: [Math.round(tokSum * 0.75), Math.round(tokSum * 1.4)],
    hours: [round1(hourSum * 0.75), round1(hourSum * 1.4)],
    confidence: Math.min(0.85, scored[0].score),
    neighbors: scored.map(s => ({ id: s.entry.id, title: s.entry.title, score: round2(s.score) }))
  };
}

function featurize(o) {
  return {
    tags: new Set((o.tags || []).map(t => String(t).toLowerCase())),
    tokens: tokenize((o.title || '') + ' ' + (o.body || '').slice(0, 2000))
  };
}

function tokenize(s) {
  return new Set(
    String(s).toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, ' ')
      .split(' ')
      .filter(w => w.length > 1)
  );
}

function similarity(a, b) {
  const tagJ = jaccard(a.tags, b.tags);
  const textJ = jaccard(a.tokens, b.tokens);
  return 0.4 * tagJ + 0.6 * textJ;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
