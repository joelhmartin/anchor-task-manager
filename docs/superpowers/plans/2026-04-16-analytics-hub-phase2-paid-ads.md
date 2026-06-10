# Analytics Hub Phase 2: Paid Ads Deep Dive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Paid Ads tab with Meta and Google Ads sub-views, campaign drill-down (campaign -> ad set/ad group -> ad), and Google Ads keyword/search term reporting.

**Architecture:** Extend backend adapters with new GAQL/Meta API queries, add drill-down endpoints to `server/routes/analytics.js`, build frontend components with breadcrumb-based drill-down navigation within the Paid Ads tab.

**Tech Stack:** Express.js, google-ads-api (GAQL), Meta Graph API v21.0, React, MUI v5, DataTable shared component

**Spec:** `docs/superpowers/specs/2026-04-16-analytics-hub-design.md`

**No test suite.** Verify via `yarn build` + visual check.

---

### Task 1: Extend Meta adapter with ad set fetching

**Files:**
- Modify: `server/services/analytics/metaAdsAdapter.js`

Add two new exported functions:

**`fetchAdSets(accessToken, campaignId, startDate, endDate)`**
- Call Meta API: `{campaignId}/adsets?fields=id,name,status,daily_budget,lifetime_budget,targeting&limit=50`
- Also fetch insights: `{campaignId}/insights?fields=adset_id,adset_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type&time_range={...}&level=adset&limit=50`
- Merge metadata + insights by adset_id
- Return array of ad sets with `{ id, name, status, insights: { spend, impressions, clicks, ctr, cpc, cpm, reach, conversions, costPerConversion } }`
- Use the same `leadActions` extraction pattern from `fetchCampaignsWithCreatives`

**`fetchAdsForAdSet(accessToken, adAccountId, adSetId, startDate, endDate)`**
- Call Meta API: `{adSetId}/ads?fields=id,name,status,creative{id,name,title,body,image_url,thumbnail_url,video_id,call_to_action_type,object_story_spec,asset_feed_spec}&limit=50`
- Also fetch insights: `{adSetId}/insights?fields=ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,actions&time_range={...}&level=ad&limit=50`
- Merge ad data + insights by ad_id
- Resolve image hashes for dynamic creatives using the same `adimages` pattern from `fetchCampaignsWithCreatives` (needs `adAccountId` for the hash resolution call)
- Return array: `{ id, name, status, creative: {...}, insights: { spend, impressions, clicks, ctr, cpc, reach, conversions } }`

Both functions use the existing `fetchMeta()` helper and `accessToken` parameter.

---

### Task 2: Extend Google Ads adapter with ad groups, keywords, search terms

**Files:**
- Modify: `server/services/analytics/googleAdsAdapter.js`

Add four new exported functions. All follow the existing pattern: check `DEVELOPER_TOKEN`/`REFRESH_TOKEN`, clean customer ID, use `getCustomer()`, run GAQL queries.

**`fetchAdGroups(customerId, campaignId, startDate, endDate)`**
```sql
SELECT
  ad_group.id, ad_group.name, ad_group.status,
  metrics.cost_micros, metrics.clicks, metrics.impressions,
  metrics.ctr, metrics.conversions, metrics.cost_per_conversion
FROM ad_group
WHERE campaign.id = {campaignId}
  AND segments.date BETWEEN '{startDate}' AND '{endDate}'
  AND ad_group.status = 'ENABLED'
ORDER BY metrics.cost_micros DESC
LIMIT 50
```
Return: `[{ id, name, status, spend, clicks, impressions, ctr, conversions, costPerConversion }]`

**`fetchAdsForAdGroup(customerId, adGroupId, startDate, endDate)`**
```sql
SELECT
  ad_group_ad.ad.id, ad_group_ad.ad.name,
  ad_group_ad.ad.type, ad_group_ad.status,
  ad_group_ad.ad.responsive_search_ad.headlines,
  ad_group_ad.ad.responsive_search_ad.descriptions,
  ad_group_ad.ad.final_urls,
  metrics.cost_micros, metrics.clicks, metrics.impressions,
  metrics.ctr, metrics.conversions
FROM ad_group_ad
WHERE ad_group.id = {adGroupId}
  AND segments.date BETWEEN '{startDate}' AND '{endDate}'
  AND ad_group_ad.status = 'ENABLED'
ORDER BY metrics.cost_micros DESC
LIMIT 50
```
Return: `[{ id, name, type, status, headlines, descriptions, finalUrls, spend, clicks, impressions, ctr, conversions }]`
- headlines/descriptions: extract `text` field from each `AssetFieldType` in the responsive_search_ad arrays

