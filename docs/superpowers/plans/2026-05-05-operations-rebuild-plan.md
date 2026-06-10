# Operations Tab — Rebuild Plan

**Date:** 2026-05-05
**Branch:** `claude/review-operations-tab-4qicW` (plan source); shipped on `main` 2026-05-05.
**Status:** ✅ Shipped — all 11 phases (0–10) complete. P1–P9 locked at the listed defaults. See `docs/ops-rebuild/STATE.md` and `docs/ops-rebuild/phases/phase-{0..10}-completion.md` for the as-built record.

---

## 0. Context — what's wrong today

The Operations tab is currently two unrelated products fused into one shell:

1. **Kinsta SSH manager** (Sites + Bulk tabs) — well-built, ~95% of the original Phase plan in `docs/superpowers/plans/2026-04-29-kinsta-operations.md`.
2. **Analytics audit reskin** (Portfolio + Client Detail + Assistant tabs) — imported wholesale from `views/admin/AnalyticsDashboard/AuditsTab` via `OperationsWorkspace/index.jsx:38, :42-48`. Different domain model, different API, different DB tables, different AI pipeline.

The vision (AI-driven multi-platform health checks with cross-platform correlation, scheduled runs, per-client chat) is **~10% delivered**. The Kinsta surface contains real production value but should become *one of* several umbrellas, not the centerpiece.

Two AI assistants currently coexist:

- **Site Assistant** (`Sites/SiteAssistant.jsx` → `POST /api/operations/assistant/chat` → `opsAssistant.js`) — Vertex Gemini with 7 WP-CLI / Kinsta tools.
- **Audit Assistant** (top-level Assistant tab → `POST /api/analytics/audits/chat` → `chatAuditAssistant`) — different model, different prompts, different scope.

There is no scheduler (`driftScanner.js:3` literally says "User-triggered: there is no cron"), no per-client credential store, no unified report, no run-tier concept, and no checks for Google Ads, Meta, PSI, GSC, or SEMrush.

### Defects in shipped code (must fix in Phase 0)

| # | File:Line | Defect |
|---|---|---|
| D1 | `opsAssistant.js:190-193` | Vertex safety thresholds set to `BLOCK_NONE` in a HIPAA app |
| D2 | `agentTools.js:136-139` | WP-CLI read-only blocklist uses substring match |
| D3 | `driftScanner.js:197-205` | Baseline rolls forward unconditionally; can't re-run to confirm |
| D4 | `agentTools.js:202-209` | `verify_tracking_install` fetches `home_url` without SSRF guards |
| D5 | `agentTools.js:281-300` | `divi_safe_update` is a stub returning errors; pollutes Vertex tool planning |
| D6 | `opsAssistant.js:24-25` | Silent context truncation (16KB/8KB) |
| D7 | `kinsta_environments.ssh_password_fetched_at` | No TTL or scheduled refresh |
| D8 | `bulkRunner.js:71` vs. `runDriftCheck` `includeTrackingCheck` | Inconsistent tracking-check inclusion |
| D9 | `/api/operations/assistant/chat`, `/exec` | No rate limiting |
| D10 | `kinsta_site_clients.relationship` | Field exists, never enforced anywhere |
| D11 | Tool approvals | Logged to `kinsta_ssh_command_log` only as side-effect; no first-class approval audit |

---

## 1. Prerequisites — decisions required before Phase 1

These shape schemas and can't be deferred without rework.

| # | Decision | Why it matters | Default if unanswered |
|---|---|---|---|
| P1 | Per-client OAuth for Google Ads / Meta vs. agency-level only? | `client_platform_credentials` shape | Keep agency-level; add per-client as future flag |
| P2 | Search Console: per-client OAuth or service-account? | Auth flow + token storage | Per-client OAuth |
| P3 | PSI vs. Lighthouse-CI on Cloud Run Jobs? | Quota + infra cost | PSI first; swap if quota becomes pain |
| P4 | Report format (in-app HTML vs. emailed PDF)? | Renderer scope | In-app HTML; PDF later |
| P5 | Action surface — does AI-execute extend to ad platforms? | Tool surface, approval UX | Read-only ads in v1; mutations only on website |
| P6 | Existing `audit_runs` analytics — keep separate or absorb? | Migration scope | Keep separate; absorb in Phase 10 |
| P7 | Token budget per client per month? | Tier definitions | $5/client/month default |
| P8 | Run cadence mix? | Scheduler config | Daily essentials + weekly deep + monthly audit |
| P9 | Drift baseline strategy — version history or roll-forward with explicit accept? | Schema | Versioned baselines (no silent rollover) |

---

## 2. Phase 0 — Stabilize what ships today (1 week)

**Goal:** Fix correctness/compliance defects before stacking new work on top.

### 2.1 Compliance hardening

- [ ] `opsAssistant.js:190-193` — change Vertex safety thresholds from `BLOCK_NONE` to `BLOCK_MEDIUM_AND_ABOVE` for `HARM_CATEGORY_DANGEROUS_CONTENT` and `HARM_CATEGORY_HARASSMENT`. Add `HARM_CATEGORY_HATE_SPEECH` and `HARM_CATEGORY_SEXUALLY_EXPLICIT`.
- [ ] Create `audit_log` event types: `operations.tool_proposed`, `operations.tool_approved`, `operations.tool_executed`. Wire approval path in `opsAssistant.js:161-175` to write `tool_approved` with user_id, tool name, args hash, pending tool ref.

### 2.2 Rate limiting

- [ ] Apply existing `rateLimitMiddleware` to `POST /api/operations/assistant/chat` (30/5min) and `POST /api/operations/environments/:envId/exec` (60/5min).

### 2.3 WP-CLI blocklist correctness

- [ ] `agentTools.js:136-139` — replace substring match with tokenized command parser. Fail-closed: unknown verbs refused.

### 2.4 Drift baseline mutation

- [ ] `driftScanner.js:197-205` — stop rolling baseline forward unconditionally. Add `baseline_accepted_at` column to `kinsta_site_workspaces`. Roll forward only on first scan or explicit admin "Accept new baseline" click.
- [ ] New table `kinsta_scan_history` for versioned baselines.

