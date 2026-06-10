# Meta Campaign Allowlist — Implementation Spec

**Date:** 2026-04-21
**Status:** Draft
**Scope:** Per-client campaign allowlist for Meta Ads analytics, solving shared-pixel / shared-ad-account data leakage and group-mode double-counting

## Problem

Multiple clients (e.g. ADC practices: Anthem, Arizona Smile Design, Bell Road) share a single Meta ad account and pixel. Today `server/services/analytics/metaAdsAdapter.js` pulls every campaign on that account for each client. Two concrete failures result:

1. **Data leakage (single-client view).** When a client opens their analytics, they see campaigns from every practice that shares the account.
2. **Double-counting (group mode).** `groupAnalytics.js` iterates per-client and sums data. Because each client pulls the full account, a campaign counts once per client in the group — visible in "Top Performing Creatives" rendering the same creative 3 times at identical CTR/clicks/LPVs.

There is also a latent need to run internal / side campaigns on a client's ad account that should not appear in the client's reporting at all.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Default for new campaigns | **Allowlist** — excluded until explicitly claimed | Compliance-safe in a shared-account world; handles "side campaigns" use case naturally |
| Granularity | **Campaign-level only** | Current naming pattern bakes practice identity into the campaign name; ad-set/ad granularity unneeded |
| Ownership model | **Each campaign belongs to at most one client** (unique) | Makes group-mode double-counting structurally impossible |
| UI placement | **Inline in Tracking Wizard Step 2 (Accounts)**, beneath the Meta Ad Account selector | Keeps account + campaign scoping co-located in the flow |
| Campaign list loading | **Live fetch from Meta API**, active + paused by default, `show archived` toggle | Fresh data, no cache-sync logic, covers the 90%+ case |
| Filter scope | **Retroactive — applies to all time**, both single-client and group-mode views | A claim is a statement of ownership, not a time-bounded event |
| Platform scope (v1) | **Meta only**; data model extensible to Google Ads | Google Ads already has per-client customer IDs under MCC, so no parallel bug |

## Data model

New table: `tracking_campaign_claims` (platform-agnostic naming for future Google Ads reuse).

```sql
CREATE TABLE IF NOT EXISTS tracking_campaign_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('meta', 'google_ads')),
  ad_account_id   TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  campaign_name   TEXT,                       -- snapshot at claim time, UI fallback if Meta fetch fails
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by      UUID REFERENCES users(id),  -- admin who made the claim
  UNIQUE (platform, ad_account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS tracking_campaign_claims_user_platform_idx
  ON tracking_campaign_claims (user_id, platform);
```

The `UNIQUE (platform, ad_account_id, campaign_id)` constraint is the structural fix for the double-count bug: no two clients can own the same campaign, so group-mode aggregation cannot double-count.

Migration filename: `server/sql/migrate_tracking_v4.sql`. Invoked from a new `maybeRunTrackingV4Migration()` in `server/index.js` added to the startup migration chain. Idempotent via `IF NOT EXISTS`. No backfill — existing clients start with zero claims (see "Post-deploy" section).

## API

All endpoints live in `server/routes/tracking.js` and require admin/superadmin auth.

### GET `/hub/tracking/:userId/meta-campaigns`

Lists campaigns on the client's Meta ad account, annotated with claim state.

**Query params:**
- `status` — comma-separated, one of `active`, `paused`, `archived`, or `all` (default `active,paused`)

**Response:**
```json
{
  "ad_account_id": "act_2851894194985503",
  "campaigns": [
    {
      "id": "120208765432100000",
      "name": "ANC_ADCAnthem_Meta_Social_XX_Awareness_DentalMedical_General_XX_XX",
      "status": "ACTIVE",
      "objective": "OUTCOME_AWARENESS",
      "start_time": "2026-03-01T00:00:00+0000",
      "stop_time": null,
      "spend_last_30d": 432.10,
      "claimed_by": {
        "user_id": "d08c80ef-8c9b-48a0-9a2d-adfc4b282016",
        "name": "Anthem",
        "is_current_client": true
      }
    },
    { ... "claimed_by": null ... },
    { ... "claimed_by": { "user_id": "…", "name": "Arizona Smile Design", "is_current_client": false } ... }
  ]
}
```

