---
name: codeforesight-calibrate-check
description: Use when the codeForesight estimator is showing signs of systematic drift — repeated misses, suspiciously wide bands, or user expressing frustration with estimates ("估算又不准了", "estimate was way off", "why is the range so big"). Also fire proactively when ≥3 of the last 5 completed requirements fell outside their estimate band. The job is to inspect calibration data and suggest concrete tuning actions.
---

# codeForesight — calibration health check

Your job: read `history.jsonl` and `requirements.json`, evaluate how well the three-layer estimator is performing recently, and propose concrete tuning if drift is real.

## When to fire

Trigger when ANY of:
- User complains about estimate accuracy directly
- The last completed requirement's `actual_tokens` was outside the estimate band (>1.5× upper or <0.5× lower)
- Calibration accuracy from the API has dropped below 50% with n≥5 history entries
- A new requirement's three-layer estimate has high disagreement (high/low > 5×)

Do NOT fire on first miss — wait until pattern is established (≥2 of last 5 outside band, or user-prompted).

## What to do

1. **Pull calibration data**:
   ```
   curl -s http://localhost:7878/api/charts/calibration
   ```
   (Or read `.codepr/history.jsonl` directly if dashboard not running.)

2. **Diagnose the bias**:
   - `meanRatio > 1.2` → systematic **under-estimation** (actuals running high)
   - `meanRatio < 0.8` → systematic **over-estimation** (we're being conservative)
   - `meanRatio ≈ 1.0` but accuracy < 60% → high variance, bands too narrow
   - n < 3 → cold start, advise "wait for more data, not enough signal yet"

3. **Identify the culprit layer**:
   - Look at each requirement's `estimate.layers.{rules,history,ai}` and which one was closest to actual
   - If `rules` consistently overestimates → the user's complexity-keyword multipliers may be too aggressive
   - If `history` keeps missing → KNN may be picking poor neighbors (similar in tags but different in scope)
   - If `ai` is the outlier → prompt may not be calibrated to user's domain

4. **Propose tuning** in concrete edits:
   - **Rule multipliers**: "In `.codepr/config.json`, lower `estimator.rules.complexityMultipliers.auth` from 1.6 to 1.3?"
   - **Weights**: "Reduce `estimator.weights.ai` to 0.3 and bump `history` to 0.5?"
   - **Layer disable**: "If AI estimates keep being noisy, set `weights.ai` to 0 for now."

5. **Suggest next concrete step**:
   - "After your tuning, run `codepr estimate <next-req>` to see the change."
   - "Or pull recent history and rerun: `codepr estimate req-XXX --force`"

## Anti-patterns to avoid

- Don't run with <3 history entries — say "need more data" instead.
- Don't propose config changes >2× from defaults — that's overfit territory.
- Don't fire after every estimation; this is a periodic / on-demand skill.

## Cross-references

- Calibration data source: [src/charts/timeseries.js](../../src/charts/timeseries.js) `calibration()`
- Config defaults: [src/store.js](../../src/store.js) `DEFAULT_CONFIG`
- The three layers: [src/estimator/rules.js](../../src/estimator/rules.js), [history.js](../../src/estimator/history.js), [ai.js](../../src/estimator/ai.js)
