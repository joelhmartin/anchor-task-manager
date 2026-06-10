# Analytics Dashboard — Design Spec

> **Status:** Approved
> **Date:** 2026-04-02
> **Scope:** Admin-facing unified analytics dashboard pulling from GA4, Google Ads, Meta Ads, and CTM

---

## Overview

A unified analytics dashboard for agency admins that consolidates data from four platforms into a single view per client. Replaces the need to jump between GA4, Google Ads Manager, Meta Ads Manager, and CTM to understand client performance.

**Phase 1 (this spec):** Admin-only, hardcoded test client, predefined dashboard cards.
**Phase 2 (future):** Dynamic client selection, custom report builder, configurable axes/heatmaps.
**Phase 3 (future):** Client-facing view with selective sharing.

---

## Data Sources

| Source | API | Auth | Data Available |
|---|---|---|---|
| **CTM** | Local DB (`call_logs`, `form_submissions`) | None needed | Calls, form fills, sources, duration, AI classifications. Years of history. |
| **GA4** | Google Analytics Data API v1 | Google OAuth + `analytics.readonly` scope | Sessions, users, pageviews, sources, conversions, demographics, landing pages |
| **Google Ads** | Google Ads API v18 | Google OAuth + developer token + `adwords` scope | Campaign spend, clicks, impressions, CTR, CPC, conversions, ROAS |
| **Meta Ads** | Marketing API v18.0 | Facebook OAuth + `ads_read` (already granted in dev mode) | Campaign spend, reach, impressions, CPC, CPM, conversions, cost per result |

### Infrastructure Status

- **GA4 Data API:** Enabled on `anchor-hub-480305` (2026-04-01)
- **Google Ads API:** Enabled on `anchor-hub-480305` (2026-04-01). Developer token needed from Ads Manager → API Center.
- **Meta Marketing API:** Already added to Facebook app. `ads_read` permission active in dev mode.
- **googleapis npm package:** Already installed (v171.4.0)
- **CTM:** Data already in local PostgreSQL

### Test Client IDs

| Platform | ID |
|---|---|
| GA4 Property | `527437284` |
| GA4 Measurement ID | `G-T5KYCM6YCY` |
| Google Ads | `AW-17929144196` (customer ID `179-2914-4196`) |
| Meta Pixel | `391670359576766` |

---

## Architecture

### Approach: Unified Analytics Service

A single orchestrator service calls platform-specific adapters in parallel, normalizes the results into a common data shape, and returns a unified response.

```
Client Request (date range + client ID)
    → GET /hub/analytics/:clientId/overview
    → analyticsService.js (orchestrator)
        ├── ctmAdapter.js      (local DB query)
        ├── ga4Adapter.js      (GA4 Data API)
        ├── metaAdsAdapter.js  (Marketing API)
        └── googleAdsAdapter.js (Google Ads API)
    → Normalize into common shape
    → Return unified JSON
```

### File Structure

```
server/
  services/
    analytics/
      index.js              # Orchestrator — calls adapters in parallel, merges results
      ga4Adapter.js          # GA4 Data API calls
      metaAdsAdapter.js      # Meta Marketing API calls
      googleAdsAdapter.js    # Google Ads API calls
      ctmAdapter.js          # Local DB queries against call_logs
src/
  views/
    admin/
      AnalyticsDashboard/
        index.jsx            # Main dashboard page
        KpiCards.jsx          # Top-level metric cards
        TimeSeriesChart.jsx   # Leads & spend over time
        LeadSourcesChart.jsx  # Donut/pie chart of lead sources
        AdPerformanceChart.jsx # Google vs Meta comparison
        TopPagesTable.jsx     # GA4 top landing pages
        CallSummaryCard.jsx   # CTM call stats
  api/
    analytics.js             # Frontend API client
```

---

## API Design

### Endpoints

All endpoints require admin/superadmin auth via `requireAdmin` middleware.

