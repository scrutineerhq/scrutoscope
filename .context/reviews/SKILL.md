# Scrutineer Review System

Comprehensive, multi-expert review process for the Scrutineer WordPress profiler plugin. Run before wp.org submission, after major changes, or on a regular cadence.

## Review Panels

This system uses **12 expert panels**, each with a dedicated prompt in `panels/`. Panels are designed to run as parallel tasks in any AI agent harness.

| # | Panel | Prompt | Focus |
|---|-------|--------|-------|
| 1 | Solo Freelancer | `solo-freelancer.md` | Real-world utility, client site workflow, time-to-insight |
| 2 | Agency CTO | `agency-cto.md` | Multi-site fleet, overhead, client reports, team workflow |
| 3 | Plugin Author | `plugin-author.md` | Measurement fairness, attribution accuracy, defensible numbers |
| 4 | Hosting Support | `hosting-support.md` | Ticket triage, customer-facing reports, trust, deployment at scale |
| 5 | Security Reviewer | `security-reviewer.md` | Attack surface, data exposure, nonce handling, Application Passwords |
| 6 | AI-Native Dev | `ai-native-dev.md` | API contract, prompt endpoint, agent interop, diagnostics shape |
| 7 | WP Beginner | `wp-beginner.md` | First-run experience, terminology, overwhelm, "what do I do with this?" |
| 8 | WP Core Contributor | `wp-core-contributor.md` | Measurement accuracy, hook instrumentation, WP API usage, coding standards |
| 9 | Accessibility Auditor | `accessibility-auditor.md` | Dashboard WCAG 2.2, screen reader, keyboard nav, color contrast |
| 10 | wp.org Plugin Reviewer | `wporg-plugin-reviewer.md` | Submission readiness, guideline compliance, security, readme.txt |
| 11 | Performance Skeptic | `performance-skeptic.md` | Profiler overhead, observer effect, measurement accuracy under load |
| 12 | HN Heckler | `hn-heckler.md` | Adversarial "Show HN" critique, P3-successor positioning, claims vs. reality |

## How to Run

### Full Pre-Submission Review
```
Run the full Scrutineer pre-submission review. Use all 12 panels from .context/reviews/panels/.
Present results section by section.
```

### Single Panel
```
Run the Scrutineer [panel name] review panel. Follow .context/reviews/panels/[filename].md.
```

### Re-Review (check previous findings)
```
Re-check all open findings from the last Scrutineer review in docs/internal/reviews/.
```

## Execution Flow

1. **Check for prior findings** — Look in `docs/internal/reviews/` for previous review output
2. **Spawn panels** — Run in two batches:
   - **Batch A** (code-focused): WP Core Contributor, Security Reviewer, Plugin Author, Accessibility Auditor, wp.org Plugin Reviewer, Performance Skeptic
   - **Batch B** (product + live): Solo Freelancer, Agency CTO, Hosting Support, AI-Native Dev, WP Beginner, HN Heckler
3. **Collect results** — Each panel writes to `docs/internal/reviews/panel-{name}.md`
4. **Synthesize** — Merge findings, deduplicate, sort by severity
5. **Create action items** — Concrete fixes with owners and priority

## Context the Agent Needs

Before running panels, the agent should read:

| File | Why |
|------|-----|
| `.context/CONSTITUTION.md` | Architecture, philosophy, red lines |
| `.context/INVARIANTS.md` | Things that must always be true |
| `.context/PATTERNS.md` | Key patterns and anti-patterns |
| `.context/STATE.md` | Current milestone status |
| `.context/DECISIONS.md` | Why things are the way they are |

For live-site panels, the agent needs access to the POC at `poc.scrutineer.dev` (WP admin: `admin` / check with maintainer for current password).