### 2.5 Tracking-check consistency

- [ ] Decide always-on or never (recommend always). Remove `includeTrackingCheck` flag.

### 2.6 Stale `divi_safe_update` tool

- [ ] Remove from `agentTools.js` registry until mu-plugin actually exists.

### 2.7 SSRF surface

- [ ] `agentTools.js:202-209` — validate `homeUrl` before fetch: must be `https?://`, must resolve to public IP. Block RFC1918 + 169.254/16 + 127/8.

### 2.8 Silent context truncation

- [ ] `opsAssistant.js:24-25` — append `[truncated: N bytes omitted]` to system prompt when truncating.

### 2.9 UI Frankenstein excision

- [ ] `OperationsWorkspace/index.jsx:38, :42-48, :50-56` — remove `Portfolio`, `Client Detail`, top-level `Assistant` tabs. Move users back to `views/admin/AnalyticsDashboard/AuditsTab`.
- [ ] `OperationsWorkspace/index.jsx` should drop below 200 lines after excision.
- [ ] Update `docs/superpowers/plans/2026-04-29-kinsta-operations.md` with excision note.

**Validation:** `yarn build` + `yarn lint` clean. Operations renders only Sites + Bulk; Audits feature still works under Analytics.

**Rollback:** Each fix is a separate commit; revert individually.

**Effort:** ~5 dev-days.

---

## 3. Phase 1 — Domain model foundation (1 week)

**Goal:** New run/check/finding/credential domain model. No new functionality yet — bones only.

### 3.1 Schema migration `migrate_ops_foundation.sql`

```
ops_run_definitions
  id (uuid, pk)
  name, description (text)
  tier (text)               -- 'daily_essential' | 'weekly_deep' | 'monthly_audit' | 'on_demand'
  umbrellas (text[])        -- ['google_ads', 'meta', 'website']
  check_set (jsonb)         -- [{check_id, enabled, config}]
  default_for_new_clients (bool)
  created_at, updated_at

client_run_subscriptions
  id (uuid, pk)
  client_user_id (uuid, fk)
  run_definition_id (uuid, fk)
  enabled (bool)
  schedule_cron (text)      -- nullable; null = use definition's tier default
  created_at, updated_at
  UNIQUE (client_user_id, run_definition_id)

ops_runs
  id (uuid, pk)
  client_user_id (uuid)
  run_definition_id (uuid, fk)
  tier (text)
  status (text)             -- 'queued' | 'running' | 'completed' | 'failed' | 'partial' | 'cancelled' | 'budget_exceeded'
  trigger (text)            -- 'schedule' | 'manual' | 'retry'
  triggered_by (uuid)       -- user_id when manual; null when scheduled
  started_at, finished_at (timestamptz)
  duration_ms (int)
  token_usage_json (jsonb)  -- {prompt_tokens, completion_tokens, cost_cents, by_subagent: {...}}
  cost_estimate_cents (int)
  error_summary (text)
  metadata (jsonb)
  created_at

ops_check_results
  id (uuid, pk)
  run_id (uuid, fk → ops_runs)
  umbrella (text)           -- 'google_ads' | 'meta' | 'website'
  check_id (text)           -- 'gads.conversion_tag_firing', 'meta.pixel_health', 'web.psi_lcp', etc.
  status (text)             -- 'pass' | 'warn' | 'fail' | 'error' | 'na' | 'skipped'
  severity (text)           -- 'critical' | 'warning' | 'info'
  payload_json (jsonb)      -- check-specific evidence
  duration_ms (int)
  cost_cents (int)
  created_at
  INDEX (run_id), INDEX (umbrella, check_id)

ops_findings
  id (uuid, pk)
  run_id (uuid, fk)
  client_user_id (uuid)
  severity (text)
  category (text)
  summary (text)
  evidence_json (jsonb)
  linked_check_result_ids (uuid[])  -- cross-platform correlations live here
  acknowledged_by (uuid), acknowledged_at (timestamptz)
  resolved_at (timestamptz), resolved_by (uuid), resolution_note (text)
  created_at
  INDEX (client_user_id, resolved_at) WHERE resolved_at IS NULL

ops_reports
  id (uuid, pk)
  run_id (uuid, fk, unique)
  format (text)             -- 'html' | 'pdf' | 'json'
  storage_uri (text)        -- gs://anchor-hub-ops-reports/<run_id>.html
  size_bytes (int)
  rendered_at (timestamptz)

client_platform_credentials
  id (uuid, pk)
  client_user_id (uuid, fk)
  platform (text)           -- 'google_ads' | 'meta' | 'ga4' | 'gsc' | 'semrush' | 'kinsta_site'
  account_id (text)         -- per-platform identifier
  credentials_source (text) -- 'agency_mcc' | 'agency_sysuser' | 'self_serve_oauth' | 'env_var'
  credentials_encrypted (text)  -- nullable; only when self_serve_oauth
  scope_metadata (jsonb)
  last_validated_at (timestamptz)
  last_validation_error (text)
  created_at, updated_at
  UNIQUE (client_user_id, platform, account_id)

ops_tool_approvals
  id (uuid, pk)
  run_id (uuid, nullable)
  user_id (uuid)
  tool_name (text)
  args_hash (text)          -- sha256 of canonical-JSON args
  args_json (jsonb)
  approved_at (timestamptz)
  executed_at (timestamptz)
  execution_result_json (jsonb)
  created_at
```

### 3.2 Migration registration

- [ ] `server/index.js` — append `maybeRunOpsFoundationMigration` after `maybeRunKinstaFindingsMigration`.

### 3.3 Backward-compat views

- [ ] `kinsta_findings_compat` view: `SELECT ... FROM ops_findings WHERE category LIKE 'kinsta.%'`.

### 3.4 Check registry skeleton

- [ ] `server/services/ops/checks/registry.js`:
  - `registerCheck(checkId, { umbrella, tier, handler, costEstimate, requires })`
  - `listChecksForUmbrella(umbrella)`
  - `listChecksForTier(tier)`
  - `getCheck(checkId)`

