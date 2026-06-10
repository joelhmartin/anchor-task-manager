# Production Health Checks — Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorm) → pending implementation plan
**Author:** session with super-admin (jmartin@anchorcorps.com)

## Motivation

On 2026-06-02 Google retired the `gemini-2.0-flash` Vertex model in `us-central1`. The
prod Cloud Run service had `VERTEX_MODEL` / `VERTEX_CLASSIFIER_MODEL` pinned to that
model, so **every** AI lead classification threw a 404 and fell back to
`category: 'unreviewed'`, `summary: 'AI classification failed.'`. The outage ran ~3 days
(382 affected `call_logs` rows) before anyone noticed — there was no automated signal that
a production "agent" had stopped working.

This feature adds a **reusable health-check framework** that probes the agents and
integrations we depend on in production and emails the super-admin when something is
broken — so the next silent outage surfaces within a day, not after a human stumbles on it.

## Goals

- A small, reusable registry where adding a new health check is "drop a file, import it once."
- Ship three first-version concerns: AI lead classification, the Ops AI supervisor, and
  agency-level integration credentials.
- Each check is a straightforward **active probe**: it actually exercises the agent/integration
  (calls the model, hits the API) and passes only if it gets a real response. An active probe
  catches a total outage even on a zero-traffic day, so no separate row/log scan is needed.
- Persist every run to a table (history, trends, future admin UI).
- A daily 8:00 AM (America/New_York) job that emails the super-admin **only when a check is
  not OK**. Silent when everything is green.
- Manual run + latest-results endpoints so the system is testable on demand.

## Non-Goals

- Not reusing or extending `server/services/ops/` — that is a per-client *marketing* checks
  framework (umbrellas website/google_ads/meta, per-client fan-out, cost gates). This is
  global *internal system* health and deserves its own small home.
- No admin UI panel in v1 (the persistence + `GET latest` endpoint are the hooks for it).
- No paging/SMS/Slack — email to super-admin only.
- No per-client scoping — these checks are about agency-wide systems, not individual clients.

## Architecture

### Directory layout
```
server/services/health/
  registry.js            # registerHealthCheck / getHealthChecks
  runner.js              # runAllHealthChecks(): execute, time, persist, summarize
  healthEmail.js         # compose + send the failure email
  checks/
    index.js             # imports every check file (registration side-effects)
    aiClassification.js   # check_id: ai.classification
    opsSupervisor.js      # check_id: ops.supervisor
    integrations.js       # registers integ.google_ads, integ.meta, integ.ctm, integ.mailgun, integ.ga4
server/routes/health.js  # POST /run, GET /latest  (mounted at /api/health)
server/sql/<n>_system_health_checks.sql  # migration
```

### Check contract
```js
registerHealthCheck('ai.classification', {
  label: 'AI lead classification (Vertex)',
  category: 'agent',          // 'agent' | 'integration' | 'job'
  timeoutMs: 20000,           // per-check hard cap (default 15000)
  run: async (ctx) => ({
    status: 'ok' | 'warn' | 'fail',
    detail: 'human-readable one-liner',   // NEVER contains PHI
    error: 'message if status !== ok',    // optional
    metrics: { /* small jsonb, counts only */ } // optional
  })
});
```

- A handler that **throws** is recorded as `status: 'fail'` with `error = err.message`.
- A handler that exceeds `timeoutMs` is recorded as `status: 'fail'`, `error: 'timeout'`.
- `warn` is a non-paging degraded signal (e.g. failure rate elevated but non-zero traffic
  still classifying). `warn` counts as "not OK" for the email trigger but is labeled distinctly.

### Registry (`registry.js`)
Mirrors the style of `server/services/ops/checks/registry.js` but far simpler — no umbrella,
tier, cost, or `requires`. A `Map<check_id, definition>`, `registerHealthCheck(id, def)` with
validation (non-empty id, valid category, function handler), `getHealthChecks()` returns the
list in registration order. Re-registration warns and overwrites (dev hot-reload safety).

