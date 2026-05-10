export function estimateByRules(prd, config) {
  const r = config.estimator.rules;
  const expects = prd.expects || {};
  const expectedCount =
    (expects.routes?.length || 0) +
    (expects.handlers?.length || 0) +
    (expects.hooks?.length || 0) +
    (expects.db_models?.length || 0) +
    (expects.services?.length || 0);

  const fileSignal = Math.max(prd.pathHints.length, expectedCount, 1);
  const acceptanceSignal = Math.max(prd.acceptance.length, 1);

  let mult = 1.0;
  const lower = (prd.body + ' ' + prd.tags.join(' ')).toLowerCase();
  for (const [k, v] of Object.entries(r.complexityMultipliers)) {
    if (lower.includes(k)) mult = Math.max(mult, v);
  }

  const tokensBase = fileSignal * r.baseTokensPerFile + acceptanceSignal * r.baseTokensPerAcceptance;
  const hoursBase = fileSignal * r.baseHoursPerFile + acceptanceSignal * r.baseHoursPerAcceptance;

  const tokens = round2([tokensBase * mult * 0.7, tokensBase * mult * 1.5]);
  const hours = round2([hoursBase * mult * 0.7, hoursBase * mult * 1.5]);

  return {
    layer: 'rules',
    tokens,
    hours,
    confidence: 0.4,
    signals: { fileSignal, acceptanceSignal, complexityMult: mult }
  };
}

function round2(arr) {
  return arr.map(n => Math.round(n * 100) / 100);
}