### 3.5 Run executor skeleton

- [ ] `server/services/ops/runExecutor.js`:
  1. Load run + definition
  2. Resolve client credentials per umbrella
  3. For each check_id in definition.check_set:
     - Run handler with bounded timeout
     - Persist `ops_check_results`
     - Track cost
     - Stop if cost_estimate exceeds tier budget
  4. Aggregate findings (Phase 6 fills in)
  5. Render report (Phase 6)
  6. Mark run completed/partial/failed

### 3.6 Credential service

- [ ] `server/services/ops/credentialStore.js`:
  - `getCredential(clientUserId, platform, accountId?)`
  - `putCredential(...)` (admin only)
  - `validateCredential(...)`
  - `rotateCredential(...)`
  - Reuses `services/security/encryption.js`. Agency-level sources lookup once and skip per-client storage.

### 3.7 Routes

New router `server/routes/ops.js` mounted at `/api/ops`:

```
GET    /runs                        list runs
POST   /runs                        manually trigger
GET    /runs/:id                    detail
POST   /runs/:id/cancel
GET    /runs/:id/report
GET    /runs/:id/findings
GET    /findings                    cross-run finding feed
POST   /findings/:id/acknowledge
POST   /findings/:id/resolve
GET    /run-definitions
POST   /run-definitions             admin only
PUT    /run-definitions/:id
GET    /clients/:id/subscriptions
PUT    /clients/:id/subscriptions
GET    /clients/:id/credentials
PUT    /clients/:id/credentials/:platform
DELETE /clients/:id/credentials/:id
POST   /clients/:id/credentials/:id/validate
```

Existing `/api/operations` router stays mounted — Kinsta-specific surface lives there during transition.

**Validation:** Migration applies idempotently; `GET /api/ops/runs` returns `[]`; `POST /api/ops/runs` with fake definition_id 404s cleanly.

**Rollback:** Drop tables in reverse FK order. Comment out router mount.

**Effort:** ~5 dev-days.

---

## 4. Phase 2 — Run orchestration plumbing (1 week)

**Goal:** Pub/Sub + Cloud Run Jobs in prod, in-process queue in dev.

### 4.1 Pub/Sub topics & subs

- [ ] Topic `ops.run.requested`
- [ ] Topic `ops.run.completed` (for fan-out to email/notification consumers)
- [ ] Subscription `ops-runner`
- [ ] DLQ topic `ops.run.dead` with alert
- [ ] IaC snippet at `infra/pubsub/ops.tf` or `scripts/`

### 4.2 Cloud Run Job

- [ ] `Dockerfile.opsRunner` (or shared image with entry override).
- [ ] Entry: `node server/jobs/opsRunner.js`
  - Pub/Sub pull subscriber
  - Calls `executeRun(runId)`
  - Bounded concurrency (4 runs in-flight per instance)
  - Graceful SIGTERM
- [ ] `scripts/gdeploy-ops-runner.sh`

### 4.3 Local-dev fallback

- [ ] `server/services/ops/runQueue.js`:
  - Production: publishes to Pub/Sub
  - Local: in-memory queue + `setInterval` worker started from `server/index.js` only when `NODE_ENV !== 'production'`
  - Same surface either way: `enqueueRun(runId)`

### 4.4 Cloud Scheduler integration

- [ ] `scripts/schedule-ops-runs.sh`:
  - `ops-daily-essentials` — `0 6 * * *` America/Chicago
  - `ops-weekly-deep` — `0 7 * * 1` (Monday)
  - `ops-monthly-audit` — `0 8 1 * *`
- [ ] `server/services/ops/scheduleFanout.js` — handler for `POST /api/ops/internal/fanout?tier=...` (signed with OIDC). Queries `client_run_subscriptions`, publishes one Pub/Sub message per (client, definition).

### 4.5 Cost tracking

- [ ] Each handler accepts `costTracker.add({ tokens, dollars, source })`.
- [ ] `executeRun` aggregates into `ops_runs.token_usage_json` and `cost_estimate_cents`.
- [ ] Hard cap: when `cost_estimate_cents` exceeds tier budget, mark `status='budget_exceeded'`, emit `budget_exceeded` finding (warning), stop further checks.

**Validation:**
1. Manual `POST /api/ops/runs` → Pub/Sub msg → Cloud Run Job picks up → status `completed` (with 0 checks) within 30s.
2. `gcloud scheduler jobs run ops-daily-essentials` → fanout publishes N messages.
3. Local dev works without Pub/Sub.

**Rollback:** Disable Cloud Scheduler; Cloud Run Job quiesces.

**Effort:** ~5 dev-days.

---

## 5. Phase 3 — Website umbrella v1 (2–3 weeks, internally parallelizable)

**Goal:** First real checks. Re-home Kinsta drift + add web-level checks.

### 5.1 Re-home Kinsta drift

- [ ] `web.kinsta.drift` — wraps `runDriftCheck()`, writes to `ops_check_results`. Old `kinsta_findings` writes mirror to `ops_findings` for compat.
- [ ] `web.tracking_install` — port `verify_tracking_install` from `agentTools.js:182` to standalone check.
- [ ] `web.wp_security` — xmlrpc.php enabled, WP_DEBUG, listed-only-when-needed users, vulnerable plugins (cross-ref vuln feed §5.7).

### 5.2 PSI / Core Web Vitals

- [ ] `server/services/ops/checks/website/psi.js` — PSI API (mobile + desktop).
- [ ] Checks: `web.psi.lcp`, `web.psi.cls`, `web.psi.inp`, `web.psi.accessibility_score`, `web.psi.best_practices_score`, `web.psi.seo_score`.
- [ ] Quota tracking: 25k/day; back off at 90%.

### 5.3 SSL & uptime

- [ ] `server/services/ops/checks/website/ssl.js` — TLS handshake, cert expiry. `web.ssl.expiry_within_30d` (warning), `web.ssl.expiry_within_7d` (critical).
- [ ] `server/services/ops/checks/website/uptime.js` — HEAD with timeout. Multi-region deferred to v2.

### 5.4 Schema validation

