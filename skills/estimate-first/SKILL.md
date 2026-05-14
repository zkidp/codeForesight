---
name: codeforesight-estimate-first
description: Use when the user describes a NEW feature or requirement they want to start implementing — before any code is written. Trigger phrases include "我想加个 X 功能", "Let's build X", "新功能", "implement X", "add a new endpoint/page/feature", "下一步做 Y". Skip when an active codeForesight requirement already covers the described work (check `.codepr/active-req` and `requirements.json` first).
---

# codeForesight — estimate before implementing

Your job: when a user announces they're about to start a new piece of work, gently propose the codeForesight up-front estimation flow BEFORE diving into implementation. This prevents scope blindness and feeds the calibration loop.

## When to fire

Trigger when ALL of these are true:
1. User describes work they have not started yet (no related files just created, no in-progress active req)
2. The work is at least one acceptance criterion's worth of effort (not a one-line tweak)
3. No matching requirement exists yet under `<repo>/docs/prd/` or in `.codepr/requirements.json`

Do NOT fire if:
- User is asking a question, doing research, or debugging existing code
- User explicitly says "skip estimation" or "just code it"
- There's already an active req covering this (check `.codepr/active-req` text contents)

## What to do

1. **Confirm intent in one short line**: "Sounds like a new feature — want me to register a PRD and estimate first?" Wait for yes.
2. **Draft a minimal PRD** at `docs/prd/<id>-<slug>.md` with frontmatter:
   ```yaml
   ---
   id: req-<NNN>            # next number after existing PRDs
   title: <one-line title>
   priority: P1
   tags: [<infer 1-3 tags>]
   expects:
     routes: [...]          # inferable from feature description
     handlers: [...]
     db_models: [...]
   ---
   ```
   Body: 1 paragraph context + 3–5 acceptance criteria as `- [ ]` checklist.
3. **Register and estimate** in one bash call:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js req add docs/prd/<file>.md
   node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js req active <id>
   ```
4. **Surface the estimate** to the user concisely:
   - "Estimated 18–42k tokens / 3.5–8h. Three-layer breakdown attached. Calibration accuracy on similar past requirements: 87%."
   - If estimate range is suspiciously wide (high/low > 4×), say so: "Wide range — PRD might be too vague; consider adding more `expects.*` items."
5. **Hand control back** to the user: "Ready to start? I'll attribute tokens to this req as we go."

## Anti-patterns to avoid

- Don't make the PRD too long — keep it under 30 lines. The user can refine it later.
- Don't guess `expects.handlers` paths with high confidence; mark uncertain ones with `# TODO: confirm path`.
- Don't auto-run if the user is clearly mid-conversation about an existing feature.

## Cross-references

- The actual estimator: [src/estimator/combine.js](../../src/estimator/combine.js)
- PRD frontmatter schema: [docs/prd/001-foundation.md](../../docs/prd/001-foundation.md) (good example)
- After registration, `audit-gap` skill can be invoked when user later asks "did I finish?"
