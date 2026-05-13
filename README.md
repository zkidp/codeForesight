# codeForesight

> **Foresight for AI-driven development** — up-front token & effort estimation, design↔implementation diff, and self-contained HTML reports for [Claude Code](https://claude.com/claude-code) projects.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-purple.svg)](https://claude.com/claude-code)

While most Claude Code companion tools (ccusage, codeburn, TokenTracker, …)
look *backwards* at the tokens you've already spent, **codeForesight looks
forwards**: how many tokens / hours will this requirement cost, where are
we against that budget right now, and what was actually built vs. what was
designed?

---

## Why codeForesight

| Existing tools | What's missing | codeForesight |
|---|---|---|
| ccusage, tokscale, TokenTracker (~10 tools) — backward-looking token usage | No **up-front** estimation | 3-layer estimator (rules + history KNN/embedding + AI) gives a range *before* you start |
| claude-task-viewer, task-tracker-plugin — todo Kanban | No **PRD → reality** check | Scanner diffs declared components against actual code; tells you exactly what's missing |
| Claude HUD — context window monitor | No business-level progress | Token attribution per requirement + 5 charts (burnup / CFD / Gantt / calibration scatter / per-req burnup) |
| All of them — live dashboards only | No **shareable** artifact | One-shot self-contained HTML report (zero external deps, opens offline, drop into PR/email) |

## Three core capabilities

### 1. Up-front estimation (3-layer engine)

For every PRD you register, codeForesight produces a token range AND an
hours range **before development starts**, so you can sanity-check scope:

- **Layer 1 — Rules**: file/acceptance signal × complexity keyword multipliers
- **Layer 2 — History**: KNN over completed requirements; cosine similarity if `VOYAGE_API_KEY` / `OPENAI_API_KEY` set, falls back to tag+text Jaccard
- **Layer 3 — AI**: Claude Haiku gives a range with reasoning (if `ANTHROPIC_API_KEY` set)

Each layer is shown separately. The combined estimate uses min/max
fusion (conservative bounds) and updates a calibration scatter as
requirements complete.

### 2. Design ↔ Implementation diff

Declare expected components in PRD frontmatter:

```yaml
---
id: req-002
title: User login
expects:
  routes:
    - { method: POST, path: /api/auth/login }
  handlers:
    - src/handlers/auth.ts:loginHandler
  hooks:
    - src/middleware/withAuth.ts:withAuth
  db_models:
    - User
    - Session
---
```

A scanner greps the actual codebase (supports Express, NestJS, Spring,
Flask, Django, Rails, Fastify, Prisma, TypeORM, Sequelize, SQLAlchemy,
Mongoose, …) and tells you:

- ✅ Matched (declared + implemented)
- ❌ Missing (declared but not found) — with `scaffold` command to generate stubs
- ⚠️ Deviation (implemented but at a different location)

In reports, any Mermaid diagram in the PRD gets nodes colored by these states.

### 3. Self-contained HTML reports

```sh
codeforesight report req-001    # single requirement
codeforesight report --all      # whole project
```

Outputs `~3.8 MB` single HTML files with **zero external dependencies**.
Chart.js, Luxon, Mermaid runtime all inlined. Works offline, in a PR
comment, in an email, anywhere.

Contents:
1. Status summary (estimate vs actual)
2. AI-generated narrative (current state / gaps / next steps)
3. PRD with rendered Mermaid (status-colored)
4. Design↔Reality audit tables
5. Token burnup chart
6. Code snippets from implemented handlers (syntax-highlighted)
7. Project-level: cross-PRD merged architecture + CFD + Gantt + calibration scatter

## Quick start

```sh
# 1. Clone & install (no dependencies — pure Node ≥18)
git clone https://github.com/zkidp/codePR.git codeforesight
cd codeforesight

# 2. Enable as a Claude Code plugin
# Add .claude-plugin/plugin.json to your CC plugins (see Claude Code docs)

# 3. Write a PRD with frontmatter
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

# 4. Register and estimate
codeforesight req add docs/prd/001-hello.md
codeforesight req active req-001

# 5. Work on it — Claude Code hooks attribute tokens automatically

# 6. Inspect
codeforesight audit req-001        # design ↔ reality
codeforesight progress             # dashboard at localhost:7878
codeforesight report req-001       # offline-capable HTML

# 7. Or see the dogfooded demo of codeForesight tracking itself
codeforesight seed-real
codeforesight report --all && open .codepr/reports/index.html
```

## Features

### Charts (built for AI dev, not classic Scrum)

- **Project Burnup** with estimate envelope — scope changes (revealed by audit) become visible, unlike burndown which hides them
- **Per-requirement Burnup** — actual cumulative tokens vs estimate band; line turns red on over-budget
- **Calibration Scatter** — actual vs estimated tokens for completed reqs, with ±50% tolerance band
- **Cumulative Flow Diagram (CFD)** — Backlog / In Progress / Done stacked area, peak-WIP warning
- **Gantt-lite** — actual duration bars overlaid on estimated upper-bound bars (no dependency graph)

### Snapshots & time travel

When a requirement transitions to `done`, the Stop hook automatically
archives the full project state to `.codepr/snapshots/<ISO>/`. Each
snapshot contains both an HTML report and a `data.json` that lets you
diff any two snapshots semantically.

```sh
codeforesight snapshot list
codeforesight diff 2026-05-10 2026-05-13
```

### Internationalization

Chinese (zh) + English (en) throughout: CLI output, dashboard UI, chart
labels, report sections, AI narrative prompts. ~200 keys per locale.

```sh
codeforesight --lang en req list                 # explicit
CODEFORESIGHT_LANG=en codeforesight req list     # via env
```

Reports embed both locales — a 中 / EN button in the top-right toggles
language live in the browser.

### Theme — follows Claude Code

Reads `~/.claude/settings.json` to default to your CC theme (dark / light
/ system). Reports embed both themes; a 🌙 / ☀️ button toggles live.
All charts re-read CSS variables on toggle.

### Slash commands

| Command | Purpose |
|---|---|
| `/req add\|list\|show\|done\|active\|rm` | Requirement CRUD |
| `/estimate <id>` | Re-run 3-layer estimator |
| `/audit <id>` | Design ↔ reality diff |
| `/scaffold <id>` | Generate stubs for missing items |
| `/sync` | Discover new PRDs |
| `/progress` | Launch dashboard |
| `/report <id>` or `/report --all` | Generate offline HTML report |

### CLI aliases

The binary is invokable as `codeforesight`, `cf`, or `codepr` (kept for
backwards compatibility).

## Architecture

```
codeForesight/
├── .claude-plugin/plugin.json
├── commands/                     # 7 slash commands
├── hooks/                        # SessionStart, UserPromptSubmit, PostToolUse, Stop
├── src/
│   ├── store.js                  # .codepr/{requirements,events,history,config}
│   ├── prd-parser.js             # markdown + frontmatter + mermaid + acceptance
│   ├── jsonl-parser.js           # ~/.claude/projects/<repo>/<session>.jsonl
│   ├── estimator/                # rules, history (KNN), ai, combine, embeddings
│   ├── scanner/                  # routes, handlers, hooks, db, diff (7 frameworks)
│   ├── charts/                   # timeseries aggregation for all 5 charts
│   ├── report/                   # generator, snapshots, mermaid-merger, cc-settings
│   ├── i18n/                     # zh + en locales
│   └── dashboard/                # http server + single-page UI
├── statusline.js
├── bin/codepr.js                 # CLI entrypoint
└── docs/
    ├── PROGRESS.md               # what's been built, version-by-version
    ├── ROADMAP.md                # what's next
    └── prd/                      # sample PRDs (codeForesight's own milestones)
```

Data lives at `<repo>/.codepr/` in your target project — JSONL / JSON
only, no database.

## Privacy & cost

- **All data is local.** JSONL transcripts, requirements, history,
  cache — everything under `<repo>/.codepr/`.
- **AI features are opt-in via env vars.** Without keys, codeForesight
  uses heuristic / rule-based fallbacks.
  - `ANTHROPIC_API_KEY` — AI estimation layer + AI narrative in reports
  - `VOYAGE_API_KEY` or `OPENAI_API_KEY` — semantic embeddings for history calibration
- **No telemetry, no phone-home.** Reports are static HTML.

## Status

**v0.4 — feature complete.** See [docs/PROGRESS.md](docs/PROGRESS.md) for
the detailed changelog and [docs/ROADMAP.md](docs/ROADMAP.md) for what's
next (real-world validation, Marketplace listing, multi-CLI support).

The project dogfoods itself — `codeforesight seed-real` populates the
repo with codeForesight's own development milestones as requirements, so
you can immediately see a fully-realized example of all features.

## Contributing

PRs welcome. The codebase is intentionally dependency-free (pure Node
≥18, zero npm install needed) and uses plain ESM. Keep that constraint.

Before submitting:
1. `codeforesight seed-real && codeforesight report --all` should work
2. Run `node bin/codepr.js req list` and verify Chinese + English output via `--lang`
3. Make sure new user-facing strings have entries in both `src/i18n/locales/{zh,en}.json`

## License

MIT — see [LICENSE](LICENSE).