- [ ] `server/services/ops/checks/website/schema.js` — JSON-LD validation. `web.schema.has_organization`, `web.schema.has_localbusiness` (medical/dental), `web.schema.parse_errors`.

### 5.5 Search Console

- [ ] OAuth dance per P2 decision. Reuse `oauth_connections` pattern.
- [ ] `web.gsc.coverage_errors`, `web.gsc.manual_actions`, `web.gsc.crux_lcp`, `web.gsc.indexed_pages_drop`.

### 5.6 SEMrush

- [ ] `server/services/ops/checks/website/semrush.js`:
  - `web.semrush.organic_traffic_drop` (>20% WoW)
  - `web.semrush.top_keywords_lost` (drop >5 positions)
  - `web.semrush.toxic_backlinks`

### 5.7 Vulnerability feed

- [ ] `server/services/ops/feeds/wpvuln.js` — caches WPScan or alternative DB. Daily refresh into `ops_vuln_feed` table.

### 5.8 Broken links (deferred but stubbed)

- [ ] `server/services/ops/checks/website/brokenLinks.js` — returns `status='skipped'` for now.

### 5.9 Run definitions

- [ ] Seed three definitions via `migrate_ops_seed_run_definitions.sql`:
  - `web_daily_essential`: tracking_install, ssl, uptime
  - `web_weekly_deep`: psi (mobile+desktop), gsc, semrush, schema, drift
  - `web_monthly_audit`: full set including broken_links

### 5.10 UI: run results

- [ ] `src/views/admin/Operations/Runs/RunsTab.jsx` — list view, client filter.
- [ ] `RunDetail.jsx` — checks grouped by umbrella, severity-colored, payload drill-down.

**Validation:**
1. `web_daily_essential` triggered → 3 checks run → results persisted.
2. PSI returns real LCP from actual site URL.
3. SSL accurately flags cert expiring < 30d.
4. GSC coverage errors match Search Console UI.
5. Drift writes to `ops_check_results` AND `kinsta_findings` (compat).

**Effort:** ~10–15 dev-days. PSI/SSL/uptime/tracking_install quick (existing logic). GSC OAuth + SEMrush + schema validation are long pole.

---

## 6. Phase 4 — Google Ads umbrella (2–3 weeks)

**Goal:** Read-only health checks across Google Ads accounts.

### 6.1 Adapter setup

- [ ] All checks under `server/services/ops/checks/google_ads/`.
- [ ] Reuse `services/analytics/googleAds.js` (`google-ads-api` gRPC). **No duplicate clients.**
- [ ] Helper: `getCustomerClient(customerId)`.

### 6.2 Conversion tracking

- [ ] `gads.conversion_tag.installed` — query `Customer.conversion_tracking_setting`. Cross-ref `tracking_configs`.
- [ ] `gads.conversion_tag.firing` — `conversion_action` last-7d conversions; if 0 across primary actions while spend > 0, critical.
- [ ] `gads.conversion_action.cpa_drift` — last-7d vs. last-30d-excluding-7d. >50% drift = warning.
- [ ] `gads.conversion_source.validity` — every active conversion action has ≥1 attribution in 30d.

### 6.3 Negative keyword audit

- [ ] `gads.negative_keywords.recent_changes` — `change_event` resource, 7d window, info-level diff.
- [ ] `gads.negative_keywords.coverage` — at least one shared neg-kw list applied.

### 6.4 Account configuration

- [ ] `gads.account.linked_analytics` — `customer_client_link` for GA4.
- [ ] `gads.account.linked_search_console`.
- [ ] `gads.account.linked_merchant_center` — only if e-commerce client_type.
- [ ] `gads.account.disapproved_ads` — `ad_group_ad` where `policy_summary.approval_status='DISAPPROVED'`.
- [ ] `gads.account.budget_pacing` — pacing >120% or <70%.
- [ ] `gads.account.location_bid_modifiers` — count; flag 0 for service-area clients.
- [ ] `gads.account.device_bid_modifiers`.
- [ ] `gads.account.audience_lists.populated`.
- [ ] `gads.account.audience_lists.size` — remarketing >100 (eligible for serving).
- [ ] `gads.account.ad_extensions.sitelinks`.
- [ ] `gads.account.ad_extensions.callouts`.
- [ ] `gads.account.ad_extensions.callout_phone` — match against client's CTM tracking number.
- [ ] `gads.account.auto_applied_recommendations`.

### 6.5 Keyword ranking history

- [ ] `gads.keywords.position_changes` — diff today vs. 7d ago for top 50 keywords by spend. >3-position drop = flag.
- [ ] New table `ops_keyword_history` (customer_id, keyword, date, avg_position, impressions, clicks).

### 6.6 Suggested additional checks

- [ ] `gads.account.smart_bidding.adoption` — % of campaigns on Maximize Conversions / Target CPA / Target ROAS.
- [ ] `gads.search_terms.brand_competitors` — competitor brands in top 20 search terms.
- [ ] `gads.account.url_options.tracking_template` — UTM params present.
- [ ] `gads.account.final_url_suffix`.
- [ ] `gads.account.experiments.active` — running > 60d without conclusion.

### 6.7 Run definitions

- [ ] `gads_daily_essential`: budget_pacing, disapproved_ads, conversion_tag.firing.
- [ ] `gads_weekly_deep`: full audit set.

**Effort:** ~12 dev-days.

---

## 7. Phase 5 — Meta Ads umbrella (2–3 weeks)

**Goal:** Same shape as Google Ads. Read-only in v1.

### 7.1 Adapter setup

- [ ] `server/services/ops/checks/meta/`. Reuse `services/analytics/meta.js`.
- [ ] Per-client `ad_account_id` from `client_platform_credentials`.

### 7.2 Pixel & CAPI health

- [ ] `meta.pixel.health` — `last_fired_time` within 24h.
- [ ] `meta.capi.health` — `last_received_time`.
- [ ] `meta.capi.match_quality` — `match_keys_quality_score`; warning if <7.0.
- [ ] `meta.pixel.event_coverage` — match `tracking_configs` expectations (Lead, Contact, Schedule).
- [ ] `meta.pixel.deduplication` — server+browser `event_id` dedup rate.

