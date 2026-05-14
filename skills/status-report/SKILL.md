---
name: codeforesight-status-report
description: Use when the user needs a shareable project status — for a PR description, an email update, a standup summary, or a snapshot of "where we are". Trigger phrases include "项目进度", "给我个总结", "status update", "PR description", "写个总结", "where are we", "milestone summary", "give me a recap". Distinct from audit-gap (which focuses on one requirement); this skill is project-level.
---

# codeForesight — generate shareable status report

Your job: produce a project-level recap by either (a) generating the self-contained HTML report and pointing the user at it, or (b) producing a Markdown summary suitable for pasting into a PR / chat / email — depending on what they need.

## When to fire

Trigger when the user wants a **shareable summary**, not raw data:
- "Give me a status update"
- "Write a PR description for this work"
- "What's the project state for [audience: PM / team / external reviewer]"
- "Snapshot for the weekly meeting"

Do NOT fire if:
- User wants details about ONE requirement → use `audit-gap` instead
- User is debugging or looking at internals
- A report was just generated in this session (use the existing one)

## What to do

1. **Clarify the audience and format** in one short question if ambiguous:
   - "PR description (markdown, paste-ready) or full HTML report (shareable file)?"
   - Default to HTML if they say "report" or "snapshot"; default to markdown if they say "PR" or "message".

2. **For HTML report**:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/bin/codepr.js report --all
   ```
   Then tell user: "Generated at `.codepr/reports/index.html` (X.X MB, self-contained — works offline). Per-req detail: `.codepr/reports/req-NNN.html`."

3. **For Markdown summary**:
   Read `.codepr/requirements.json` and produce 4 sections:
   - **Done this period**: bullet each `req` with `status: done` and `completed_at` in last 7 days; include actual tokens / hours
   - **In progress**: each in_progress req with progress %, actual vs estimated tokens
   - **Risks**: any req where actual > estimate.combined.tokens[1] (over budget), or WIP > 3
   - **Up next**: backlog reqs with priority P0/P1

   Keep under 30 lines total. Use `codepr req list` as the data source.

4. **Optional embed**: if user is making a PR description, suggest:
   - Embed `.codepr/reports/req-<active>.html` link in PR (offline-viewable)
   - Or paste 1-line summary: "req-004: 95% complete, 38k tokens (within 17.9k–74.8k estimate band)"

## Anti-patterns to avoid

- Don't run `report --all` if no requirements registered (suggest `seed-real` for demo or `req add` for real)
- Don't surface internal layer-breakdown estimates in user-facing recap — they want bottom-line numbers
- Don't dump JSON; always summarize human-readable

## Cross-references

- Project report generator: [src/report/generator.js](../../src/report/generator.js) `generateProjectReport()`
- Snapshots for time-travel comparisons: [src/report/snapshots.js](../../src/report/snapshots.js) → after generating, suggest `codepr diff` if multiple snapshots exist
