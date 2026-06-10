# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified admin-facing analytics dashboard that pulls data from GA4, Meta Ads, Google Ads, and CTM into a single view per client.

**Architecture:** A server-side orchestrator calls platform-specific adapters in parallel, normalizes results into a common shape, and serves it via a single API endpoint. The frontend renders predefined dashboard cards with date range controls using ApexCharts and MUI.

**Tech Stack:** Express.js, googleapis (GA4 Data API), Meta Marketing API (fetch), Google Ads API, PostgreSQL (CTM), React, ApexCharts, MUI v5

**Spec:** `docs/superpowers/specs/2026-04-02-analytics-dashboard-design.md`

---

## File Map

### Server (new files)
- `server/services/analytics/index.js` — Orchestrator: calls adapters in parallel, merges results
- `server/services/analytics/ga4Adapter.js` — GA4 Data API calls via googleapis
- `server/services/analytics/metaAdsAdapter.js` — Meta Marketing API calls via fetch
- `server/services/analytics/googleAdsAdapter.js` — Google Ads API calls (stub until developer token)
- `server/services/analytics/ctmAdapter.js` — Local DB queries against call_logs

### Server (modified files)
- `server/routes/hub.js` — Add analytics endpoints
- `server/services/oauthIntegration.js:24-29` — Add `analytics.readonly` to Google OAuth scopes

### Frontend (new files)
- `src/views/admin/AnalyticsDashboard/index.jsx` — Main dashboard page
- `src/views/admin/AnalyticsDashboard/KpiCards.jsx` — Top-level metric cards
- `src/views/admin/AnalyticsDashboard/TimeSeriesChart.jsx` — Leads & spend over time
- `src/views/admin/AnalyticsDashboard/LeadSourcesChart.jsx` — Lead sources donut chart
- `src/views/admin/AnalyticsDashboard/AdPerformanceChart.jsx` — Google vs Meta comparison
- `src/views/admin/AnalyticsDashboard/CallSummaryCard.jsx` — CTM call stats
- `src/api/analytics.js` — Add analytics API functions (file exists, extend it)

### Frontend (modified files)
- `src/routes/MainRoutes.jsx` — Add analytics route
- `src/menu-items/clientHub.js` — Add Analytics menu item

---

## Task 1: CTM Adapter (local DB — no external API needed)

**Files:**
- Create: `server/services/analytics/ctmAdapter.js`

This is the simplest adapter since it queries local data. Build it first to validate the adapter pattern.

- [ ] **Step 1: Create the analytics directory**

```bash
mkdir -p "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/server/services/analytics"
```

- [ ] **Step 2: Write the CTM adapter**

Create `server/services/analytics/ctmAdapter.js`:

```javascript
import { query } from '../../db.js';

/**
 * Fetch CTM call analytics for a client within a date range.
 * @param {string} userId - The client's user ID (UUID)
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @returns {object} { totalCalls, qualifiedCalls, missedCalls, avgDuration, topSources, timeSeries }
 */
export async function fetchCTMAnalytics(userId, startDate, endDate) {
  const [summaryRes, sourceRes, timeSeriesRes] = await Promise.all([
    // Summary stats
    query(
      `SELECT
        COUNT(*) AS total_calls,
        COUNT(*) FILTER (WHERE score >= 3) AS qualified_calls,
        COUNT(*) FILTER (WHERE duration_sec = 0 OR duration_sec IS NULL) AS missed_calls,
        ROUND(AVG(duration_sec) FILTER (WHERE duration_sec > 0))::int AS avg_duration
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')`,
      [userId, startDate, endDate]
    ),
    // Top sources from meta JSONB
    query(
      `SELECT
        COALESCE(meta->>'source', 'Unknown') AS source,
        COUNT(*) AS count
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')
      GROUP BY COALESCE(meta->>'source', 'Unknown')
      ORDER BY count DESC
      LIMIT 10`,
      [userId, startDate, endDate]
    ),
    // Daily time series
    query(
      `SELECT
        started_at::date AS date,
        COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE score >= 3) AS qualified
      FROM call_logs
      WHERE user_id = $1
        AND started_at >= $2::date
        AND started_at < ($3::date + interval '1 day')
      GROUP BY started_at::date
      ORDER BY date`,
      [userId, startDate, endDate]
    )
  ]);

  const summary = summaryRes.rows[0] || {};
  return {
    totalCalls: parseInt(summary.total_calls) || 0,
    qualifiedCalls: parseInt(summary.qualified_calls) || 0,
    missedCalls: parseInt(summary.missed_calls) || 0,
    avgDuration: parseInt(summary.avg_duration) || 0,
    topSources: sourceRes.rows.map((r) => ({ source: r.source, count: parseInt(r.count) })),
    timeSeries: timeSeriesRes.rows.map((r) => ({
      date: r.date.toISOString().split('T')[0],
      calls: parseInt(r.calls),
      qualified: parseInt(r.qualified)
    }))
  };
}
```

- [ ] **Step 3: Verify the adapter loads without errors**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && node -e "import('./server/services/analytics/ctmAdapter.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/services/analytics/ctmAdapter.js
git commit -m "feat(analytics): add CTM adapter for local call log analytics"
```

