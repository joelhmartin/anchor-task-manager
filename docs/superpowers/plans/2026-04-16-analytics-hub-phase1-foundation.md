# Analytics Hub Phase 1: Foundation & UI Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract analytics endpoints into a dedicated route file, build the tabbed dashboard shell with premium date range controls (presets + custom picker + period comparison), and create the ComparisonKpiCard component.

**Architecture:** Migrate existing analytics endpoints from `server/routes/hub.js` into `server/routes/analytics.js`, mount at `/api/analytics`. Refactor the frontend `AnalyticsDashboard/index.jsx` into a tabbed shell using MUI Tabs. Build `DateRangeControls` with presets, custom MUI DatePicker, and comparison toggle. Build `ComparisonKpiCard` that shows delta arrows when comparison is active.

**Tech Stack:** Express.js, React, MUI v5 (Tabs, DatePicker, ToggleButtonGroup), ApexCharts, @tabler/icons-react

**Spec:** `docs/superpowers/specs/2026-04-16-analytics-hub-design.md`

**Note:** This project has no test suite. Verification is done via `yarn build` (must succeed), `yarn lint` (must pass), and visual check in the browser. Steps referencing "verify" mean run `yarn build` and visually confirm in the running app.

---

### Task 1: Create `server/routes/analytics.js` and migrate endpoints from hub.js

**Files:**
- Create: `server/routes/analytics.js`
- Modify: `server/routes/hub.js` (remove analytics endpoints)
- Modify: `server/index.js` (mount new route)

- [ ] **Step 1: Create the new analytics route file**

Create `server/routes/analytics.js` with all analytics endpoints migrated from hub.js. The new router handles paths relative to its mount point (`/api/analytics`), so strip the `/analytics` prefix from all route paths.

```javascript
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { fetchUnifiedAnalytics } from '../services/analytics/index.js';
import { fetchCampaignsWithCreatives } from '../services/analytics/metaAdsAdapter.js';

const router = Router();

// Helper: parse date range from query params, default to last 30 days
function parseDateRange(req) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return {
    startDate: req.query.start || thirtyDaysAgo.toISOString().split('T')[0],
    endDate: req.query.end || now.toISOString().split('T')[0]
  };
}

// GET /analytics/clients — List clients with tracking configs
router.get('/clients', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT tc.user_id, u.first_name, u.last_name, u.email,
             tc.ga4_property_id IS NOT NULL AS has_ga4,
             tc.meta_ad_account_id IS NOT NULL AS has_meta,
             tc.google_ads_customer_id IS NOT NULL AS has_google_ads
      FROM tracking_configs tc
      JOIN users u ON u.id = tc.user_id
      ORDER BY u.first_name, u.last_name
    `);
    res.json({ clients: rows });
  } catch (err) {
    console.error('[analytics] clients list error:', err);
    res.status(500).json({ message: 'Failed to fetch analytics clients' });
  }
});

// GET /analytics/test/overview — Hardcoded test endpoint
router.get('/test/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = parseDateRange(req);
    const configRes = await query(
      "SELECT user_id FROM tracking_configs WHERE ga4_property_id = '527437284' LIMIT 1"
    );
    if (!configRes.rows.length) {
      return res.status(404).json({ message: 'Test client tracking config not found.' });
    }
    const userId = configRes.rows[0].user_id;
    const data = await fetchUnifiedAnalytics(userId, startDate, endDate, {
      ga4PropertyId: '527437284',
      metaAdAccountId: 'act_5060545420680641',
      googleAdsCustomerId: '179-2914-4196'
    });
    res.json(data);
  } catch (err) {
    console.error('[analytics] test overview error:', err);
    res.status(500).json({ message: 'Failed to fetch test analytics' });
  }
});

// GET /analytics/test/meta-campaigns — Test endpoint for Facebook campaigns
router.get('/test/meta-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { startDate, endDate } = parseDateRange(req);
    const VALID_CAMPAIGN_STATUSES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED']);
    const rawStatus = req.query.status || null;
    const status = VALID_CAMPAIGN_STATUSES.has(rawStatus) ? rawStatus : null;

    const data = await fetchCampaignsWithCreatives(metaToken, 'act_5060545420680641', startDate, endDate, status);
    res.json(data);
  } catch (err) {
    console.error('[analytics] test meta-campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch campaign data' });
  }
});