### 7.3 Audience & delivery

- [ ] `meta.audience.size` — `approximate_count` > minimum-serving threshold.
- [ ] `meta.audience.overlap` — `audience_overlap_estimate`; warning >30%.
- [ ] `meta.adset.delivery_issues` — `delivery_estimate` + `issues_info`.
- [ ] `meta.adset.learning_phase` — count stuck >7d.
- [ ] `meta.adset.frequency` — avg frequency >4 in 7d.
- [ ] `meta.creative.fatigue` — 7d CTR < 50% of lifetime.

### 7.4 Account-level

- [ ] `meta.account.spending_limit` — `spend_cap` not blocking.
- [ ] `meta.account.business_verification`.
- [ ] `meta.account.domain_verification`.
- [ ] `meta.account.attribution_setting` — confirm 1d-click-7d-view (or agency standard).
- [ ] `meta.account.ios14_aem_priority`.
- [ ] `meta.account.disapproved_ads`.

### 7.5 HIPAA gate

- [ ] All Meta checks check `client_profiles.client_type !== 'medical'`. Medical clients return `status='skipped', payload_json={reason: 'hipaa_no_meta'}` — explicit, not silent.

### 7.6 Run definitions

- [ ] `meta_daily_essential`: pixel.health, capi.health, account.spending_limit (skipped for medical).
- [ ] `meta_weekly_deep`: full set.

**Effort:** ~10 dev-days.

---

## 8. Phase 6 — Cross-platform correlation & unified reporting (2 weeks)

**Goal:** Show the *correlations* the vision describes ("conversions dropped on Google Ads AND the conversion tag is missing from the thank-you page").

### 8.1 Correlation rules engine

- [ ] `server/services/ops/correlator.js` — runs after all checks complete. Declarative rules:

```js
{
  name: 'tracking_loss_with_conversion_drop',
  severity: 'critical',
  when: ({ checks }) =>
    checks.some(c => c.check_id === 'gads.conversion_tag.firing' && c.status === 'fail') &&
    checks.some(c => c.check_id === 'web.tracking_install' && c.payload_json.gtm_present === false),
  summary: () => 'Google Ads conversions dropped to zero AND GTM is missing from the homepage. Likely a tag deployment regression.',
  linked_check_result_ids: (checks) => [...]
}
```

Initial rule set (~10 rules):
- tracking_loss_with_conversion_drop
- psi_lcp_regression_with_organic_traffic_drop
- meta_capi_down_with_lead_form_active
- ssl_expiring_with_organic_decline
- keyword_ranking_drop_with_indexation_errors
- budget_overrun_with_disapproved_ads
- ...

### 8.2 Report renderer

- [ ] `server/services/ops/reportRenderer.js` — HTML from run + checks + findings. Sections:
  - Executive summary (counts by severity, key findings)
  - Cross-platform correlations (prominent, not buried)
  - Per-umbrella detail (collapsed by default)
  - Trend graph (current vs. last 4 runs of same definition)
- [ ] Render to GCS `gs://anchor-hub-ops-reports/`. Signed URL via `ops_reports.storage_uri`.

### 8.3 PDF (deferred unless P4 requires)

- [ ] If P4 = emailed PDF, add `puppeteer` Cloud Run Job. Otherwise skip.

### 8.4 Email digest

- [ ] Per-client subscription `email_on_completion=true`. Mailgun template `ops-run-summary` with summary + signed URL.
- [ ] Internal portfolio digest: "12 runs, 3 critical, click for detail."

### 8.5 Trend storage

- [ ] No new table — use `ops_check_results` history. Add index on `(client_user_id, check_id, created_at DESC)`.

**Validation:** Deliberately break a site (kill GTM + trigger Google Ads conversion drop). Verify cross-platform finding appears correlated, not as two separate issues.

**Effort:** ~8–10 dev-days.

---

## 9. Phase 7 — AI agent: supervisor + sub-agents (2–3 weeks)

**Goal:** Replace single `opsAssistant.js` with supervisor + specialized sub-agents.

### 9.1 Framework

- [ ] `server/services/ops/agents/supervisor.js`:
  - Loads run context (last 3 runs per tier per client)
  - Top-level tools: `load_run`, `drill_into`, `delegate_to(subagent, prompt)`, `propose_action`
  - Routes by intent
- [ ] `server/services/ops/agents/subAgents/`:
  - `googleAdsAgent.js`
  - `metaAgent.js`
  - `websiteAgent.js` (re-homed Kinsta tools + new web-platform tools)

### 9.2 Tool surface per sub-agent

**WebsiteAgent:**
- Existing: `wpcli_read`, `plugin_list`, `list_recent_posts`, `sftp_read`, `verify_tracking_install`
- New: `psi_run_now(url)`, `gsc_query(query, dimensions, daterange)`, `semrush_keyword_lookup(domain, keyword)`
- Mutating: `plugin_update` (existing approval gate), `wp_user_password_reset` (new)

**GoogleAdsAgent (P5: read-only v1):**
- `gads_query(gaql)` — sandboxed GAQL
- `gads_keyword_history(keyword, daterange)`
- `gads_disapproved_reason(ad_id)`
- Mutating deferred: `pause_ad`, `change_budget`

**MetaAgent (read-only):**
- `meta_query(endpoint, params)`
- `meta_pixel_test_event(event_name)`
- Mutating deferred

### 9.3 Cost tracking & budgets per turn

- [ ] Each invocation tracked into `ops_runs.token_usage_json.by_subagent`.
- [ ] Per-chat-turn cap: $0.50. On exceed: "I've hit my per-turn budget — please ask a more focused question or split this into multiple turns."

### 9.4 Approval gate

- [ ] Lift the existing `opsAssistant.js:209` mutation pattern into `supervisor.js`. Now writes to `ops_tool_approvals` (Phase 0.1).
- [ ] Frontend approval UI shared across all sub-agents — single component.

### 9.5 Per-client chat UI

- [ ] `src/views/admin/Operations/Chat/ClientChat.jsx`:
  - Client picker (admin-switchable)
  - Tool-call rendering (proposed/running/done/error)
  - Approval modal (`ConfirmDialog`)
  - "Reference latest run" button — injects context
