# Meta Campaign Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-client Meta campaign allowlist so each client's analytics only show campaigns they own, eliminating data leakage on shared ad accounts and the group-mode double-counting bug.

**Architecture:** A new `tracking_campaign_claims` table (user_id → campaign_id, unique per ad account) powers a checklist UI in the Tracking Wizard Step 2. The Meta adapter gains an `allowedCampaignIds` option; the analytics pipeline resolves claims per-client before calling the adapter. Group-mode aggregation needs no change — per-client filtering plus the DB uniqueness constraint dedupe by construction.

**Tech Stack:** PostgreSQL (migration), Node/Express (routes, adapter), React 19 + MUI v5 (UI), existing shared components (`DataTable`, `SubCard`, `StatusChip`, `ConfirmDialog`, `EmptyState`, `LoadingButton`, `useToast`).

**Spec:** `docs/superpowers/specs/2026-04-21-meta-campaign-allowlist-design.md`

**Verification model:** Project has no automated test suite (per CLAUDE.md). Verification per task is primarily `yarn build` + `yarn lint` + targeted manual smoke tests against a running local server. The final task runs a full end-to-end smoke test.

---

## Task 1: Create feature branch

**Files:** none (branch operation)

- [ ] **Step 1: Ensure clean working tree on main**

Run:
```bash
git status
```
Expected: `working tree clean` on `main`. If not clean, stop and resolve with the user before proceeding.

- [ ] **Step 2: Pull latest main**

Run:
```bash
git fetch origin && git checkout main && git pull --ff-only origin main
```
Expected: `Already up to date.` or a fast-forward merge.

- [ ] **Step 3: Create and push feature branch**

Run:
```bash
git checkout -b feature/meta-campaign-allowlist
git push -u origin feature/meta-campaign-allowlist
```
Expected: branch created and tracking `origin/feature/meta-campaign-allowlist`.

---

## Task 2: Database migration

**Files:**
- Create: `server/sql/migrate_tracking_v4.sql`
- Modify: `server/index.js` (add `maybeRunTrackingV4Migration` and wire into startup chain)

- [ ] **Step 1: Write migration SQL**

Create `server/sql/migrate_tracking_v4.sql`:

```sql
-- Meta campaign allowlist — per-client campaign ownership

CREATE TABLE IF NOT EXISTS tracking_campaign_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('meta', 'google_ads')),
  ad_account_id   TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  campaign_name   TEXT,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by      UUID REFERENCES users(id),
  UNIQUE (platform, ad_account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS tracking_campaign_claims_user_platform_idx
  ON tracking_campaign_claims (user_id, platform);

CREATE INDEX IF NOT EXISTS tracking_campaign_claims_account_idx
  ON tracking_campaign_claims (platform, ad_account_id);
```

- [ ] **Step 2: Add migration runner function**

In `server/index.js`, right after the existing `maybeRunTrackingV3Migration` function (around line 801), add:

```js
async function maybeRunTrackingV4Migration() {
  try {
    const sqlPath = path.join(__dirname, 'sql', 'migrate_tracking_v4.sql');
    const migrationSql = await fs.readFile(sqlPath, 'utf8');
    await pool.query(migrationSql);
    console.log('[migrations] ran migrate_tracking_v4.sql');
  } catch (err) {
    console.error('[migrations] migrate_tracking_v4.sql failed:', err.message);
  }
}
```

- [ ] **Step 3: Wire into startup chain**

In `server/index.js`, find the migration chain (around line 1231) and add the new migration after `maybeRunTrackingV3Migration`:

```js
    .then(maybeRunTrackingMigration)
    .then(maybeRunTrackingV2Migration)
    .then(maybeRunTrackingV3Migration)
    .then(maybeRunTrackingV4Migration)
```

- [ ] **Step 4: Verify migration runs**

Kill any running server: `lsof -ti:4000 | xargs kill -9 2>/dev/null`
Start server: `yarn server`

In the server log, look for:
```
[migrations] ran migrate_tracking_v4.sql
```

Then verify the table exists:
```bash
psql postgresql://bif@localhost:5432/anchor -c "\d tracking_campaign_claims"
```
Expected: table description with 7 columns, PK, 1 unique constraint, 2 indexes, 2 FK references.

Verify idempotency by restarting the server — log should still print the ran message, no errors (DDL is all `IF NOT EXISTS`).

- [ ] **Step 5: Commit**

```bash
git add server/sql/migrate_tracking_v4.sql server/index.js
git commit -m "feat(tracking): add tracking_campaign_claims table + v4 migration

Creates per-client campaign ownership table with UNIQUE
(platform, ad_account_id, campaign_id) to prevent double-claiming."
```

---

## Task 3: Add `fetchMetaCampaignsList` to Meta adapter

**Files:**
- Modify: `server/services/analytics/metaAdsAdapter.js`

Lightweight function that returns the campaign list without creative fan-out (used by the checklist UI).

- [ ] **Step 1: Add function to metaAdsAdapter.js**

Append to `server/services/analytics/metaAdsAdapter.js` (after existing exports, before file end):