---

## Task 2: GA4 Adapter

**Files:**
- Create: `server/services/analytics/ga4Adapter.js`
- Modify: `server/services/oauthIntegration.js:24-29` — Add analytics.readonly scope

- [ ] **Step 1: Add analytics.readonly scope to Google OAuth**

In `server/services/oauthIntegration.js`, change lines 24-29 from:

```javascript
const GOOGLE_BUSINESS_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/business.manage'
];
```

to:

```javascript
const GOOGLE_BUSINESS_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/analytics.readonly'
];
```

- [ ] **Step 2: Write the GA4 adapter**

Create `server/services/analytics/ga4Adapter.js`:

```javascript
import { google } from 'googleapis';

/**
 * Fetch GA4 analytics for a property within a date range.
 * @param {string} accessToken - Decrypted OAuth access token
 * @param {string} propertyId - GA4 property ID (numeric, e.g. '527437284')
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object} { sessions, users, bounceRate, avgSessionDuration, topSources, topPages, timeSeries }
 */
export async function fetchGA4Analytics(accessToken, propertyId, startDate, endDate) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${propertyId}`;

  const [summaryRes, sourcesRes, pagesRes, timeSeriesRes] = await Promise.all([
    // Summary metrics
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'conversions' }
        ]
      }
    }),
    // Traffic sources
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' }
        ],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      }
    }),
    // Top landing pages
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPage' }],
        metrics: [
          { name: 'sessions' },
          { name: 'bounceRate' }
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10
      }
    }),
    // Daily time series
    analyticsData.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'conversions' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      }
    })
  ]);

  const summaryRow = summaryRes.data.rows?.[0]?.metricValues || [];
  return {
    sessions: parseInt(summaryRow[0]?.value) || 0,
    users: parseInt(summaryRow[1]?.value) || 0,
    bounceRate: parseFloat(summaryRow[2]?.value) || 0,
    avgSessionDuration: Math.round(parseFloat(summaryRow[3]?.value)) || 0,
    conversions: parseInt(summaryRow[4]?.value) || 0,
    topSources: (sourcesRes.data.rows || []).map((row) => ({
      source: row.dimensionValues[0].value,
      medium: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value)
    })),
    topPages: (pagesRes.data.rows || []).map((row) => ({
      page: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value),
      bounceRate: parseFloat(row.metricValues[1].value)
    })),
    timeSeries: (timeSeriesRes.data.rows || []).map((row) => {
      const d = row.dimensionValues[0].value;
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        sessions: parseInt(row.metricValues[0].value),
        users: parseInt(row.metricValues[1].value),
        conversions: parseInt(row.metricValues[2].value)
      };
    })
  };
}
```

- [ ] **Step 3: Verify the adapter loads**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && node -e "import('./server/services/analytics/ga4Adapter.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/services/analytics/ga4Adapter.js server/services/oauthIntegration.js
git commit -m "feat(analytics): add GA4 adapter and analytics.readonly scope"
```

---

## Task 3: Meta Ads Adapter

**Files:**
- Create: `server/services/analytics/metaAdsAdapter.js`

- [ ] **Step 1: Write the Meta Ads adapter**

Create `server/services/analytics/metaAdsAdapter.js`:

```javascript
const META_GRAPH_URL = 'https://graph.facebook.com/v18.0';

/**
 * Fetch Meta Ads analytics for an ad account within a date range.
 * @param {string} accessToken - Decrypted Facebook OAuth access token
 * @param {string} adAccountId - Meta ad account ID (with or without 'act_' prefix)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object} { spend, reach, impressions, clicks, ctr, cpc, cpm, conversions, costPerConversion, campaigns, timeSeries }
 */
export async function fetchMetaAdsAnalytics(accessToken, adAccountId, startDate, endDate) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  const insightsFields = 'spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type';
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  const [accountRes, campaignsRes, timeSeriesRes] = await Promise.all([
    // Account-level summary
    fetchMeta(`${accountId}/insights?fields=${insightsFields}&time_range=${timeRange}&access_token=${accessToken}`),
    // Campaign breakdown
    fetchMeta(`${accountId}/insights?fields=campaign_name,${insightsFields}&time_range=${timeRange}&level=campaign&limit=20&access_token=${accessToken}`),
    // Daily time series
    fetchMeta(`${accountId}/insights?fields=spend,impressions,clicks,actions&time_range=${timeRange}&time_increment=1&access_token=${accessToken}`)
  ]);

  const summary = accountRes.data?.[0] || {};
  const leadActions = (summary.actions || []).find((a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d');
  const leadCost = (summary.cost_per_action_type || []).find((a) => a.action_type === leadActions?.action_type);

  return {
    spend: parseFloat(summary.spend) || 0,
    reach: parseInt(summary.reach) || 0,
    impressions: parseInt(summary.impressions) || 0,
    clicks: parseInt(summary.clicks) || 0,
    ctr: parseFloat(summary.ctr) || 0,
    cpc: parseFloat(summary.cpc) || 0,
    cpm: parseFloat(summary.cpm) || 0,
    conversions: parseInt(leadActions?.value) || 0,
    costPerConversion: parseFloat(leadCost?.value) || 0,
    campaigns: (campaignsRes.data || []).map((c) => {
      const cLeadActions = (c.actions || []).find((a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d');
      return {
        name: c.campaign_name,
        spend: parseFloat(c.spend) || 0,
        impressions: parseInt(c.impressions) || 0,
        clicks: parseInt(c.clicks) || 0,
        conversions: parseInt(cLeadActions?.value) || 0
      };
    }),
    timeSeries: (timeSeriesRes.data || []).map((d) => ({
      date: d.date_start,
      spend: parseFloat(d.spend) || 0,
      impressions: parseInt(d.impressions) || 0,
      clicks: parseInt(d.clicks) || 0
    }))
  };
}

/**
 * Fetch ad accounts for the authenticated user.
 * @param {string} accessToken
 * @returns {Array<{id: string, name: string}>}
 */
export async function fetchAdAccounts(accessToken) {
  const res = await fetchMeta(`me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`);
  return (res.data || [])
    .filter((a) => a.account_status === 1) // 1 = ACTIVE
    .map((a) => ({ id: a.id, name: a.name }));
}

async function fetchMeta(path) {
  const url = `${META_GRAPH_URL}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Meta API error: ${err.error?.message || response.statusText}`);
  }
  return response.json();
}
```

- [ ] **Step 2: Verify the adapter loads**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && node -e "import('./server/services/analytics/metaAdsAdapter.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/metaAdsAdapter.js
git commit -m "feat(analytics): add Meta Ads adapter for Marketing API"
```

---

## Task 4: Google Ads Adapter (stub)

**Files:**
- Create: `server/services/analytics/googleAdsAdapter.js`

Google Ads API requires a developer token (pending approval). Build a stub that returns null so the orchestrator gracefully skips it.

- [ ] **Step 1: Write the Google Ads adapter stub**

Create `server/services/analytics/googleAdsAdapter.js`:

```javascript
/**
 * Fetch Google Ads analytics for a customer account.
 * STUB: Returns null until developer token is obtained.
 * Once approved, this will use the Google Ads API (GAQL) to query campaign performance.
 *
 * @param {string} accessToken - Decrypted Google OAuth access token
 * @param {string} customerId - Google Ads customer ID (e.g. '179-2914-4196')
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {object|null}
 */
