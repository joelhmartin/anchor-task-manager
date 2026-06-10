# Phase 5 — Meta umbrella v1 (shipped 2026-05-05)

**Specialist:** meta-checks-engineer
**Branch:** `main`
**Commits:**
- `23215d4` — `feat(ops-meta): add Meta adapter + HIPAA gate helper`
- `ee63f06` — `feat(ops-meta): add pixel + CAPI checks`
- `c21f764` — `feat(ops-meta): add delivery + account-level checks`
- _(C4)_ — `feat(ops-meta): seed meta run definitions` (see commit log for SHA)

## HIPAA gate — explicit, never silent

**This is the load-bearing compliance decision for the entire Meta umbrella.**

`server/services/ops/checks/meta/_hipaaGate.js` exposes a single helper:

```js
import { assertNonMedical } from './_hipaaGate.js';

handler: async (ctx) => {
  const gate = await assertNonMedical(ctx);
  if (gate.skipped) return gate.outcome;
  // ... Meta API work
}
```

Behavior matrix:

| `client_profiles.client_type` | Outcome |
|---|---|
| `'medical'` | `status='skipped'`, `payload_json={ reason: 'hipaa_no_meta', policy: 'Meta does not sign HIPAA Business Associate Agreements.', client_type: 'medical' }` |
| `'non_medical'` | Gate passes, check proceeds with Meta API calls |
| `null`, missing row, any other value | `status='skipped'`, `payload_json={ reason: 'client_type_unknown', detail: 'client_profiles.client_type must be "non_medical" before Meta checks run.', client_type: <value> }` — **fails safe**, never silently allows Meta calls when type is indeterminate |

**Every** Meta check in this umbrella calls `assertNonMedical(ctx)` as its first
action. There are no exceptions. The gate logic lives in exactly one helper —
audits read one file to verify the policy. Per-run memoization on `ctx` ensures
the lookup runs once per run regardless of how many Meta checks are dispatched.

This mirrors the existing HIPAA gate in `server/services/trackingRelay.js`
(which blocks Meta CAPI dispatch for medical clients during conversion relay).
Mirroring the policy keeps a single mental model across the codebase: **Meta is
non-medical only, end of story.**

The gate is _explicit_ rather than silent because:
- Audits need to see the gate fired (status='skipped' + reason='hipaa_no_meta').
- Run UI surfaces the skipped result so staff can confirm the policy applied.
- A silently absent check would be indistinguishable from a misconfiguration.

## Files added

| File | Purpose |
|---|---|
| `server/services/ops/checks/meta/_hipaaGate.js` | Single-source HIPAA gate (`assertNonMedical(ctx)`). Used by every Meta check. |
| `server/services/ops/checks/meta/_client.js` | Adapter wrapping `services/analytics/metaAdsAdapter.js`. Resolves agency-level `FACEBOOK_SYSTEM_USER_TOKEN` (P1) + per-client meta `account_id` from `client_platform_credentials`. Exposes a small `graph(path)` helper for endpoints not covered by the existing adapter. Per-run memoization on `ctx`. |
| `server/services/ops/checks/meta/pixel.js` | `meta.pixel.health`, `meta.capi.health`, `meta.capi.match_quality`, `meta.pixel.event_coverage`, `meta.pixel.deduplication`. Pixel listing memoized per run. |
| `server/services/ops/checks/meta/delivery.js` | `meta.audience.size`, `meta.audience.overlap`, `meta.adset.delivery_issues`, `meta.adset.learning_phase`, `meta.adset.frequency`, `meta.creative.fatigue`. |
| `server/services/ops/checks/meta/account.js` | `meta.account.spending_limit`, `meta.account.business_verification`, `meta.account.domain_verification`, `meta.account.attribution_setting`, `meta.account.ios14_aem_priority`, `meta.account.disapproved_ads`. Account record memoized per run across all six. |
| `server/services/ops/checks/meta/index.js` | Side-effect barrel (`pixel.js`, `delivery.js`, `account.js`). |
| `server/sql/migrate_ops_seed_meta_run_definitions.sql` | Idempotent seed of `meta_daily_essential` (5 checks) + `meta_weekly_deep` (full 17-check set). |

## Files modified

- `server/services/ops/index.js` — adds side-effect import of `./checks/meta/index.js` so the registry is populated before the executor dispatches.
- `server/services/ops/runExecutor.js` — same side-effect import for completeness.
- `server/index.js` — registers `maybeRunOpsSeedMetaRunDefinitionsMigration` in the boot migration chain after `maybeRunOpsSeedRunDefinitionsMigration`.
- `docs/ops-rebuild/STATE.md` — Phase 5 marked shipped.