```js
/**
 * Fetch campaigns on an ad account with basic metadata + last-30d spend,
 * without fetching per-campaign creatives. Used for the per-client
 * allowlist checklist in the Tracking Wizard.
 *
 * @param {string} accessToken - Meta system user token
 * @param {string} adAccountId - e.g. 'act_2851894194985503' or '2851894194985503'
 * @param {object} [options]
 * @param {string[]} [options.statuses] - Meta effective_status values to include
 *   (e.g. ['ACTIVE', 'PAUSED']). Defaults to active + paused.
 * @returns {Promise<Array<{id, name, status, objective, start_time, stop_time, spend_last_30d}>>}
 */
export async function fetchMetaCampaignsList(accessToken, adAccountId, options = {}) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const statuses = options.statuses && options.statuses.length > 0
    ? options.statuses
    : ['ACTIVE', 'PAUSED'];

  const statusFilter = `&filtering=${encodeURIComponent(
    JSON.stringify([{ field: 'effective_status', operator: 'IN', value: statuses }])
  )}`;

  // Last-30d window for spend_last_30d
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: fmt(thirtyDaysAgo), until: fmt(today) }));

  // 1. Campaign metadata (name, status, objective, dates)
  const metaRes = await fetchMeta(
    `${accountId}/campaigns?fields=id,name,effective_status,objective,start_time,stop_time&limit=200${statusFilter}&access_token=${accessToken}`
  );
  const campaigns = metaRes.data || [];

  if (campaigns.length === 0) return [];

  // 2. Last-30d spend per campaign
  const campaignIds = campaigns.map((c) => c.id);
  const idFilter = encodeURIComponent(
    JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }])
  );
  const spendRes = await fetchMeta(
    `${accountId}/insights?fields=campaign_id,spend&level=campaign&time_range=${timeRange}&limit=500&filtering=${idFilter}&access_token=${accessToken}`
  );
  const spendByCampaign = new Map(
    (spendRes.data || []).map((r) => [r.campaign_id, parseFloat(r.spend) || 0])
  );

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.effective_status,
    objective: c.objective || null,
    start_time: c.start_time || null,
    stop_time: c.stop_time || null,
    spend_last_30d: spendByCampaign.get(c.id) || 0
  }));
}
```

**Note:** The existing `fetchMeta` helper (used throughout this file) expects the path-and-query string after `https://graph.facebook.com/v21.0/`. Use the same pattern.

- [ ] **Step 2: Smoke test the new function**

Add a temporary scratch file `/tmp/test-campaigns-list.mjs`:

```js
import { fetchMetaCampaignsList } from '/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/analytics/metaAdsAdapter.js';

const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
const adAccount = 'act_2851894194985503'; // ADC — Arizona Smile Design shared account
const result = await fetchMetaCampaignsList(token, adAccount, { statuses: ['ACTIVE', 'PAUSED'] });
console.log(JSON.stringify(result, null, 2));
console.log(`\nTotal campaigns: ${result.length}`);
```

Run:
```bash
FACEBOOK_SYSTEM_USER_TOKEN=$(grep ^FACEBOOK_SYSTEM_USER_TOKEN .env | cut -d= -f2) node /tmp/test-campaigns-list.mjs
```

Expected: an array of campaign objects each with `id`, `name`, `status`, `spend_last_30d`. Delete the scratch file after success:
```bash
rm /tmp/test-campaigns-list.mjs
```

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/metaAdsAdapter.js
git commit -m "feat(analytics): add fetchMetaCampaignsList for allowlist checklist