Implementation:
- Load `tracking_configs.meta_ad_account_id` for `:userId`. If unset, return `400`.
- Add a new lightweight `fetchMetaCampaignsList(accessToken, adAccountId, { status, timeRange })` in `metaAdsAdapter.js`. It calls the campaigns endpoint plus a single account-level insights call (no per-campaign creative fetches). Returns `{ id, name, status, objective, start_time, stop_time, spend_last_30d }` per campaign. This avoids the expensive `fetchAdCreatives` fan-out that `fetchMetaCampaignsWithCreatives` does — the checklist doesn't need creatives.
- Left-join the Meta result against `tracking_campaign_claims WHERE platform='meta' AND ad_account_id=$1` to populate `claimed_by`. The join resolves `claimed_by.name` via `users` table for display.
- `is_current_client` is `true` when `claimed_by.user_id === :userId`, else `false`.

### POST `/hub/tracking/:userId/meta-campaigns/claims`

Claim a campaign for this client.

**Body:** `{ "campaign_id": "120208765432100000", "campaign_name": "ANC_ADCAnthem_…" }`

**Success (201):**
```json
{ "claim": { "id": "…", "user_id": "…", "campaign_id": "…", "campaign_name": "…", "claimed_at": "…" } }
```

**Conflict (409)** when another client already owns it:
```json
{
  "error": "campaign_already_claimed",
  "claimed_by": { "user_id": "…", "name": "Arizona Smile Design" }
}
```

The frontend uses the 409 response to explain the conflict in a toast, but in normal UX flow the row is already disabled (see UI section) so this is a defensive backstop.

### DELETE `/hub/tracking/:userId/meta-campaigns/claims/:campaign_id`

Release a claim. Idempotent — deleting a non-existent claim returns 204.

## Filter application in the analytics pipeline

Two call sites need the allowlist to take effect. Both resolve from the DB once per request and pass the result down.

### `server/services/analytics/index.js` → `fetchUnifiedAnalytics(userId, startDate, endDate)`

Before invoking `fetchMetaAnalytics`, run:

```js
const { rows } = await query(
  `SELECT campaign_id FROM tracking_campaign_claims
   WHERE user_id = $1 AND platform = 'meta'`,
  [userId]
);
const allowedCampaignIds = rows.map(r => r.campaign_id);
```

