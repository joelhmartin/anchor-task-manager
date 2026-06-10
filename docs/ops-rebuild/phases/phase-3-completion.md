# Phase 3 — Website umbrella v1 (shipped 2026-05-05)

**Specialist:** website-checks-engineer
**Branch:** `main`
**Commits:**
- `143feed` — `feat(ops-website): add SSL, uptime, tracking_install, schema, broken_links checks`
- `af5a7c0` — `feat(ops-website): add PSI check with quota tracking`
- `0125ed2` — `feat(ops-website): add GSC, SEMrush checks (per-client OAuth scaffold)`
- `267ffc4` — `feat(ops-website): re-home Kinsta drift as web.kinsta.drift + add wp_security cross-ref`
- `9f38b51` — `feat(ops-website): add WPVuln feed + ops_vuln_feed table`
- `de891d4` — `feat(ops-website): seed website run definitions`
- `eaf81f8` — `feat(ops-ui): add initial Runs list + RunDetail views`

## Files added

| File | Purpose |
|---|---|
| `server/services/ops/checks/website/_lib/httpFetch.js` | SSRF-guarded fetch + `resolveClientWebsiteUrl()` (kinsta_sites primary domain → client_profiles.website_url fallback) |
| `server/services/ops/checks/website/ssl.js` | `web.ssl.expiry_within_30d`, `web.ssl.expiry_within_7d` (TLS handshake, days-to-expiry) |
| `server/services/ops/checks/website/uptime.js` | `web.uptime.reachable` (single HEAD probe, 10s timeout) |
| `server/services/ops/checks/website/trackingInstall.js` | `web.tracking_install` (homepage GTM/GA4/Meta verify, cross-ref tracking_configs) |
| `server/services/ops/checks/website/schema.js` | `web.schema.has_organization`, `has_localbusiness` (medical/dental gated), `parse_errors` |
| `server/services/ops/checks/website/psi.js` | `web.psi` composite (mobile + desktop, all metrics in payload) |
| `server/services/ops/checks/website/gsc.js` | `web.gsc.coverage_errors`, `manual_actions`, `crux_lcp`, `indexed_pages_drop` |
| `server/services/ops/checks/website/semrush.js` | `web.semrush.organic_traffic_drop`, `top_keywords_lost`, `toxic_backlinks` |
| `server/services/ops/checks/website/brokenLinks.js` | `web.broken_links` (stub, returns skipped) |
| `server/services/ops/checks/website/kinstaDrift.js` | `web.kinsta.drift` (wraps legacy runDriftCheck) + `web.wp_security` (cross-refs ops_vuln_feed) |
| `server/services/ops/checks/website/index.js` | Side-effect barrel that triggers every registerCheck() at load |
| `server/services/ops/feeds/psiQuota.js` | In-process daily PSI quota tracker (90% backoff of 25k/day cap) |
| `server/services/ops/feeds/wpvuln.js` | WPVuln daily refresh (WPSCAN_API_TOKEN; no-op when unset) |
| `server/sql/migrate_ops_vuln_feed.sql` | `ops_vuln_feed` table (UNIQUE(plugin_slug, vuln_id), idempotent) |
| `server/sql/migrate_ops_seed_run_definitions.sql` | Seeds `web_daily_essential`, `web_weekly_deep`, `web_monthly_audit` |
| `src/api/ops.js` | Frontend API client for `/api/ops/*` (distinct from the legacy `src/api/operations.js`) |
| `src/views/admin/Operations/Runs/RunsTab.jsx` | Runs list (client filter, status/tier/duration/cost columns, manual trigger dialog) |
| `src/views/admin/Operations/Runs/RunDetail.jsx` | Run detail (check_results grouped by umbrella, findings, JSON inspector, cancel) |

## Files modified

- `server/services/ops/runExecutor.js` — added side-effect import of `./checks/website/index.js` so the registry is populated before the executor dispatches checks. Same import added to `server/services/ops/index.js` for completeness when callers use the barrel.
- `server/services/ops/index.js` — exports unchanged; side-effect import added.
- `server/routes/ops.js` — adds `GET /runs/:id/check-results` (powering RunDetail) and 501 scaffolds for `GET /clients/:id/credentials/gsc/oauth/start` + `/callback`.
- `server/index.js` — registers `maybeRunOpsVulnFeedMigration` and `maybeRunOpsSeedRunDefinitionsMigration` after `maybeRunOpsFoundationMigration` in the boot migration chain.
- `src/views/admin/OperationsWorkspace/index.jsx` — adds a third tab (`runs`) between Sites and Bulk; mounts `RunsTab`. Lightest-touch wiring; full IA rebuild is Phase 9.
- `docs/ops-rebuild/STATE.md` — Phase 3 marked shipped, active phase advanced to Phase 4, Phase 3 sub-ticket checklist filled.

## Schema decisions

