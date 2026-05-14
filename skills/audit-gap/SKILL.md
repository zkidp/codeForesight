---
name: codeforesight-audit-gap
description: Use when the user asks about completion status, gaps between what was designed and what's actually implemented, or what's still missing. Trigger phrases include "做完了吗", "还缺什么", "什么没实现", "are we done", "what's missing", "design vs reality", "audit", "check progress on req-X". Especially valuable right before a PR is opened or a milestone is closed.
---

# codeForesight — design ↔ reality audit

Your job: run codeForesight's scanner against the active (or specified) requirement, summarize the gap in one paragraph, and offer concrete next actions (e.g., `/scaffold` for missing items).

## When to fire

Trigger when the user:
- Asks completion/status questions ("are we done", "what's left", "做完了吗")
- Mentions opening a PR ("ready for review", "submit PR", "merge into main")
- Asks for design-vs-implementation comparison
- Mentions a specific `req-XXX` and wants its current state

## What to do

1. **Resolve target requirement**:
   - If user mentions `req-XXX` explicitly → use that id
   - Else read `.codepr/active-req` for the active one
   - If neither → ask "Which requirement?" with `codepr req list` output

2. **Run audit**:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js audit <id>
   ```

3. **Parse the output** and summarize in this shape:
   - **Status line** (1 short sentence): "req-002 is 5/7 = 71% implemented; 2 items missing."
   - **Missing items** (bulleted, with file paths): each as `❌ POST /api/foo (expected at src/routes/foo.ts)`
   - **Deviations** if any: each as `⚠️ loginHandler is at src/auth/login.ts, not src/handlers/auth.ts as declared`

4. **Suggest next action**:
   - If `missing > 0` and items are simple stubs → "Run `/scaffold <id>` to generate placeholder files? Then we can fill them in."
   - If `deviations > 0` only → "Want me to update the PRD's `expects.*` to match where things actually live?"
   - If all matched → "✅ Design and implementation match. Ready to mark `req done` and snapshot?"

5. **Optional**: If user wants a deeper look, generate the HTML report:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js report <id>
   ```
   and point them at the file path (architecture diagram will have colored nodes).

## Anti-patterns to avoid

- Don't run audit on every status question — if user just asked "what time is it 工期" or similar non-completion question, skip.
- Don't paste raw audit output without summarizing — humans want the headline first.
- If audit finds 0 declared `expects.*`, gently suggest the PRD's frontmatter could be richer.

## Cross-references

- Scanner: [src/scanner/diff.js](../../src/scanner/diff.js)
- Supported frameworks: see [src/scanner/routes.js](../../src/scanner/routes.js), [handlers.js](../../src/scanner/handlers.js), [db.js](../../src/scanner/db.js), [hooks.js](../../src/scanner/hooks.js)
- After "all matched" → the `status-report` skill can summarize for PR description
