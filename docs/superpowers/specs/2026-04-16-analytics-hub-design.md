# Analytics Hub — Premium Dashboard Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Admin-only analytics hub replacing Looker Studio. Client-facing view deferred.

## Overview

Transform the existing Analytics Dashboard into a full-fledged premium analytics hub with 7 tabbed sections, deep drill-down reporting, date comparison, saved report templates with scheduled auto-generation, PDF/CSV export, and an AI-powered insights engine. Built on existing live integrations: GA4, Google Ads, Meta Ads, and CTM.

## Decisions

| Decision | Choice |
|----------|--------|
| Navigation | Tabs within existing AnalyticsDashboard component (no pane routing) |
| Tab count | 7: Overview, Paid Ads, Traffic & Attribution, Calls & Leads, Reports, Settings |
| Paid Ads sub-views | Toggle between Meta Ads and Google Ads within the tab |
| Date controls | Presets + custom date picker + period comparison with deltas |
| Drill-down depth | Full: Campaign -> Ad Set/Ad Group -> Ad. Google Ads adds Keywords + Search Terms |
| Calls & Leads | Analytics aggregations only (no individual call logs/transcripts) |
| Reports | Saved templates + scheduled auto-generation (pause/resume/frequency/on-demand), no email delivery |
| PDF generation | Template-based via pdfmake (server-side, no Puppeteer) |
| Insights | Rule-based alerts + Vertex AI narrative analysis |
| Settings | Account connection status only |
| Backend | New `server/routes/analytics.js` (split from hub.js) |
| Audience | Admin-only for now |

## Data Source Hierarchy

- **CTM** = source of truth for lead outcomes (calls, forms, qualified status, star ratings)
- **GA4** = traffic and behavior (sessions, users, bounce rate, landing pages, source/medium)
- **Ad platforms** = spend, delivery, native ad metrics (Meta: reach, CPM; Google Ads: keywords, quality score)
- **Attribution conflicts**: When CTM and GA4 disagree on lead source, expose both with explanation — don't silently pick one

## Architecture

### Backend

**New file: `server/routes/analytics.js`**

Migrate existing analytics endpoints from hub.js and add new ones. Mount at `/api/analytics`.

**Existing endpoints to migrate:**
- `GET /analytics/clients` — list clients with tracking configs
- `GET /analytics/:userId/overview` — unified analytics
- `GET /analytics/:userId/meta-campaigns` — Meta campaigns with creatives
- `GET /analytics-test/overview` — test endpoint
- `GET /analytics-test/meta-campaigns` — test endpoint

**New endpoints:**

Overview:
- `GET /analytics/:userId/overview` — enhanced: add top campaigns cross-platform, lead source breakdown from CTM

Paid Ads — Meta:
- `GET /analytics/:userId/meta/campaigns` — campaign list with insights
- `GET /analytics/:userId/meta/campaigns/:campaignId/adsets` — ad sets within a campaign
- `GET /analytics/:userId/meta/campaigns/:campaignId/adsets/:adsetId/ads` — ads within an ad set

Paid Ads — Google Ads:
- `GET /analytics/:userId/google-ads/campaigns` — campaign list with insights
- `GET /analytics/:userId/google-ads/campaigns/:campaignId/ad-groups` — ad groups within a campaign
- `GET /analytics/:userId/google-ads/campaigns/:campaignId/ad-groups/:adGroupId/ads` — ads within an ad group
- `GET /analytics/:userId/google-ads/campaigns/:campaignId/ad-groups/:adGroupId/keywords` — keyword performance
- `GET /analytics/:userId/google-ads/search-terms` — search term report (account or campaign level)

Traffic & Attribution:
- `GET /analytics/:userId/traffic/sources` — full source/medium table (no 10-row limit)
- `GET /analytics/:userId/traffic/landing-pages` — full landing pages table
- `GET /analytics/:userId/traffic/devices` — device category breakdown