// GET /analytics/:userId/overview — Unified analytics for a client
router.get('/:userId/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = parseDateRange(req);
    const data = await fetchUnifiedAnalytics(userId, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error('[analytics] overview error:', err);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

// GET /analytics/:userId/meta-campaigns — Facebook campaigns with creatives
router.get('/:userId/meta-campaigns', requireAuth, requireAdmin, async (req, res) => {
  try {
    const metaToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN;
    if (!metaToken) return res.status(500).json({ message: 'FACEBOOK_SYSTEM_USER_TOKEN not configured' });

    const { userId } = req.params;
    const configRes = await query('SELECT meta_ad_account_id FROM tracking_configs WHERE user_id = $1', [userId]);
    const adAccountId = configRes.rows[0]?.meta_ad_account_id;
    if (!adAccountId) return res.status(404).json({ message: 'No Meta ad account configured for this client' });

    const { startDate, endDate } = parseDateRange(req);
    const VALID_CAMPAIGN_STATUSES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED']);
    const rawStatus = req.query.status || null;
    const status = VALID_CAMPAIGN_STATUSES.has(rawStatus) ? rawStatus : null;

    const data = await fetchCampaignsWithCreatives(metaToken, adAccountId, startDate, endDate, status);
    res.json(data);
  } catch (err) {
    console.error('[analytics] meta-campaigns error:', err);
    res.status(500).json({ message: 'Failed to fetch campaign data' });
  }
});

// GET /analytics/:userId/connections — Platform connection status
router.get('/:userId/connections', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const configRes = await query(`
      SELECT ga4_property_id, ga4_measurement_id,
             google_ads_customer_id,
             meta_ad_account_id, meta_pixel_id
      FROM tracking_configs WHERE user_id = $1
    `, [userId]);

    if (!configRes.rows.length) {
      return res.json({ connections: { ga4: null, googleAds: null, meta: null, ctm: false } });
    }

    const config = configRes.rows[0];

    // Check if client has any call_logs (CTM data)
    const ctmRes = await query('SELECT 1 FROM call_logs WHERE user_id = $1 LIMIT 1', [userId]);

    res.json({
      connections: {
        ga4: config.ga4_property_id ? { propertyId: config.ga4_property_id, measurementId: config.ga4_measurement_id } : null,
        googleAds: config.google_ads_customer_id ? { customerId: config.google_ads_customer_id } : null,
        meta: config.meta_ad_account_id ? { adAccountId: config.meta_ad_account_id, pixelId: config.meta_pixel_id } : null,
        ctm: ctmRes.rows.length > 0
      }
    });
  } catch (err) {
    console.error('[analytics] connections error:', err);
    res.status(500).json({ message: 'Failed to fetch connection status' });
  }
});

export default router;
```

- [ ] **Step 2: Mount the new route in server/index.js**

In `server/index.js`, add the import and mount line. Find the line `app.use('/api/hub', hubRouter);` (line ~172) and add the analytics route nearby:

```javascript
import analyticsRouter from './routes/analytics.js';
```

Add after the hub router mount:
```javascript
app.use('/api/analytics', analyticsRouter);
```

- [ ] **Step 3: Remove analytics endpoints from hub.js**

Remove these blocks from `server/routes/hub.js`:
1. The Looker URL endpoint at line ~6222 (`router.get('/analytics', ...)`) — keep this one since it's used by client portal for Looker URL, OR migrate it too. Since it's a simple client-facing endpoint, leave it in hub.js.
2. Remove lines ~9967-10096: the `/analytics/clients`, `/analytics-test/overview`, `/analytics-test/meta-campaigns`, `/analytics/:userId/meta-campaigns`, and `/analytics/:userId/overview` endpoints.
3. Remove the analytics imports at lines 21-22:
   - `import { fetchUnifiedAnalytics } from '../services/analytics/index.js';`
   - `import { fetchCampaignsWithCreatives } from '../services/analytics/metaAdsAdapter.js';`

   Only remove these if no other endpoint in hub.js uses them. Search hub.js for `fetchUnifiedAnalytics` and `fetchCampaignsWithCreatives` to confirm they're only used in the analytics endpoints being removed.

- [ ] **Step 4: Update the frontend API client**

Update `src/api/analytics.js` to point to the new `/api/analytics` path instead of `/api/hub/analytics`:

```javascript
import client from './client';