## Run definitions seeded (§7.6)

| Name | Tier | Checks |
|---|---|---|
| `meta_daily_essential` | `daily_essential` | `meta.pixel.health`, `meta.capi.health`, `meta.account.spending_limit`, `meta.adset.delivery_issues`, `meta.account.disapproved_ads` |
| `meta_weekly_deep` | `weekly_deep` | All 17 Meta checks |

Both definitions have `default_for_new_clients=TRUE`. Medical clients will see
every check run in their reports as `status='skipped'` with the HIPAA reason —
this is intentional so the audit trail shows the policy fired.

## Behavioral decisions

- **Per-run memoization on `ctx`.** The HIPAA gate, `getAdAccountClient`, the
  pixel listing, ad-set listing, audience listing, and the account record are
  each fetched at most once per run, even when many checks consume them. The
  Phase 1 executor passes one shared `ctx` object across all handler calls in a
  single run (see `runExecutor.js:executeRun`), so this is safe.
- **Read-only in v1 (P5).** No mutations anywhere — every check only issues
  GET requests against the Graph API.
- **Agency-level token only (P1).** All Meta calls use `FACEBOOK_SYSTEM_USER_TOKEN`
  from env. Per-client OAuth is deferred. The adapter explicitly skips with a
  reason if the env var is unset.
- **Account ID resolution.** The adapter reads
  `client_platform_credentials.account_id WHERE platform = 'meta'` and
  normalises to the `act_<digits>` form. If the row is missing, the check skips
  with reason `'no Meta ad_account_id configured for client...'`.
- **Gated endpoints fail safe.** `event_match_quality`, `browser_vs_server`
  aggregations, and `aggregated_event_measurement_settings` are not always
  granted to system-user tokens. When Meta returns a permission error, the
  affected check returns `status='skipped'` with the upstream message rather
  than silently passing.
- **`meta.audience.overlap` is bounded.** Pairwise overlap is O(n²); we only
  evaluate the top 10 audiences by `approximate_count_lower_bound` to keep the
  Graph cost predictable. Missed overlaps below the top-10 are surfaced via
  `pairs_checked` in the payload.
- **`meta.creative.fatigue` denominator floor.** Ads with < 1 000 recent
  impressions are excluded from the fatigue ratio — small samples produced
  noisy false positives during the analytics dashboard work.
- **HIPAA gate always FIRST.** Every check calls `assertNonMedical(ctx)` before
  any Graph fetch. There is no escape hatch and no opt-out.

## Validation outputs

- `yarn lint` — zero new errors / warnings introduced. `yarn lint 2>&1 | grep "ops/checks/meta"` returns nothing.
- `yarn build` — clean (`✓ built in 12.54s`).
- Migration syntax — `migrate_ops_seed_meta_run_definitions.sql` uses the same
  idempotent `INSERT ... WHERE NOT EXISTS` pattern as the website seed
  migration. Re-running is safe.

## Follow-ups punted

- **Per-client OAuth for Meta.** Deferred per P1 — the adapter is shaped so a
  future flag can swap `FACEBOOK_SYSTEM_USER_TOKEN` for a decrypted self-serve
  payload without touching any check.
- **Mutations.** P5 holds Meta to read-only in v1. Phase 8+ may revisit if and
  only if the AI supervisor design accepts ad-platform mutations.
- **`event_match_quality` per-event drill-down.** We surface the average and a
  per-event array; the correlator (Phase 6) will splay low-scoring events into
  individual findings.
- **Audience overlap above top-10.** A future tier could iterate the full
  audience set if Meta adds a bulk overlap endpoint (currently O(n²)).
- **Ad-creative fatigue across multiple windows.** v1 compares 7d vs lifetime;
  weekly/monthly comparisons land with the snapshot history in Phase 6.

## How to test (post-merge)

```sql
-- Confirm seed rows present:
SELECT name, tier, jsonb_array_length(check_set) AS check_count
  FROM ops_run_definitions
 WHERE name LIKE 'meta_%';
```

```bash
# Trigger a daily-essential Meta run for a non-medical test client:
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_user_id":"<uuid>","run_definition_id":"<meta_daily_essential uuid>"}' \
  http://localhost:4000/api/ops/runs

# Trigger the same run for a medical client and confirm every check returns
# status='skipped' with payload_json.reason='hipaa_no_meta':
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/ops/runs/<runId>/check-results
```
