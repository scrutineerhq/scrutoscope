# STATE

> Volatile snapshot of the project. Updated after significant sessions.

**Last updated:** 2026-06-25 (Phase D — timeline interactivity + UX panel complete)

## Version

- Plugin: `1.0.0`
- Phase: 1 (Scrutinizer — profiler only)
- Milestone: Phase C share improvements deployed

## Codebase

| Component | Status |
|-----------|--------|
| Plugin bootstrap (`scrutinizer.php`) | ✅ Functional |
| Profiler engine (`includes/Profiler/`) | ✅ Complete |
| API (`includes/Api/`) | ✅ Complete — 5 endpoints |
| Admin UI (`includes/Admin/`) | ✅ Functional — 21 AJAX handlers |
| CSS/JS (`assets/`) | ✅ Complete — lazy-load, trace explorer, share w/ gzip |
| WP-CLI (`includes/CLI/`) | ✅ Complete — 6 commands |
| Share relay (`scrutinizer.dev`) | ✅ Deployed — CF Worker + R2 + KV |
| Viewer (`scrutinizer.dev/view`) | ✅ File upload drop zone |
| Tests (`tests/`) | ⬜ Empty |

## What Changed This Session (June 25)

### Phase D: Timeline Interactivity + UX Panel Completion
- Timeline zoom/pan: scroll-to-zoom (up to 40×), drag-to-pan, zoom buttons (+/-/reset)
- Rich hover tooltips on timeline segments (callback, source, duration, share %)
- Counter-scaled text labels (milestones, HTTP lollipops, axis ticks)
- F10: SVG trend sparkline in route drilldown (last 50 profiles, stats row)
- F15: `/v1/manifest` endpoint — public JSON API manifest for AI agent discovery
- F17: API audit log — tracks endpoint, IP, user agent, timestamp (last 100 entries)
- F18: Instrumentation overhead notice in background measurement controls

### Phase C: Share Improvements
- Gzip compression before AES-256-GCM encryption (CompressionStream API)
- Relay migrated from KV to R2 for report storage (10MB limit, up from 2MB)
- KV retained for rate limiting only
- Viewer decompresses after decryption (DecompressionStream API)
- File upload drop zone at scrutinizer.dev/view (D39)
- Viewer branding: "Scrutinizer Report" with mono wordmark
- Button states: Compressing → Encrypting → Uploading

## Milestones

| Milestone | Status |
|-----------|--------|
| M0-M2 | ✅ Complete |
| M2.5 — AI Agent API | ✅ Complete |
| UX Panel | ✅ 18/18 implemented |
| M5 — WP-CLI | ✅ Complete |
| M4 — Report Sharing | ✅ Complete |
| Soft Launch | ✅ Ready |
| M3 — Compare Workflow | ⬜ Not started |
| M6 — wp.org | ⬜ Not started |

## Next Up

- M6 — wp.org prep (i18n, readme.txt, screenshots, security audit)
- Shared hosting benchmarking
- Bug cluster #1 timeline interactivity ✅ (shipped)
- Bug cluster #9 agent UI ✅ (already shipped)
- F13: contextual help tooltips for jargon terms (COULD)
- LinkedIn launch post
- Beta launch (Google Form + LinkedIn)
