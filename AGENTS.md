# AGENTS.md

Authoritative agent context for the **Scrutinizer** plugin lives in [`.context/`](.context/).
Read the relevant files there **before** making changes — they exist to keep agents from introducing entropy.

Start with [`.context/README.md`](.context/README.md), which indexes everything and gives the reading order.

## Context files

| File | Purpose | Stability |
|------|---------|-----------|
| [`.context/CONSTITUTION.md`](.context/CONSTITUTION.md) | Identity, philosophy, hard rules, terminology. **Never bend these.** | Frozen unless explicitly discussed |
| [`.context/DECISIONS.md`](.context/DECISIONS.md) | Locked design decisions with rationale. Reversals require discussion. | Append-only |
| [`.context/INVARIANTS.md`](.context/INVARIANTS.md) | Things that must always be true, with verification methods. | Append-only; removal requires approval |
| [`.context/STATE.md`](.context/STATE.md) | Volatile project snapshot: versions, milestones, accounts, infra. | Updated after significant sessions |
| [`.context/PATTERNS.md`](.context/PATTERNS.md) | How to write code here: layout, data flow, conventions. | Updated when patterns change |
| [`.context/GOTCHAS.md`](.context/GOTCHAS.md) | Lessons learned. Every "don't" has a "do." | Append-only |
| [`.context/BACKLOG.md`](.context/BACKLOG.md) | Known work items by milestone. | Updated as work completes |
| [`.context/PANEL.md`](.context/PANEL.md) | Standing review panel. | — |
| [`.context/reviews/`](.context/reviews/) | Review panel notes and skill. | — |

## Reading order

- **New to the project:** `CONSTITUTION.md` → `PATTERNS.md` → `STATE.md`
- **Making a change:** `INVARIANTS.md` → `PATTERNS.md` → `GOTCHAS.md`
- **Design question:** `DECISIONS.md` → `CONSTITUTION.md`