// Looker URL (stays in hub for client portal)
export function fetchAnalyticsUrl() {
  return client.get('/hub/analytics').then((res) => res.data.looker_url || null);
}

// Clients with tracking configs
export const fetchAnalyticsClients = () =>
  client.get('/analytics/clients').then((res) => res.data.clients);

// Per-client analytics
export const fetchAnalyticsOverview = (userId, params = {}) =>
  client.get(`/analytics/${userId}/overview`, { params }).then((res) => res.data);

export const fetchAnalyticsTestOverview = (params = {}) =>
  client.get('/analytics/test/overview', { params }).then((res) => res.data);

// Facebook campaigns with creatives
export const fetchMetaCampaignsTest = (params = {}) =>
  client.get('/analytics/test/meta-campaigns', { params }).then((res) => res.data);

export const fetchMetaCampaigns = (userId, params = {}) =>
  client.get(`/analytics/${userId}/meta-campaigns`, { params }).then((res) => res.data);

// Connection status
export const fetchAnalyticsConnections = (userId) =>
  client.get(`/analytics/${userId}/connections`).then((res) => res.data.connections);
```

- [ ] **Step 5: Verify the migration**

Run: `yarn build`
Expected: Build succeeds with no errors.

Start the server (`yarn server`) and frontend (`yarn start`). Open the Analytics Dashboard in the browser, select a client, and verify:
- KPI cards load with data
- Time series chart renders
- Meta campaigns section loads
- No console errors referencing old `/hub/analytics` paths

- [ ] **Step 6: Commit**

```bash
git add server/routes/analytics.js server/routes/hub.js server/index.js src/api/analytics.js
git commit -m "refactor: Extract analytics endpoints into server/routes/analytics.js"
```

---

### Task 2: Build `DateRangeControls` component

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/DateRangeControls.jsx`

- [ ] **Step 1: Install MUI date picker**

Check if `@mui/x-date-pickers` is already installed:
```bash
grep "@mui/x-date-pickers" package.json
```

If not installed:
```bash
yarn add @mui/x-date-pickers dayjs
```

If installed, also check for `dayjs` (the adapter dependency).

- [ ] **Step 2: Create the DateRangeControls component**