**`fetchKeywords(customerId, adGroupId, startDate, endDate)`**
```sql
SELECT
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.quality_info.quality_score,
  metrics.cost_micros, metrics.clicks, metrics.impressions,
  metrics.ctr, metrics.conversions, metrics.cost_per_conversion
FROM keyword_view
WHERE ad_group.id = {adGroupId}
  AND segments.date BETWEEN '{startDate}' AND '{endDate}'
ORDER BY metrics.cost_micros DESC
LIMIT 100
```
Return: `[{ keyword, matchType, qualityScore, spend, clicks, impressions, ctr, conversions, costPerConversion }]`

**`fetchSearchTerms(customerId, startDate, endDate, campaignId?)`**
```sql
SELECT
  search_term_view.search_term,
  segments.keyword.info.text,
  segments.keyword.info.match_type,
  metrics.cost_micros, metrics.clicks, metrics.impressions,
  metrics.ctr, metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '{startDate}' AND '{endDate}'
  {AND campaign.id = campaignId -- if provided}
ORDER BY metrics.impressions DESC
LIMIT 200
```
Return: `[{ searchTerm, keyword, matchType, spend, clicks, impressions, ctr, conversions }]`

All functions: convert cost_micros to dollars (÷ 1,000,000), round to 2 decimals. Return `null` if tokens not configured.

---

### Task 3: Add Paid Ads API endpoints

**Files:**
- Modify: `server/routes/analytics.js`

Add these endpoints (before the `:userId/overview` catch-all route):

```javascript
// Meta drill-down
GET /:userId/meta/adsets/:campaignId
GET /:userId/meta/ads/:adSetId

// Google Ads drill-down
GET /:userId/google-ads/campaigns
GET /:userId/google-ads/ad-groups/:campaignId
GET /:userId/google-ads/ads/:adGroupId
GET /:userId/google-ads/keywords/:adGroupId
GET /:userId/google-ads/search-terms
```

Each endpoint:
1. Uses `parseDateRange(req)` for date params
2. Looks up the client's account ID from `tracking_configs`
3. Calls the corresponding adapter function
4. Returns the data as JSON

For Meta endpoints: get `meta_ad_account_id` from tracking_configs, use `FACEBOOK_SYSTEM_USER_TOKEN` from env.
For Google Ads endpoints: get `google_ads_customer_id` from tracking_configs.

Add needed imports at top of analytics.js:
```javascript
import { fetchAdSets, fetchAdsForAdSet } from '../services/analytics/metaAdsAdapter.js';
import { fetchAdGroups, fetchAdsForAdGroup, fetchKeywords, fetchSearchTerms, fetchGoogleAdsAnalytics } from '../services/analytics/googleAdsAdapter.js';
```

Also add a `GET /:userId/google-ads/campaigns` endpoint that calls `fetchGoogleAdsAnalytics` (already exists) and returns just the campaigns array with full metrics.

---

### Task 4: Build PaidAdsTab frontend shell

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/PaidAdsTab.jsx`
- Modify: `src/views/admin/AnalyticsDashboard/index.jsx` (wire in PaidAdsTab)
- Modify: `src/api/analytics.js` (add new API functions)

**Frontend API additions** (`src/api/analytics.js`):
```javascript
// Meta drill-down
export const fetchMetaAdSets = (userId, campaignId, params = {}) =>
  client.get(`/analytics/${userId}/meta/adsets/${campaignId}`, { params }).then(r => r.data);
export const fetchMetaAds = (userId, adSetId, params = {}) =>
  client.get(`/analytics/${userId}/meta/ads/${adSetId}`, { params }).then(r => r.data);