Lightweight campaigns fetch without per-campaign creative fan-out,
returning id/name/status/objective/dates/last-30d-spend."
```

---

## Task 4: Add `allowedCampaignIds` filter to existing Meta adapter functions

**Files:**
- Modify: `server/services/analytics/metaAdsAdapter.js` (`fetchMetaAdsAnalytics` at line 16, `fetchCampaignsWithCreatives` at line 151)

- [ ] **Step 1: Extend `fetchMetaAdsAnalytics` signature**

Change the existing function signature and URL construction in `metaAdsAdapter.js`. Replace the current `fetchMetaAdsAnalytics` (lines 16–81) with:

```js
export async function fetchMetaAdsAnalytics(accessToken, adAccountId, startDate, endDate, options = {}) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  const insightsFields = 'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type';
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  // Build optional campaign-id filter
  const allowedIds = Array.isArray(options.allowedCampaignIds) ? options.allowedCampaignIds : null;
  const campaignFilter = allowedIds && allowedIds.length > 0
    ? `&filtering=${encodeURIComponent(
        JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: allowedIds }])
      )}`
    : '';

  // Fetch account currency (lightweight, separate call)
  let currency = null;
  try {
    const accountMeta = await fetchMeta(`${accountId}?fields=currency&access_token=${accessToken}`);
    currency = accountMeta.currency || null;
  } catch {
    // currency unavailable — fall through
  }

  const [accountRes, campaignsRes, timeSeriesRes] = await Promise.all([
    fetchMeta(`${accountId}/insights?fields=${insightsFields}&time_range=${timeRange}${campaignFilter}&access_token=${accessToken}`),
    fetchMeta(
      `${accountId}/insights?fields=campaign_name,${insightsFields}&time_range=${timeRange}&level=campaign&limit=50${campaignFilter}&access_token=${accessToken}`
    ),
    fetchMeta(
      `${accountId}/insights?fields=spend,impressions,clicks,actions&time_range=${timeRange}&time_increment=1${campaignFilter}&access_token=${accessToken}`
    )
  ]);

  const summary = accountRes.data?.[0] || {};
  const leadActions = (summary.actions || []).find(
    (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
  );
  const leadCost = (summary.cost_per_action_type || []).find((a) => a.action_type === leadActions?.action_type);
  const landingPageViews = findActionValue(summary.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']);

  return {
    currency,
    spend: parseFloat(summary.spend) || 0,
    reach: parseInt(summary.reach) || 0,
    impressions: parseInt(summary.impressions) || 0,
    clicks: parseInt(summary.clicks) || 0,
    ctr: parseFloat(summary.ctr) || 0,
    cpc: parseFloat(summary.cpc) || 0,
    cpm: parseFloat(summary.cpm) || 0,
    landingPageViews,
    conversions: parseInt(leadActions?.value) || 0,
    costPerConversion: parseFloat(leadCost?.value) || 0,
    campaigns: (campaignsRes.data || []).map((c) => {
      const cLeadActions = (c.actions || []).find(
        (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
      );
      return {
        name: c.campaign_name,
        spend: parseFloat(c.spend) || 0,
        impressions: parseInt(c.impressions) || 0,
        clicks: parseInt(c.clicks) || 0,
        landingPageViews: findActionValue(c.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content']),
        conversions: parseInt(cLeadActions?.value) || 0
      };
    }),
    timeSeries: (timeSeriesRes.data || []).map((d) => ({
      date: d.date_start,
      spend: parseFloat(d.spend) || 0,
      impressions: parseInt(d.impressions) || 0,
      clicks: parseInt(d.clicks) || 0,
      landingPageViews: findActionValue(d.actions, ['landing_page_view', 'offsite_conversion.fb_pixel_view_content'])
    }))
  };
}
```

**Change summary:** new `options` param; three insights URLs get `${campaignFilter}` interpolated (empty string when no allowlist, `&filtering=[…]` when present). All other logic is untouched.

- [ ] **Step 2: Extend `fetchCampaignsWithCreatives`**

Locate `fetchCampaignsWithCreatives` in `metaAdsAdapter.js` (starts line 151). Two edits:

1. **Add `options` param** to signature:
```js
export async function fetchCampaignsWithCreatives(accessToken, adAccountId, startDate, endDate, statusFilter, options = {}) {
```

2. **Build `allowedIds` filter** near the top of the function body (right after resolving `accountId`):

```js
  const allowedIds = Array.isArray(options.allowedCampaignIds) ? options.allowedCampaignIds : null;
  const campaignIdFilterClause = allowedIds && allowedIds.length > 0
    ? { field: 'campaign.id', operator: 'IN', value: allowedIds }
    : null;
```

3. **Merge the allowlist into the existing filter array** for the account-level insights call. Find the existing line that builds the campaigns insights URL (around line 156):
```js
const filterParam = statusFilter ? `&filtering=[{"field":"campaign.effective_status","operator":"IN","value":["${statusFilter}"]}]` : '';
```

Replace it with:
```js
const filterClauses = [];
if (statusFilter) {
  filterClauses.push({ field: 'campaign.effective_status', operator: 'IN', value: [statusFilter] });
}
if (campaignIdFilterClause) {
  filterClauses.push(campaignIdFilterClause);
}
const filterParam = filterClauses.length > 0
  ? `&filtering=${encodeURIComponent(JSON.stringify(filterClauses))}`
  : '';
```

**Why merge:** Meta's `filtering` param accepts an array of clauses combined via AND, so status + campaign-id can coexist.

- [ ] **Step 3: Verify yarn build still passes**

Run:
```bash
yarn build
```
Expected: clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/analytics/metaAdsAdapter.js
git commit -m "feat(analytics): add allowedCampaignIds filter to Meta adapter

fetchMetaAdsAnalytics and fetchCampaignsWithCreatives gain an
options.allowedCampaignIds that restricts insights + campaign
metadata calls via Meta's IN-on-campaign.id filter."
```

---

## Task 5: Wire claim resolution into `fetchUnifiedAnalytics`

**Files:**
- Modify: `server/services/analytics/index.js`

- [ ] **Step 1: Update `fetchMetaAdsData` helper**

In `server/services/analytics/index.js`, replace the `fetchMetaAdsData` helper (currently at lines 111–115) with:

```js
async function fetchMetaAdsData(accessToken, adAccountId, startDate, endDate, options = {}) {
  if (!adAccountId) return null;
  const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  return fetchMetaAdsAnalytics(accessToken, id, startDate, endDate, options);
}
```

- [ ] **Step 2: Resolve allowed campaign ids before parallel fetch**

In `fetchUnifiedAnalytics`, immediately after resolving `metaAdAccountId` (just below line 35), add:

```js
  // Resolve the client's Meta campaign allowlist. Zero claims = empty Meta block.
  let allowedMetaCampaignIds = [];
  if (metaAdAccountId) {
    const claimsRes = await query(
      `SELECT campaign_id FROM tracking_campaign_claims
       WHERE user_id = $1 AND platform = 'meta' AND ad_account_id = $2`,
      [userId, metaAdAccountId.startsWith('act_') ? metaAdAccountId : `act_${metaAdAccountId}`]
    );
    allowedMetaCampaignIds = claimsRes.rows.map((r) => r.campaign_id);
  }
  const metaAllowlistEmpty = !!metaAdAccountId && allowedMetaCampaignIds.length === 0;
```

- [ ] **Step 3: Short-circuit Meta fetch when allowlist is empty**

In the `Promise.allSettled` block, replace the Meta line:

```js
    metaToken && metaAdAccountId
      ? fetchMetaAdsData(metaToken, metaAdAccountId, startDate, endDate)
      : Promise.resolve(null),
```

with:

```js
    metaToken && metaAdAccountId && !metaAllowlistEmpty
      ? fetchMetaAdsData(metaToken, metaAdAccountId, startDate, endDate, { allowedCampaignIds: allowedMetaCampaignIds })
      : Promise.resolve(null),
```

- [ ] **Step 4: Smoke-test via the existing analytics endpoint**

Ensure server is running (`yarn server`). Pick a client user id with a configured `meta_ad_account_id` — e.g. Anthem (query locally if unknown: `psql ... -c "SELECT user_id FROM tracking_configs WHERE meta_ad_account_id IS NOT NULL LIMIT 3"`).

With zero claims for that client:
```bash
curl -s "http://localhost:4000/hub/analytics/<userId>/overview?startDate=2026-03-20&endDate=2026-04-20" \
  -H "Authorization: Bearer <token>" | jq '.byPlatform.metaAds'
```
Expected: `null` (empty Meta block — zero-claims short-circuit).

Insert a claim manually for smoke-test:
```bash
psql postgresql://bif@localhost:5432/anchor -c "
  INSERT INTO tracking_campaign_claims (user_id, platform, ad_account_id, campaign_id, campaign_name)
  VALUES ('<userId>', 'meta', 'act_2851894194985503', '<real_campaign_id_from_account>', 'smoke test');
"
```

Re-run the curl. Expected: `byPlatform.metaAds` now populated with only that campaign's data.

Clean up:
```bash
psql postgresql://bif@localhost:5432/anchor -c "
  DELETE FROM tracking_campaign_claims WHERE campaign_name = 'smoke test';
"
```

- [ ] **Step 5: Commit**

```bash
git add server/services/analytics/index.js
git commit -m "feat(analytics): wire Meta campaign allowlist into unified pipeline

fetchUnifiedAnalytics resolves per-client claims and passes
allowedCampaignIds to the Meta adapter. Zero-claims short-circuits
the Meta fetch entirely (returns null, not full-account data)."
```

---

## Task 6: GET `/hub/tracking/:userId/meta-campaigns` route

**Files:**
- Modify: `server/routes/tracking.js`

- [ ] **Step 1: Add route**

Open `server/routes/tracking.js`. Near the other tracking routes (after the existing `PUT /:id` UPDATE handler — around line 430 — before the file's `export default router`), add:

```js
/**
 * GET /hub/tracking/:userId/meta-campaigns
 * List campaigns on this client's Meta ad account, annotated with claim state.
 * Query params:
 *   status=active,paused,archived (default: active,paused; value "all" = no filter)
 */
router.get('/:userId/meta-campaigns', async (req, res) => {
  try {
    const { userId } = req.params;
    const statusParam = (req.query.status || 'active,paused').toString().toLowerCase();

    // Load client's ad account
    const configRes = await query(
      `SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const adAccountIdRaw = configRes.rows[0]?.meta_ad_account_id;
    if (!adAccountIdRaw) {
      return res.status(400).json({ error: 'no_meta_ad_account_configured' });
    }
    const adAccountId = adAccountIdRaw.startsWith('act_') ? adAccountIdRaw : `act_${adAccountIdRaw}`;

    const token = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'meta_token_not_configured' });
    }

    // Resolve statuses
    let statuses;
    if (statusParam === 'all') {
      statuses = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED', 'IN_PROCESS', 'WITH_ISSUES'];
    } else {
      statuses = statusParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    }

    const campaigns = await fetchMetaCampaignsList(token, adAccountId, { statuses });

    // Join with claims across all clients on this ad account.
    // Display name preference: brand_assets.business_name → first+last → email.
    const claimsRes = await query(
      `SELECT c.campaign_id,
              c.user_id,
              COALESCE(
                NULLIF(ba.business_name, ''),
                NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                u.email
              ) AS display_name
         FROM tracking_campaign_claims c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN brand_assets ba ON ba.user_id = c.user_id
         WHERE c.platform = 'meta' AND c.ad_account_id = $1`,
      [adAccountId]
    );
    const claimMap = new Map(
      claimsRes.rows.map((r) => [
        r.campaign_id,
        { user_id: r.user_id, name: r.display_name || 'Unknown' }
      ])
    );

    const annotated = campaigns.map((c) => {
      const claim = claimMap.get(c.id) || null;
      return {
        ...c,
        claimed_by: claim
          ? { ...claim, is_current_client: claim.user_id === userId }
          : null
      };
    });

    res.json({ ad_account_id: adAccountId, campaigns: annotated });
  } catch (err) {
    console.error('[tracking:meta-campaigns]', err);
    res.status(500).json({ error: 'fetch_failed', message: err.message });
  }
});
```

- [ ] **Step 2: Import the new adapter function**

At the top of `server/routes/tracking.js`, add `fetchMetaCampaignsList` to the import from `metaAdsAdapter.js`. If no import currently exists, add:

```js
import { fetchMetaCampaignsList } from '../services/analytics/metaAdsAdapter.js';
```

(If the file already imports from that module, just extend the import.)

- [ ] **Step 3: Smoke-test the endpoint**

Restart the server. Run:
```bash
curl -s "http://localhost:4000/hub/tracking/<userId>/meta-campaigns" \
  -H "Authorization: Bearer <token>" | jq