```jsx
import { useState } from 'react';
import {
  Stack, ToggleButton, ToggleButtonGroup, Button, Popover,
  Typography, Switch, FormControlLabel, Divider, Box
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import SelectField from 'ui-component/extended/SelectField';

const PRESETS = [
  { label: 'Today', key: 'today' },
  { label: 'Yesterday', key: 'yesterday' },
  { label: '7d', key: '7d' },
  { label: '30d', key: '30d' },
  { label: '90d', key: '90d' },
  { label: 'This Month', key: 'this_month' },
  { label: 'Last Month', key: 'last_month' },
  { label: 'This Quarter', key: 'this_quarter' },
  { label: 'Last Quarter', key: 'last_quarter' },
  { label: 'YTD', key: 'ytd' },
  { label: '12 Months', key: '12_months' }
];

const COMPARISON_OPTIONS = [
  { value: 'previous_period', label: 'Previous Period' },
  { value: 'same_period_last_year', label: 'Same Period Last Year' },
  { value: 'custom', label: 'Custom' }
];

function resolvePreset(key) {
  const now = dayjs();
  switch (key) {
    case 'today': return { start: now, end: now };
    case 'yesterday': return { start: now.subtract(1, 'day'), end: now.subtract(1, 'day') };
    case '7d': return { start: now.subtract(7, 'day'), end: now };
    case '30d': return { start: now.subtract(30, 'day'), end: now };
    case '90d': return { start: now.subtract(90, 'day'), end: now };
    case 'this_month': return { start: now.startOf('month'), end: now };
    case 'last_month': return { start: now.subtract(1, 'month').startOf('month'), end: now.subtract(1, 'month').endOf('month') };
    case 'this_quarter': return { start: now.startOf('quarter'), end: now };
    case 'last_quarter': {
      const lastQ = now.subtract(1, 'quarter');
      return { start: lastQ.startOf('quarter'), end: lastQ.endOf('quarter') };
    }
    case 'ytd': return { start: now.startOf('year'), end: now };
    case '12_months': return { start: now.subtract(12, 'month'), end: now };
    default: return { start: now.subtract(30, 'day'), end: now };
  }
}

function computeComparisonRange(start, end, type) {
  const duration = end.diff(start, 'day');
  switch (type) {
    case 'previous_period':
      return { start: start.subtract(duration + 1, 'day'), end: start.subtract(1, 'day') };
    case 'same_period_last_year':
      return { start: start.subtract(1, 'year'), end: end.subtract(1, 'year') };
    default:
      return null;
  }
}

export default function DateRangeControls({ dateRange, onDateRangeChange, comparisonRange, onComparisonChange }) {
  const [preset, setPreset] = useState('30d');
  const [customAnchor, setCustomAnchor] = useState(null);
  const [customStart, setCustomStart] = useState(dayjs(dateRange.start));
  const [customEnd, setCustomEnd] = useState(dayjs(dateRange.end));
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareType, setCompareType] = useState('previous_period');
  const [compareCustomStart, setCompareCustomStart] = useState(null);
  const [compareCustomEnd, setCompareCustomEnd] = useState(null);

  const handlePreset = (_, val) => {
    if (!val) return;
    setPreset(val);
    if (val === 'custom') {
      return; // handled by popover
    }
    const { start, end } = resolvePreset(val);
    const range = { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD') };
    onDateRangeChange(range);
    if (compareEnabled && compareType !== 'custom') {
      const comp = computeComparisonRange(start, end, compareType);
      onComparisonChange(comp ? { start: comp.start.format('YYYY-MM-DD'), end: comp.end.format('YYYY-MM-DD') } : null);
    }
  };

  const applyCustomRange = () => {
    setCustomAnchor(null);
    const range = { start: customStart.format('YYYY-MM-DD'), end: customEnd.format('YYYY-MM-DD') };
    onDateRangeChange(range);
    if (compareEnabled && compareType !== 'custom') {
      const comp = computeComparisonRange(customStart, customEnd, compareType);
      onComparisonChange(comp ? { start: comp.start.format('YYYY-MM-DD'), end: comp.end.format('YYYY-MM-DD') } : null);
    }
  };

  const handleCompareToggle = (enabled) => {
    setCompareEnabled(enabled);
    if (!enabled) {
      onComparisonChange(null);
      return;
    }
    const start = dayjs(dateRange.start);
    const end = dayjs(dateRange.end);
    const comp = computeComparisonRange(start, end, compareType);
    onComparisonChange(comp ? { start: comp.start.format('YYYY-MM-DD'), end: comp.end.format('YYYY-MM-DD') } : null);
  };

  const handleCompareTypeChange = (e) => {
    const type = e.target.value;
    setCompareType(type);
    if (type === 'custom') {
      // Let the user pick custom comparison dates
      const start = dayjs(dateRange.start);
      const comp = computeComparisonRange(start, dayjs(dateRange.end), 'previous_period');
      setCompareCustomStart(comp?.start || start.subtract(30, 'day'));
      setCompareCustomEnd(comp?.end || start.subtract(1, 'day'));
      onComparisonChange(comp ? { start: comp.start.format('YYYY-MM-DD'), end: comp.end.format('YYYY-MM-DD') } : null);
      return;
    }
    const start = dayjs(dateRange.start);
    const end = dayjs(dateRange.end);
    const comp = computeComparisonRange(start, end, type);
    onComparisonChange(comp ? { start: comp.start.format('YYYY-MM-DD'), end: comp.end.format('YYYY-MM-DD') } : null);
  };

  const applyCustomComparison = () => {
    if (compareCustomStart && compareCustomEnd) {
      onComparisonChange({ start: compareCustomStart.format('YYYY-MM-DD'), end: compareCustomEnd.format('YYYY-MM-DD') });
    }
  };

  // Show condensed presets in toggle group, rest in the custom popover
  const quickPresets = ['7d', '30d', '90d'];

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <ToggleButtonGroup value={preset} exclusive onChange={handlePreset} size="small">
          {quickPresets.map((key) => (
            <ToggleButton key={key} value={key}>{key}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* More presets + custom date picker */}
        <Button
          size="small"
          variant={!quickPresets.includes(preset) ? 'contained' : 'outlined'}
          startIcon={<CalendarMonthIcon />}
          onClick={(e) => setCustomAnchor(e.currentTarget)}
          sx={{ textTransform: 'none' }}
        >
          {!quickPresets.includes(preset)
            ? PRESETS.find((p) => p.key === preset)?.label || `${dateRange.start} — ${dateRange.end}`
            : 'More'}
        </Button>

        <Popover
          open={Boolean(customAnchor)}
          anchorEl={customAnchor}
          onClose={() => setCustomAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        >
          <Box sx={{ p: 2, minWidth: 300 }}>
            <Typography variant="subtitle2" gutterBottom>Presets</Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 2 }}>
              {PRESETS.filter((p) => p.key !== 'custom').map((p) => (
                <Button
                  key={p.key}
                  size="small"
                  variant={preset === p.key ? 'contained' : 'outlined'}
                  onClick={() => { setPreset(p.key); const r = resolvePreset(p.key); setCustomStart(r.start); setCustomEnd(r.end); }}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                  {p.label}
                </Button>
              ))}
            </Stack>

            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2" gutterBottom>Custom Range</Typography>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <DatePicker
                label="Start"
                value={customStart}
                onChange={setCustomStart}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
                maxDate={customEnd}
              />
              <DatePicker
                label="End"
                value={customEnd}
                onChange={setCustomEnd}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
                minDate={customStart}
                maxDate={dayjs()}
              />
            </Stack>
            <Button variant="contained" size="small" fullWidth onClick={applyCustomRange}>
              Apply
            </Button>
          </Box>
        </Popover>

        {/* Comparison toggle */}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <FormControlLabel
          control={<Switch size="small" checked={compareEnabled} onChange={(e) => handleCompareToggle(e.target.checked)} />}
          label={<Stack direction="row" spacing={0.5} alignItems="center"><CompareArrowsIcon fontSize="small" /><Typography variant="caption">Compare</Typography></Stack>}
          sx={{ mr: 0 }}
        />
        {compareEnabled && (
          <SelectField
            value={compareType}
            onChange={handleCompareTypeChange}
            options={COMPARISON_OPTIONS}
            size="small"
            fullWidth={false}
            sx={{ minWidth: 160 }}
          />
        )}
        {compareEnabled && compareType === 'custom' && (
          <Stack direction="row" spacing={1} alignItems="center">
            <DatePicker
              label="Compare Start"
              value={compareCustomStart}
              onChange={(v) => { setCompareCustomStart(v); }}
              slotProps={{ textField: { size: 'small', sx: { width: 140 } } }}
            />
            <DatePicker
              label="Compare End"
              value={compareCustomEnd}
              onChange={(v) => { setCompareCustomEnd(v); }}
              slotProps={{ textField: { size: 'small', sx: { width: 140 } } }}
            />
            <Button size="small" variant="outlined" onClick={applyCustomComparison}>Apply</Button>
          </Stack>
        )}
      </Stack>
    </LocalizationProvider>
  );
}
```