export async function fetchGoogleAdsAnalytics(accessToken, customerId, startDate, endDate) {
  // TODO: Implement once GOOGLE_ADS_DEVELOPER_TOKEN is obtained from Google Ads API Center.
  // Will use GAQL queries:
  //   SELECT campaign.name, metrics.cost_micros, metrics.clicks,
  //          metrics.impressions, metrics.conversions
  //   FROM campaign
  //   WHERE segments.date BETWEEN '{startDate}' AND '{endDate}'
  console.log(`[googleAdsAdapter] Stub called for customer ${customerId} (${startDate} to ${endDate}). Developer token not yet configured.`);
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/analytics/googleAdsAdapter.js
git commit -m "feat(analytics): add Google Ads adapter stub (pending developer token)"
```

---

## Task 5: Analytics Orchestrator

**Files:**
- Create: `server/services/analytics/index.js`

- [ ] **Step 1: Write the orchestrator**

Create `server/services/analytics/index.js`:

```javascript
import { query } from '../../db.js';
import { decrypt } from '../security/index.js';
import { fetchCTMAnalytics } from './ctmAdapter.js';
import { fetchGA4Analytics } from './ga4Adapter.js';
import { fetchMetaAdsAnalytics, fetchAdAccounts } from './metaAdsAdapter.js';
import { fetchGoogleAdsAnalytics } from './googleAdsAdapter.js';

/**
 * Fetch unified analytics for a client across all platforms.
 * Each adapter runs in parallel. If one fails, others still return data.
 *
 * @param {string} userId - Client user ID (UUID)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {object} [overrides] - Optional hardcoded IDs for test mode
 * @returns {object} Unified analytics response
 */
export async function fetchUnifiedAnalytics(userId, startDate, endDate, overrides = {}) {
  const errors = [];

  // Load tracking config for this client
  const configRes = await query('SELECT * FROM tracking_configs WHERE user_id = $1', [userId]);
  const config = configRes.rows[0] || {};

  // Resolve platform IDs (overrides for test mode, config for production)
  const ga4PropertyId = overrides.ga4PropertyId || config.ga4_property_id;
  const metaPixelId = overrides.metaPixelId || config.meta_pixel_id;
  const googleAdsCustomerId = overrides.googleAdsCustomerId || config.google_ads_customer_id;

  // Load OAuth tokens
  const tokens = await getOAuthTokens(userId);

  // Run all adapters in parallel
  const [ctm, ga4, metaAds, googleAds] = await Promise.allSettled([
    fetchCTMAnalytics(userId, startDate, endDate),
    ga4PropertyId && tokens.google
      ? fetchGA4Analytics(tokens.google, ga4PropertyId, startDate, endDate)
      : Promise.resolve(null),
    tokens.facebook
      ? fetchMetaAdsData(tokens.facebook, metaPixelId, startDate, endDate)
      : Promise.resolve(null),
    googleAdsCustomerId && tokens.google
      ? fetchGoogleAdsAnalytics(tokens.google, googleAdsCustomerId, startDate, endDate)
      : Promise.resolve(null)
  ]);

  // Unwrap results, logging errors for failed adapters
  const ctmData = unwrapResult(ctm, 'ctm', errors);
  const ga4Data = unwrapResult(ga4, 'ga4', errors);
  const metaData = unwrapResult(metaAds, 'metaAds', errors);
  const googleAdsData = unwrapResult(googleAds, 'googleAds', errors);

  // Compute blended KPIs
  const totalLeads = (ctmData?.qualifiedCalls || 0) + (metaData?.conversions || 0) + (googleAdsData?.conversions || 0);
  const totalSpend = (metaData?.spend || 0) + (googleAdsData?.spend || 0);
  const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const totalSessions = ga4Data?.sessions || 0;
  const conversionRate = totalSessions > 0 ? (totalLeads / totalSessions) * 100 : 0;

  // Merge time series from all platforms
  const timeSeries = mergeTimeSeries(startDate, endDate, {
    ctm: ctmData?.timeSeries || [],
    ga4: ga4Data?.timeSeries || [],
    metaAds: metaData?.timeSeries || []
  });

  return {
    dateRange: { start: startDate, end: endDate },
    kpis: {
      totalLeads,
      totalSpend: Math.round(totalSpend * 100) / 100,
      costPerLead: Math.round(costPerLead * 100) / 100,
      totalSessions,
      conversionRate: Math.round(conversionRate * 100) / 100
    },
    byPlatform: {
      ga4: ga4Data,
      googleAds: googleAdsData,
      metaAds: metaData,
      ctm: ctmData
    },
    timeSeries,
    errors
  };
}

/**
 * For Meta, we need to find the ad account associated with the pixel.
 * If we can't match by pixel, fetch the first active ad account.
 */
async function fetchMetaAdsData(accessToken, metaPixelId, startDate, endDate) {
  const accounts = await fetchAdAccounts(accessToken);
  if (!accounts.length) return null;
  // Use the first active ad account (most agencies have one primary account per client)
  return fetchMetaAdsAnalytics(accessToken, accounts[0].id, startDate, endDate);
}

async function getOAuthTokens(userId) {
  const res = await query(
    `SELECT provider, access_token, encrypted_access_token, expires_at
     FROM oauth_connections
     WHERE client_id = $1 AND is_connected = TRUE AND revoked_at IS NULL`,
    [userId]
  );

  const tokens = {};
  for (const row of res.rows) {
    const token = row.encrypted_access_token
      ? decrypt(row.encrypted_access_token)
      : row.access_token
        ? (decrypt(row.access_token) || row.access_token)
        : null;
    if (token) {
      tokens[row.provider] = token;
    }
  }
  return tokens;
}

function unwrapResult(settled, name, errors) {
  if (settled.status === 'fulfilled') return settled.value;
  console.error(`[analytics] ${name} adapter failed:`, settled.reason?.message || settled.reason);
  errors.push({ scope: name, message: settled.reason?.message || 'Unknown error' });
  return null;
}

/**
 * Merge time series from different platforms into a single array keyed by date.
 * Fills in missing dates with zeros.
 */
function mergeTimeSeries(startDate, endDate, sources) {
  const dateMap = new Map();

  // Create entries for every date in range
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    dateMap.set(key, { date: key, sessions: 0, leads: 0, spend: 0, calls: 0 });
  }

  // Merge GA4
  for (const row of sources.ga4) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.sessions = row.sessions || 0;
    }
  }

  // Merge CTM
  for (const row of sources.ctm) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.calls = row.calls || 0;
      entry.leads += row.qualified || 0;
    }
  }

  // Merge Meta Ads
  for (const row of sources.metaAds) {
    const entry = dateMap.get(row.date);
    if (entry) {
      entry.spend += row.spend || 0;
    }
  }

  return Array.from(dateMap.values());
}
```

- [ ] **Step 2: Verify the orchestrator loads**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && node -e "import('./server/services/analytics/index.js').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/services/analytics/index.js
git commit -m "feat(analytics): add orchestrator service for unified analytics"
```