// Google Ads
export const fetchGoogleAdsCampaigns = (userId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/campaigns`, { params }).then(r => r.data);
export const fetchGoogleAdsAdGroups = (userId, campaignId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/ad-groups/${campaignId}`, { params }).then(r => r.data);
export const fetchGoogleAdsAds = (userId, adGroupId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/ads/${adGroupId}`, { params }).then(r => r.data);
export const fetchGoogleAdsKeywords = (userId, adGroupId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/keywords/${adGroupId}`, { params }).then(r => r.data);
export const fetchGoogleAdsSearchTerms = (userId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/search-terms`, { params }).then(r => r.data);
```

**PaidAdsTab.jsx:**
- ToggleButtonGroup at top: "Meta Ads" | "Google Ads"
- Renders `MetaAdsView` or `GoogleAdsView` based on selection
- Receives props: `{ userId, dateRange, comparisonRange }`

**Wire into index.jsx:**
- Import PaidAdsTab
- Replace `<PlaceholderTab label="Paid Ads" />` with `<PaidAdsTab userId={selectedClient} dateRange={dateRange} comparisonRange={comparisonRange} />`

---

### Task 5: Build MetaAdsView with drill-down

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/MetaAdsView.jsx`

**Features:**
- Breadcrumb navigation: `All Campaigns > Campaign Name > Ad Set Name`
- Three drill-down levels managed by local state: `{ level: 'campaigns'|'adsets'|'ads', campaignId, campaignName, adSetId, adSetName }`

**Level: campaigns** (default)
- Fetch campaigns using existing `fetchMetaCampaigns(userId, { start, end })`
- Render with DataTable: columns = Name, Status (StatusChip), Spend, Impressions, Clicks, CTR, CPC, Reach, Conversions
- Click a row → drill into its ad sets

**Level: adsets**
- Fetch using `fetchMetaAdSets(userId, campaignId, { start, end })`
- Same DataTable columns as campaigns
- Click a row → drill into its ads

**Level: ads**
- Fetch using `fetchMetaAds(userId, adSetId, { start, end })`
- Render each ad as a card with MetaAdCreativePreview (reuse existing component) + metrics row

**Breadcrumb**: Clickable links to go back up levels.

---

### Task 6: Build GoogleAdsView with drill-down

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/GoogleAdsView.jsx`

**Features:**
- Breadcrumb: `All Campaigns > Campaign Name > Ad Group Name`
- Three drill-down levels + keyword/search term sub-views
- State: `{ level: 'campaigns'|'adgroups'|'ads', campaignId, campaignName, adGroupId, adGroupName, subView: null|'keywords'|'search_terms' }`

**Level: campaigns**
- Fetch using `fetchGoogleAdsCampaigns(userId, { start, end })`
- DataTable: Name, Spend, Clicks, Impressions, CTR, Conversions, Cost/Conv
- Click row → drill to ad groups

**Level: adgroups**
- Fetch using `fetchGoogleAdsAdGroups(userId, campaignId, { start, end })`
- Same DataTable columns
- Click row → drill to ads
- Two additional buttons/tabs: "Keywords" and "Search Terms" (switch subView state)

**Level: ads**
- Fetch using `fetchGoogleAdsAds(userId, adGroupId, { start, end })`
- DataTable: Name, Type, Headlines (joined), Final URL, Spend, Clicks, Impressions, CTR, Conversions

**subView: keywords** (shown at adgroup level)
- Fetch using `fetchGoogleAdsKeywords(userId, adGroupId, { start, end })`
- DataTable: Keyword, Match Type, Quality Score, Spend, Clicks, Impressions, CTR, Conversions, Cost/Conv

**subView: search_terms** (shown at campaign or account level)
- Fetch using `fetchGoogleAdsSearchTerms(userId, { start, end, campaignId })`
- DataTable: Search Term, Matched Keyword, Match Type, Spend, Clicks, Impressions, CTR, Conversions

---

### Verification

After all tasks, run `yarn build` and visually verify:
1. Paid Ads tab shows Meta/Google toggle
2. Meta view lists campaigns from API, click drills to ad sets, then ads with creative previews
3. Google Ads view lists campaigns, drills to ad groups with keyword/search term sub-views
4. Breadcrumbs work for navigating back up
5. Date range changes reload data at current drill level
