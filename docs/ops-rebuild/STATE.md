# Operations Rebuild — State

**Last updated:** 2026-05-05 by ops-decom-engineer (Phase 10 shipped — 🎉 rebuild complete)
**Active phase:** —
**Active ticket:** —
**Active specialist:** —

## Decisions locked (P1–P9)

All decisions take the listed plan defaults unless explicitly changed.

| # | Decision | Locked value |
|---|---|---|
| P1 | Per-client OAuth for Google Ads / Meta | **Agency-level only**; per-client deferred behind future flag |
| P2 | Search Console auth | **Per-client OAuth** via `oauth_connections` |
| P3 | PSI vs Lighthouse-CI | **PSI first**; swap if quota becomes pain |
| P4 | Report format | **In-app HTML**; PDF deferred |
| P5 | Action surface for AI | **Read-only ads in v1**; mutations only on website |
| P6 | Existing `audit_runs` analytics | **Keep separate**; revisit in Phase 10 |
| P7 | Token budget per client per month | **$5/client/month** default cap |
| P8 | Run cadence mix | **Daily essentials + Weekly deep + Monthly audit** |
| P9 | Drift baseline strategy | **Versioned baselines** — no silent rollover; explicit accept |

Adoption option (§16.7): **Option 3 — full agent set** (10 specialists + coordinator).

## Phase status

- [x] Phase 0 — Stabilize (shipped 2026-05-05; see `phases/phase-0-completion.md`)
- [x] Phase 1 — Domain model foundation (shipped 2026-05-05; see `phases/phase-1-completion.md`; commits `9bf31c4`, `1b9daaa`, `060827f`)
- [x] Phase 2 — Run orchestration (shipped 2026-05-05; see `phases/phase-2-completion.md`; commits `8aac341`, `55a0a0c`, `458440c`, `419ad73`, `afa7c3f`)
- [x] Phase 3 — Website umbrella v1 (shipped 2026-05-05; see `phases/phase-3-completion.md`; commits `143feed`, `af5a7c0`, `0125ed2`, `267ffc4`, `9f38b51`, `de891d4`, `eaf81f8`)
- [x] Phase 4 — Google Ads umbrella (shipped 2026-05-05; see `phases/phase-4-completion.md`; commits `bbf20d7`, `bd5f9fd`, `4c90f36`, `b8b7353`)
- [x] Phase 5 — Meta umbrella (shipped 2026-05-05; see `phases/phase-5-completion.md`; commits `23215d4`, `ee63f06`, `c21f764`, plus seed migration in C4)
- [x] Phase 6 — Correlation + reporting (shipped 2026-05-05; see `phases/phase-6-completion.md`; commits `2ebe16d`, `8492bec`, `18d517f`, `7095219`, `88db55c`, `f2fa474`, `707eac5`)
- [x] Phase 7 — AI supervisor + sub-agents (shipped 2026-05-05; see `phases/phase-7-completion.md`; commits `65b5eae`, `43f92a3`)
- [x] Phase 8 — Scheduling + tier economics (shipped 2026-05-05; see `phases/phase-8-completion.md`; commits `93a8422`, `bfad7ba`)
- [x] Phase 9 — UI rebuild (shipped 2026-05-05; see `phases/phase-9-completion.md`)
- [x] Phase 10 — Decommission + cleanup (shipped 2026-05-05; see `phases/phase-10-completion.md`)

🎉 **Rebuild complete** — all 11 phases shipped on 2026-05-05.

### Phase 3 sub-tickets

- [x] 5.1 Re-home Kinsta drift as `web.kinsta.drift` + new `web.tracking_install`
- [x] 5.2 PSI / Core Web Vitals (composite `web.psi` check, quota tracker)
- [x] 5.3 SSL (`web.ssl.expiry_within_30d`, `web.ssl.expiry_within_7d`) + `web.uptime.reachable`
- [x] 5.4 Schema validation (`web.schema.has_organization`, `has_localbusiness`, `parse_errors`)
- [x] 5.5 Search Console checks + per-client OAuth scaffold (full UI flow deferred to Phase 8)
- [x] 5.6 SEMrush checks (`organic_traffic_drop`, `top_keywords_lost`, `toxic_backlinks`)
- [x] 5.7 WPVuln feed (`ops_vuln_feed` table + `web.wp_security` cross-ref check)
- [x] 5.8 Broken-links stub (`web.broken_links` returns skipped, deferred to v2)
- [x] 5.9 Seed `web_daily_essential` / `web_weekly_deep` / `web_monthly_audit` run definitions
- [x] 5.10 Initial Runs UI: list + RunDetail mounted as third tab in OperationsWorkspace

### Phase 1 sub-tickets

- [x] 3.1 Schema migration `migrate_ops_foundation.sql` (8 tables + view)
- [x] 3.2 Migration registration in `server/index.js`
- [x] 3.3 `kinsta_findings_compat` view
- [x] 3.4 Check registry skeleton (`services/ops/checks/registry.js`)
- [x] 3.5 Run executor skeleton (`services/ops/runExecutor.js`)
- [x] 3.6 Credential service (`services/ops/credentialStore.js`)
- [x] 3.7 Routes mounted at `/api/ops`

### Phase 0 sub-tickets

- [x] 2.1 Compliance hardening (Vertex safety thresholds, approval audit events)
- [x] 2.2 Rate limiting on `/assistant/chat` and `/exec`
- [x] 2.3 WP-CLI blocklist tokenized parser
- [x] 2.4 Drift baseline mutation — `baseline_accepted_at` + `kinsta_scan_history`
- [x] 2.5 Tracking-check consistency (always-on)
- [x] 2.6 Remove stale `divi_safe_update` tool
- [x] 2.7 SSRF guards on `verify_tracking_install`
- [x] 2.8 Surface silent context truncation
- [x] 2.9 UI Frankenstein excision (Portfolio / Client Detail / top-level Assistant tabs)

## Open blockers

None at scaffold time.

## Handoff notes for next session

- Coordinator dispatches `ops-stabilizer` for Phase 0
- All work is on `main` per user instruction (overrides default `refactor/wip` workflow)
- Each phase commits separately with descriptive subject

## Files NOT to touch (protected during rebuild)

- `src/views/admin/AnalyticsDashboard/` — kept separate per P6
- `audit_runs` / `audit_schedules` tables — kept separate per P6 until Phase 10
- `.env`, `.env.local` — production-canonical per CLAUDE.md
