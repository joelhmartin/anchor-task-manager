# Phase 6 — Correlation + reporting (shipped 2026-05-05)

**Specialist:** correlation-and-reports-engineer
**Branch:** `main`
**Commits:**
- `2ebe16d` — `feat(ops-corr): add cross-platform correlator + initial rules`
- `8492bec` — `feat(ops-corr): add PHI payload sanitizer + executor integration`
- `18d517f` — `feat(ops-report): add HTML report renderer + GCS upload + signed URL`
- `7095219` — `feat(ops-report): add email digest + portfolio digest endpoint`
- `88db55c` — `feat(ops-corr): add trend index + denormalize client_user_id on check results`
- `f2fa474` — `test(ops): correlator unit tests`
- `707eac5` — `feat(ops-ui): surface correlation findings prominently in RunDetail`

## Files added

| File | Purpose |
|---|---|
| `server/services/ops/correlator.js` | Loads checks, evaluates rules, persists `ops_findings` rows. Idempotent: clears prior `correlation.*` rows for the run before insert. Exports `correlateRun`, friendly alias `run`, and pure `evaluateRules` for tests. |
| `server/services/ops/correlatorRules.js` | 10 declarative cross-platform rules (tracking loss, PSI/organic, CAPI/lead form, SSL/organic, keyword/indexation, budget/disapproved, dedup/match-quality, GTM/drift, experiments/disapproved, domain-verification/spend). |
| `server/services/ops/payloadSanitizer.js` | Recursive PHI redactor — email, SSN, phone (user-ish keys only), DOB (DOB-named keys only). Returns a fresh object; safe to call on any value. |
| `server/services/ops/reportRenderer.js` | Renders an inline-styled HTML report (executive summary + correlations + trend SVG + per-umbrella collapsed detail), uploads to GCS, mints 1h signed URLs. Local `/tmp` fallback when GCS creds absent. |
| `server/services/ops/emailDigest.js` | `sendRunSummary(runId)` (per-run) + `sendPortfolioDigest()` (24h admin digest). Routes through existing `mailgun.js`; no PHI in bodies. |
| `server/sql/migrate_ops_check_results_trend_index.sql` | Adds `client_user_id` column + backfill + trend index `(client_user_id, check_id, created_at DESC)`. |
| `server/sql/migrate_ops_subscription_email.sql` | Adds `email_on_completion BOOLEAN NOT NULL DEFAULT FALSE` to `client_run_subscriptions`. |
| `server/services/ops/__tests__/correlator.test.js` | 11 unit tests (rule engine + sanitizer) using `node:test`. |

## Files modified

- `server/services/ops/runExecutor.js` — `persistCheckResult` now takes a `clientUserId` param, runs every payload through `payloadSanitizer.sanitize` before INSERT, and writes the denormalized `client_user_id` column. The Phase 6 hook block now calls `correlator.correlateRun`, `reportRenderer.render` (with a back-compat fall-through to `renderReport`), and `emailDigest.sendRunSummary`.
- `server/routes/ops.js` — `GET /api/ops/runs/:id/report` now also returns `signed_url` and `signed_url_expires_at`. New `POST /api/ops/internal/portfolio-digest` mirrors the Phase 2 fanout auth pattern (OIDC bearer or shared secret).
- `server/index.js` — registers `maybeRunOpsCheckResultsTrendIndexMigration` and `maybeRunOpsSubscriptionEmailMigration` in the migration chain.
- `package.json` — adds `@google-cloud/storage` dep + `test:ops` script (`node --test server/services/ops/__tests__/*.test.js`).
- `src/views/admin/Operations/Runs/RunDetail.jsx` — splits findings into Cross-platform Correlations (prominent) vs other findings. Light touch only; full rebuild = Phase 9.

## Decisions

