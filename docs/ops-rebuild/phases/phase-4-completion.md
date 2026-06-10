# Phase 4 — Google Ads umbrella (shipped 2026-05-05)

**Specialist:** google-ads-checks-engineer
**Branch:** `main`
**Commits:**
- `bbf20d7` — `feat(ops-gads): add Google Ads adapter + conversion tracking checks`
- `bd5f9fd` — `feat(ops-gads): add negative keyword + account config checks`
- `4c90f36` — `feat(ops-gads): add keyword history + suggested checks + migration`
- `b8b7353` — `feat(ops-gads): seed gads run definitions`

## Files added

| File | Purpose |
|---|---|
| `server/services/ops/checks/google_ads/_client.js` | gRPC adapter helper. `getCustomerClient()`, `withCustomer()`, `withCustomerCached(ctx)`, `resolveCustomerIdForClient()`. Reuses agency credentials from env (no per-client OAuth in v1, per P1). |
| `server/services/ops/checks/google_ads/conversionTracking.js` | `gads.conversion_tag.installed`, `firing`, `gads.conversion_action.cpa_drift`, `gads.conversion_source.validity` |
| `server/services/ops/checks/google_ads/negativeKeywords.js` | `gads.negative_keywords.recent_changes`, `coverage` |
| `server/services/ops/checks/google_ads/accountConfig.js` | 13 `gads.account.*` checks (linked services, disapproved ads, budget pacing, bid modifiers, audience lists, ad extensions including phone cross-ref, auto-applied recommendations) |
| `server/services/ops/checks/google_ads/keywordHistory.js` | `gads.keywords.position_changes` (snapshot top 50 by spend each run; diff vs ≥7d-old snapshot in `ops_keyword_history`) |
| `server/services/ops/checks/google_ads/suggested.js` | `smart_bidding.adoption`, `search_terms.brand_competitors`, `url_options.tracking_template`, `final_url_suffix`, `experiments.active` |
| `server/services/ops/checks/google_ads/index.js` | Side-effect barrel. Imported from `services/ops/index.js` and `runExecutor.js`. |
| `server/sql/migrate_ops_keyword_history.sql` | Idempotent `ops_keyword_history` table + indices |
| `server/sql/migrate_ops_seed_gads_run_definitions.sql` | Seeds `gads_daily_essential` + `gads_weekly_deep` |

## Files modified

- `server/services/ops/index.js` — adds `import './checks/google_ads/index.js'` to the side-effect block.
- `server/services/ops/runExecutor.js` — same side-effect import added so the executor populates the registry before dispatching.
- `server/index.js` — registers `maybeRunOpsKeywordHistoryMigration` and `maybeRunOpsSeedGadsRunDefinitionsMigration` in the migration chain (after the Meta seed migration).
- `docs/ops-rebuild/STATE.md` — Phase 4 ticked, active phase advanced.

## Schema decisions

- **`ops_keyword_history.avg_position` is a misnomer.** Google Ads deprecated `metrics.average_position` in 2019; we persist `metrics.top_impression_percentage` (a 0..1 share where higher = better) into `avg_position` because the column name reflects intent across versions. Diff threshold is 0.10 (≈10pp drop ≈ "3-position drop equivalent"). Documented inline in `keywordHistory.js`.
- **No per-client OAuth.** All checks use the agency MCC refresh token (P1). When `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_REFRESH_TOKEN` are unset, every check returns `status='skipped'` with reason "Google Ads agency credentials not configured".
- **Customer ID source.** Resolved from `tracking_configs.google_ads_customer_id` (most-recent non-null). Clients without a Google Ads link return `status='skipped'`.
- **`twilio_tracking_numbers` cross-ref.** `gads.account.ad_extensions.callout_phone` normalises both ad-extension call asset numbers and CTM tracking numbers (digits-only, leading-1 stripped) before comparison so format mismatches don't cause false negatives.

## Behavioral decisions

- **Per-ctx customer client memoisation.** `withCustomerCached(ctx)` stashes the resolved `{ customer, customerId }` promise on `ctx._gadsCustomerPromise` so multiple checks in one run share a single resolution + auth path.
- **`gads.conversion_tag.firing` skips when spend=0.** Reporting "no firing" when the account isn't actually running ads would generate false-positive criticals. Spend > 0 with conversions = 0 is the only critical signal here.
- **`gads.account.linked_search_console` uses `paid_organic_search_term_view` as a probe.** That view only returns rows when GSC is linked. An empty/error response is treated as not linked.
- **`gads.account.auto_applied_recommendations` is informational.** Many agencies prefer auto-apply OFF — surfacing it as a failure would be opinionated. We expose the enabled count and let the UI/correlator decide.
- **Brand-competitor heuristic is intentionally conservative.** Single-token, length ≥4, not in a small stop-word set, and not containing the client's own brand tokens or domain stem. False positives are cheaper than false negatives in v1; the correlator (Phase 6) can layer on better signals.
- **`gads.negative_keywords.recent_changes` is informational by design.** All change events come back with `status='pass'` — the correlator turns them into findings only when paired with a spend anomaly.

## Validation outputs

- `yarn build` — clean (`✓ built in 12.50s`) at HEAD `b8b7353`.
- `yarn lint` — no new errors / warnings introduced by the Phase 4 files. The pre-existing 128 errors / 4915 warnings come from legacy code (TaskManager, Twilio, etc.); none touch `server/services/ops/checks/google_ads/` or the new migrations.
- Migration syntax — both new migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `WHERE NOT EXISTS`). Re-run safe.
- gRPC-only verified — every external call goes through the existing `google-ads-api` Customer instance; no REST endpoints are touched (CLAUDE.md gotcha #14).

## Follow-ups punted

- **Per-client OAuth for Google Ads.** Deferred behind a future flag per P1; the credentialStore already has scaffolding for `google_ads` platform credentials when this is unlocked.
- **Mutations (pause_ad / change_budget).** Read-only in v1 per P5. The existing `googleAdsAdapter` would need write methods + an approval-gated execution path (Phase 7+).
- **Smarter brand-competitor detection.** Current heuristic is intentionally simple. Phase 6/7 can use SEMrush brand databases, an LLM classifier, or per-client allow/block lists.
- **GSC linkage detection.** `paid_organic_search_term_view` works as a probe but isn't ideal. Once `customer_user_access` exposes link types more cleanly (or a dedicated `*_link` resource), swap to that.
- **`merchant_center_link` is gated on a free-text `client_type`.** Until `client_profiles.client_type` is enum-bounded, we accept either `ecommerce` or `e-commerce` (case-insensitive). Tighten when the schema is.

## How to test (post-merge)

```sql
-- Confirm new tables and seed rows present:
SELECT name, tier, jsonb_array_length(check_set) AS check_count
  FROM ops_run_definitions WHERE name LIKE 'gads_%';
SELECT count(*) FROM ops_keyword_history;
```

```bash
# Trigger a daily-essential run for a client with a Google Ads link (admin JWT in $TOKEN):
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_user_id":"<uuid>","run_definition_id":"<gads_daily_essential uuid>"}' \
  http://localhost:4000/api/ops/runs

# Inspect check results:
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/ops/runs/<runId>/check-results
```

UI: `/operations?tab=runs` → click any run row to drill into the JSON viewer (Phase 3 mounted this surface).
