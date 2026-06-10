# Facebook Campaign View with Creatives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Facebook campaign view to the analytics dashboard that shows each campaign's ad creatives (images, videos, headlines, CTAs) alongside performance metrics.

**Architecture:** Extend the existing Meta Ads adapter with new functions that fetch campaign → ad → creative data from the Meta Graph API. Add two new endpoints in hub.js. Build three new React components that render below the existing Ad Performance chart in the analytics dashboard.

**Tech Stack:** Meta Graph API v18.0, Express.js, React 19, MUI v5, existing `fetchMeta` helper

**Spec:** `docs/superpowers/specs/2026-04-06-facebook-campaign-view-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `server/services/analytics/metaAdsAdapter.js` | Add `fetchCampaignsWithCreatives()` and `fetchAdCreatives()` |
| Modify | `server/routes/hub.js` | Add two new endpoints for campaign data |
| Modify | `src/api/analytics.js` | Add frontend API client functions |
| Create | `src/views/admin/AnalyticsDashboard/MetaCampaignsView.jsx` | Container: fetches data, manages filters, renders campaign cards |
| Create | `src/views/admin/AnalyticsDashboard/MetaCampaignCard.jsx` | Individual campaign card with creative preview + metrics grid |
| Create | `src/views/admin/AnalyticsDashboard/MetaAdCreativePreview.jsx` | Renders ad image/video thumbnail with headline + CTA overlay |
| Modify | `src/views/admin/AnalyticsDashboard/index.jsx` | Add MetaCampaignsView below AdPerformanceChart |

---

## Task 1: Add Campaign + Creative Fetching to Meta Ads Adapter

**Files:**
- Modify: `server/services/analytics/metaAdsAdapter.js`

This task adds two new exported functions to the existing adapter. The existing `fetchMeta` helper (line 68) handles all Graph API calls with error handling.

- [ ] **Step 1: Add `fetchAdCreatives` function**

Add this function after `fetchAdAccounts` (after line 66) and before the `fetchMeta` helper:

```js
/**
 * Fetch ads with creative details for a given campaign.
 * @param {string} accessToken
 * @param {string} campaignId - Campaign ID (numeric string)
 * @returns {Array<{id, name, status, creative}>}
 */
export async function fetchAdCreatives(accessToken, campaignId) {
  const res = await fetchMeta(
    `${campaignId}/ads?fields=id,name,status,creative{id,name,title,body,image_url,thumbnail_url,video_id,call_to_action_type,object_story_spec}&limit=50&access_token=${accessToken}`
  );

  return (res.data || []).map((ad) => {
    const c = ad.creative || {};
    // Extract headline/body from object_story_spec if not in top-level fields
    const story = c.object_story_spec?.link_data || c.object_story_spec?.video_data || {};

    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      creative: {
        id: c.id,
        imageUrl: c.image_url || story.picture || null,
        thumbnailUrl: c.thumbnail_url || null,
        headline: c.title || story.name || story.title || null,
        body: c.body || story.message || null,
        callToAction: c.call_to_action_type || story.call_to_action?.type || null,
        linkUrl: story.link || null,
        isVideo: !!c.video_id
      }
    };
  });
}
```

- [ ] **Step 2: Add `fetchCampaignsWithCreatives` function**

Add this function after `fetchAdCreatives`:

```js
/**
 * Fetch all campaigns with insights and ad creatives for an ad account.
 * @param {string} accessToken
 * @param {string} adAccountId - With or without 'act_' prefix
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @param {string} [statusFilter] - 'ACTIVE', 'PAUSED', or null for all
 * @returns {object} { campaigns: [...] }
 */
