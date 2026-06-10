# Phase 1 — Domain model foundation (shipped 2026-05-05)

**Specialist:** ops-domain-architect
**Branch:** `main`
**Commits:**
- `9bf31c4` — `feat(ops-domain): add ops foundation schema migration`
- `1b9daaa` — `feat(ops-domain): add registry, credential store, run executor skeleton`
- `060827f` — `feat(ops-domain): add /api/ops router with run/finding/credential endpoints`

## Files added

| File | Purpose |
|---|---|
| `server/sql/migrate_ops_foundation.sql` | 8 tables + `kinsta_findings_compat` view (idempotent) |
| `server/services/ops/checks/registry.js` | In-memory check registry (registerCheck/getCheck/listChecksForUmbrella/Tier) |
| `server/services/ops/credentialStore.js` | Per-client platform credentials, AES-256-GCM via `services/security/encryption.js` |
| `server/services/ops/runExecutor.js` | Loads queued ops_run, dispatches handlers, persists results, enforces tier budget |
| `server/services/ops/index.js` | Barrel re-export |
| `server/routes/ops.js` | Admin-gated `/api/ops` router (runs, findings, definitions, subscriptions, credentials) |

## Files modified

- `server/index.js` — added `maybeRunOpsFoundationMigration` (registered after `maybeRunOpsPhase0DriftBaselineMigration`); imported and mounted `opsRouter` at `/api/ops`.
- `docs/ops-rebuild/STATE.md` — Phase 1 marked shipped; active phase now Phase 2; sub-ticket checklist added.

## Schema decisions

- **UUID PKs everywhere** via `gen_random_uuid()` (pgcrypto already enabled in earlier migrations).
- **JSONB defaults** are non-null (`'{}'::jsonb`, `'[]'::jsonb`, `ARRAY[]::TEXT[]`) so app code can read fields without null-guarding.
- **`linked_check_result_ids UUID[]`** — denormalized cross-check linkage; correlator (Phase 6) populates this.
- **`ops_findings.run_id` is nullable** — long-lived findings synthesized across runs (e.g. credential rotation reminders) need a place to land.
- **`ops_runs.run_definition_id`** uses `ON DELETE SET NULL` so deleting a definition does not cascade-delete historical runs.
- **`client_platform_credentials` UNIQUE (client_user_id, platform, account_id)** — same client can have multiple ad accounts under one platform.
- **`kinsta_findings_compat`** is `CREATE OR REPLACE VIEW` so re-runs are clean even if the view definition evolves.

## Behavioral decisions

- **Tier budget defaults** in `runExecutor.js`: `daily_essential=50¢`, `weekly_deep=200¢`, `monthly_audit=500¢`, `on_demand=250¢`. Hard cap; on overflow we write a `budget_exceeded` finding (severity `warning`, category `ops.budget_exceeded`) and stop.
- **Per-check timeout** defaults to 60s; overridable via `entry.config.timeoutMs`. Phase 2 will swap the timeout race for AbortController-aware cancellation.
- **Phase 6 hooks are lazy-imported** — `./correlator.js` and `./reportRenderer.js` are imported via `await import().catch(() => null)` so the executor runs cleanly until those modules exist.
- **`POST /api/ops/runs` does not enqueue** — Phase 1 only inserts `status='queued'`. Pub/Sub publish lands in Phase 2 (`runQueue.js`).
- **Credential validation** (`POST /clients/:id/credentials/:credId/validate`) accepts the result from the caller in Phase 1; per-platform validation logic lives with the platform specialists.

## Validation outputs

- `yarn build` — clean (`✓ built in 13.06s`).
- `yarn lint` — no new errors or warnings introduced; `grep` for `server/(routes/ops\.js|services/ops/|sql/migrate_ops_foundation)` against the lint output returned zero hits. (Repo-wide pre-existing 127 errors / 4899 warnings are unchanged.)
- Migration syntax — re-read; all `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE VIEW`. Idempotent.
- Smoke (against running local server): not exercised in this session — local DB requires `yarn server` boot which would run the new migration. Migration will run idempotently on next server start.

## Follow-ups punted

- **Per-platform credential validators** (e.g. Google Ads OAuth probe, Meta token introspection). Phase 1 lets callers report `{ ok, error }`; Phase 4/5 specialists own the actual probes.
- **Run queue** (`runQueue.js`) — Phase 2.
- **`migrate_ops_seed_run_definitions.sql`** with `web_daily_essential`, `web_weekly_deep`, `web_monthly_audit` definitions — Phase 3 §5.9.
- **`ops_vuln_feed`** table for WPScan cache — Phase 3 §5.7.
- **Correlator + report renderer modules** — Phase 6.
- **AbortSignal threading** through check handlers — Phase 2.

## How to test (post-merge)

```sql
-- Confirm tables present:
SELECT tablename FROM pg_tables WHERE tablename LIKE 'ops_%' OR tablename = 'client_run_subscriptions' OR tablename = 'client_platform_credentials';

-- Confirm view present:
SELECT viewname FROM pg_views WHERE viewname = 'kinsta_findings_compat';
```

```bash
# With server running locally and a valid admin JWT in $TOKEN:
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/ops/runs
# expected: []

curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/ops/run-definitions
# expected: []
```