- [ ] Endpoint: `POST /api/ops/chat` — replaces `POST /api/operations/assistant/chat`.

### 9.6 Migrate existing tools

- [ ] `opsAssistant.js` — keep file as redirect to supervisor with `subagent='website'`. Remove after Phase 10.
- [ ] `agentTools.js` → `server/services/ops/agents/subAgents/websiteTools.js`. Old file becomes re-export shim.

**Validation:**
1. "Is GTM installed on this site?" → website agent → tool runs → answer.
2. "Why did Google Ads conversions drop last week?" → Google Ads agent → analysis with citations to specific check_results.
3. "Update Yoast plugin" → website agent proposes → ConfirmDialog → approve → both `ops_tool_approvals` and `kinsta_ssh_command_log` recorded.
4. "Drill into every keyword" → agent stops with budget message.

**Effort:** ~12 dev-days.

---

## 10. Phase 8 — Scheduling & tier economics (1 week)

**Goal:** Productionize scheduler + budget controls.

### 10.1 Tier definitions reviewed

- [ ] Daily essentials: deterministic checks only, **no AI**. ~$0/run.
- [ ] Weekly deep: full check set + 1 supervisor turn. ~$0.05/run × 132 weekly = ~$26/month.
- [ ] Monthly audit: full + 5 supervisor turns. ~$0.50/run × 132 = $66/month.
- [ ] **Total projected AI spend: ~$100/month** (Gemini 2.5 Flash).

### 10.2 Per-client overrides

- [ ] `client_run_subscriptions.schedule_cron` — per-client custom cron.

### 10.3 Backoff on cost

- [ ] If client `cost_estimate_cents` MTD exceeds `client_profiles.ops_monthly_cap_cents` (default 500 = $5), runs auto-degrade with `budget_throttled` finding.

### 10.4 Rotating subset strategy

- [ ] Stub `client_run_subscriptions.rotation_group` (1–7) for week-rotation. Don't enable until needed.

### 10.5 Run cancellation

- [ ] User cancels via UI → Pub/Sub `ops.run.cancel` → runner aborts cleanly between checks.

**Effort:** ~3 dev-days.

---

## 11. Phase 9 — UI rebuild as command center (2–3 weeks)

**Goal:** UI catches up to the new domain model.

### 11.1 Information architecture

```
/operations
  ├─ Overview          — portfolio KPIs
  ├─ Runs              — table of recent runs, drill-down
  ├─ Findings          — cross-run feed, filterable
  ├─ Clients           — per-client view: subscriptions, credentials, latest runs, chat
  ├─ Sites             — Kinsta site management (existing, narrower scope)
  ├─ Bulk              — Kinsta bulk WP-CLI (existing, narrower scope)
  ├─ Schedule          — run definitions, per-client overrides
  └─ Cost              — token spend by client / tier / sub-agent
```

### 11.2 Components

- [ ] `Overview/OverviewTab.jsx` — KPI strip + 7-day trend graph.
- [ ] `Runs/RunsTab.jsx`, `Runs/RunDetail.jsx` — drilldown with correlations at top.
- [ ] `Findings/FindingsTab.jsx` — feed view, "ack all" bulk actions, resolution notes.
- [ ] `Clients/ClientOpsView.jsx` — per-client command center: latest run, subscriptions, credential health, "Open Chat".
- [ ] `Schedule/ScheduleTab.jsx`.
- [ ] `Cost/CostTab.jsx` — MTD spend, forecast.

### 11.3 Sites/Bulk shrink

- [ ] Functionally unchanged but positioned correctly: website-umbrella implementation, not centerpiece.

### 11.4 Per-client chat

- [ ] `Clients/ClientChat.jsx` — built in Phase 7.5, integrated.
- [ ] Optional client-portal exposure: read-only summary, double-gated. Decision needed.

**Effort:** ~12 dev-days.

---

## 12. Phase 10 — Decommission & cleanup (1 week)

### 12.1 Deprecate legacy

- [ ] `audit_runs` / `audit_schedules` — per P6 decision, migrate or keep separate with deprecation comment.
- [ ] `kinsta_findings` becomes view (Phase 1.3); `GET /api/operations/findings` redirects to `GET /api/ops/findings?umbrella=website`.
- [ ] Remove `server/services/operations/opsAssistant.js`.
- [ ] Remove `server/services/operations/agentTools.js` (moved in 9.6).

### 12.2 Folder rename

- [ ] `src/views/admin/OperationsWorkspace/` → `src/views/admin/Operations/`.
- [ ] `server/services/operations/` → `server/services/ops/operations-website/`.

### 12.3 Documentation

- [ ] Replace `docs/superpowers/plans/2026-04-29-kinsta-operations.md` with DONE stub.
- [ ] New `docs/OPERATIONS.md` — authoritative architecture doc.
- [ ] Update `docs/INTEGRATIONS.md` — SEMrush, GSC, PSI.
- [ ] Update `docs/SECURITY.md` — credential storage, approval audit.
- [ ] Update `CLAUDE.md` — Operations as command center in Where-To-Look.

**Effort:** ~3 dev-days.

---

## 13. Cross-cutting concerns

### Compliance

- No PHI in `payload_json`. Sanitizer in `runExecutor.js` strips known PHI patterns before persistence.
- Meta umbrella skipped for medical clients (BAA reality), enforced at adapter entry.
- All routes admin-gated. Client portal exposure is read-only and double-gated.

### Observability

- Every run emits `console.warn`: `[ops-run] client=<id> def=<id> status=<...> duration=<ms> findings=<count> cost_cents=<n>`.
- Cloud Run Job logs → BigQuery via standard log sink.

### Testing

- No test suite exists project-wide. Validation = `yarn build` + `yarn lint` + manual smoke per phase.
- Phase 1+ correlator rules and cost tracking justify a *small* test suite under `server/services/ops/__tests__/`. 5–10 unit tests on the correlator alone catch regressions cheaply.

### Performance

