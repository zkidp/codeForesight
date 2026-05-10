import { loadHistory } from '../store.js';

export async function estimateByAI(prd, repo, opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || opts.skipNetwork) {
    return heuristicFallback(prd, 'no-api-key');
  }

  const model = process.env.CODEPR_AI_MODEL || 'claude-haiku-4-5-20251001';
  const history = loadHistory(repo).slice(-8);
  const historySnippet = history.length
    ? history.map(h => `- ${h.id} "${h.title || ''}" actual_tokens=${h.actual_tokens} actual_hours=${h.actual_hours}`).join('\n')
    : '(none)';

  const prompt = `You are estimating Claude Code token usage and human-developer wall-clock hours for a single requirement.

Recent completed requirements in this repo (for calibration):
${historySnippet}

Requirement PRD:
---
${prd.raw.slice(0, 6000)}
---

Expected components declared: ${JSON.stringify(prd.expects || {})}
Acceptance items: ${prd.acceptance.length}
Path hints found in PRD: ${prd.pathHints.join(', ') || '(none)'}

Return STRICTLY a single JSON object, no prose, no code fences:
{"tokens":[low,high],"hours":[low,high],"confidence":0.0-1.0,"reasoning":"one short sentence"}
"tokens" are total Claude Code tokens (input+output) for the whole task.
"hours" are wall-clock hours a developer (with Claude Code) spends.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      return heuristicFallback(prd, `http-${res.status}`);
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristicFallback(prd, 'no-json');
    const parsed = JSON.parse(match[0]);
    return {
      layer: 'ai',
      tokens: clampPair(parsed.tokens),
      hours: clampPair(parsed.hours),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.6,
      reasoning: parsed.reasoning || ''
    };
  } catch (e) {
    return heuristicFallback(prd, `err-${e.message?.slice(0, 40) || 'unknown'}`);
  }
}

function heuristicFallback(prd, why) {
  const items = (prd.acceptance.length || 1) + (prd.pathHints.length || 0);
  const tokensMid = items * 5500;
  const hoursMid = items * 0.9;
  return {
    layer: 'ai',
    tokens: [Math.round(tokensMid * 0.6), Math.round(tokensMid * 1.7)],
    hours: [round1(hoursMid * 0.6), round1(hoursMid * 1.7)],
    confidence: 0.3,
    reasoning: `heuristic fallback (${why})`
  };
}

function clampPair(p) {
  if (!Array.isArray(p) || p.length < 2) return [0, 0];
  let [a, b] = [Number(p[0]), Number(p[1])];
  if (!isFinite(a)) a = 0;
  if (!isFinite(b)) b = a;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}

function round1(n) { return Math.round(n * 10) / 10; }
