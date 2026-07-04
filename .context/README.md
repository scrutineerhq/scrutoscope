# .context/ — Scrutoscope Agent Context

> These files give AI coding agents the context they need to work in this codebase without introducing entropy. Read the relevant files before making changes.

## Files

| File | Purpose | Stability |
|------|---------|-----------|
| `CONSTITUTION.md` | Identity, philosophy, hard rules, terminology. **Never bend these.** | Frozen unless explicitly discussed |
| `DECISIONS.md` | Locked design decisions with rationale. Reversals require discussion. | Append-only |
| `INVARIANTS.md` | Things that must always be true, with verification methods. | Append-only, removal requires approval |
| `STATE.md` | Volatile project snapshot: versions, milestones, accounts, infra. | Updated after significant sessions |
| `PATTERNS.md` | How to write code in this codebase: layout, data flow, conventions. | Updated when patterns change |
| `GOTCHAS.md` | Lessons learned. Every "don't" has a "do." | Append-only |
| `BACKLOG.md` | Known work items by milestone. | Updated as work completes |

## Reading Order

New to the project: `CONSTITUTION.md` → `PATTERNS.md` → `STATE.md`
Making a change: `INVARIANTS.md` → `PATTERNS.md` → `GOTCHAS.md`
Design question: `DECISIONS.md` → `CONSTITUTION.md`

## Master Spec

These `.context/` files are the authoritative agent-actionable context for the Scrutoscope plugin.