- `ops_check_results` will grow fast. Add monthly partitions by `created_at` when row count > ~1M. Defer until then.

### Migration safety

- Idempotent migrations (`CREATE TABLE IF NOT EXISTS`). Matches existing chain pattern.
- Backward-compat views preserve old queries during transition.

---

## 14. Effort summary

| Phase | Title | Effort | Parallel-with |
|---|---|---|---|
| 0 | Stabilize | 1 week | — |
| 1 | Domain model | 1 week | — |
| 2 | Orchestration | 1 week | — |
| 3 | Website umbrella | 2–3 weeks | 4, 5 |
| 4 | Google Ads umbrella | 2–3 weeks | 3, 5 |
| 5 | Meta umbrella | 2–3 weeks | 3, 4 |
| 6 | Correlation + reporting | 2 weeks | 7 (partially) |
| 7 | AI supervisor + sub-agents | 2–3 weeks | 6 |
| 8 | Scheduling + tiers | 1 week | — |
| 9 | UI rebuild | 2–3 weeks | — |
| 10 | Decommission | 1 week | — |

**Wall-clock totals:**
- One engineer: ~14–20 weeks
- Two engineers (parallelize 3/4/5 after Phase 2; 6/7 near end): ~10–12 weeks

**MVP cut** (one umbrella end-to-end): Phases 0–3 + minimum 6 + minimum 9 = ~7 weeks.

---

## 15. 4-week demo slice

If demo pressure is real, the smallest credible vertical slice:

1. **Week 1 — Phase 0.** Compliance/correctness defects fixed.
2. **Week 2 — Phase 1.** Domain model only.
3. **Week 3 — Phase 2.** Orchestration with minimal in-process runner (skip Pub/Sub).
4. **Week 4 — Phase 3 narrow.** Three website checks (PSI, SSL, tracking_install), one run definition (`web_daily_essential`), one client subscribed, one report rendered to HTML, basic UI.

Demonstrates the architecture and lets the user feel the product shape before committing the remaining ~12+ weeks.

---

## 16. Execution model — agent architecture

A 14–20 week build executed across many sessions has three predictable failure modes. This section defines an agent + state-file model that prevents them.

### 16.1 Failure modes this section prevents

1. **Cross-session amnesia.** A new session has no memory of "we shipped Phase 3.5 last week, but GSC OAuth still has the consent screen unfinished." The plan tells you what to *do*; it does not tell you *where you are*.
2. **Within-session context bloat.** Implementing 12 Google Ads checks in one session loads dozens of files into context. Attention degrades; later checks regress.
3. **Specialist context dilution.** One do-everything agent that writes Phase 0 fixes, then Phase 4 adapters, then Phase 9 React UI carries every prior file read into the next task. Specialists with narrow scopes produce sharper code.

### 16.2 Coordinator + specialist agents

This project already has the pattern (`docs/refactoring/agents/` + `docs/refactoring/STATE.md`). Extend it; do not invent a parallel system.

**Coordinator agent** — `ops-rebuild-coordinator`:
- Holds the whole plan in context. The only agent that does.
- On every invocation: Read `docs/ops-rebuild/STATE.md`, determine next un-checked ticket, dispatch the right specialist.
- Updates STATE.md after specialist returns.
- **Never writes code itself.**
- Mirrors the `agent-organizer` pattern documented in `CLAUDE.md`.

**Phase-aligned specialists** — each maps to a contiguous slice of the plan and stays narrow:

| Specialist | Phases owned | Scope |
|---|---|---|
| `ops-stabilizer` | Phase 0 | Defects in existing `server/services/operations/` only. Disposable — retire after Phase 0. |
| `ops-domain-architect` | Phase 1 | New tables, migrations, route skeletons, registry primitives. No checks, no UI. |
| `ops-orchestration-engineer` | Phase 2, 8 | Pub/Sub, Cloud Run Jobs, Cloud Scheduler, runQueue, cost tracker. Cloud-infra fluent. |
| `website-checks-engineer` | Phase 3 | Website umbrella checks only. Owns PSI, SSL, GSC, SEMrush, schema validation. |
| `google-ads-checks-engineer` | Phase 4 | Google Ads umbrella only. Fluent in gRPC `google-ads-api`. |
| `meta-checks-engineer` | Phase 5 | Meta umbrella only. HIPAA-gate aware. |
| `correlation-and-reports-engineer` | Phase 6 | Correlator rules, HTML report renderer, GCS upload, email digest. |
| `ops-ai-architect` | Phase 7 | Supervisor framework, sub-agents, tool registry refactor, approval audit. |
| `ops-ui-engineer` | Phase 9 | React/MUI work for new IA. Reuses `frontend-specialist` patterns. |
| `ops-decommissioner` | Phase 10 | Folder renames, deprecations, doc updates. Disposable. |

Plus mandatory reuse of existing project agents:
- `compliance-auditor` — invoked by the coordinator after every phase touching PHI / auth / data flow.
- `code-reviewer` — invoked after every specialist commit, before merge.
- Built-in `Explore` agent — spawned by specialists for codebase research within their phase, so they don't load whole files into context.

**Why this prevents context loss:**

- Specialists see only their phase's plan section + STATE.md + the files they touch. They don't carry Phase 3 file reads into Phase 4.
- Coordinator sees only the plan + STATE.md, never the specialist's working files. It stays light and lasts across many sessions.
- STATE.md is the durable memory. Every agent reads it first, updates it last. Sessions become resumable.

### 16.3 Canonical state file

Create `docs/ops-rebuild/STATE.md`. Structure:

