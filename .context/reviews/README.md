# Scrutineer Review System

A multi-expert review framework for auditing the Scrutineer WordPress profiler plugin. Designed to run with any AI coding agent — Claude Code, Codex, OpenCode, Cursor, Aider, or similar.

## Quick Start

### With Claude Code

```bash
# Run a single panel
claude "Run the Scrutineer Solo Freelancer review panel. Follow .context/reviews/panels/solo-freelancer.md"

# Run a full review
claude "Run a full Scrutineer pre-submission review. See .context/reviews/SKILL.md for the process and .context/reviews/panels/ for all panel prompts."
```

### With Any Agent

Point your agent at a panel prompt file and ask it to follow the instructions:

```
Read .context/reviews/panels/wp-beginner.md and execute that review against the current codebase and live POC at poc.scrutineer.dev.
```

### Running Multiple Panels in Parallel

Split the 12 panels into two batches:

**Batch A (code-focused):** WP Core Contributor, Security Reviewer, Plugin Author, Accessibility Auditor, wp.org Plugin Reviewer, Performance Skeptic — these read the codebase and/or run the plugin locally.

**Batch B (product + live site):** Solo Freelancer, Agency CTO, Hosting Support, AI-Native Dev, WP Beginner, HN Heckler — these evaluate the product holistically, ideally against the live POC.

## What's Here

```
.context/reviews/
├── README.md          ← You are here
├── SKILL.md           ← Full review process, panel list, execution flow
└── panels/
    ├── solo-freelancer.md
    ├── agency-cto.md
    ├── plugin-author.md
    ├── hosting-support.md
    ├── security-reviewer.md
    ├── ai-native-dev.md
    ├── wp-beginner.md
    ├── wp-core-contributor.md
    ├── accessibility-auditor.md
    ├── wporg-plugin-reviewer.md
    ├── performance-skeptic.md
    └── hn-heckler.md
```

Each panel is self-contained: it describes the expert persona, what to review, how to structure findings, and where to write output. No external dependencies.

## Finding Format

All panels use the same structure:

```
[SEVERITY] | [CATEGORY] | Location

What: Precise description.
Why it matters: Impact if unfixed.
Evidence: Code snippet, URL, or reproduction steps.
Recommendation: Concrete fix with tradeoffs.
Status: new | recurring (seen in review on YYYY-MM-DD)
```

Severities: 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, 🔵 LOW, ⚪ NOTE, ✅ STRENGTH

## Writing Review Output

Panel results should go to a gitignored location — they're internal work product, not part of the public repo. Recommended: `docs/internal/reviews/` (already gitignored via `docs/internal/`).

## Tips

- **Start with wp.org Plugin Reviewer** if you're preparing for submission.
- **Start with Performance Skeptic** if you're worried about profiler overhead.
- **Start with Security Reviewer** before any public deployment.
- **Start with HN Heckler** for a fast gut-check of the "P3 successor" positioning.
- **WP Core Contributor** is the deepest technical review — run it when measurement accuracy matters.