### Runner (`runner.js`)
`runAllHealthChecks({ trigger })` → :
1. Generate a `run_id` (uuid).
2. For each registered check: run `handler` wrapped in try/catch + a `Promise.race` timeout;
   measure `duration_ms`.
3. Insert one `system_health_checks` row per check (parameterized).
4. Return `{ run_id, results: [...], failing: [...] }`.

Checks run **sequentially** (there are only a handful; avoids hammering Vertex/integrations
concurrently and keeps quota pressure trivial). `trigger` is `'cron'` or `'manual'`.

## The v1 checks

### `ai.classification` (category: agent)
- **Active probe (only):** call `classifyContent(DEFAULT_AI_PROMPT, <fixed synthetic transcript>, '', { source: 'call' })`.
  The synthetic transcript is a hard-coded, obviously-fake new-patient call (no real PHI).
  This drives the exact production path — including the `VERTEX_CLASSIFIER_MODEL` /
  `VERTEX_MODEL` env resolution that caused the outage — and calls the live Gemini model under
  the hood. Pass only if the result is a real classification, i.e. NOT the failure fallback
  (`summary !== 'AI classification failed.'` and a non-`unreviewed` category for the
  unambiguous lead). Any throw, or the failure fallback, = `fail`.
- This is exactly the "call the model and see if it answers" probe that would have caught the
  3-day outage on day one. No row/log scan.
- `metrics`: `{ category, model }` (the returned category + the model id used — no PHI).

### `ops.supervisor` (category: agent)
- **Active probe (only):** call the Ops supervisor's Vertex runtime
  (`server/services/ops/agents/vertexRuntime.js`) with a minimal generation prompt; pass only
  if it returns a non-empty response. This exercises the same Vertex path the per-client
  supervisor uses. Any throw / empty response = `fail`.
- `metrics`: `{ model }`.

### Integration credential checks (category: integration, one check each)
Each is a cheap, **non-PHI**, low-cost liveness/auth probe. Registered separately so the
email can name exactly which cred rotted.

- **`integ.google_ads`** — `listAccessibleCustomers` via the `google-ads-api` gRPC client
  using the MCC OAuth refresh token. Auth failure / refresh failure = `fail`.
- **`integ.meta`** — `GET /me` on the Graph API with `FACEBOOK_SYSTEM_USER_TOKEN`. Non-200 /
  token error = `fail`. (Read-only token introspection; no ad/PHI data fetched.)
- **`integ.ctm`** — a cheap CTM API call (e.g. account/whoami) with agency keys. Non-2xx = `fail`.
- **`integ.mailgun`** — config present (`isMailgunConfigured()`) + a cheap authenticated API
  ping (e.g. domains list). Missing config or auth failure = `fail`.
- **`integ.ga4`** — mint a token for the GA4 service account / a cheap Admin API call;
  failure = `fail`.

Each check is defensive: a missing/optional integration that is *intentionally* unconfigured
should report `warn` ("not configured"), not `fail`, so the email isn't noisy for features the
agency doesn't use. Hard-required creds (Google Ads, Meta, CTM, Mailgun) report `fail` when
broken.

## Persistence — `system_health_checks`

New migration following the append-only chain convention in `server/index.js`
(idempotent `CREATE TABLE IF NOT EXISTS`, a `maybeRunSystemHealthChecksMigration()` appended
to the `.then()` chain).

```sql
CREATE TABLE IF NOT EXISTS system_health_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL,
  check_id     text NOT NULL,
  label        text NOT NULL,
  category     text NOT NULL,
  status       text NOT NULL,        -- 'ok' | 'warn' | 'fail'
  detail       text,
  error        text,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms  integer,
  trigger      text NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_health_checks_run    ON system_health_checks (run_id);
CREATE INDEX IF NOT EXISTS idx_system_health_checks_recent ON system_health_checks (check_id, created_at DESC);
```

