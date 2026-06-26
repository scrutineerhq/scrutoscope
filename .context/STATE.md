# STATE

> Volatile snapshot of the project. Updated after significant sessions.

**Last updated:** 2026-06-26

## Version

- Plugin: `1.0.0`
- PHP: 7.4+
- WordPress: 6.0+

## Codebase

| Component | Status |
|-----------|--------|
| Plugin bootstrap (`scrutinizer.php`) | ✅ Functional |
| Profiler engine (`includes/Profiler/`) | ✅ Complete |
| API (`includes/Api/`) | ✅ Complete — 6 REST endpoints |
| Admin UI (`includes/Admin/`) | ✅ Functional — 31 AJAX handlers |
| CSS/JS (`assets/`) | ✅ Complete — lazy-load, trace explorer, share w/ gzip |
| WP-CLI (`includes/Cli/`) | ✅ Complete — 7 subcommands |
| Share relay (`scrutinizer.dev`) | ✅ Deployed — CF Worker + R2 + KV |
| Viewer (`scrutinizer.dev/view`) | ✅ File upload + relay decryption |
| Landing page (`scrutineer.dev`) | ✅ Deployed — CF Worker |
| Tests (`tests/`) | ⬜ Empty |

## Milestones

| Milestone | Status |
|-----------|--------|
| M1 — Core Instrumentation | ✅ Complete |
| M2 — Deep Mode & Timeline | ✅ Complete |
| M2.5 — AI Agent API & Sharing | ✅ Complete |
| M3 — Compare Workflow | ✅ Complete |
| M4 — Report Sharing | ✅ Complete (absorbed into M2.5) |
| M5 — WP-CLI | ✅ Complete |
| M5.5 — Data Lifecycle & Share Mgmt | ✅ Complete |
| UX Panel (18 findings) | ✅ 18/18 implemented |
| M5.6 — Cron Profiling Integration | ⬜ Not started |
| M6 — wp.org Submission | 🔧 In progress |

## M6 Progress

Done:
- `uninstall.php` (clean teardown)
- `handle_prompt` → proper REST response
- API log → custom table
- Cron registration optimization
- Contrast/a11y fixes, milestone clipping, queries pill labels
- Shared reports ledger + profile TTL (7d default, configurable)

Remaining:
- i18n (JS + PHP string wrapping, .pot generation)
- a11y (ARIA tab pattern, focus trap, screen reader announcements)
- Relay viewer CSP header
- Tab active-state visual consistency
- wp.org readme (readme.txt, screenshots, FAQ, changelog)
- Security audit (activation flow, cookies, CSRF, nonces)
- wp.org submission

## Next Up

- M6 completion (i18n, a11y, wp.org readme, security audit)
- M5.6 cron profiling integration