```

Expected: JSON `{ ad_account_id: "act_...", campaigns: [...] }`. Each campaign has `id`, `name`, `status`, `objective`, `start_time`, `stop_time`, `spend_last_30d`, and `claimed_by: null` (no claims yet).

Add `?status=all` and re-run; expected: more campaigns including archived.

- [ ] **Step 4: Commit**

```bash
git add server/routes/tracking.js
git commit -m "feat(tracking): add GET /hub/tracking/:userId/meta-campaigns

Returns campaigns on the client's Meta ad account annotated with
claim state (including cross-client claim indicators)."
```

---

## Task 7: POST + DELETE claim endpoints

**Files:**
- Modify: `server/routes/tracking.js`

- [ ] **Step 1: Import security helper**

`server/routes/tracking.js` does not currently import `logSecurityEvent`. Add to the top imports:

```js
import { logSecurityEvent } from '../services/security/index.js';
```

(This matches the import pattern used by `ctmForms.js`, `hub.js`, `tasks.js`.)

- [ ] **Step 2: Add POST claim route**

Add after the GET route from Task 6:

```js
/**
 * POST /hub/tracking/:userId/meta-campaigns/claims
 * Body: { campaign_id, campaign_name }
 */
router.post('/:userId/meta-campaigns/claims', async (req, res) => {
  try {
    const { userId } = req.params;
    const { campaign_id: campaignId, campaign_name: campaignName } = req.body || {};
    if (!campaignId) {
      return res.status(400).json({ error: 'missing_campaign_id' });
    }

    // Resolve client's ad account
    const cfgRes = await query(
      `SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1`,
      [userId]
    );
    const raw = cfgRes.rows[0]?.meta_ad_account_id;
    if (!raw) {
      return res.status(400).json({ error: 'no_meta_ad_account_configured' });
    }
    const adAccountId = raw.startsWith('act_') ? raw : `act_${raw}`;

    // Attempt insert; catch unique-constraint violation for 409
    try {
      const ins = await query(
        `INSERT INTO tracking_campaign_claims
           (user_id, platform, ad_account_id, campaign_id, campaign_name, claimed_by)
         VALUES ($1, 'meta', $2, $3, $4, $5)
         RETURNING id, user_id, campaign_id, campaign_name, claimed_at`,
        [userId, adAccountId, campaignId, campaignName || null, req.user?.id || null]
      );

      await logSecurityEvent({
        userId: req.user?.id || null,
        eventCategory: 'tracking',
        eventType: 'campaign_claim_created',
        metadata: { target_user_id: userId, ad_account_id: adAccountId, campaign_id: campaignId }
      });

      return res.status(201).json({ claim: ins.rows[0] });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        // Unique constraint — someone else owns it (or same user idempotent)
        const existing = await query(
          `SELECT c.user_id,
                  COALESCE(
                    NULLIF(ba.business_name, ''),
                    NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
                    u.email
                  ) AS display_name
             FROM tracking_campaign_claims c
             LEFT JOIN users u ON u.id = c.user_id
             LEFT JOIN brand_assets ba ON ba.user_id = c.user_id
             WHERE c.platform = 'meta' AND c.ad_account_id = $1 AND c.campaign_id = $2`,
          [adAccountId, campaignId]
        );
        const row = existing.rows[0];
        if (row?.user_id === userId) {
          // Same user already claims it — treat as idempotent 200
          const current = await query(
            `SELECT id, user_id, campaign_id, campaign_name, claimed_at
               FROM tracking_campaign_claims
               WHERE platform = 'meta' AND ad_account_id = $1 AND campaign_id = $2`,
            [adAccountId, campaignId]
          );
          return res.status(200).json({ claim: current.rows[0] });
        }
        return res.status(409).json({
          error: 'campaign_already_claimed',
          claimed_by: row
            ? { user_id: row.user_id, name: row.display_name || 'Unknown' }
            : null
        });
      }
      throw dbErr;
    }
  } catch (err) {
    console.error('[tracking:claim]', err);
    res.status(500).json({ error: 'claim_failed', message: err.message });
  }
});
```

- [ ] **Step 3: Add DELETE claim route**

```js
/**
 * DELETE /hub/tracking/:userId/meta-campaigns/claims/:campaignId
 * Idempotent — returns 204 whether or not the claim existed.
 */