- [ ] **Step 3: Verify the component renders**

Run: `yarn build`
Expected: Build succeeds. (Component is not yet wired into the dashboard — that happens in Task 4.)

- [ ] **Step 4: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/DateRangeControls.jsx package.json yarn.lock
git commit -m "feat: Add DateRangeControls with presets, custom picker, and comparison"
```

---

### Task 3: Build `ComparisonKpiCard` component

**Files:**
- Create: `src/views/admin/AnalyticsDashboard/ComparisonKpiCard.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { Grid, Paper, Typography, Stack, Skeleton, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

const KPI_CONFIG = [
  { key: 'totalLeads', label: 'Total Leads', icon: 'IconUsers', format: (v) => v.toLocaleString(), color: 'primary', upIsGood: true },
  { key: 'totalSpend', label: 'Total Spend', icon: 'IconCurrencyDollar', format: (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'warning', upIsGood: false },
  { key: 'costPerLead', label: 'Cost per Lead', icon: 'IconTarget', format: (v) => `$${v.toFixed(2)}`, color: 'error', upIsGood: false },
  { key: 'totalSessions', label: 'Sessions', icon: 'IconEye', format: (v) => v.toLocaleString(), color: 'info', upIsGood: true },
  { key: 'conversionRate', label: 'Conversion Rate', icon: 'IconPercentage', format: (v) => `${v.toFixed(2)}%`, color: 'success', upIsGood: true }
];

// Lazy-load tabler icons to avoid importing them all at module level
import { IconUsers, IconCurrencyDollar, IconTarget, IconEye, IconPercentage } from '@tabler/icons-react';
const ICON_MAP = { IconUsers, IconCurrencyDollar, IconTarget, IconEye, IconPercentage };

function DeltaIndicator({ current, previous, upIsGood }) {
  if (previous == null || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  if (!isFinite(delta) || Math.abs(delta) < 0.01) return null;

  const isUp = delta > 0;
  const isGood = isUp === upIsGood;
  const color = isGood ? 'success.main' : 'error.main';
  const Icon = isUp ? ArrowUpwardIcon : ArrowDownwardIcon;

  return (
    <Stack direction="row" alignItems="center" spacing={0.25}>
      <Icon sx={{ fontSize: 14, color }} />
      <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
        {Math.abs(delta).toFixed(1)}%
      </Typography>
    </Stack>
  );
}

export default function ComparisonKpiCards({ kpis, comparisonKpis, loading }) {
  const theme = useTheme();

  return (
    <Grid container spacing={2}>
      {KPI_CONFIG.map(({ key, label, icon, format, color, upIsGood }) => {
        const Icon = ICON_MAP[icon];
        return (
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
                  {comparisonKpis && (
                    <DeltaIndicator
                      current={kpis?.[key] ?? 0}
                      previous={comparisonKpis?.[key] ?? 0}
                      upIsGood={upIsGood}
                    />
                  )}
                </Stack>
              )}
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `yarn build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/ComparisonKpiCard.jsx
git commit -m "feat: Add ComparisonKpiCard with delta indicators"
```

---

### Task 4: Refactor `index.jsx` into tabbed shell

**Files:**
- Modify: `src/views/admin/AnalyticsDashboard/index.jsx`
- Create: `src/views/admin/AnalyticsDashboard/OverviewTab.jsx`
- Create: `src/views/admin/AnalyticsDashboard/SettingsTab.jsx`

- [ ] **Step 1: Create the OverviewTab component**

Extract the current dashboard body into an OverviewTab that receives data as props. This preserves all existing functionality:

```jsx
import { Grid, Stack, Typography } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import ComparisonKpiCards from './ComparisonKpiCard';
import TimeSeriesChart from './TimeSeriesChart';
import LeadSourcesChart from './LeadSourcesChart';
import AdPerformanceChart from './AdPerformanceChart';
import CallSummaryCard from './CallSummaryCard';
import MetaCampaignsView from './MetaCampaignsView';

export default function OverviewTab({ data, comparisonData, loading, userId, dateRange }) {
  return (
    <Stack spacing={3}>
      <ComparisonKpiCards
        kpis={data?.kpis}
        comparisonKpis={comparisonData?.kpis || null}
        loading={loading}
      />

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

      <MetaCampaignsView userId={userId} dateRange={dateRange} />
    </Stack>
  );
}
```

- [ ] **Step 2: Create a placeholder SettingsTab**

```jsx
import { Stack, Typography, Paper, Chip, Skeleton } from '@mui/material';
import { useState, useEffect } from 'react';
import MainCard from 'ui-component/cards/MainCard';
import { fetchAnalyticsConnections } from 'api/analytics';

const PLATFORMS = [
  { key: 'ga4', label: 'Google Analytics 4', detailKey: 'propertyId', detailLabel: 'Property ID' },
  { key: 'googleAds', label: 'Google Ads', detailKey: 'customerId', detailLabel: 'Customer ID' },
  { key: 'meta', label: 'Meta Ads', detailKey: 'adAccountId', detailLabel: 'Ad Account' },
  { key: 'ctm', label: 'Call Tracking (CTM)', detailKey: null, detailLabel: null }
];

export default function SettingsTab({ userId }) {
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchAnalyticsConnections(userId)
      .then(setConnections)
      .catch(() => setConnections(null))
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <MainCard title="Connected Accounts">
      <Stack spacing={2}>
        {PLATFORMS.map(({ key, label, detailKey, detailLabel }) => (
          <Paper key={key} variant="outlined" sx={{ p: 2 }}>
            {loading ? (
              <Skeleton width={200} height={24} />
            ) : (
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack>
                  <Typography variant="subtitle1" fontWeight={600}>{label}</Typography>
                  {connections?.[key] && detailKey && (
                    <Typography variant="caption" color="text.secondary">
                      {detailLabel}: {typeof connections[key] === 'object' ? connections[key][detailKey] : 'Connected'}
                    </Typography>
                  )}
                </Stack>
                <Chip
                  label={connections?.[key] ? 'Connected' : 'Not Configured'}
                  color={connections?.[key] ? 'success' : 'default'}
                  size="small"
                  variant={connections?.[key] ? 'filled' : 'outlined'}
                />
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>
    </MainCard>
  );
}
```

- [ ] **Step 3: Refactor index.jsx into the tabbed shell**

Replace the entire `src/views/admin/AnalyticsDashboard/index.jsx` with:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Stack, Typography, Tab, Tabs, Box } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import SelectField from 'ui-component/extended/SelectField';
import EmptyState from 'ui-component/extended/EmptyState';
import DateRangeControls from './DateRangeControls';
import OverviewTab from './OverviewTab';
import SettingsTab from './SettingsTab';
import { fetchAnalyticsClients, fetchAnalyticsOverview } from 'api/analytics';
import { useToast } from 'contexts/ToastContext';
import BarChartIcon from '@mui/icons-material/BarChart';

const TABS = [
  { label: 'Overview', key: 'overview' },
  { label: 'Paid Ads', key: 'paid_ads' },
  { label: 'Traffic & Attribution', key: 'traffic' },
  { label: 'Calls & Leads', key: 'calls_leads' },
  { label: 'Reports', key: 'reports' },
  { label: 'Settings', key: 'settings' }
];

function TabPanel({ value, current, children }) {
  if (value !== current) return null;
  return <Box sx={{ pt: 2 }}>{children}</Box>;
}

function PlaceholderTab({ label }) {
  return (
    <EmptyState
      icon={BarChartIcon}
      title={`${label} — Coming Soon`}
      message="This section is under development."
    />
  );
}

export default function AnalyticsDashboard() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [data, setData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [dateRange, setDateRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  });
  const [comparisonRange, setComparisonRange] = useState(null);
  const { showToast } = useToast();

  // Load clients on mount
  useEffect(() => {
    fetchAnalyticsClients()
      .then((list) => {
        setClients(list || []);
        if (list?.length > 0) setSelectedClient(list[0].user_id);
      })
      .catch((err) => {
        console.error('[AnalyticsDashboard] clients error:', err);
        showToast('Failed to load analytics clients', 'error');
      })
      .finally(() => setClientsLoading(false));
  }, [showToast]);

  // Load data when client or date range changes
  const loadData = useCallback(async () => {
    if (!selectedClient) return;
    setLoading(true);
    try {
      const requests = [
        fetchAnalyticsOverview(selectedClient, { start: dateRange.start, end: dateRange.end })
      ];
      // If comparison is active, fetch comparison period in parallel
      if (comparisonRange) {
        requests.push(
          fetchAnalyticsOverview(selectedClient, { start: comparisonRange.start, end: comparisonRange.end })
        );
      }
      const [current, comparison] = await Promise.all(requests);
      setData(current);
      setComparisonData(comparison || null);

      if (current.errors?.length) {
        current.errors.forEach((e) => showToast(`${e.scope}: ${e.message}`, 'warning'));
      }
    } catch (err) {
      console.error('[AnalyticsDashboard] load error:', err);
      showToast('Failed to load analytics data', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedClient, dateRange, comparisonRange, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const clientOptions = clients.map((c) => ({
    value: c.user_id,
    label: `${c.first_name} ${c.last_name}`
  }));

  const selectedClientData = clients.find((c) => c.user_id === selectedClient);

  return (
    <MainCard
      title="Analytics"
      secondary={
        <SelectField
          label="Client"
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
          options={clientOptions}
          fullWidth={false}
          size="small"
          disabled={clientsLoading}
          sx={{ minWidth: 220 }}
        />
      }
    >
      {!selectedClient && !clientsLoading ? (
        <EmptyState
          icon={BarChartIcon}
          title="No clients configured"
          message="No clients have tracking credentials set up yet. Add tracking configs to see analytics."
        />
      ) : (
        <Stack spacing={2}>
          {/* Date controls + platform badges */}
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
            <DateRangeControls
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              comparisonRange={comparisonRange}
              onComparisonChange={setComparisonRange}
            />
            {selectedClientData && (
              <Stack direction="row" spacing={0.5} alignItems="center">
                {selectedClientData.has_ga4 && <Typography variant="caption" sx={{ bgcolor: 'success.light', color: 'success.dark', px: 1, py: 0.25, borderRadius: 1 }}>GA4</Typography>}
                {selectedClientData.has_meta && <Typography variant="caption" sx={{ bgcolor: 'info.light', color: 'info.dark', px: 1, py: 0.25, borderRadius: 1 }}>Meta Ads</Typography>}
                {selectedClientData.has_google_ads && <Typography variant="caption" sx={{ bgcolor: 'warning.light', color: 'warning.dark', px: 1, py: 0.25, borderRadius: 1 }}>Google Ads</Typography>}
              </Stack>
            )}
          </Stack>

          {/* Tabs */}
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            {TABS.map((t) => (
              <Tab key={t.key} label={t.label} value={t.key} />
            ))}
          </Tabs>

          {/* Tab panels */}
          <TabPanel value="overview" current={tab}>
            <OverviewTab
              data={data}
              comparisonData={comparisonData}
              loading={loading}
              userId={selectedClient}
              dateRange={dateRange}
            />
          </TabPanel>

          <TabPanel value="paid_ads" current={tab}>
            <PlaceholderTab label="Paid Ads" />
          </TabPanel>

          <TabPanel value="traffic" current={tab}>
            <PlaceholderTab label="Traffic & Attribution" />
          </TabPanel>

          <TabPanel value="calls_leads" current={tab}>
            <PlaceholderTab label="Calls & Leads" />
          </TabPanel>

          <TabPanel value="reports" current={tab}>
            <PlaceholderTab label="Reports" />
          </TabPanel>

          <TabPanel value="settings" current={tab}>
            <SettingsTab userId={selectedClient} />
          </TabPanel>
        </Stack>
      )}
    </MainCard>
  );
}
```

- [ ] **Step 4: Verify everything works**

Run: `yarn build`
Expected: Build succeeds.

Start `yarn server` and `yarn start`. Open the Analytics Dashboard and verify:
- Tab bar renders with all 6 tabs
- Date range controls show with 7d/30d/90d quick presets + "More" button
- "More" button opens popover with all presets + custom date picker
- Comparison toggle works (switch on, shows dropdown)
- Selecting a preset or custom range reloads data
- Overview tab shows the same KPI cards, charts, and campaign data as before
- KPI cards show delta arrows when comparison is enabled
- Clicking other tabs shows "Coming Soon" placeholders
- Settings tab shows connection status for the selected client
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/views/admin/AnalyticsDashboard/index.jsx src/views/admin/AnalyticsDashboard/OverviewTab.jsx src/views/admin/AnalyticsDashboard/SettingsTab.jsx
git commit -m "feat: Refactor analytics into tabbed shell with date controls and comparison"
```

---

### Task 5: Clean up old KpiCards.jsx

**Files:**
- Delete: `src/views/admin/AnalyticsDashboard/KpiCards.jsx` (replaced by ComparisonKpiCard.jsx)

- [ ] **Step 1: Verify KpiCards is no longer imported anywhere**

Search the codebase for imports of KpiCards:
```bash
grep -r "KpiCards" src/ --include="*.jsx" --include="*.js"
```

Expected: No results (OverviewTab now uses ComparisonKpiCards instead). If any file still imports it, update that import to use ComparisonKpiCards.

- [ ] **Step 2: Delete the old file**

```bash
rm src/views/admin/AnalyticsDashboard/KpiCards.jsx
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Remove old KpiCards replaced by ComparisonKpiCard"
```