- If `tracking_configs.meta_ad_account_id` is set and `allowedCampaignIds.length === 0`, skip the Meta fetch entirely and return an empty Meta block. (Zero claims ≠ show everything — this is the allowlist's whole point.)
- If `allowedCampaignIds.length > 0`, pass them to `fetchMetaAnalytics(…, { allowedCampaignIds })`.

### `server/services/analytics/metaAdsAdapter.js`

Two functions grow an optional `{ allowedCampaignIds }` option:

- `fetchMetaAnalytics` — adds a `filtering` clause with `IN` on `campaign.id` to the account-level insights URL, and restricts the follow-up `campaigns` metadata call the same way.
- `fetchMetaCampaignsWithCreatives` — applies the same filter when the account-level insights call runs, so per-campaign creative fetches only run for allowed campaigns.

The `filtering` param and `IN` operator on campaign id are already used in this adapter — see the existing `filtering=[{"field":"id","operator":"IN","value":[…]}]` call in `fetchMetaCampaignsWithCreatives` when fetching campaign metadata, and the `filtering=[{"field":"campaign.effective_status","operator":"IN","value":[…]}]` status filter on insights. The new filter follows the same shape.

### Group mode (`server/services/analytics/groupAnalytics.js`)

**No change.** `fetchGroupAnalytics` already iterates user IDs and calls `fetchUnifiedAnalytics` per client. Because each per-client call filters by that client's claims — and the `UNIQUE` constraint guarantees no campaign appears in more than one client's claim set — the "creative shown N times" bug dies on its own.

## Frontend UI

### Location

`src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx`. A new section renders **only** when `config.meta_ad_account_id` is set, beneath the "Pixel auto-selected" banner.

### Component composition

All shared components per `CLAUDE.md` rules:

- `SubCard` — section wrapper with title "Campaigns for this client"
- `DataTable` — the campaign list (searchable, paginated, sortable)
- `StatusChip` — Active / Paused / Archived status column
- `LoadingButton` — refresh action
- `EmptyState` — fetch error / zero-campaigns states
- `ConfirmDialog` — Meta ad account change warning (see "Edge cases")
- `useToast` — claim / unclaim success + failure feedback

### Layout

```
[SubCard: "Campaigns for this client"]
  Helper text: "Check the campaigns that belong to this practice. Unchecked
  campaigns won't appear in this client's analytics or in any group reports
  that include them."

  [Switch: Show archived]    [IconButton: Refresh]

  [DataTable]
    Columns:
      ☐    (checkbox — disabled + locked if claimed by another client)
      Campaign name  (with secondary "claimed by Arizona Smile Design" caption when foreign-claimed)
      Status         (StatusChip)
      Start date
      30-day spend
    Search: by campaign name
    Page size: 10

  Footer: "X of Y campaigns claimed for this client"
```

### Data fetching

- On mount (and whenever `config.meta_ad_account_id` changes): call `GET /hub/tracking/:userId/meta-campaigns?status=active,paused`.
- Toggling "Show archived" refetches with `status=active,paused,archived`.
- Refresh button re-runs the fetch (no cache layer to invalidate).

### Interaction flow

**Check a row:**
1. Optimistically set the checkbox to checked.
2. `POST /hub/tracking/:userId/meta-campaigns/claims` with `{ campaign_id, campaign_name }`.
3. On success: toast "Claimed for {clientName}". Update local state to reflect `claimed_by = current client`.
4. On 409: revert checkbox, toast error with the owning client's name.
5. On other error: revert, generic error toast with retry affordance.

**Uncheck a row:**
1. Optimistically uncheck.
2. `DELETE /hub/tracking/:userId/meta-campaigns/claims/:campaign_id`.
3. On success: toast "Removed from {clientName}".
4. On error: revert, error toast.

**Claimed-elsewhere rows:** rendered with the checkbox disabled, row greyed, and a secondary caption under the campaign name reading "Claimed by {other client name}". Prevents users from attempting a conflict and getting a 409.

**Zero-campaigns state:** `EmptyState` with title "No campaigns found" and body "This ad account has no campaigns matching the current filters. Toggle 'Show archived' to see older campaigns."

**Fetch error:** `EmptyState` with retry button.

## Edge cases

| Case | Behavior |
|---|---|
| Client has no Meta ad account selected | Campaigns section hidden |
| Client has Meta ad account but zero claims | Analytics Meta block returns empty; Meta panel on the dashboard shows a hint: "No campaigns claimed for this client. Visit Tracking → Accounts to assign campaigns." |
| Admin changes the Meta ad account dropdown while claims exist for the old account | `ConfirmDialog`: "Switching ad accounts will clear this client's N claimed campaign(s). Continue?" On confirm, the backend `PATCH` to `tracking_configs` runs `DELETE FROM tracking_campaign_claims WHERE user_id=$1 AND platform='meta' AND ad_account_id=$old` in the same transaction. |
| Meta deletes / archives a claimed campaign | Claim remains in DB. On next campaign list fetch the campaign appears under `Show archived` or is absent; analytics filter still includes its id harmlessly (Meta returns nothing for deleted ids). No cleanup job needed. |
| Client user is deleted | `ON DELETE CASCADE` on `user_id` drops their claims automatically |
| Admin user who made a claim is deleted | `claimed_by` FK has default `NO ACTION` — blocks deletion. That's existing `users` table behavior; not this feature's concern. If needed, switch to `ON DELETE SET NULL` in the migration. |
| Campaign claim predates any analytics data | No effect — retroactive filter still applies, the campaign just has no data in the requested window |

## Compliance notes

- **No PHI added.** The feature only stores campaign IDs and campaign names (marketing copy, not patient data). HIPAA surface unchanged.
- **Authorization.** All endpoints require admin/superadmin role, enforced server-side via existing middleware. Clients cannot read, create, or modify claims for themselves or others.
- **Audit trail.** Claim creation / deletion logged via existing `logSecurityEvent` with `eventCategory: 'tracking'`, `eventType: 'campaign_claim_created'` / `'campaign_claim_deleted'`, including `user_id`, `campaign_id`, `claimed_by`.
- **Data retention.** Claims persist for the life of the client relationship and cascade on user deletion.

The `compliance-auditor` agent should review before merge even though the surface is minimal, per CLAUDE.md's default-on posture for healthcare.

## Verification plan

No automated test suite in this project. Verification steps:

1. `yarn build` — must succeed
2. `yarn lint` — must pass
3. Manual smoke test against local ngrok instance:
   - Pick one ADC client (Anthem). Visit Tracking → Accounts. Confirm campaigns list loads with all campaigns unclaimed.
   - Claim 2 campaigns. Refresh. Confirm the claims persist and the footer count updates.
   - Open Anthem's analytics page. Confirm only the 2 claimed campaigns appear in the Meta KPI/time series / top creatives.
   - Claim 2 *different* campaigns on Arizona Smile Design (same shared ad account).
   - Open the analytics dashboard in group mode containing Anthem + Arizona Smile Design. Confirm:
     - "Top Performing Creatives" no longer shows the same creative multiple times
     - Meta spend total equals Anthem's 2 campaigns + Arizona's 2 campaigns (no inflation)
   - On Anthem's Tracking tab, try to claim a campaign already owned by Arizona Smile Design. Confirm the row is disabled in the UI (primary path). If forcibly attempted via API, confirm 409 + toast.
   - Uncheck one of Anthem's claims. Confirm the campaign disappears from Anthem's analytics immediately.
   - Change Anthem's Meta ad account dropdown. Confirm `ConfirmDialog` fires, and after accepting, Anthem's previous claims are cleared.
4. `compliance-auditor` agent pass.

## Post-deploy

Existing clients start with zero claims and will therefore show an empty Meta block in their analytics until an admin tags campaigns. This is correct allowlist behavior, but requires a one-time manual pass:

- For each client with a configured `meta_ad_account_id`, visit Tracking → Accounts and tag the campaigns that belong to them.
- Verify each client's analytics Meta block displays as expected before announcing the feature.

## Deliberately out of scope

- Ad-set / ad-level filtering — campaign-level is sufficient for current naming conventions
- Google Ads allowlist — not needed today; data model is extensible when the need arises
- "Untagged campaign" badge / reminder on the Tracking tab — follow-up
- Historical claim audit log beyond `claimed_at` / `claimed_by` — existing security event log covers this
- Shared / multi-client campaigns — structurally disallowed by `UNIQUE` constraint by design

## File inventory

**New:**
- `server/sql/migrate_tracking_v4.sql`
- `src/views/admin/AdminHub/tracking/CampaignClaimsPanel.jsx` (rendered from `AccountSelectionStep.jsx`)

**Modified:**
- `server/index.js` — add `maybeRunTrackingV4Migration` to startup chain
- `server/routes/tracking.js` — three new endpoints (list, claim, unclaim)
- `server/services/analytics/metaAdsAdapter.js` — `allowedCampaignIds` option on `fetchMetaAnalytics` and `fetchMetaCampaignsWithCreatives`
- `server/services/analytics/index.js` — resolve claims before calling Meta adapter; zero-claims short-circuit
- `src/api/tracking.js` — frontend API client methods for the three new endpoints
- `src/views/admin/AdminHub/tracking/AccountSelectionStep.jsx` — render `CampaignClaimsPanel` beneath the Meta account banner; `ConfirmDialog` on account change when claims exist

**Unchanged but relevant:**
- `server/services/analytics/groupAnalytics.js` — filter applies transitively; no edits needed