router.delete('/:userId/meta-campaigns/claims/:campaignId', async (req, res) => {
  try {
    const { userId, campaignId } = req.params;
    await query(
      `DELETE FROM tracking_campaign_claims
         WHERE user_id = $1 AND platform = 'meta' AND campaign_id = $2`,
      [userId, campaignId]
    );
    await logSecurityEvent({
      userId: req.user?.id || null,
      eventCategory: 'tracking',
      eventType: 'campaign_claim_deleted',
      metadata: { target_user_id: userId, campaign_id: campaignId }
    });
    res.status(204).end();
  } catch (err) {
    console.error('[tracking:unclaim]', err);
    res.status(500).json({ error: 'unclaim_failed', message: err.message });
  }
});
```

- [ ] **Step 4: Smoke-test**

```bash
# Claim
curl -s -X POST "http://localhost:4000/hub/tracking/<userId>/meta-campaigns/claims" \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"campaign_id":"<real-campaign-id>","campaign_name":"test claim"}' | jq
# Expected: 201 with { claim: {...} }

# Re-claim (idempotent)
# Repeat same command → Expected: 200 with { claim: {...} }

# Attempt conflict — POST the same campaign_id as a different userId
curl -s -X POST "http://localhost:4000/hub/tracking/<otherUserId>/meta-campaigns/claims" \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"campaign_id":"<same-campaign-id>","campaign_name":"conflict"}' | jq
# Expected: 409 with { error: "campaign_already_claimed", claimed_by: { name: "<first client name>" } }

# Delete
curl -s -X DELETE "http://localhost:4000/hub/tracking/<userId>/meta-campaigns/claims/<campaignId>" \
  -H "Authorization: Bearer <token>" -o /dev/null -w "%{http_code}\n"
# Expected: 204

# Delete again (idempotent)
# Repeat → Expected: 204
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/tracking.js
git commit -m "feat(tracking): add POST/DELETE meta campaign claim endpoints

Claim is idempotent for same user, returns 409 with owning-client
info on cross-client conflict. Delete is idempotent (204 either way)."
```

---

## Task 8: Clear claims on Meta ad account change

**Files:**
- Modify: `server/routes/tracking.js` (PUT /:id handler around line 335)

When an admin changes `meta_ad_account_id` on an existing config, the claims for the old account become orphaned and must be cleared in the same flow.

- [ ] **Step 1: Load previous `meta_ad_account_id` and compare**

In the PUT handler (around line 357), **before** the UPDATE query runs, there's already:
```js
const { rows: existing } = await query(`SELECT * FROM tracking_configs WHERE id = $1`, [req.params.id]);
```

Immediately after the `const current = existing[0];` line, add:

```js
    const newMetaAccount = meta_ad_account_id || null;
    const oldMetaAccount = current.meta_ad_account_id || null;
    const metaAccountChanged =
      newMetaAccount !== null && newMetaAccount !== oldMetaAccount && oldMetaAccount !== null;
```

- [ ] **Step 2: Delete claims when the account changes**

After the existing `UPDATE tracking_configs …` query (after the `const { rows } = await query(…)` block, before `const config = decryptConfig(rows[0]);`), add:

```js
    if (metaAccountChanged) {
      const normalized = oldMetaAccount.startsWith('act_') ? oldMetaAccount : `act_${oldMetaAccount}`;
      await query(
        `DELETE FROM tracking_campaign_claims
           WHERE user_id = $1 AND platform = 'meta' AND ad_account_id = $2`,
        [current.user_id, normalized]
      );
    }
```

(This uses `current.user_id` — the PUT handler keys off `req.params.id` (config row id), and the config row carries the user_id.)

- [ ] **Step 3: Smoke-test**

```bash
# 1. Create a claim
psql postgresql://bif@localhost:5432/anchor -c "
  INSERT INTO tracking_campaign_claims (user_id, platform, ad_account_id, campaign_id, campaign_name)
  VALUES ('<userId>', 'meta', 'act_2851894194985503', 'test-campaign', 'will be cleared');
"

# 2. PUT the tracking config with a different meta_ad_account_id
curl -s -X PUT "http://localhost:4000/hub/tracking/<configId>" \
  -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"meta_ad_account_id":"act_9999999999999999"}'