#### `GET /hub/analytics/:clientId/overview`

Primary endpoint. Returns all dashboard data for a date range.

**Query params:**
- `start` — ISO date string (default: 30 days ago)
- `end` — ISO date string (default: today)

**Response shape:**

```json
{
  "dateRange": { "start": "2026-03-03", "end": "2026-04-02" },
  "kpis": {
    "totalLeads": 47,
    "totalSpend": 3200.50,
    "costPerLead": 68.10,
    "totalSessions": 1842,
    "conversionRate": 2.55
  },
  "byPlatform": {
    "ga4": {
      "sessions": 1842,
      "users": 1204,
      "bounceRate": 42.3,
      "avgSessionDuration": 125,
      "topSources": [
        { "source": "google", "medium": "organic", "sessions": 820 }
      ],
      "topPages": [
        { "page": "/", "sessions": 450, "bounceRate": 38.2 }
      ]
    },
    "googleAds": {
      "spend": 1800.25,
      "clicks": 312,
      "impressions": 15420,
      "ctr": 2.02,
      "cpc": 5.77,
      "conversions": 18,
      "costPerConversion": 100.01,
      "campaigns": [
        { "name": "Brand Search", "spend": 800, "clicks": 180, "conversions": 12 }
      ]
    },
    "metaAds": {
      "spend": 1400.25,
      "reach": 28500,
      "impressions": 42000,
      "clicks": 890,
      "ctr": 2.12,
      "cpc": 1.57,
      "cpm": 33.34,
      "conversions": 14,
      "costPerConversion": 100.02,
      "campaigns": [
        { "name": "Lead Gen - TMJ", "spend": 900, "reach": 18000, "conversions": 10 }
      ]
    },
    "ctm": {
      "totalCalls": 89,
      "qualifiedCalls": 34,
      "missedCalls": 12,
      "avgDuration": 185,
      "formSubmissions": 13,
      "topSources": [
        { "source": "Google Ads", "count": 28 }
      ]
    }
  },
  "timeSeries": [
    {
      "date": "2026-03-03",
      "sessions": 62,
      "leads": 3,
      "spend": 105.20,
      "calls": 4
    }
  ],
  "errors": []
}
```

**Error handling:** If one platform fails (e.g., expired token), the response still returns data from the other platforms. Failed platforms return `null` in `byPlatform` and add an entry to `errors[]`.

---

## Frontend Layout

Built with MUI components and ApexCharts (already installed).

