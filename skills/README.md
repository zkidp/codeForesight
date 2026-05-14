# codeForesight Skills

These are **proactive** entry points to codeForesight — Claude Code's AI invokes them based on user intent, complementing the explicit `/req`, `/audit`, `/report` slash commands.

| Skill | Fires when user… | Action |
|---|---|---|
| [estimate-first](estimate-first/SKILL.md) | Describes a new feature to start building | Drafts a PRD, runs 3-layer estimation, sets it active |
| [audit-gap](audit-gap/SKILL.md) | Asks "are we done / what's missing / design vs reality" | Runs scanner, summarizes gap, offers `scaffold` |
| [status-report](status-report/SKILL.md) | Asks for a shareable summary (PR / standup / weekly) | Generates HTML report OR markdown recap |
| [calibrate-check](calibrate-check/SKILL.md) | Estimator drifts (≥2 misses or user complaint) | Diagnoses bias, suggests config tuning |

## Layered model

```
User intent → Skill (proactive) ─┐
                                  ├─→ bin/codepr.js (deterministic CLI)
Explicit slash command ──────────┘
```

Skills produce structured suggestions and invoke the same CLI underneath, so they're never "magic" — every action is auditable as a `node bin/codepr.js ...` invocation.

## When to add a new skill

A new skill makes sense when:
1. There's a recurring user intent that *currently requires remembering a slash command*
2. The desired action involves > 1 step (draft + register + estimate, or run + summarize)
3. Doing it via plugin alone feels unnatural (e.g. "I want to plan something" → no slash command matches but `estimate-first` does)

Skip a new skill when:
- Single slash command already covers it cleanly
- Action is high-stakes / destructive (skills should be advisory; destructive ops should be explicit)