# 3. Verify claims were cleared
psql postgresql://bif@localhost:5432/anchor -c "
  SELECT * FROM tracking_campaign_claims WHERE user_id = '<userId>';
"
# Expected: 0 rows
```

Restore original `meta_ad_account_id` after testing.

- [ ] **Step 4: Commit**

```bash
git add server/routes/tracking.js
git commit -m "feat(tracking): clear campaign claims when meta ad account changes

When an admin switches a client's meta_ad_account_id, drop that
client's existing Meta campaign claims tied to the old account
so they don't orphan-persist."
```

---

## Task 9: Frontend API client methods

**Files:**
- Modify: `src/api/tracking.js`

- [ ] **Step 1: Add three methods**

Append to `src/api/tracking.js`:

```js
// -- Meta campaign allowlist --

export function listMetaCampaigns(userId, { status = 'active,paused' } = {}) {
  return client
    .get(`/hub/tracking/${userId}/meta-campaigns`, { params: { status } })
    .then((res) => res.data);
}

export function claimMetaCampaign(userId, { campaignId, campaignName }) {
  return client
    .post(`/hub/tracking/${userId}/meta-campaigns/claims`, {
      campaign_id: campaignId,
      campaign_name: campaignName
    })
    .then((res) => res.data);
}

export function unclaimMetaCampaign(userId, campaignId) {
  return client
    .delete(`/hub/tracking/${userId}/meta-campaigns/claims/${campaignId}`)
    .then((res) => res.data);
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build
```
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/api/tracking.js
git commit -m "feat(tracking): frontend API client for Meta campaign claims

Adds listMetaCampaigns, claimMetaCampaign, unclaimMetaCampaign."
```

---

## Task 10: `CampaignClaimsPanel` component

**Files:**
- Create: `src/views/admin/AdminHub/tracking/CampaignClaimsPanel.jsx`

- [ ] **Step 1: Create the component**

Create `src/views/admin/AdminHub/tracking/CampaignClaimsPanel.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Checkbox, FormControlLabel, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import SubCard from 'ui-component/cards/SubCard';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { useToast } from 'contexts/ToastContext';
import { listMetaCampaigns, claimMetaCampaign, unclaimMetaCampaign } from 'api/tracking';

const STATUS_MAP = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
  DELETED: 'archived',
  IN_PROCESS: 'pending',
  WITH_ISSUES: 'failed'
};

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCurrency(n) {
  if (!n) return '$0.00';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CampaignClaimsPanel({ userId, adAccountId }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [mutating, setMutating] = useState(new Set()); // campaign_ids mid-request

  const statusParam = showArchived ? 'active,paused,archived' : 'active,paused';

  const fetchCampaigns = useCallback(async () => {
    if (!userId || !adAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listMetaCampaigns(userId, { status: statusParam });
      setCampaigns(data.campaigns || []);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [userId, adAccountId, statusParam]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleToggle = async (campaign) => {
    const alreadyMine = campaign.claimed_by?.is_current_client;
    const claimedElsewhere = campaign.claimed_by && !alreadyMine;
    if (claimedElsewhere) return; // disabled row, should not fire

    // Optimistic update
    setMutating((s) => new Set(s).add(campaign.id));
    const prev = campaigns;
    setCampaigns((rows) =>
      rows.map((r) =>
        r.id === campaign.id
          ? {
              ...r,
              claimed_by: alreadyMine ? null : { user_id: userId, name: 'this client', is_current_client: true }
            }
          : r
      )
    );

    try {
      if (alreadyMine) {
        await unclaimMetaCampaign(userId, campaign.id);
        toast.success(`Removed "${campaign.name}"`);
      } else {
        await claimMetaCampaign(userId, { campaignId: campaign.id, campaignName: campaign.name });
        toast.success(`Claimed "${campaign.name}"`);
      }
      // Refetch to get authoritative claimed_by.name
      fetchCampaigns();
    } catch (e) {
      setCampaigns(prev); // revert
      const data = e.response?.data;
      if (data?.error === 'campaign_already_claimed') {
        toast.error(`Already claimed by ${data.claimed_by?.name || 'another client'}`);
      } else {
        toast.error(data?.message || e.message || 'Action failed');
      }
    } finally {
      setMutating((s) => {
        const next = new Set(s);
        next.delete(campaign.id);
        return next;
      });
    }
  };

  const columns = useMemo(
    () => [
      {
        id: 'check',
        label: '',
        width: 48,
        render: (row) => {
          const mine = row.claimed_by?.is_current_client;
          const elsewhere = row.claimed_by && !mine;
          return (
            <Checkbox
              checked={!!mine}
              disabled={elsewhere || mutating.has(row.id)}
              onChange={() => handleToggle(row)}
            />
          );
        }
      },
      {
        id: 'name',
        label: 'Campaign',
        sortable: true,
        sortValue: (row) => row.name,
        render: (row) => {
          const elsewhere = row.claimed_by && !row.claimed_by.is_current_client;
          return (
            <Box>
              <Typography variant="body2" sx={{ color: elsewhere ? 'text.disabled' : 'text.primary' }}>
                {row.name}
              </Typography>
              {elsewhere && (
                <Typography variant="caption" color="text.secondary">
                  Claimed by {row.claimed_by.name}
                </Typography>
              )}
            </Box>
          );
        }
      },
      {
        id: 'status',
        label: 'Status',
        sortable: true,
        sortValue: (row) => row.status,
        render: (row) => <StatusChip status={STATUS_MAP[row.status] || 'inactive'} label={row.status} size="small" />
      },
      {
        id: 'start_time',
        label: 'Start',
        sortable: true,
        sortValue: (row) => row.start_time || '',
        render: (row) => formatDate(row.start_time)
      },
      {
        id: 'spend',
        label: '30d spend',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.spend_last_30d || 0,
        render: (row) => formatCurrency(row.spend_last_30d)
      }
    ],
    [mutating, userId] // handleToggle closure reads these; other deps are stable
  );

  const claimedCount = campaigns.filter((c) => c.claimed_by?.is_current_client).length;

  if (error) {
    return (
      <SubCard title="Campaigns for this client">
        <EmptyState
          title="Couldn't load campaigns"
          message={error}
          action={
            <IconButton onClick={fetchCampaigns} size="small">
              <RefreshIcon />
            </IconButton>
          }
        />
      </SubCard>
    );
  }

  return (
    <SubCard title="Campaigns for this client">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Check the campaigns that belong to this practice. Unchecked campaigns won&apos;t appear in this client&apos;s
          analytics or in any group reports that include them.
        </Typography>

        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <FormControlLabel
            control={<Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} size="small" />}
            label="Show archived"
          />
          <Tooltip title="Refresh from Meta">
            <IconButton onClick={fetchCampaigns} size="small" disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Stack>

        <DataTable
          columns={columns}
          rows={campaigns}
          rowKey="id"
          searchable
          searchFields={['name']}
          paginated
          pageSize={10}
          loading={loading}
          emptyTitle="No campaigns found"
          emptyMessage={
            showArchived
              ? 'This ad account has no campaigns.'
              : "No active or paused campaigns. Toggle 'Show archived' to see older campaigns."
          }
          size="small"
        />

        <Typography variant="caption" color="text.secondary">
          {claimedCount} of {campaigns.length} campaigns claimed for this client
        </Typography>
      </Stack>
    </SubCard>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
yarn build && yarn lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AdminHub/tracking/CampaignClaimsPanel.jsx
git commit -m "feat(tracking): add CampaignClaimsPanel component

Per-client Meta campaign checklist with search, pagination, status
filter, and cross-client claim indicators. Uses shared DataTable,
SubCard, StatusChip, EmptyState, useToast."
```

---

## Task 11: Integrate panel into `AccountSelectionStep` + account-change confirm

**Files:**
- Modify: `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx`

- [ ] **Step 1: Read the existing file to locate the Meta account section**

Before editing, read `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx` to locate:
(a) the Meta Ad Account `Autocomplete` (where `config.meta_ad_account_id` is set)
(b) the "Pixel auto-selected" banner
(c) the parent's config-update handler (prop name varies — likely `onConfigChange` or `onUpdate`)

- [ ] **Step 2: Import new dependencies**

Add to the top imports in `AccountSelectionStep.jsx`:

```jsx
import { useState } from 'react';
import CampaignClaimsPanel from './CampaignClaimsPanel';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import { listMetaCampaigns } from 'api/tracking';
```

(If `useState` is already imported, skip that line.)

- [ ] **Step 3: Render `CampaignClaimsPanel` beneath the Meta section**

Immediately after the existing "Pixel auto-selected" banner (in the JSX tree), add:

```jsx
{config.meta_ad_account_id && (
  <CampaignClaimsPanel userId={userId} adAccountId={config.meta_ad_account_id} />
)}
```

**Note on `userId`:** The step component already receives the client's user id for other lookups — reuse that prop. If it currently receives only `config` / `onChange`, thread `userId` through from the parent (`TrackingWizard.jsx`). Do not create a new API client-side to fetch it.

- [ ] **Step 4: Intercept Meta ad account changes with a confirm dialog**

Find the Meta Ad Account `Autocomplete`'s `onChange` handler. Wrap its call to the parent's config setter in a guard:

```jsx
const [pendingMetaAccount, setPendingMetaAccount] = useState(null); // { newId, oldId }

const handleMetaAccountChange = async (newId) => {
  const oldId = config.meta_ad_account_id || null;
  if (oldId && newId && oldId !== newId) {
    // Check whether this client has claims on the old account
    try {
      const data = await listMetaCampaigns(userId, { status: 'all' });
      const claimedCount = (data.campaigns || []).filter((c) => c.claimed_by?.is_current_client).length;
      if (claimedCount > 0) {
        setPendingMetaAccount({ newId, oldId, claimedCount });
        return; // wait for user confirmation
      }
    } catch {
      // If listing fails, fall through and change anyway — backend still clears claims
    }
  }
  // No claims or no prior account: apply immediately
  onConfigChange({ meta_ad_account_id: newId });
};
```

Replace the Autocomplete's existing `onChange={(e, v) => onConfigChange({ meta_ad_account_id: v?.id || null })}` (or similar) with:
```jsx
onChange={(e, v) => handleMetaAccountChange(v?.id || null)}
```

**Note:** Use the parent's actual config-update prop name (`onConfigChange` is a placeholder — substitute the real one found in Step 1).

Then, near the root of the returned JSX, render the confirm dialog:

```jsx
<ConfirmDialog
  open={!!pendingMetaAccount}
  onClose={() => setPendingMetaAccount(null)}
  onConfirm={() => {
    const { newId } = pendingMetaAccount;
    setPendingMetaAccount(null);
    onConfigChange({ meta_ad_account_id: newId });
  }}
  title="Switch Meta ad account?"
  message={`This client has ${pendingMetaAccount?.claimedCount || 0} claimed campaign(s) on the current account. Switching will clear those claims.`}
  secondaryText="You can re-claim campaigns on the new account after switching."
  confirmLabel="Switch account"
  confirmColor="warning"
/>
```

- [ ] **Step 5: Verify build + lint**

```bash
yarn build && yarn lint
```
Expected: clean.

- [ ] **Step 6: Visual smoke test**

Start both frontend + backend (`./dev.sh`). Navigate to AdminHub → any client with a Meta ad account configured → Tracking tab → Accounts step.

- Confirm the "Campaigns for this client" section renders beneath the pixel banner.
- Confirm the campaign list loads (status 200 on `/hub/tracking/:userId/meta-campaigns`).
- Check one campaign box → toast fires, row shows checked.
- Uncheck → toast fires, row unchecks.
- Toggle "Show archived" → fetch refires with `?status=active,paused,archived`.
- Change the Meta Ad Account dropdown → ConfirmDialog fires (assuming claims exist). Cancel → no change. Confirm → account changes, claims cleared (verify in DB).

- [ ] **Step 7: Commit**

```bash
git add src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx
git commit -m "feat(tracking): wire CampaignClaimsPanel into Accounts step

Renders the per-client Meta campaign checklist below the pixel
banner. Intercepts ad-account changes with a ConfirmDialog when
the client has existing claims."
```

---

## Task 12: End-to-end verification + docs + PR

**Files:**
- Modify: `docs/API_REFERENCE.md`
- Modify: `SKILLS.md` (Database Schema Map section)

- [ ] **Step 1: Run full build + lint**

```bash
yarn build && yarn lint
```
Expected: clean.

- [ ] **Step 2: End-to-end smoke test**

With ADC-shared-account clients (Anthem, Arizona Smile Design, Bell Road):

1. On Anthem's Tracking → Accounts, tag 2 specific campaigns.
2. On Arizona Smile Design's Tracking → Accounts, tag 2 *different* campaigns on the same ad account.
3. Confirm the row for a campaign claimed by Arizona Smile Design appears disabled + captioned "Claimed by Arizona Smile Design" on Anthem's view.
4. Open Anthem's Analytics → verify Meta block shows only Anthem's 2 campaigns (creatives, spend, totals).
5. Open the group-mode Analytics containing Anthem + Arizona Smile Design:
   - **Top Performing Creatives** no longer shows any creative more than once.
   - Meta spend total = Anthem's 2 campaigns + Arizona's 2 campaigns (hand-verify against Meta Ads Manager if needed).
6. On a fresh client with Meta configured but no claims, open Analytics → Meta block shows empty / null.
7. Change Anthem's Meta ad account → ConfirmDialog fires → confirm → open Tracking again, verify claim list is empty for the new account.

- [ ] **Step 3: Update `docs/API_REFERENCE.md`**

Add an entry for the three new endpoints. Append to the Tracking section:

```markdown
### Meta Campaign Allowlist

#### `GET /hub/tracking/:userId/meta-campaigns`
Lists campaigns on the client's configured Meta ad account, annotated with claim state.

**Query:** `status` — comma-separated effective_status values or `all` (default: `active,paused`)

**Response:** `{ ad_account_id, campaigns: [{ id, name, status, objective, start_time, stop_time, spend_last_30d, claimed_by: { user_id, name, is_current_client } | null }] }`

#### `POST /hub/tracking/:userId/meta-campaigns/claims`
Claims a campaign for the given client.

**Body:** `{ campaign_id, campaign_name }`
**Responses:** 201 (created), 200 (idempotent re-claim by same user), 409 (owned by another client — response includes `claimed_by`)

#### `DELETE /hub/tracking/:userId/meta-campaigns/claims/:campaignId`
Releases a claim. Idempotent — always returns 204.
```

- [ ] **Step 4: Update `SKILLS.md` database schema section**

Add a row to the schema map for `tracking_campaign_claims`:

```markdown
- **tracking_campaign_claims** — per-client Meta/Google Ads campaign ownership. UNIQUE(platform, ad_account_id, campaign_id) enforces one-client-per-campaign; used by analytics pipeline to filter per-client Meta data and dedupe group-mode aggregation.
```

- [ ] **Step 5: Commit docs**

```bash
git add docs/API_REFERENCE.md SKILLS.md
git commit -m "docs: document Meta campaign allowlist endpoints + table"
```

- [ ] **Step 6: Push and open PR**

```bash
git push
gh pr create --title "feat(tracking): per-client Meta campaign allowlist" --body "$(cat <<'EOF'
## Summary
- Adds `tracking_campaign_claims` table with unique-per-ad-account constraint
- New checklist UI in Tracking Wizard → Accounts step for tagging campaigns per client
- Meta analytics pipeline now filters to the client's claimed campaigns; zero claims = empty Meta block
- Group-mode aggregation deduplicates automatically (no code change needed there)

Fixes the "same creative shown 3× in group mode" bug for shared ad accounts, and the data-leakage issue where clients could see other practices' campaigns.

Spec: `docs/superpowers/specs/2026-04-21-meta-campaign-allowlist-design.md`
Plan: `docs/superpowers/plans/2026-04-21-meta-campaign-allowlist.md`

## Test plan
- [ ] `yarn build` and `yarn lint` pass
- [ ] On ADC shared-account clients, tag distinct campaigns to Anthem and Arizona Smile Design
- [ ] Anthem's single-client analytics shows only Anthem's campaigns
- [ ] Group mode with both clients: Top Performing Creatives shows no duplicates; spend totals correct
- [ ] Zero-claims client: Meta block returns null/empty
- [ ] Cross-client claim attempt shows disabled row + ConfirmDialog on ad-account change clears claims
- [ ] `compliance-auditor` agent pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Run compliance-auditor agent on the PR**

Invoke the `compliance-auditor` subagent with a prompt summarizing the changes and ask for a compliance read. Address any findings before merge.

---

## Appendix: File inventory

| File | Action |
|---|---|
| `server/sql/migrate_tracking_v4.sql` | Create (Task 2) |
| `server/index.js` | Modify — add migration runner (Task 2) |
| `server/services/analytics/metaAdsAdapter.js` | Modify — add `fetchMetaCampaignsList` (Task 3); extend `fetchMetaAdsAnalytics` + `fetchCampaignsWithCreatives` with `allowedCampaignIds` (Task 4) |
| `server/services/analytics/index.js` | Modify — resolve claims and short-circuit empty allowlist (Task 5) |
| `server/routes/tracking.js` | Modify — 3 new endpoints (Tasks 6, 7) + clear-claims on account change (Task 8) |
| `src/api/tracking.js` | Modify — 3 new client methods (Task 9) |
| `src/views/admin/AdminHub/tracking/CampaignClaimsPanel.jsx` | Create (Task 10) |
| `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx` | Modify — render panel + confirm dialog (Task 11) |
| `docs/API_REFERENCE.md` | Modify (Task 12) |
| `SKILLS.md` | Modify (Task 12) |
| `server/services/analytics/groupAnalytics.js` | **Unchanged** — filter applies transitively via `fetchUnifiedAnalytics` |