```markdown
# Operations Rebuild — State

**Last updated:** <date> by <agent>
**Active phase:** Phase 3 — Website umbrella v1
**Active ticket:** 5.5 (Search Console integration)
**Active specialist:** website-checks-engineer

## Decisions locked
- P1: agency-level only (decided 2026-05-05)
- P2: per-client OAuth via oauth_connections (decided 2026-05-06)
- P3: PSI first
- P4: in-app HTML
- P5: read-only ads in v1
- P6: keep audit_runs separate
- P7: $5/client/month default cap
- P8: daily essentials + weekly deep + monthly audit
- P9: versioned baselines

## Phase status
- [x] Phase 0 — shipped at commit a3f1c2d (2026-05-12)
- [x] Phase 1 — shipped at commit 88b2e44 (2026-05-19)
- [x] Phase 2 — shipped at commit 4d091fe (2026-05-26)
- [ ] Phase 3 — IN PROGRESS
  - [x] 5.1 Re-home Kinsta drift (commit 1a2b3c4)
  - [x] 5.2 PSI checks (commit 9e8f7d6)
  - [x] 5.3 SSL & uptime
  - [x] 5.4 Schema validation
  - [ ] 5.5 GSC integration ← HERE
  - [ ] 5.6 SEMrush
  - [ ] 5.7 Vuln feed
  - [ ] 5.9 Run definitions seed
- [ ] Phase 4 — not started
- [ ] Phase 5 — not started
- ...

## Open blockers
- GSC OAuth consent screen pending Google approval (filed 2026-05-30)
- SEMrush API quota: confirmed 100k req/month seat — sufficient

## Handoff notes for next session
- After GSC ticket: pick up 5.6 SEMrush
- `ops_check_results` table needs `(client_user_id, check_id, created_at DESC)` index BEFORE Phase 6 starts
- Test client for validation: <client_id>

## Files NOT to touch
- server/services/reports/ (different agent's work)
- src/views/admin/AnalyticsDashboard/ (kept separate per P6)
```

**Hard rule:** every specialist's first action is `Read STATE.md`. Their last action is `Edit STATE.md`. No exceptions.

### 16.4 Per-phase handoff protocol

Before a phase is considered "done":

1. **Specialist** updates STATE.md and writes a phase-completion summary to `docs/ops-rebuild/phases/phase-N-completion.md`:
   - What shipped (file paths + line ranges)
   - Validation results (`yarn build` / `yarn lint` / smoke check outputs)
   - Decisions made during execution
   - Follow-ups punted to later phases
2. **`compliance-auditor`** invoked by coordinator with the phase summary as context. Returns approve/block + specific PHI/auth concerns.
3. **`code-reviewer`** invoked with the diff. Returns approve/block + specific issues.
4. Only on both approves does coordinator mark the phase shipped in STATE.md and move to the next.

Mirrors the existing `docs/refactoring/agents/validator.md` pattern.

### 16.5 Subagent dispatch within a phase

Specialists shouldn't try to be omniscient. Within a phase:

- **Use `Explore` (built-in) for codebase research.** Example: `website-checks-engineer` needs to know how `tracking_configs` is structured before writing cross-ref logic. Spawn Explore with a narrow query, get back a 200-word answer; don't load the whole table-definition file.
- **Use parallel specialist dispatch when a phase has independent slices.** Example: Phase 3 sub-tickets 5.2 (PSI), 5.3 (SSL), and 5.4 (schema) are independent. Coordinator can dispatch three parallel `website-checks-engineer` invocations — each returns a small commit, no shared file conflicts.
- **Reserve in-context work for things that require holding a mental model.** Writing the correlation rules engine (Phase 6.1) is one mental model — don't fragment it across subagents.

### 16.6 Specialist agent definition template

Drop into `~/.claude/agents/<specialist-name>.md`. Each follows this skeleton:

```markdown
---
name: website-checks-engineer
description: Implements Phase 3 (Website umbrella v1) of the Operations rebuild plan.
---

## Mandate
Implement Phase 3 (Website umbrella v1) of
docs/superpowers/plans/2026-05-05-operations-rebuild-plan.md. Nothing else.

## Inputs you MUST read before writing code
1. docs/ops-rebuild/STATE.md
2. The Phase 3 section of the plan
3. server/services/ops/checks/registry.js (built in Phase 1)
4. server/services/ops/runExecutor.js (built in Phase 1)
5. server/services/operations/driftScanner.js (existing — you re-home this)

## Files in scope (you may write here)
- server/services/ops/checks/website/**/*
- server/services/ops/feeds/wpvuln.js
- server/sql/migrate_ops_seed_run_definitions.sql

## Files NOT to touch
- Anything under server/services/operations/ except read-only reads of driftScanner.js
- src/views/admin/AnalyticsDashboard/
- server/services/reports/

## Handoff protocol
1. First action: Read STATE.md
2. Pick the next un-checked Phase 3 ticket
3. Spawn Explore for any cross-cutting research (tracking_configs shape, oauth_connections pattern)
4. Implement, run yarn build + yarn lint
5. Commit per project commit-style convention
6. Update STATE.md with ticket complete + commit SHA
7. Last action: write a 100-word completion note in docs/ops-rebuild/phases/phase-3-progress.md

## Escalation triggers (return to coordinator instead of proceeding)
- A prerequisite decision (P1–P9) is not yet locked in STATE.md
- A check requires a credential model not yet built
- yarn build fails with errors outside your scope
- Compliance question (PHI in payload, encryption surface) — kick to compliance-auditor
```

Each specialist in §16.2 gets its own file with its own scope, in-scope file globs, and not-to-touch list.

### 16.7 Adoption options

Three options, smallest to largest:

1. **STATE.md + handoff protocol only.** Skip the specialist agents; enforce STATE.md discipline in every session. Smallest change, biggest single context-loss win. Recommended if you're a single engineer.
2. **Coordinator + 2–3 specialists.** Add `ops-rebuild-coordinator`, `ops-domain-architect`, `website-checks-engineer`, `ops-ai-architect`. Covers the longest, most context-heavy phases. Recommended if multiple engineers / multiple sessions per week.
3. **Full agent set.** All 10 specialists codified in `~/.claude/agents/`. Highest setup cost; pays off most across a 14–20 week build.

### 16.8 Concrete next step before Phase 0

Before any code is written:

1. Create `docs/ops-rebuild/STATE.md` from the §16.3 template.
2. Lock decisions P1–P9 (§1) by writing them into STATE.md's "Decisions locked" section.
3. Decide on adoption option (§16.7) and create the agent definition files for that scope.
4. Phase 0 begins only when STATE.md exists and decisions are locked.

---

*Last updated: 2026-05-05*