```
┌──────────────────────────────────────────────────────┐
│  Analytics Dashboard              [Date Range Picker] │
│  Client: TMJ Center NT            [7d|30d|90d|Custom] │
├──────────────────────────────────────────────────────┤
│                                                        │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐│
│  │ Leads  │ │ Spend  │ │  CPL   │ │Sessions│ │ CVR  ││
│  │   47   │ │ $3.2k  │ │$68.10  │ │ 1,842  │ │2.55% ││
│  │ +12%   │ │ -5%    │ │ -15%   │ │ +8%    │ │+0.3% ││
│  └────────┘ └────────┘ └────────┘ └────────┘ └──────┘│
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │  Leads & Spend Over Time (mixed line + bar)    │   │
│  │  Y1: Lead count (bars)  Y2: Spend (line)       │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
│  ┌─────────────────────┐ ┌─────────────────────┐     │
│  │ Lead Sources (donut) │ │ Ad Performance      │     │
│  │ Organic / Paid /     │ │ Google vs Meta      │     │
│  │ Direct / Referral    │ │ (grouped bar chart) │     │
│  └─────────────────────┘ └─────────────────────┘     │
│                                                        │
│  ┌─────────────────────┐ ┌─────────────────────┐     │
│  │ Top Landing Pages   │ │ Call Summary (CTM)   │     │
│  │ (DataTable)         │ │ Total / Qualified /  │     │
│  │                     │ │ Missed / Avg Duration│     │
│  └─────────────────────┘ └─────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

### Components

- **KPI cards:** MUI Paper with trend indicator (% change vs. previous period)
- **Time series:** ApexCharts mixed chart (bar + line)
- **Lead sources:** ApexCharts donut
- **Ad performance:** ApexCharts grouped bar (Google vs Meta side by side)
- **Top pages:** DataTable (existing shared component)
- **Call summary:** MUI cards with stats

### Date Range

- Quick selectors: 7d, 30d, 90d
- Custom date picker using MUI DatePicker
- Default: last 30 days
- Trend comparison: auto-compares to previous equivalent period

---

## Platform Adapter Details

### GA4 Adapter (`ga4Adapter.js`)

Uses `googleapis` package, `analyticsdata` v1beta.

**Auth:** Uses existing Google OAuth connection token from `oauth_connections` table. Needs `analytics.readonly` scope added to Google OAuth scopes.

**API calls:**
- `runReport()` with dimensions/metrics for sessions, users, bounce rate, session duration
- `runReport()` with `sessionSource`/`sessionMedium` dimensions for traffic sources
- `runReport()` with `landingPage` dimension for top pages
- `runReport()` with `date` dimension for time series

### Meta Ads Adapter (`metaAdsAdapter.js`)

Uses existing Facebook OAuth token from `oauth_connections`.

**API calls:**
- `GET /me/adaccounts` — list ad accounts
- `GET /{adAccountId}/insights` — account-level metrics (spend, impressions, clicks, conversions)
- `GET /{adAccountId}/campaigns` — campaign list
- `GET /{campaignId}/insights` — per-campaign metrics

**Fields:** `spend`, `impressions`, `clicks`, `cpc`, `cpm`, `ctr`, `reach`, `actions`, `cost_per_action_type`

### Google Ads Adapter (`googleAdsAdapter.js`)

Uses `google-ads-api` npm package (needs to be installed) or REST API via `googleapis`.

**Auth:** OAuth token + developer token (env var `GOOGLE_ADS_DEVELOPER_TOKEN`).

**API calls:**
- Campaign performance query via GAQL:
  ```sql
  SELECT campaign.name, metrics.cost_micros, metrics.clicks,
         metrics.impressions, metrics.conversions
  FROM campaign
  WHERE segments.date BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD'
  ```

### CTM Adapter (`ctmAdapter.js`)

Direct PostgreSQL queries against existing tables.

**Queries:**
- `call_logs` — count by status, source, date; avg duration
- `form_submissions` (if stored locally) — count by date, source
- Group by date for time series

---

## Test Phase

### Route: `/admin/analytics-test`

Hardcoded IDs:
```js
const TEST_CONFIG = {
  ga4PropertyId: '527437284',
  metaPixelId: '391670359576766',
  googleAdsCustomerId: '179-2914-4196',
  // CTM: queries all call_logs for this client's user_id
};
```

No client selector — renders dashboard immediately with test data. Once validated, swap to dynamic lookup from `tracking_configs` table.

---

## Security & Compliance

- **Auth:** Admin/superadmin only via `requireAdmin` middleware
- **No PHI exposure:** Analytics data is aggregate metrics, not individual patient data
- **Token handling:** Reuse existing encrypted OAuth tokens from `oauth_connections`
- **Audit logging:** Log analytics access events to security audit trail
- **Rate limiting:** Cache API responses for 15 minutes to avoid hitting platform rate limits

---

## Dependencies

**Already installed:**
- `googleapis` v171.4.0 (GA4 Data API, potentially Google Ads REST)
- `apexcharts` + `react-apexcharts` (charting)
- `@mui/material` + `@mui/x-date-pickers` (UI components)

**May need:**
- `google-ads-api` npm package (if REST API via googleapis is insufficient)

**API access:**
- GA4 Data API: Enabled
- Google Ads API: Enabled (developer token pending)
- Meta Marketing API: Active on Facebook app
