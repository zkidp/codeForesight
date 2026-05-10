import { estimateByRules } from './rules.js';
import { estimateByHistory } from './history.js';
import { estimateByAI } from './ai.js';

export async function estimate(prd, repo, config, opts = {}) {
  const rules = estimateByRules(prd, config);
  const history = estimateByHistory(prd, repo);
  const ai = await estimateByAI(prd, repo, opts);

  const layers = { rules, history, ai };
  const usableHistory = history.tokens && history.hours;
  const w = usableHistory ? config.estimator.weights : config.estimator.weightsNoHistory;

  const combined = combineLayers(layers, w, usableHistory);

  return { layers, combined };
}

function combineLayers(layers, weights, usableHistory) {
  const tokenLows = [], tokenHighs = [];
  const hourLows = [], hourHighs = [];
  let confSum = 0, wSum = 0;

  push('rules', layers.rules);
  if (usableHistory) push('history', layers.history);
  push('ai', layers.ai);

  function push(name, l) {
    const w = weights[name] ?? 0;
    if (!w) return;
    if (l.tokens) { tokenLows.push(l.tokens[0]); tokenHighs.push(l.tokens[1]); }
    if (l.hours) { hourLows.push(l.hours[0]); hourHighs.push(l.hours[1]); }
    confSum += w * (l.confidence ?? 0);
    wSum += w;
  }

  return {
    tokens: [Math.round(min(tokenLows)), Math.round(max(tokenHighs))],
    hours: [round1(min(hourLows)), round1(max(hourHighs))],
    confidence: wSum ? round2(confSum / wSum) : 0
  };
}

function min(a) { return a.length ? Math.min(...a) : 0; }
function max(a) { return a.length ? Math.max(...a) : 0; }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