export async function fetchCampaignsWithCreatives(accessToken, adAccountId, startDate, endDate, statusFilter) {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const timeRange = JSON.stringify({ since: startDate, until: endDate });

  // Step 1: Fetch campaign list with insights
  const filterParam = statusFilter ? `&filtering=[{"field":"campaign.effective_status","operator":"IN","value":["${statusFilter}"]}]` : '';
  const campaignsRes = await fetchMeta(
    `${accountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type&time_range=${timeRange}&level=campaign&limit=50${filterParam}&access_token=${accessToken}`
  );

  const campaignRows = campaignsRes.data || [];

  // Step 2: For each campaign, fetch its ads with creatives (in parallel, max 10 concurrent)
  const campaignIds = [...new Set(campaignRows.map((r) => r.campaign_id))];

  // Also fetch campaign metadata (status, objective) in one call
  const campaignMetaRes = campaignIds.length > 0
    ? await fetchMeta(`${accountId}/campaigns?fields=id,name,status,objective,start_time,stop_time&filtering=[{"field":"id","operator":"IN","value":[${campaignIds.map((id) => `"${id}"`).join(',')}]}]&limit=50&access_token=${accessToken}`)
    : { data: [] };

  const campaignMetaMap = new Map((campaignMetaRes.data || []).map((c) => [c.id, c]));

  // Fetch creatives for each campaign in parallel
  const creativeResults = await Promise.allSettled(
    campaignIds.map((id) => fetchAdCreatives(accessToken, id))
  );

  const creativeMap = new Map();
  campaignIds.forEach((id, i) => {
    creativeMap.set(id, creativeResults[i].status === 'fulfilled' ? creativeResults[i].value : []);
  });

  // Step 3: Merge everything
  const campaigns = campaignRows.map((row) => {
    const meta = campaignMetaMap.get(row.campaign_id) || {};
    const leadActions = (row.actions || []).find(
      (a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.messaging_conversation_started_7d'
    );
    const leadCost = (row.cost_per_action_type || []).find(
      (a) => a.action_type === leadActions?.action_type
    );

    return {
      id: row.campaign_id,
      name: row.campaign_name,
      status: meta.status || 'UNKNOWN',
      objective: meta.objective || null,
      startTime: meta.start_time || null,
      stopTime: meta.stop_time || null,
      insights: {
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        ctr: parseFloat(row.ctr) || 0,
        cpc: parseFloat(row.cpc) || 0,
        cpm: parseFloat(row.cpm) || 0,
        reach: parseInt(row.reach) || 0,
        conversions: parseInt(leadActions?.value) || 0,
        costPerConversion: parseFloat(leadCost?.value) || 0
      },
      ads: creativeMap.get(row.campaign_id) || []
    };
  });

  // Sort by spend descending (highest spend first)
  campaigns.sort((a, b) => b.insights.spend - a.insights.spend);

  return { campaigns };
}
```

- [ ] **Step 3: Verify server starts**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && node -e "import('./server/services/analytics/metaAdsAdapter.js').then(m => console.log('Exports:', Object.keys(m))).catch(e => console.error(e))"
```

Expected: `Exports: [ 'fetchMetaAdsAnalytics', 'fetchAdAccounts', 'fetchAdCreatives', 'fetchCampaignsWithCreatives' ]`

- [ ] **Step 4: Commit**

```bash
git add server/services/analytics/metaAdsAdapter.js
git commit -m "feat(analytics): add campaign + creative fetching to Meta adapter"
```

---

## Task 2: Add API Endpoints in Hub.js

**Files:**
- Modify: `server/routes/hub.js` (insert at ~line 9796, before the `:userId/overview` route)

The new endpoints follow the same patterns as the existing analytics routes: `requireAuth, requireAdmin` middleware, date range from query params, same error handling.

- [ ] **Step 1: Add import for new function**

At line 21 of hub.js, change:

```js
import { fetchUnifiedAnalytics } from '../services/analytics/index.js';
```

to:

```js
import { fetchUnifiedAnalytics } from '../services/analytics/index.js';
import { fetchCampaignsWithCreatives } from '../services/analytics/metaAdsAdapter.js';
```

- [ ] **Step 2: Add test endpoint for meta campaigns**

Insert after the `analytics-test/overview` route (after line 9796), before `analytics/:userId/overview`:

```js
// GET /hub/analytics-test/meta-campaigns — Test endpoint for Facebook campaigns with creatives
router.get('/analytics-test/meta-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const metaToken = process.env.META_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'META_SYSTEM_USER_TOKEN not configured' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const startDate = req.query.start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = req.query.end || now.toISOString().split('T')[0];
    const status = req.query.status || null; // 'ACTIVE', 'PAUSED', or null for all

    const data = await fetchCampaignsWithCreatives(
      metaToken,
      'act_5060545420680641',
      startDate,
      endDate,
      status
    );
    res.json(data);
  } catch (err) {
    console.error('[analytics] test meta-campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch campaign data' });
  }
});
```

- [ ] **Step 3: Add per-user endpoint for meta campaigns**

Insert immediately after the test endpoint:

```js
// GET /hub/analytics/:userId/meta-campaigns — Facebook campaigns with creatives for a client
router.get('/analytics/:userId/meta-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const metaToken = process.env.META_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'META_SYSTEM_USER_TOKEN not configured' });

    const { userId } = req.params;
    const configRes = await query('SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1', [userId]);
    const adAccountId = configRes.rows[0]?.meta_ad_account_id;
    if (!adAccountId) return res.status(404).json({ message: 'No Meta ad account configured for this client' });

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const startDate = req.query.start || thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = req.query.end || now.toISOString().split('T')[0];
    const status = req.query.status || null;

    const data = await fetchCampaignsWithCreatives(metaToken, adAccountId, startDate, endDate, status);
    res.json(data);
  } catch (err) {
    console.error('[analytics] meta-campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch campaign data' });
  }
});
```

- [ ] **Step 4: Verify build**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add server/routes/hub.js
git commit -m "feat(analytics): add meta campaigns API endpoints with creative data"
```

---

## Task 3: Add Frontend API Client Functions

**Files:**
- Modify: `src/api/analytics.js`

- [ ] **Step 1: Add API functions**

Append to `src/api/analytics.js`:

```js
// Facebook campaigns with creatives
export const fetchMetaCampaignsTest = (params = {}) =>
  client.get('/hub/analytics-test/meta-campaigns', { params }).then((res) => res.data);

export const fetchMetaCampaigns = (userId, params = {}) =>
  client.get(`/hub/analytics/${userId}/meta-campaigns`, { params }).then((res) => res.data);
```

- [ ] **Step 2: Commit**

```bash
git add src/api/analytics.js
git commit -m "feat(analytics): add meta campaigns API client functions"
```

---

## Task 4: Build MetaAdCreativePreview Component

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/MetaAdCreativePreview.jsx`

This is the leaf component — renders an ad's image/video thumbnail with headline and CTA. No data fetching, pure presentation.

- [ ] **Step 1: Create the component**

```jsx
import { Box, Typography, Button, Skeleton } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';

const CTA_LABELS = {
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Sign Up',
  SHOP_NOW: 'Shop Now',
  BOOK_NOW: 'Book Now',
  CONTACT_US: 'Contact Us',
  GET_OFFER: 'Get Offer',
  GET_QUOTE: 'Get Quote',
  SUBSCRIBE: 'Subscribe',
  SEND_MESSAGE: 'Send Message',
  CALL_NOW: 'Call Now',
  APPLY_NOW: 'Apply Now',
  DOWNLOAD: 'Download',
  WATCH_MORE: 'Watch More',
  NO_BUTTON: null
};

function formatCTA(raw) {
  if (!raw) return null;
  return CTA_LABELS[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MetaAdCreativePreview({ creative, compact = false }) {
  if (!creative) return null;

  const { imageUrl, thumbnailUrl, headline, body, callToAction, isVideo } = creative;
  const imgSrc = imageUrl || thumbnailUrl;
  const ctaLabel = formatCTA(callToAction);
  const imgSize = compact ? 120 : 180;

  return (
    <Box sx={{ display: 'flex', gap: 1.5, minWidth: 0 }}>
      {/* Image / Video Thumbnail */}
      <Box
        sx={{
          width: imgSize,
          height: imgSize,
          minWidth: imgSize,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'grey.100',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}
      >
        {imgSrc ? (
          <>
            <Box
              component="img"
              src={imgSrc}
              alt={headline || 'Ad creative'}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            {isVideo && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'rgba(0,0,0,0.3)',
                  borderRadius: 1
                }}
              >
                <PlayArrowIcon sx={{ color: 'white', fontSize: 48 }} />
              </Box>
            )}
          </>
        ) : (
          <ImageNotSupportedIcon sx={{ color: 'grey.400', fontSize: 40 }} />
        )}
      </Box>

      {/* Text + CTA */}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {headline && (
          <Typography variant="subtitle2" noWrap sx={{ mb: 0.25 }}>
            {headline}
          </Typography>
        )}
        {!compact && body && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {body}
          </Typography>
        )}
        {ctaLabel && (
          <Button size="small" variant="outlined" sx={{ textTransform: 'none', pointerEvents: 'none', mt: 0.5 }}>
            {ctaLabel} →
          </Button>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/MetaAdCreativePreview.jsx
git commit -m "feat(analytics): add MetaAdCreativePreview component"
```

---

## Task 5: Build MetaCampaignCard Component

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/MetaCampaignCard.jsx`

Individual campaign card showing status, creative preview, and metrics grid. Uses `MetaAdCreativePreview` for the creative, `SubCard` for the wrapper.

- [ ] **Step 1: Create the component**

```jsx
import { useState } from 'react';
import { Box, Grid, Typography, Chip, Collapse, IconButton, Stack, Divider } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SubCard from 'ui-component/cards/SubCard';
import MetaAdCreativePreview from './MetaAdCreativePreview';

const STATUS_CONFIG = {
  ACTIVE: { color: 'success', label: 'Active' },
  PAUSED: { color: 'warning', label: 'Paused' },
  ARCHIVED: { color: 'default', label: 'Archived' },
  DELETED: { color: 'error', label: 'Deleted' },
  UNKNOWN: { color: 'default', label: 'Unknown' }
};

function formatNumber(val) {
  if (val == null) return '—';
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return val.toLocaleString();
}

function formatCurrency(val) {
  if (val == null) return '—';
  return `$${val.toFixed(2)}`;
}

function formatPercent(val) {
  if (val == null) return '—';
  return `${val.toFixed(2)}%`;
}

const METRICS = [
  { key: 'spend', label: 'Spend', format: formatCurrency },
  { key: 'clicks', label: 'Clicks', format: formatNumber },
  { key: 'impressions', label: 'Impressions', format: formatNumber },
  { key: 'ctr', label: 'CTR', format: formatPercent },
  { key: 'cpc', label: 'CPC', format: formatCurrency },
  { key: 'reach', label: 'Reach', format: formatNumber },
  { key: 'cpm', label: 'CPM', format: formatCurrency },
  { key: 'conversions', label: 'Conversions', format: formatNumber }
];

export default function MetaCampaignCard({ campaign }) {
  const [expanded, setExpanded] = useState(false);

  const { name, status, insights, ads } = campaign;
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN;
  const primaryAd = ads?.[0] || null;

  return (
    <SubCard
      sx={{ '&:hover': { borderColor: 'primary.light' }, transition: 'border-color 0.2s' }}
      title={
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
          <Chip label={statusCfg.label} color={statusCfg.color} size="small" />
          <Typography variant="subtitle1" noWrap sx={{ flex: 1 }} title={name}>
            {name}
          </Typography>
          {ads?.length > 1 && (
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
            >
              <ExpandMoreIcon />
            </IconButton>
          )}
        </Stack>
      }
    >
      <Grid container spacing={2}>
        {/* Creative Preview */}
        <Grid item xs={12} md={5}>
          {primaryAd?.creative ? (
            <MetaAdCreativePreview creative={primaryAd.creative} />
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No creative available
            </Typography>
          )}
        </Grid>

        {/* Metrics Grid */}
        <Grid item xs={12} md={7}>
          <Grid container spacing={1}>
            {METRICS.map((m) => (
              <Grid item xs={6} sm={3} key={m.key}>
                <Typography variant="caption" color="text.secondary">{m.label}</Typography>
                <Typography variant="body2" fontWeight={600}>{m.format(insights?.[m.key])}</Typography>
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>

      {/* Expanded: show all ads */}
      {ads?.length > 1 && (
        <Collapse in={expanded}>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            All Ads ({ads.length})
          </Typography>
          <Stack spacing={1.5}>
            {ads.slice(1).map((ad) => (
              <Box key={ad.id} sx={{ pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  {ad.name} — {ad.status}
                </Typography>
                {ad.creative && <MetaAdCreativePreview creative={ad.creative} compact />}
              </Box>
            ))}
          </Stack>
        </Collapse>
      )}
    </SubCard>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/MetaCampaignCard.jsx
git commit -m "feat(analytics): add MetaCampaignCard component"
```

---

## Task 6: Build MetaCampaignsView Container

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/MetaCampaignsView.jsx`

Container component that fetches campaign data, manages status filter, and renders a list of `MetaCampaignCard`s. Receives `dateRange` from parent (the analytics dashboard passes start/end dates).

- [ ] **Step 1: Create the component**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Stack, Typography, Skeleton, ToggleButton, ToggleButtonGroup } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import MainCard from 'ui-component/cards/MainCard';
import EmptyState from 'ui-component/extended/EmptyState';
import MetaCampaignCard from './MetaCampaignCard';
import { fetchMetaCampaignsTest } from 'api/analytics';
import { useToast } from 'contexts/ToastContext';

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Paused', value: 'PAUSED' }
];

export default function MetaCampaignsView({ dateRange }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const { showToast } = useToast();

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateRange?.start) params.start = dateRange.start;
      if (dateRange?.end) params.end = dateRange.end;
      if (statusFilter) params.status = statusFilter;

      const data = await fetchMetaCampaignsTest(params);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error('[MetaCampaignsView] load error:', err);
      showToast('Failed to load Facebook campaign data', 'error');
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange?.start, dateRange?.end, statusFilter, showToast]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  return (
    <MainCard
      title="Facebook Campaigns"
      secondary={
        <ToggleButtonGroup
          value={statusFilter}
          exclusive
          onChange={(_, val) => val !== null && setStatusFilter(val)}
          size="small"
        >
          {STATUS_FILTERS.map((f) => (
            <ToggleButton key={f.value} value={f.value}>{f.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      }
    >
      {loading ? (
        <Stack spacing={2}>
          {[1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" height={160} sx={{ borderRadius: 1 }} />
          ))}
        </Stack>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={CampaignIcon}
          title="No campaigns found"
          message={statusFilter ? `No ${statusFilter.toLowerCase()} campaigns in this date range` : 'No Facebook campaign data available for this date range'}
        />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} — sorted by spend
          </Typography>
          {campaigns.map((campaign) => (
            <MetaCampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </Stack>
      )}
    </MainCard>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/MetaCampaignsView.jsx
git commit -m "feat(analytics): add MetaCampaignsView container component"
```

---

## Task 7: Integrate into Analytics Dashboard

**Files:**
- Modify: `src/views/admin/AnalyticsDashboard/index.jsx`

Add the MetaCampaignsView below the Ad Performance / Lead Sources row, passing the current date range.

- [ ] **Step 1: Add import**

Add after the existing imports (after line 8):

```js
import MetaCampaignsView from './MetaCampaignsView';
```

- [ ] **Step 2: Compute dateRange object for child components**

Inside the `AnalyticsDashboard` component, after the `loadData` callback (after line 46), add a computed date range:

```js
const dateRange = (() => {
  const days = DATE_RANGES.find((r) => r.label === range)?.days || 30;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0]
  };
})();
```

- [ ] **Step 3: Add MetaCampaignsView to the JSX**

Insert after the second `<Grid container spacing={3}>` block (the one with Top Landing Pages and CallSummaryCard), before the closing `</Stack>`:

```jsx
<MetaCampaignsView dateRange={dateRange} />
```

The full Stack children order becomes:
1. KpiCards
2. TimeSeriesChart
3. Grid (LeadSourcesChart + AdPerformanceChart)
4. Grid (Top Landing Pages + CallSummaryCard)
5. **MetaCampaignsView** ← new

- [ ] **Step 4: Verify build**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build
```

- [ ] **Step 5: Visual verification**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn start
```

Open the analytics dashboard in the browser. Verify:
- Facebook Campaigns section appears below the call summary
- Status filter toggles work (All / Active / Paused)
- Campaign cards show creative images, headlines, CTAs, and metrics
- Cards are sorted by spend (highest first)
- Expand/collapse works for campaigns with multiple ads
- Loading skeletons show while data loads
- Empty state shows correctly if no campaigns match the filter

- [ ] **Step 6: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/index.jsx
git commit -m "feat(analytics): integrate Facebook campaigns view into dashboard"
```

---

## Task 8: Final Build Verification & Documentation

**Files:**
- Verify: full `yarn build` and `yarn lint`
- Update: `SKILLS.md` if analytics capabilities section exists

- [ ] **Step 1: Full build check**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Lint check**

```bash
cd "/Volumes/G-DRIVE SSD/DEVELOPER/Anchor-Client-Dashboard" && yarn lint 2>&1 | tail -20
```

Expected: No new lint errors.

- [ ] **Step 3: Update memory**

Update `project_analytics_dashboard.md` to reflect that the Facebook Campaign View is now built.

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore(analytics): build verification and cleanup"
```