---

## Task 6: API Endpoints

**Files:**
- Modify: `server/routes/hub.js` — Add analytics route block

- [ ] **Step 1: Add the analytics endpoint to hub.js**

Add at the end of hub.js, before the final `export default router;`:

```javascript
// ─── Analytics Dashboard ────────────────────────────────────────
import { fetchUnifiedAnalytics } from '../services/analytics/index.js';

// GET /hub/analytics/:userId/overview
router.get('/analytics/:userId/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const startDate = req.query.start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = req.query.end || now.toISOString().split('T')[0];

    const data = await fetchUnifiedAnalytics(userId, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('[analytics] overview error:', err);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

// GET /hub/analytics/test — Hardcoded test endpoint for development
router.get('/analytics-test/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const startDate = req.query.start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = req.query.end || now.toISOString().split('T')[0];

    // Find the user_id for the test client by their tracking config
    const configRes = await query(
      "SELECT user_id FROM tracking_configs WHERE ga4_property_id = '527437284' LIMIT 1"
    );

    if (!configRes.rows.length) {
      return res.status(404).json({ message: 'Test client tracking config not found. Create a tracking config with ga4_property_id=527437284.' });
    }

    const userId = configRes.rows[0].user_id;

    const data = await fetchUnifiedAnalytics(userId, startDate, endDate, {
      ga4PropertyId: '527437284',
      metaPixelId: '391670359576766',
      googleAdsCustomerId: '179-2914-4196'
    });

    res.json(data);
  } catch (err) {
    console.error('[analytics] test overview error:', err);
    res.status(500).json({ message: 'Failed to fetch test analytics' });
  }
});
```

Note: The import statement should be added at the top of hub.js with the other imports. The routes go at the bottom before the export.

- [ ] **Step 2: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(analytics): add analytics overview API endpoints"
```

---

## Task 7: Frontend API Client

**Files:**
- Modify: `src/api/analytics.js`

- [ ] **Step 1: Read the existing analytics.js file**

The file currently only has `fetchAnalyticsUrl()` for Looker Studio. Add the new functions.

- [ ] **Step 2: Add analytics API functions**

Add to `src/api/analytics.js`:

```javascript
import api from './index';

// Existing Looker Studio function — keep as-is
export const fetchAnalyticsUrl = () => api.get('/hub/analytics').then((res) => res.data);

// New analytics dashboard functions
export const fetchAnalyticsOverview = (userId, params = {}) =>
  api.get(`/hub/analytics/${userId}/overview`, { params }).then((res) => res.data);

export const fetchAnalyticsTestOverview = (params = {}) =>
  api.get('/hub/analytics-test/overview', { params }).then((res) => res.data);
```

- [ ] **Step 3: Commit**

```bash
git add src/api/analytics.js
git commit -m "feat(analytics): add frontend API client for analytics dashboard"
```

---

## Task 8: KPI Cards Component

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/KpiCards.jsx`

- [ ] **Step 1: Create the AnalyticsDashboard directory**

```bash
mkdir -p "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard/src/views/admin/AnalyticsDashboard"
```

- [ ] **Step 2: Write KpiCards component**

Create `src/views/admin/AnalyticsDashboard/KpiCards.jsx`:

```jsx
import { Grid, Paper, Typography, Stack, Skeleton } from '@mui/material';
import { IconUsers, IconCurrencyDollar, IconTarget, IconEye, IconPercentage } from '@tabler/icons-react';
import { useTheme } from '@mui/material/styles';

const KPI_CONFIG = [
  { key: 'totalLeads', label: 'Total Leads', icon: IconUsers, format: (v) => v.toLocaleString(), color: 'primary' },
  { key: 'totalSpend', label: 'Total Spend', icon: IconCurrencyDollar, format: (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: 'warning' },
  { key: 'costPerLead', label: 'Cost per Lead', icon: IconTarget, format: (v) => `$${v.toFixed(2)}`, color: 'error' },
  { key: 'totalSessions', label: 'Sessions', icon: IconEye, format: (v) => v.toLocaleString(), color: 'info' },
  { key: 'conversionRate', label: 'Conversion Rate', icon: IconPercentage, format: (v) => `${v.toFixed(2)}%`, color: 'success' }
];

export default function KpiCards({ kpis, loading }) {
  const theme = useTheme();

  return (
    <Grid container spacing={2}>
      {KPI_CONFIG.map(({ key, label, icon: Icon, format, color }) => (
        <Grid item xs={6} sm={4} md key={key}>
          <Paper
            elevation={0}
            sx={{
              p: 2.5,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              textAlign: 'center'
            }}
          >
            {loading ? (
              <Stack spacing={1} alignItems="center">
                <Skeleton variant="circular" width={40} height={40} />
                <Skeleton width={80} height={32} />
                <Skeleton width={60} height={20} />
              </Stack>
            ) : (
              <Stack spacing={0.5} alignItems="center">
                <Icon size={28} color={theme.palette[color].main} stroke={1.5} />
                <Typography variant="h3" fontWeight={600}>
                  {format(kpis?.[key] ?? 0)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Stack>
            )}
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/KpiCards.jsx
git commit -m "feat(analytics): add KPI cards component"
```