- **Correlator idempotency**: prior `correlation.*` findings for the run are deleted before re-insert, so retries don't duplicate. Non-correlation findings (e.g. budget_exceeded) are untouched.
- **Sanitizer applied unconditionally**: even checks that surface no user data run through `sanitize()`. Cost is negligible (regex on string fields only) and the defense-in-depth posture is worth more than the micro-optimization.
- **Phone redaction is field-name gated**: regex alone produces too many false positives (version strings, IDs). Sanitizer only redacts phones inside string values whose key matches user-ish hints (`phone`, `caller`, `user`, `name`, `email`, `contact`, etc.). DOB redaction is similarly gated to date-of-birth-named fields.
- **GCS bucket**: `anchor-hub-ops-reports` (overridable via `OPS_REPORTS_BUCKET`). 90-day object lifecycle should be configured at the bucket level via `gcloud` — not via the renderer (one-time bucket-config concern, not per-write).
- **Signed URL TTL**: 1 hour. Email digests embed the URL directly so recipients can open the report immediately.
- **Local fallback**: when `@google-cloud/storage` cannot mint a signed URL (e.g. no creds in dev), the renderer writes `/tmp/ops-reports/<run_id>.html` and stores `file://...` as `storage_uri`. The signed-URL helper passes that through with `local: true` so the API caller can decide whether to expose it (we currently do not).
- **Trend storage option (a)**: denormalized `client_user_id` on `ops_check_results` rather than always joining `ops_runs`. Plan called the choice out explicitly; (a) keeps trend queries simple.
- **PDF deferred**: P4 = in-app HTML. No `puppeteer` dep added.
- **Email template**: rather than referencing a Mailgun-side template, we build text + HTML in JS and pass it to the existing `sendMailgunMessageWithLogging` helper. This keeps the flow inspectable in `email_logs` and avoids template drift between code and Mailgun UI.
- **Portfolio digest auth**: re-uses the Phase 2 `authorizeFanoutRequest` (OIDC verify + `OPS_FANOUT_SHARED_SECRET` fallback). Same Cloud Scheduler service account works for both endpoints.

## Validation

- `yarn build` — clean (`✓ built in 12.03s`).
- `yarn lint` — 128 errors / 4916 warnings; no new errors traceable to Phase 6 files (pre-existing baseline ≈127). Grep for `(correlator|payloadSanitizer|reportRenderer|emailDigest|RunDetail)` in error rows → 0 hits.
- `yarn test:ops` — 11/11 pass:
  - `tracking_loss_with_conversion_drop` matches when both signals present
  - same rule does not match when GTM is present
  - multiple rules concurrent: `ssl_expiring_with_organic_decline` + `keyword_ranking_drop_with_indexation_errors` from same checks
  - empty checks → empty findings (no throws)
  - partial signals: `meta_capi_down` requires both checks
  - `domain_unverified_with_active_meta_spend` matches when any meta check is non-skipped
  - evidence shape: JSON round-trips
  - rules array invariants: ≥10 rules, unique categories, all have required functions
  - sanitizer redacts emails + SSNs unconditionally
  - sanitizer redacts phones only on user-ish keys
  - sanitizer redacts DOB only on DOB-named keys
- Migrations re-read: both new files use `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`. Trend index migration's backfill `UPDATE ... WHERE client_user_id IS NULL` is safe to re-run.

## Follow-ups punted

- **GCS bucket lifecycle config** — `anchor-hub-ops-reports` should have a 90-day object lifecycle. Set this at the bucket level via `gcloud storage buckets update`; not a per-write concern.
- **Cloud Scheduler entries** — `POST /api/ops/internal/portfolio-digest` is mounted but no scheduler job is provisioned yet. Phase 8 (scheduling) will add one alongside the run fanouts.
- **"Lead form active" heuristic** — the `meta_capi_down_with_lead_form_active` rule currently approximates "active lead form" via `web.tracking_install.payload.meta_pixel_present`. A more precise check would join `ctm_forms.analytics_json` for the client. Deferred until we have a per-check forms-context loader (Phase 7 agent toolset).
- **PDF rendering** — locked out by P4. Revisit only if a customer demands an emailed PDF.
- **Per-check trend payload** — we surface aggregate severity counts per run on the trend graph. Per-check value trends (e.g. PSI LCP over time) require a different rendering and live in Phase 7 agent context.
- **Email body template variables** — long-term the HTML body should source from `emailTemplate.js` so brand styling stays consistent. Current implementation inlines styles for self-containment; refactor when other Phase 6+ digests get added.

## How to test (post-merge)

```bash
# 1. Migrations pick up on next server boot. Confirm:
psql -d anchor -c "\d ops_check_results" | grep client_user_id
psql -d anchor -c "\d client_run_subscriptions" | grep email_on_completion

# 2. Trigger a run, verify correlations land:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_user_id":"<uuid>","run_definition_id":"<uuid>"}' \
  http://localhost:4000/api/ops/runs

# 3. After it completes:
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/ops/runs/<run_id>/report
# expected: { storage_uri: 'gs://...' or 'file://...', signed_url: 'https://...' or null, ... }

# 4. Run unit tests:
yarn test:ops

# 5. Email digest dry-run (mailgun must be configured):
# Set email_on_completion=true on a subscription, trigger a run, check email_logs.
psql -d anchor -c "UPDATE client_run_subscriptions SET email_on_completion=true WHERE id='<uuid>';"
```