Calls & Leads:
- `GET /analytics/:userId/calls-leads/summary` — KPIs: total calls, forms, qualified, missed, avg duration
- `GET /analytics/:userId/calls-leads/by-rating` — count per star rating (1-5)
- `GET /analytics/:userId/calls-leads/by-source` — leads grouped by source with qualified rate
- `GET /analytics/:userId/calls-leads/by-category` — AI classification distribution
- `GET /analytics/:userId/calls-leads/volume` — daily call + form counts time series
- `GET /analytics/:userId/calls-leads/duration-distribution` — call duration histogram buckets

Reports:
- `GET /analytics/reports` — list saved report templates
- `POST /analytics/reports` — create a saved report template
- `PATCH /analytics/reports/:reportId` — update (rename, change schedule, pause/resume)
- `DELETE /analytics/reports/:reportId` — delete template
- `POST /analytics/reports/:reportId/generate` — generate on-demand (returns PDF/CSV)
- `GET /analytics/reports/:reportId/generated` — list previously generated files
- `GET /analytics/reports/generated/:fileId/download` — download a generated file

Insights:
- `GET /analytics/:userId/insights` — rule-based alerts + AI narrative for current date range

Settings:
- `GET /analytics/:userId/connections` — platform connection status

All endpoints require `requireAuth` + `requireAdmin` middleware. All accept `?start=YYYY-MM-DD&end=YYYY-MM-DD` for date range. Comparison is computed client-side by making two parallel API calls (current range + comparison range) and computing deltas in the frontend.

### Adapter Enhancements

**metaAdsAdapter.js — add:**
- `fetchAdSets(accessToken, campaignId, startDate, endDate)` — ad sets with insights for a date range
- `fetchAdsForAdSet(accessToken, adAccountId, adSetId, startDate, endDate)` — ads within an ad set with creative details + image hash resolution

**googleAdsAdapter.js — add:**
- `fetchAdGroups(customerId, campaignId, startDate, endDate)` — GAQL query for ad groups
- `fetchAdsForAdGroup(customerId, adGroupId, startDate, endDate)` — individual ads
- `fetchKeywords(customerId, adGroupId, startDate, endDate)` — keyword performance with quality score
- `fetchSearchTerms(customerId, startDate, endDate, campaignId?)` — search term report

**ga4Adapter.js — modify:**
- Remove the hardcoded `limit: 10` on sources and landing pages — accept a `limit` parameter (default 50)
- Add `fetchDeviceBreakdown(propertyId, startDate, endDate)` — sessions by device category

**ctmAdapter.js — add:**
- `fetchByRating(userId, startDate, endDate)` — count per star rating
- `fetchByCategory(userId, startDate, endDate)` — count per AI classification category
- `fetchBySource(userId, startDate, endDate)` — leads by source with qualified count
- `fetchVolumeTimeSeries(userId, startDate, endDate)` — daily calls vs forms
- `fetchDurationDistribution(userId, startDate, endDate)` — duration histogram buckets

### Database — New Tables

