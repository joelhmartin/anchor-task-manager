# Facebook Campaign View with Creatives — Design Spec

> **Status:** Draft
> **Date:** 2026-04-06
> **Scope:** Admin-facing Facebook Ads campaign view showing ad creatives (images, videos, headlines) alongside performance metrics

---

## Overview

Build a dedicated Facebook campaign management view within the analytics dashboard that shows each ad campaign with its actual creative assets — images, videos, headlines, body text, CTAs — alongside performance metrics (spend, clicks, impressions, conversions). This goes beyond the current summary bar chart to give admins a visual, Ads Manager-like experience inside the CRM.

---

## Data Sources

All data comes from the Meta Marketing API using the existing system user token (`META_SYSTEM_USER_TOKEN`).

### API Endpoints Needed

| What | Endpoint | Fields | Permission |
|---|---|---|---|
| Campaign list | `GET /{ad-account-id}/campaigns` | id, name, status, objective, start_time, stop_time | `ads_read` |
| Campaign insights | `GET /{campaign-id}/insights` | spend, impressions, clicks, ctr, cpc, cpm, reach, actions, cost_per_action_type | `ads_read` |
| Ad sets | `GET /{campaign-id}/adsets` | id, name, status, targeting, daily_budget | `ads_read` |
| Ads | `GET /{ad-set-id}/ads` or `GET /{campaign-id}/ads` | id, name, status, creative | `ads_read` |
| Ad creative | `GET /{ad-creative-id}` | id, name, title, body, image_url, image_hash, thumbnail_url, video_id, call_to_action_type, object_story_spec, asset_feed_spec | `ads_read` |
| Ad preview | `GET /{ad-id}/previews` | Rendered HTML preview | `ads_read` |
| Ad images | `GET /{ad-account-id}/adimages` | hash, url, name | `ads_read` |

All under existing `ads_read` permission — no additional access needed.

---

## Architecture

### Server-Side

New adapter functions in `server/services/analytics/metaAdsAdapter.js`:

```
fetchCampaigns(token, adAccountId, dateRange)
  → Returns campaign list with status, objective, date range

fetchCampaignDetails(token, campaignId, dateRange)
  → Returns campaign insights + ad sets + ads with creatives

fetchAdCreative(token, creativeId)
  → Returns creative details (image URL, headline, body, CTA)
```

New API endpoints in hub.js:

```
GET /hub/analytics/:userId/meta-campaigns
  → List all campaigns with summary metrics

GET /hub/analytics/:userId/meta-campaigns/:campaignId
  → Campaign detail with ad sets, ads, creatives, and full metrics
```

### Frontend

New components in `src/views/admin/AnalyticsDashboard/`:

```
MetaCampaignsView.jsx        — Campaign list with cards showing creative + metrics
MetaCampaignCard.jsx          — Individual campaign card with creative preview + stats
MetaAdCreativePreview.jsx     — Renders ad image/video with headline and CTA overlay
```

---

## UI Design

### Campaign List View

```
┌──────────────────────────────────────────────────────────┐
│  Facebook Campaigns          [Active ▾] [Date Range ▾]   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🟢 ANC_TMJNorthTexas_Meta_Social_Traffic_TMJ      │  │
│  │                                                    │  │
│  │  ┌──────────┐  Spend: $67.17  │  Impressions: 8.4k│  │
│  │  │          │  Clicks: 155    │  CTR: 1.85%       │  │
│  │  │  [Ad     │  CPC: $0.43    │  Reach: 7,236     │  │
│  │  │  Image]  │  Conversions: 0 │  CPM: $8.00       │  │
│  │  │          │                 │                    │  │
│  │  └──────────┘                 │                    │  │
│  │                                                    │  │
│  │  "Expert TMJ & Sleep Therapy Care"                 │  │
│  │  Learn More →                                      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ⏸ ANC_TMJNorthTexas_Meta_Lead_Gen                 │  │
│  │  ...                                               │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Campaign Card Layout

Each campaign card shows:
- **Status indicator** (green dot = active, yellow = paused, gray = archived)
- **Campaign name** (truncated if long, full name on hover)
- **Ad creative thumbnail** (first ad's image/video thumbnail)
- **Headline + body text + CTA** from the creative
- **Performance metrics** in a clean grid
- **Click to expand** for ad set / individual ad breakdown

### Creative Preview Component

- Shows the actual ad image at a reasonable size (~200px wide)
- Overlays headline and CTA button styling to approximate how the ad looks on Facebook
- For video ads, shows the thumbnail with a play icon overlay
- Falls back to a placeholder if no creative is available

---

## Data Shape

### Campaign List Response

```json
{
  "campaigns": [
    {
      "id": "123456",
      "name": "ANC_TMJNorthTexas_Meta_Social_Traffic_TMJ",
      "status": "ACTIVE",
      "objective": "OUTCOME_TRAFFIC",
      "startTime": "2026-03-16",
      "stopTime": null,
      "insights": {
        "spend": 67.17,
        "impressions": 8401,
        "clicks": 155,
        "ctr": 1.85,
        "cpc": 0.43,
        "cpm": 8.00,
        "reach": 7236,
        "conversions": 0
      },
      "ads": [
        {
          "id": "789",
          "name": "Ad 1",
          "status": "ACTIVE",
          "creative": {
            "imageUrl": "https://...",
            "thumbnailUrl": "https://...",
            "headline": "Expert TMJ & Sleep Therapy Care",
            "body": "Struggling with jaw pain or sleep issues?",
            "callToAction": "LEARN_MORE",
            "linkUrl": "https://tmjcentrent.com"
          }
        }
      ]
    }
  ]
}
```

---

## Integration with Existing Dashboard

The campaign view can be:
- A new section below the existing Ad Performance chart
- Or a separate tab/pane within the analytics page

Recommendation: Add as a collapsible section below the Ad Performance chart, defaulting to expanded. This keeps everything on one page.

---

## Security & Compliance

- No PHI involved — ad campaign data is marketing performance metrics
- System user token stored as env var, never exposed to frontend
- All API calls are server-side only
- Admin/superadmin auth required via `requireAdmin` middleware

---

## Dependencies

- Meta Marketing API with `ads_read` permission (already configured)
- System user token with ad account access (already working for 20+ accounts)
- ApexCharts + MUI (already installed)
- No new npm packages needed