---

## Task 9: Chart Components

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/TimeSeriesChart.jsx`
- Create: `src/views/admin/AnalyticsDashboard/LeadSourcesChart.jsx`
- Create: `src/views/admin/AnalyticsDashboard/AdPerformanceChart.jsx`
- Create: `src/views/admin/AnalyticsDashboard/CallSummaryCard.jsx`

- [ ] **Step 1: Write TimeSeriesChart**

Create `src/views/admin/AnalyticsDashboard/TimeSeriesChart.jsx`:

```jsx
import Chart from 'react-apexcharts';
import MainCard from 'ui-component/cards/MainCard';
import { useTheme } from '@mui/material/styles';
import { Skeleton } from '@mui/material';

export default function TimeSeriesChart({ timeSeries, loading }) {
  const theme = useTheme();

  if (loading) return <MainCard title="Leads & Spend Over Time"><Skeleton variant="rectangular" height={350} /></MainCard>;
  if (!timeSeries?.length) return null;

  const categories = timeSeries.map((d) => d.date);

  const series = [
    { name: 'Leads', type: 'column', data: timeSeries.map((d) => d.leads) },
    { name: 'Calls', type: 'column', data: timeSeries.map((d) => d.calls) },
    { name: 'Sessions', type: 'line', data: timeSeries.map((d) => d.sessions) },
    { name: 'Spend', type: 'line', data: timeSeries.map((d) => Math.round(d.spend * 100) / 100) }
  ];

  const options = {
    chart: { toolbar: { show: true }, stacked: false },
    colors: [theme.palette.primary.main, theme.palette.secondary.main, theme.palette.info.main, theme.palette.warning.main],
    stroke: { width: [0, 0, 2, 2], curve: 'smooth' },
    plotOptions: { bar: { borderRadius: 3, columnWidth: '50%' } },
    xaxis: {
      categories,
      labels: { rotate: -45, style: { fontSize: '11px' } },
      tickAmount: Math.min(categories.length, 15)
    },
    yaxis: [
      { title: { text: 'Count' }, seriesName: 'Leads' },
      { show: false, seriesName: 'Calls' },
      { show: false, seriesName: 'Sessions' },
      { opposite: true, title: { text: 'Spend ($)' }, seriesName: 'Spend', labels: { formatter: (v) => `$${v}` } }
    ],
    tooltip: {
      shared: true,
      y: { formatter: (val, { seriesIndex }) => seriesIndex === 3 ? `$${val.toFixed(2)}` : val }
    },
    legend: { position: 'top' }
  };

  return (
    <MainCard title="Leads & Spend Over Time">
      <Chart options={options} series={series} type="line" height={350} />
    </MainCard>
  );
}
```

- [ ] **Step 2: Write LeadSourcesChart**

Create `src/views/admin/AnalyticsDashboard/LeadSourcesChart.jsx`:

```jsx
import Chart from 'react-apexcharts';
import MainCard from 'ui-component/cards/MainCard';
import { useTheme } from '@mui/material/styles';
import { Skeleton, Typography } from '@mui/material';

export default function LeadSourcesChart({ ga4Data, loading }) {
  const theme = useTheme();

  if (loading) return <MainCard title="Traffic Sources"><Skeleton variant="rectangular" height={300} /></MainCard>;

  const sources = ga4Data?.topSources || [];
  if (!sources.length) return <MainCard title="Traffic Sources"><Typography color="text.secondary">No GA4 data available</Typography></MainCard>;

  const labels = sources.map((s) => `${s.source} / ${s.medium}`);
  const series = sources.map((s) => s.sessions);

  const options = {
    chart: { type: 'donut' },
    labels,
    colors: [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.warning.main,
      theme.palette.info.main,
      theme.palette.success.main,
      theme.palette.error.main,
      '#8884d8', '#82ca9d', '#ffc658', '#ff7300'
    ],
    legend: { position: 'bottom', fontSize: '12px' },
    tooltip: { y: { formatter: (val) => `${val} sessions` } },
    plotOptions: { pie: { donut: { size: '55%' } } }
  };

  return (
    <MainCard title="Traffic Sources">
      <Chart options={options} series={series} type="donut" height={300} />
    </MainCard>
  );
}
```

- [ ] **Step 3: Write AdPerformanceChart**

Create `src/views/admin/AnalyticsDashboard/AdPerformanceChart.jsx`:

```jsx
import Chart from 'react-apexcharts';
import MainCard from 'ui-component/cards/MainCard';
import { useTheme } from '@mui/material/styles';
import { Skeleton, Typography } from '@mui/material';