**`analytics_report_templates`**
```sql
CREATE TABLE analytics_report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL, -- { userId, sections[], dateRangeType ('rolling_7d','rolling_30d','rolling_90d','this_month','last_month','custom'), customStart, customEnd, includeComparison, comparisonType }
  schedule_frequency TEXT, -- 'daily', 'weekly', 'monthly', NULL for no schedule
  schedule_paused BOOLEAN DEFAULT false,
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**`analytics_generated_reports`**
```sql
CREATE TABLE analytics_generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES analytics_report_templates(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'pdf', -- 'pdf' or 'csv'
  file_path TEXT NOT NULL, -- server-local path or GCS path
  file_size_bytes INTEGER,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now()
);
```

Report files stored in `server/generated-reports/` locally, or a GCS bucket in production. 90-day retention via cron cleanup.

### Scheduled Report Generation

A cron job in `server/index.js` runs daily at 11:00 UTC (6:00 AM CT):
1. Query `analytics_report_templates` where `schedule_frequency` is not null and `schedule_paused = false`
2. For each template due for generation (based on frequency + last_generated_at):
   - Fetch all data for the configured sections/userId/dateRange
   - Render PDF via pdfmake with branded template
   - Save to filesystem/GCS
   - Insert row into `analytics_generated_reports`
   - Update `last_generated_at` on the template

### Insights Engine

**Rule-based alerts** (computed on every overview load):
- CPC increased > 30% vs comparison period
- Missed calls > 20% of total calls
- Campaign spent > $X with 0 conversions
- Conversion rate dropped > 25%
- A lead source dried up (was producing leads, now zero)

Rules defined as a config array in `server/services/analytics/insightRules.js`. Each rule is a function that receives current + comparison data and returns `{ severity, title, description, recommendation }` or null.

**AI narrative** (on-demand, not cached):
- Aggregate key metrics into a structured prompt
- Send to Vertex AI (Gemini) via existing `services/ai.js` infrastructure
- Ask for 3-5 actionable insights with specific recommendations
- Display as a card section on the Overview tab

## Frontend Components

### File Structure

```
src/views/admin/AnalyticsDashboard/
├── index.jsx                    # Shell: client selector, date controls, tab bar, tab routing
├── DateRangeControls.jsx        # Presets + custom picker + comparison toggle
├── ComparisonKpiCard.jsx        # KPI card with delta arrow/percentage
│
├── OverviewTab.jsx              # Executive summary
├── OverviewTopCampaigns.jsx     # Cross-platform top campaigns table
│
├── PaidAdsTab.jsx               # Meta/Google Ads toggle + selected sub-view
├── MetaAdsView.jsx              # Meta account KPIs + campaign table
├── MetaAdSetView.jsx            # Ad sets within a campaign
├── MetaAdView.jsx               # Ads within an ad set (with creative preview)
├── GoogleAdsView.jsx            # Google Ads account KPIs + campaign table
├── GoogleAdGroupView.jsx        # Ad groups within a campaign
├── GoogleAdView.jsx             # Ads within an ad group
├── GoogleKeywordsTable.jsx      # Keyword performance table
├── GoogleSearchTermsTable.jsx   # Search terms report
│
├── TrafficTab.jsx               # Source/medium + landing pages + devices
├── SourceMediumTable.jsx        # Full source/medium DataTable
├── LandingPagesTable.jsx        # Landing pages DataTable
│
├── CallsLeadsTab.jsx            # CTM analytics aggregations
├── RatingBreakdownChart.jsx     # Star rating distribution
├── CategoryBreakdownChart.jsx   # AI classification distribution
├── CallFormVolumeChart.jsx      # Calls vs forms over time
│
├── ReportsTab.jsx               # Saved templates + generated reports
├── ReportTemplateDialog.jsx     # Create/edit report template dialog
│
├── SettingsTab.jsx              # Connection status cards
│
├── InsightsCard.jsx             # Rule-based alerts + AI narrative
│
├── // Existing (keep/refactor):
├── KpiCards.jsx                 # Refactor into ComparisonKpiCard
├── TimeSeriesChart.jsx          # Keep, add comparison overlay
├── LeadSourcesChart.jsx         # Keep, move to OverviewTab
├── AdPerformanceChart.jsx       # Keep, move to OverviewTab
├── CallSummaryCard.jsx          # Absorb into CallsLeadsTab
├── MetaCampaignsView.jsx        # Integrate into PaidAdsTab -> MetaAdsView
├── MetaCampaignCard.jsx         # Keep, used by MetaAdsView
└── MetaAdCreativePreview.jsx    # Keep, used by MetaAdView
```

### Shared State

The `index.jsx` shell manages and passes down:
- `selectedClient` — the selected client userId
- `dateRange` — `{ start, end }` ISO date strings
- `comparisonRange` — `{ start, end }` or null if comparison inactive
- `comparisonType` — 'previous_period' | 'same_period_last_year' | 'custom' | null

Each tab receives these as props. Tabs that support comparison make two parallel API calls (current + comparison range) and compute deltas locally.

### Date Range Controls Component

**Presets**: Today, Yesterday, Last 7 Days, Last 30 Days, Last 90 Days, This Month, Last Month, This Quarter, Last Quarter, YTD, Last 12 Months

**Custom picker**: Two date inputs (start/end) with a calendar popup (MUI DatePicker).

**Comparison toggle**: Switch that enables comparison. When on, shows a dropdown: "Previous Period", "Same Period Last Year", "Custom". Custom shows a second date picker pair. The comparison range is auto-computed for Previous Period and Same Period Last Year.

### Drill-Down Navigation

Drill-down within Paid Ads uses a breadcrumb pattern at the top of the sub-view:

```
All Campaigns > Campaign Name > Ad Set Name > Ad Name
```

Each level is clickable to go back up. State is managed within PaidAdsTab — no URL changes needed.

## Attribution & Merging Logic

### Lead Counting
- **Total Leads** = CTM-sourced count of `call_logs` entries with `score >= 3` for the selected user + date range. This is the canonical number.
- **Platform-reported conversions** (Meta "lead" actions, Google Ads conversions) are shown alongside but labeled as "Platform-Reported Conversions" to distinguish from CTM-verified leads.

### Source Attribution
- **CTM source** (`call_logs.meta->>'source'`): Primary attribution for lead source. This is what the client's tracking number or form was associated with.
- **GA4 source/medium**: Used for traffic analysis. May differ from CTM source because GA4 tracks the website session, not the call/form directly.
- **Attribution conflicts**: When the Traffic & Attribution tab shows source data, a callout card notes: "Lead source data comes from CTM (call/form tracking). Traffic source data comes from GA4 (website sessions). These may differ because a user might visit via organic search but call a number they saw on a paid ad."

### Spend & ROI
- Spend comes exclusively from ad platforms (Meta + Google Ads)
- Cost per Lead = (Meta spend + Google Ads spend) / CTM qualified leads
- Per-platform CPL shown separately in Paid Ads tab

### Time Series Merging
- All adapters return daily time series with ISO date keys
- Frontend merges by date, filling gaps with zeros
- Comparison overlay uses the same x-axis (day offset from start) not absolute dates

## PDF Report Template

Reports use pdfmake to generate branded PDFs:

**Header**: Anchor Corps logo + report title + date range + client name
**Sections** (based on template config):
- Executive Summary KPIs (table format)
- Trend charts (ApexCharts exported as base64 PNG, embedded in PDF)
- Campaign performance tables
- Lead/call summary tables
- Insights (if included)
**Footer**: Page numbers + "Generated by Anchor Corps Dashboard" + timestamp

For on-demand exports: the client pre-renders charts as base64 PNG using ApexCharts' `getDataURI()` and sends them with the generate request. For scheduled reports (no browser): use `chartjs-node-canvas` (a Node.js-native chart renderer that doesn't require a DOM) to generate chart images server-side from the raw data.

## CSP & Security

- Meta CDN (`*.fbcdn.net`, `*.facebook.com`) already added to `img-src` CSP directive
- No new external domains needed — all data flows through our backend APIs
- Report files served from our own server, no external hosting
- Vertex AI calls are server-side only

## Phased Implementation

### Phase 1: Foundation & UI Overhaul
- Create `server/routes/analytics.js`, migrate existing endpoints from hub.js
- Build DateRangeControls with presets, custom picker, and comparison
- Build ComparisonKpiCard component
- Refactor index.jsx into tabbed shell
- Build OverviewTab with enhanced KPIs, charts, and top campaigns

### Phase 2: Paid Ads Deep Dive
- Extend metaAdsAdapter with ad set fetching
- Extend googleAdsAdapter with ad groups, keywords, search terms
- Build PaidAdsTab with Meta and Google Ads sub-views
- Build drill-down components (campaign -> ad set/ad group -> ad)
- Build Google Ads keyword and search term tables

### Phase 3: Traffic, Calls & Leads
- Extend ga4Adapter (remove limits, add device breakdown)
- Extend ctmAdapter with rating/category/source/volume/duration queries
- Build TrafficTab with full source/medium and landing pages tables
- Build CallsLeadsTab with all aggregation charts

### Phase 4: Reports Engine
- Create database tables for report templates and generated reports
- Build report CRUD endpoints
- Integrate pdfmake for PDF generation
- Build ReportsTab UI with template management
- Add scheduled generation cron job
- Add CSV export

### Phase 5: Insights Engine
- Build rule-based alert system
- Integrate Vertex AI narrative insights
- Build InsightsCard component
- Add to OverviewTab

### Phase 6: Settings & Polish
- Build SettingsTab with connection status
- UI polish pass across all tabs
- Performance optimization (loading states, error handling)
