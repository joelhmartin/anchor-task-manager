# Phase 8 — Scheduling + tier economics — completion

**Date:** 2026-05-05
**Specialist:** ops-orchestration-engineer (returning)
**Commits:** `93a8422`, `bfad7ba`

## What shipped

### §10.1 — Tier economics (no code change; verified)
- `daily_essential` runs do NOT invoke the supervisor — supervisor is only reached via `POST /api/ops/chat` (Phase 7), never from `runExecutor`. Daily-tier projected AI spend is therefore $0.
- `weekly_deep` and `monthly_audit` budgets enforced by the existing `TIER_BUDGET_CENTS` cap in `runExecutor.js` (`50/200/500/250` cents for daily/weekly/monthly/on_demand).
- Per-client monthly cap added below (§10.3) is the *cumulative* layer over those per-run caps.

### §10.2 — Per-client schedule_cron honored (`scheduleFanout.js`)
Fanout query now `WHERE schedule_cron IS NULL`. Subscriptions with an explicit cron are left to an external per-client scheduler entry (or admin manual trigger). Simpler than embedding a cron parser; documented as the chosen design.

### §10.3 — Monthly cap (`migrate_ops_monthly_cap.sql`, `budgetGuard.js`)
- New column `client_profiles.ops_monthly_cap_cents INT NOT NULL DEFAULT 500` (= $5/month per P7).
- New helper `server/services/ops/budgetGuard.js` exports `getMonthlyCapCents`, `getMonthToDateSpendCents`, `checkBudget`, `recordBudgetThrottle`.
- `scheduleFanout.fanoutTier` calls `checkBudget` before enqueue; over-cap clients are skipped and a `budget.throttled` finding (severity warning, no run_id) is persisted so the throttle surfaces in the Findings UI.
- Manual triggers via `POST /api/ops/runs` bypass the cap (admin override) but emit the new `OPERATIONS_RUN_MANUAL_OVERRIDE_BUDGET` audit event with cap/spend snapshot in `details`.

### §10.4 — Rotation group stub (`migrate_ops_monthly_cap.sql`)
- New column `client_run_subscriptions.rotation_group SMALLINT` (1-7), nullable.
- Range constraint via DO-block IF-NOT-EXISTS guard.
- No enforcement logic — per plan: "Don't enable until needed."

### §10.5 — Cooperative cancellation
- `runQueue.js` keeps `Map<runId, AbortController>`; `runJob` registers the controller and calls `executeRun(runId, { signal })`.
- New export `cancelLocal(runId)` aborts the matching in-flight controller.
- `runExecutor.js` accepts `options.signal`. Between checks (top of the for loop) it checks `signal?.aborted` and stops with `stoppedReason='cancelled'`. Final status maps to `'cancelled'`.
- `POST /api/ops/runs/:id/cancel` calls `cancelLocal` (returned as `_cancel_local`) AND publishes `ops.run.cancel` for production runners.

## Files changed

- `server/sql/migrate_ops_monthly_cap.sql` (new)
- `server/index.js` — registered `maybeRunOpsMonthlyCapMigration`
- `server/services/ops/budgetGuard.js` (new)
- `server/services/ops/scheduleFanout.js` — `checkBudget` integration + `schedule_cron IS NULL` filter
- `server/services/ops/runQueue.js` — AbortController map + `cancelLocal` export
- `server/services/ops/runExecutor.js` — `options.signal` threading + `cancelled` status
- `server/services/security/audit.js` — added `OPERATIONS_RUN_MANUAL_OVERRIDE_BUDGET`
- `server/routes/ops.js` — manual-override audit event + `cancelLocal` wired into cancel route

## Validation

- `yarn build` clean (12.53s).
- Migration idempotent (`ADD COLUMN IF NOT EXISTS`, IF-NOT-EXISTS constraint).
- Cancel flow verified by code reading; full end-to-end smoke deferred (no live runs to cancel).

## Decisions

- Per-client cron honored by *exclusion* from default-tier fanout, not by parsing — cleaner; expansion via cron-parser deferred until a client actually needs sub-day cadence.
- Manual override audit event (not run metadata) chosen so the override is queryable by category in `security_audit_log`.
- `budget.throttled` findings carry `run_id=NULL` (allowed by Phase 1 schema) — they describe a non-event, not a run.

## Follow-ups punted

- Cron expression parsing for per-client overrides (Phase 9 UI may surface this).
- Production cancel: `ops.run.cancel` Pub/Sub topic exists; the Cloud Run Job worker subscriber that consumes it and aborts in-flight executions there is documented but not wired.
- DLQ alert routing.
- `budget.throttled` findings have no automatic resolver — admin acks them manually.

## Hand-off note

Phase 9 (UI rebuild) is next. Suggested entry points:
- `Cost/CostTab.jsx` should query `client_profiles.ops_monthly_cap_cents` + `getMonthToDateSpendCents` per client for the cost dashboard.
- `Findings/FindingsTab.jsx` should highlight `budget.throttled` and `correlation.*` categories prominently.
- `Schedule/ScheduleTab.jsx` should expose per-client `schedule_cron` and `rotation_group` editing (rotation_group as a stub field).