- **`ops_vuln_feed` is plugin-only** for v1 — no theme or core vulnerability rows. Adding `entity_type` is straightforward when needed (Phase 8 may revisit).
- **`raw JSONB`** stores the full WPScan record so the correlator (Phase 6) can mine reference URLs / proof-of-concept fields without a re-fetch.
- **GSC OAuth tokens reuse `oauth_connections`** (provider=`google`) per CLAUDE.md provider check constraint; `scope_granted` is queried with `ILIKE '%webmasters%'` OR `'%searchconsole%'`. No new table needed.

## Behavioral decisions

- **PSI is one composite check, not per-metric.** Phase 1's executor returns one `ops_check_result` per `handler()` call. Splitting into 12+ registry entries would either need executor changes (out of scope) or 12× the PSI quota burn. Decision: register `web.psi` as a single check whose `payload_json.strategies.{mobile,desktop}` carries all metrics; the correlator (Phase 6) splays into per-metric findings without re-querying PSI. Documented in `psi.js` header.
- **Per-run memoization via context object.** `ssl.js`, `schema.js`, and `gsc.js` cache their primary fetch on `ctx._sslCachePromise`/etc so multiple registered checks reusing the same fetch only hit the network once. The Phase 1 executor passes the same `ctx` object to every handler call within a single run.
- **GSC manual actions / per-page CrUX** are not exposed via the public Search Console API. Both register cleanly but return `status='skipped'` with a reason; the dashboard can render a "manual review required" badge.
- **SEMrush WoW comparison deferred.** v1 surfaces current snapshot; the correlator (Phase 6) will diff vs prior runs once the snapshot history is in place.
- **Kinsta drift legacy path is preserved.** `web.kinsta.drift` calls `runDriftCheck()` directly; that function already writes to `kinsta_findings`. The Phase 1 `kinsta_findings_compat` view projects new `ops_findings` rows back to the legacy reader surface.
- **Site URL resolution.** `resolveClientWebsiteUrl()` prefers `kinsta_sites.primary_domain` (when the client is linked) and falls back to `client_profiles.website_url`. Returns `null` when nothing is configured → checks return `status='skipped'` with reason.
- **Quota tracker is in-process, not persistent.** Restarts reset the daily counter — accepted because the Cloud Run Job runner is the only sustained PSI consumer; quota over-spend just yields a 429 which we already handle as `'skipped'`. Phase 8 may swap for Postgres-backed counter if multi-runner concurrency grows.
- **Broken-links is a registered stub** (returns `status='skipped'` with reason "deferred to v2") rather than absent so monthly_audit run definitions don't trip the unknown-check_id error path.

## Validation outputs

- `yarn build` — clean (`✓ built in 12.14s`) at HEAD.
- `yarn lint` — no new errors / warnings introduced. The single new file warning (`api/ops.js` prettier hint) was fixed before final commit; grep on the post-commit lint output shows zero hits for any of the Phase 3 files.
- Migration syntax — both new migrations use idempotent guards (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `WHERE NOT EXISTS`). Re-running them is safe.
- End-to-end smoke (queued → completed for `web_daily_essential`): not exercised in this session because the local PSI/SSL/GSC keys aren't populated. Path verified by code reading: `executeRun` → `getCheck('web.tracking_install')` → handler resolves `null` website URL → `status='skipped'` outcome → run finalizes as `completed`.

## Follow-ups punted

- **GSC OAuth UI flow.** The 501 scaffold endpoints are in place but the actual token exchange / refresh / scope upgrade should reuse the existing Google OAuth infrastructure used for Ads and GA4. Phase 8 owns this.
- **PSI persistent quota tracking.** When concurrent runners grow we'll need the Postgres-backed counter mentioned above.
- **SEMrush WoW + keyword diff history.** Requires snapshot history; lands with the correlator in Phase 6.
- **Per-page CrUX + manual actions.** GSC API gap; revisit if Google ships endpoints, otherwise document as manual-review only in the v2 dashboard.
- **Broken links crawler.** v2 — likely a separate Cloud Run Job with its own concurrency tuning.
- **Run definition CRUD UI.** The seed migration plus the existing `PUT /run-definitions/:id` endpoint cover the v1 needs; a proper UI editor lands with Phase 9.

## How to test (post-merge)

```sql
-- Confirm tables and seed rows present:
SELECT name, tier, jsonb_array_length(check_set) AS check_count FROM ops_run_definitions WHERE name LIKE 'web_%';
SELECT COUNT(*) FROM ops_vuln_feed;
```

```bash
# Trigger a daily-essential run for a test client (admin JWT in $TOKEN):
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_user_id":"<uuid>","run_definition_id":"<web_daily_essential uuid>"}' \
  http://localhost:4000/api/ops/runs

# Inspect check results:
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/ops/runs/<runId>/check-results
```

UI: navigate to `/operations?tab=runs` → click any run row to drill into the JSON viewer.