export default function AdPerformanceChart({ metaAds, googleAds, loading }) {
  const theme = useTheme();

  if (loading) return <MainCard title="Ad Performance"><Skeleton variant="rectangular" height={300} /></MainCard>;
  if (!metaAds && !googleAds) return <MainCard title="Ad Performance"><Typography color="text.secondary">No ad data available</Typography></MainCard>;

  const categories = ['Spend', 'Clicks', 'Impressions', 'Conversions'];
  const metaSeries = [
    metaAds?.spend || 0,
    metaAds?.clicks || 0,
    metaAds?.impressions || 0,
    metaAds?.conversions || 0
  ];
  const googleSeries = [
    googleAds?.spend || 0,
    googleAds?.clicks || 0,
    googleAds?.impressions || 0,
    googleAds?.conversions || 0
  ];

  // Use separate charts for spend/conversions (small numbers) vs impressions/clicks (large numbers)
  const metricPairs = [
    { label: 'Spend', meta: metaAds?.spend || 0, google: googleAds?.spend || 0, format: (v) => `$${v.toFixed(2)}` },
    { label: 'Clicks', meta: metaAds?.clicks || 0, google: googleAds?.clicks || 0, format: (v) => v.toLocaleString() },
    { label: 'CPC', meta: metaAds?.cpc || 0, google: googleAds?.cpc || 0, format: (v) => `$${v.toFixed(2)}` },
    { label: 'Conversions', meta: metaAds?.conversions || 0, google: googleAds?.conversions || 0, format: (v) => v.toLocaleString() },
    { label: 'Cost/Conv', meta: metaAds?.costPerConversion || 0, google: googleAds?.costPerConversion || 0, format: (v) => `$${v.toFixed(2)}` }
  ];

  const options = {
    chart: { type: 'bar', toolbar: { show: false } },
    plotOptions: { bar: { horizontal: false, columnWidth: '55%', borderRadius: 4, dataLabels: { position: 'top' } } },
    colors: ['#1877F2', '#4285F4'], // Meta blue, Google blue
    xaxis: { categories: metricPairs.map((m) => m.label) },
    yaxis: { labels: { formatter: (v) => typeof v === 'number' ? v.toLocaleString() : v } },
    dataLabels: { enabled: false },
    tooltip: { shared: true },
    legend: { position: 'top' }
  };

  const series = [
    { name: 'Meta Ads', data: metricPairs.map((m) => m.meta) },
    { name: 'Google Ads', data: metricPairs.map((m) => m.google) }
  ];

  return (
    <MainCard title="Ad Performance — Google vs Meta">
      <Chart options={options} series={series} type="bar" height={300} />
    </MainCard>
  );
}
```

- [ ] **Step 4: Write CallSummaryCard**

Create `src/views/admin/AnalyticsDashboard/CallSummaryCard.jsx`:

```jsx
import { Grid, Typography, Stack, Skeleton } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import { IconPhone, IconPhoneCheck, IconPhoneOff, IconClock } from '@tabler/icons-react';
import { useTheme } from '@mui/material/styles';

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const STATS = [
  { key: 'totalCalls', label: 'Total Calls', icon: IconPhone, color: 'primary' },
  { key: 'qualifiedCalls', label: 'Qualified', icon: IconPhoneCheck, color: 'success' },
  { key: 'missedCalls', label: 'Missed', icon: IconPhoneOff, color: 'error' },
  { key: 'avgDuration', label: 'Avg Duration', icon: IconClock, color: 'info', format: formatDuration }
];