**Compliance (HARD):** `detail`, `error`, and `metrics` MUST NOT contain PHI. Active probes
use synthetic data; passive checks store **counts**, never call/transcript content. Reviewed
against the HIPAA constraints in CLAUDE.md.

**Retention:** the daily job deletes `system_health_checks` rows older than 30 days
(monitoring telemetry, not audit data — the super-admin acts on failures as they arrive, so
history is a short convenience window, not a record to keep).

## Scheduler + email

### Cron
In `server/index.js`, alongside the existing crons:
```js
cron.schedule('0 8 * * *', async () => {
  if (isDemoMode()) return;
  try { await runDailyHealthCheck(); }
  catch (e) { console.error('[cron:health]', e?.message); }
}, { timezone: 'America/New_York' });
```
`runDailyHealthCheck()` = `runAllHealthChecks({ trigger: 'cron' })` → prune old rows → if any
result is `warn`/`fail`, send the email.

### Email (`healthEmail.js`)
- Recipients: `SELECT email FROM users WHERE role='superadmin' AND email IS NOT NULL`.
- **Errors-only:** if `failing.length === 0`, send nothing and return.
- Subject: `⚠️ Anchor Hub health: N check(s) need attention` (N = warn+fail count).
- HTML body: one row per failing check — label, category, status badge, `detail`, `error`.
  A trailing line "M other checks passed." for context. Brand voice: warm, plain, direct.
- Sent via `sendMailgunMessage({ to, subject, html, text })` (text fallback included).
  Use `sendMailgunMessageWithLogging` so the send lands in the email audit log.

## Manual endpoints — `server/routes/health.js` (mounted `/api/health`, `isAdmin`/superadmin)

- `POST /api/health/run` — run all checks now (`trigger: 'manual'`), return
  `{ run_id, results, failing }`. Does **not** email (manual runs are interactive). Superadmin-only.
- `GET /api/health/latest` — return the most recent run's rows grouped by `run_id`, for the
  future admin panel and for verifying after a deploy. Superadmin-only.

Routes documented in `docs/API_REFERENCE.md`; table documented in `SKILLS.md`.

## Error handling

- Per-check try/catch + timeout (no single check can hang or crash the run).
- The cron wrapper swallows errors (logs via `console.error`, which survives in prod).
- Email send failure is logged but never throws out of the cron.
- A totally failed run (e.g. DB down) still attempts the email with whatever it has.

## Reusability story

Adding a check later:
1. Create `server/services/health/checks/<name>.js` that calls `registerHealthCheck(...)`.
2. Add one import line to `checks/index.js`.
That's it — the runner, persistence, scheduling, and email pick it up automatically. The
"background jobs / crons" liveness checks (deferred from v1) are the obvious next additions
and slot in with zero framework changes.

## Verification (no automated test suite)

1. `yarn build` + `yarn lint` must pass.
2. Run the migration locally; confirm `system_health_checks` exists.
3. `POST /api/health/run` locally; inspect returned results + persisted rows.
4. Force a failure (temporarily point a check at a bad cred / break the model) and confirm the
   row records `fail` and — via a temporary manual call to `runDailyHealthCheck()` — the email
   renders and sends to the super-admin.
5. Confirm the green path sends **no** email.

## Open considerations (resolved)

- **One check per integration** vs one grouped "creds" check → **one per integration** (granular
  email, independent reuse). ✓ approved.
- **Include manual endpoints in v1** → **yes** (testability, future UI hook). ✓ approved.
- **Cadence** → errors-only, silent when green. ✓ approved.
- **Detection** → active probe only. A probe that actually calls the model/API catches a total
  outage even with zero traffic, so the passive row/log scan was dropped as unnecessary
  complexity. ✓ revised 2026-06-05. The `warn` status remains available for checks that want a
  degraded (non-paging) signal (e.g. an optional integration that is intentionally
  unconfigured), but the v1 agent checks only emit `ok`/`fail`.
- **Persistence** → dedicated table + email. ✓ approved.
