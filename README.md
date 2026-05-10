# codePR

Claude Code plugin: requirement-driven progress board with a three-layer
token/effort estimator and a design ↔ implementation diff view.

## What makes it different

Most Claude Code companion tools track tokens **after the fact**. codePR
focuses on three things that aren't well covered yet:

1. **Up-front estimation** — for every new PRD, give a token range and an
   hours range *before* development. Three layers combined: rule baseline,
   history-calibrated KNN, and an AI range (Claude). Each layer is shown
   separately so you can tell where the estimate came from.
2. **Design ↔ reality diff** — PRDs declare expected components
   (routes, handlers, hooks, DB models) in YAML frontmatter. A scanner
   greps the actual codebase and tells you exactly which ones are missing,
   present-but-deviating, or matched.
3. **Auto attribution** — Claude Code hooks attribute every tool call's
   tokens to the currently active requirement so you see live progress
   without manually ticking checkboxes.

## Layout

```
codePR/
├── .claude-plugin/plugin.json
├── commands/                 # /req, /estimate, /audit, /scaffold, /sync, /progress
├── hooks/                    # SessionStart, UserPromptSubmit, PostToolUse, Stop
├── src/
│   ├── store.js              # .codepr/{requirements,events,history,config}
│   ├── prd-parser.js         # markdown + frontmatter + mermaid + acceptance
│   ├── jsonl-parser.js       # ~/.claude/projects/<repo>/<session>.jsonl
│   ├── estimator/            # rules, history, ai, combine
│   ├── scanner/              # routes, handlers, hooks, db, diff
│   └── dashboard/            # http server + single-page HTML+JS
├── statusline.js
└── bin/codepr.js             # CLI used by hooks and slash commands
```

## Quick start

```sh
# 1. install plugin (see CC plugin docs) and enable for a target repo
# 2. write a PRD with frontmatter:

cat > docs/prd/001-hello.md <<'MD'
---
id: req-001
title: Add /hello endpoint
tags: [backend]
expects:
  routes:
    - { method: GET, path: /hello }
  handlers:
    - src/handlers/hello.ts:helloHandler
---
# Hello endpoint
- [ ] Return 200 with body "world"
MD

# 3. register and estimate
/req add docs/prd/001-hello.md
/req active req-001

# 4. work on it (Claude Code automatically attributes tokens)

# 5. inspect
/audit req-001
/progress         # opens http://localhost:7878
```

## PRD `expects.*` schema

| key | shape | example |
|---|---|---|
| `routes` | `[ { method, path } ]` | `{ method: POST, path: /api/x }` |
| `handlers` | `[ "file:fnName" ]` | `src/h/auth.ts:loginHandler` |
| `hooks` | `[ "file:hookName" ]` | `src/m/auth.ts:withAuth` |
| `db_models` | `[ "ModelName" ]` | `User` |

When PRD includes a Mermaid diagram, the dashboard's "Design ↔ Reality"
tab colors graph nodes by audit state (green = matched, red = missing,
yellow = deviation).

## Configuration

`.codepr/config.json` (auto-created on first run). Tune
`estimator.weights`, `estimator.rules.complexityMultipliers`, and the
PRD discovery directory `prdDir`.

## Privacy

- Everything is local. JSONL transcripts, requirements, and history all
  live under `<repo>/.codepr/`.
- The AI estimator layer calls the Anthropic API only if
  `ANTHROPIC_API_KEY` is set; otherwise it falls back to a heuristic.