export default function CallSummaryCard({ ctmData, loading }) {
  const theme = useTheme();

  return (
    <MainCard title="Call Summary (CTM)">
      {loading ? (
        <Stack spacing={2}>
          {STATS.map((s) => <Skeleton key={s.key} height={40} />)}
        </Stack>
      ) : !ctmData ? (
        <Typography color="text.secondary">No call data available</Typography>
      ) : (
        <Grid container spacing={2}>
          {STATS.map(({ key, label, icon: Icon, color, format }) => (
            <Grid item xs={6} key={key}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Icon size={24} color={theme.palette[color].main} stroke={1.5} />
                <Stack>
                  <Typography variant="h4">
                    {format ? format(ctmData[key]) : (ctmData[key] ?? 0).toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Stack>
              </Stack>
            </Grid>
          ))}
        </Grid>
      )}
    </MainCard>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/TimeSeriesChart.jsx src/views/admin/AnalyticsDashboard/LeadSourcesChart.jsx src/views/admin/AnalyticsDashboard/AdPerformanceChart.jsx src/views/admin/AnalyticsDashboard/CallSummaryCard.jsx
git commit -m "feat(analytics): add chart and summary components"
```

---

## Task 10: Main Dashboard Page

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/index.jsx`

- [ ] **Step 1: Write the main dashboard page**

Create `src/views/admin/AnalyticsDashboard/index.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Grid, Stack, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import KpiCards from './KpiCards';
import TimeSeriesChart from './TimeSeriesChart';
import LeadSourcesChart from './LeadSourcesChart';
import AdPerformanceChart from './AdPerformanceChart';
import CallSummaryCard from './CallSummaryCard';
import { fetchAnalyticsTestOverview } from 'api/analytics';
import { useToast } from 'contexts/ToastContext';

const DATE_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 }
];

export default function AnalyticsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30d');
  const { showToast } = useToast();

  const loadData = useCallback(async (rangeDays) => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - rangeDays);

      const result = await fetchAnalyticsTestOverview({
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      });
      setData(result);

      if (result.errors?.length) {
        result.errors.forEach((e) => showToast(`${e.scope}: ${e.message}`, 'warning'));
      }
    } catch (err) {
      console.error('[AnalyticsDashboard] load error:', err);
      showToast('Failed to load analytics data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const days = DATE_RANGES.find((r) => r.label === range)?.days || 30;
    loadData(days);
  }, [range, loadData]);

  return (
    <MainCard
      title="Analytics Dashboard"
      secondary={
        <ToggleButtonGroup
          value={range}
          exclusive
          onChange={(_, val) => val && setRange(val)}
          size="small"
        >
          {DATE_RANGES.map((r) => (
            <ToggleButton key={r.label} value={r.label}>{r.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      }
    >
      <Stack spacing={3}>
        <KpiCards kpis={data?.kpis} loading={loading} />

        <TimeSeriesChart timeSeries={data?.timeSeries} loading={loading} />

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <LeadSourcesChart ga4Data={data?.byPlatform?.ga4} loading={loading} />
          </Grid>
          <Grid item xs={12} md={6}>
            <AdPerformanceChart
              metaAds={data?.byPlatform?.metaAds}
              googleAds={data?.byPlatform?.googleAds}
              loading={loading}
            />
          </Grid>
        </Grid>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            {data?.byPlatform?.ga4?.topPages?.length > 0 && (
              <MainCard title="Top Landing Pages">
                <Stack spacing={1}>
                  {data.byPlatform.ga4.topPages.map((page) => (
                    <Stack key={page.page} direction="row" justifyContent="space-between" sx={{ py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>{page.page}</Typography>
                      <Typography variant="body2" color="text.secondary">{page.sessions} sessions</Typography>
                    </Stack>
                  ))}
                </Stack>
              </MainCard>
            )}
          </Grid>
          <Grid item xs={12} md={6}>
            <CallSummaryCard ctmData={data?.byPlatform?.ctm} loading={loading} />
          </Grid>
        </Grid>
      </Stack>
    </MainCard>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/index.jsx
git commit -m "feat(analytics): add main analytics dashboard page"
```

---

## Task 11: Wire Up Route and Menu Item

**Files:**
- Modify: `src/routes/MainRoutes.jsx`
- Modify: `src/menu-items/clientHub.js`

- [ ] **Step 1: Add the route to MainRoutes.jsx**

Add the lazy import at the top with the others (after line 24):

```javascript
const AnalyticsDashboard = Loadable(lazy(() => import('views/admin/AnalyticsDashboard')));
```

Add the route in the children array (after the `ctm-forms` route block, before the closing `]`):

```javascript
    {
      path: 'analytics',
      element: (
        <AdminRoute>
          <AnalyticsDashboard />
        </AdminRoute>
      )
    }
```

- [ ] **Step 2: Add the menu item to clientHub.js**

Add `IconChartLine` to the import on line 1:

```javascript
import { IconUser, IconChartArcs, IconChartLine, IconSettings, IconBriefcase, IconUsers, IconFiles } from '@tabler/icons-react';
```

Add the analytics item to the `adminNavGroup.children` array (after the `shared-documents` entry):

```javascript
    {
      id: 'analytics',
      title: 'Analytics',
      type: 'item',
      url: '/analytics',
      icon: IconChartLine
    },
```

- [ ] **Step 3: Verify the build compiles**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/MainRoutes.jsx src/menu-items/clientHub.js
git commit -m "feat(analytics): wire up route and sidebar menu item"
```

---

## Task 12: Test End-to-End

- [ ] **Step 1: Start the dev servers**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn server &
yarn start &
```

- [ ] **Step 2: Verify the test endpoint returns data**

```bash
curl -s http://localhost:4000/hub/analytics-test/overview -H "Authorization: Bearer <your-token>" | head -100
```

Check that:
- CTM data has real call counts (if the test client has call_logs)
- GA4 returns session data (if Google OAuth token is active)
- Meta returns ad data (if Facebook OAuth token is active)
- Errors array lists any platforms that couldn't connect

- [ ] **Step 3: Open the dashboard in browser**

Navigate to `http://localhost:3000/analytics` and verify:
- KPI cards render with data (or loading skeletons → error toasts if no active tokens)
- Time series chart shows date range
- Date range toggles work (7d, 30d, 90d)
- Charts that have data render correctly
- Charts without data show graceful empty states

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(analytics): polish dashboard based on manual testing"
```
