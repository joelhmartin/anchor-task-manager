# Report Builder — Phase 7+8+9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the report builder from "feature-complete for an internal tool" (Phases 1–6) to "comprehensive enterprise-grade." Add starter templates, an in-browser viewer, schedule preview + version diff, conditional formatting, better empty/loading states, bulk generate, ACLs, annotations, share links, and performance optimizations.

**Status when this plan was written:** branch `feature/report-builder-phase1` at HEAD `3e16cf9`, 63 commits since the spec. 14 widgets shipped, builder fully wired with multi-select / align / lock / undo-redo / autosave / version history, comparison fully threaded through, charts working in PDFs.

**Conventions (already established — every implementer must follow):**

- DB: `import { query } from '../../db.js'` (NOT `pool.query`)
- `file_uploads` columns: `owner_id`, `owner_type`, `original_name`, `content_type`, `size_bytes`, `bytes`, `category`
- React 19 auto-JSX — never `import React from 'react'`
- `SelectField` `onChange` passes the EVENT, not the value: `(e) => onChange(e.target.value)`
- Audit logging via `logSecurityEvent` from `server/services/security/audit.js` (table is `security_audit_log`)
- HIPAA: Meta widget rejects medical clients (no BAA); never `hidden_at IS NULL` in shared SQL (inbox-only)
- Verification = `yarn build` + `yarn lint` + manual smoke. No automated test suite.

**Where to look for X:**

| What | Where |
|---|---|
| Widget code | `src/views/admin/AdminHub/reports/widgets/<type>/` |
| Chart theme | `src/views/admin/AnalyticsDashboard/chartTheme.js` (`useChartTheme`, `PREMIUM_COLORS`, `getPremiumChartDefaults`, `getPremiumDonutDefaults`) |
| Filter resolver | `server/services/reports/filterResolver.js` |
| Hydration | `server/services/reports/reportRenderer.js` |
| PDF / CSV renderers | `server/services/reports/pdfRenderer.js`, `csvRenderer.js` |
| Routes | `server/routes/reports.js` |
| Builder shell | `src/views/admin/AdminHub/reports/ReportBuilder.jsx` |
| Properties panel | `src/views/admin/AdminHub/reports/PropertiesPanel.jsx` |
| Delta utility | `src/views/admin/AdminHub/reports/utils/delta.js` |
| Layout helpers | `src/views/admin/AdminHub/reports/utils/layoutHelpers.js` |

---

# Phase 7 — Templates & Sharing

## Task 7-A: Starter templates picker

**Files:**
- Create: `src/views/admin/AdminHub/reports/starterTemplates.js`
- Create: `src/views/admin/AdminHub/reports/StarterTemplateDialog.jsx`
- Modify: `src/views/admin/AdminHub/reports/ReportsList.jsx`
- Modify: `src/views/admin/AdminHub/reports/ReportBuilder.jsx`

**Goal:** "New Template" button opens a dialog with 5 pre-built starting points: Blank, Lead Insights (1 page), Quick KPIs (3×2 grid w/ sparklines + comparison), Full Marketing Report (3 pages), Traffic Deep-dive (1 page).

- [ ] **Step 1: Define starters**

`starterTemplates.js` exports `STARTER_TEMPLATES` array. Each entry `{ id, name, description, layout, filters_default }`. Layouts use `nanoid()` for widget ids and the established widget types/sizes. The "Blank" entry has `layout: null` (signals "use `emptyLayout()`").

Use `MARGIN = 32`, `PAGE = { w: 816, h: 1056 }`. Widget sizes from registry defaults. Helper `function w(type, x, y, width, height, props = {})` returns a properly-shaped widget object.

Five entries to define:

1. **Blank** — `layout: null`. Default filters.
2. **Lead Insights** (1 page): row of 4 KPI tiles (total_leads / qualified_leads / qualification_rate / total_calls), then `lead_source_breakdown` table 752×240, then `lead_activity_table` 752×320.
3. **Quick KPIs** (1 page): 3×2 grid of 240×140 KPI tiles. First row: total_leads / qualified_leads / qualification_rate (sparklines on first two). Second row: total_calls / total_forms / cpl. Comparison enabled (previous_period).
4. **Full Marketing Report** (3 pages): page 1 exec — `static_text_block` heading "Executive Summary", row of 4 KPI tiles (total_leads / qualification_rate / total_spend / ga4_sessions), `ai_insights_text` 752×280. Page 2 lead-side — `static_text_block` heading "Lead Performance", `lead_source_breakdown` 360×240 bar mode, `leads_by_day_table` 376×240 line mode, `utm_sources_table` 752×240. Page 3 ad-side — `static_text_block` heading "Paid Advertising", `google_ads_campaigns` table 752×240, `meta_campaigns` table 752×240, `ga4_traffic_summary` donut 752×280. Comparison enabled.
5. **Traffic Deep-dive** (1 page): heading, 2 KPI tiles (ga4_sessions 360×120, ga4_users 376×120), `ga4_traffic_summary` donut 752×240, `utm_sources_table` 360×240 + `leads_by_day_table` 376×240 line side by side.

- [ ] **Step 2: Build StarterTemplateDialog**

```jsx
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Card, CardActionArea, CardContent, Typography, Box } from '@mui/material';
import { STARTER_TEMPLATES } from './starterTemplates';

export default function StarterTemplateDialog({ open, onClose, onPick }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Choose a Starting Point</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2, py: 1 }}>
          {STARTER_TEMPLATES.map((t) => (
            <Card key={t.id} variant="outlined">
              <CardActionArea onClick={() => onPick(t)} sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600}>{t.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {t.description}
                  </Typography>
                  {t.layout && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontStyle: 'italic' }}>
                      {t.layout.pages.length} page{t.layout.pages.length === 1 ? '' : 's'} · {t.layout.pages.reduce((s, p) => s + p.widgets.length, 0)} widgets
                    </Typography>
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button></DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire ReportsList**

The "New Template" button (and the EmptyState button) currently calls `navigate('/admin/reports/new')`. Replace with `setStarterOpen(true)`. Add `<StarterTemplateDialog />` at the bottom of the JSX. The `onPick(starter)` handler navigates with `state: { starter }`:

```jsx
const handlePickStarter = (starter) => {
  setStarterOpen(false);
  if (!starter.layout) navigate('/admin/reports/new');
  else navigate('/admin/reports/new', { state: { starter } });
};
```

- [ ] **Step 4: Wire ReportBuilder to consume starter state**

```jsx
import { useLocation } from 'react-router-dom';
const location = useLocation();
const starter = location.state?.starter;

const [template, setTemplate] = useState({
  name: starter && starter.id !== 'blank' ? `New ${starter.name}` : '',
  description: starter?.description || '',
  filters_default: starter?.filters_default || {},
});
const layoutState = useUndoRedo(starter?.layout || emptyLayout());
```

Verify the existing `id`-based load `useEffect` doesn't run when `id` is undefined and `starter` is set — it shouldn't, since the effect early-returns on `if (!id) return`.

- [ ] **Step 5: Build + commit**

```bash
yarn build
git add src/views/admin/AdminHub/reports/starterTemplates.js src/views/admin/AdminHub/reports/StarterTemplateDialog.jsx src/views/admin/AdminHub/reports/ReportsList.jsx src/views/admin/AdminHub/reports/ReportBuilder.jsx
git commit -m "feat(reports): starter templates picker (5 layouts)"
```

---

## Task 7-B: Live in-browser report viewer

**Files:**
- Create: `src/views/admin/AdminHub/reports/ReportViewer.jsx`
- Modify: `src/routes/MainRoutes.jsx` (add route)
- Modify: `src/views/admin/AdminHub/reports/ReportsList.jsx` (add "View" button)

**Goal:** A new route `/admin/reports/generations/:id` renders the hydrated payload as a live React tree. Reuses widget components but wrapped in the AdminHub shell (so the user can navigate back, see breadcrumbs, etc.). No PDF download required.

- [ ] **Step 1: ReportViewer component**

```jsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Stack, Typography, Button, IconButton } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { reportsApi } from 'api/reports';
import { useToast } from 'contexts/ToastContext';
import ReportRendererPage from './ReportRendererPage';

import './widgets/kpiTile';
import './widgets/leadSourceBreakdown';
import './widgets/leadActivityTable';
import './widgets/leadsByDayTable';
import './widgets/utmSourcesTable';
import './widgets/googleAdsCampaigns';
import './widgets/metaCampaigns';
import './widgets/ga4TrafficSummary';
import './widgets/aiInsightsText';
import './widgets/staticTextBlock';
import './widgets/pageChrome';
import './widgets/dateRangeHeader';
import './widgets/image';
import './widgets/metricComparisonChart';

export default function ReportViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [generation, setGeneration] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // We need the FULL hydrated_payload. The current GET /generations/:id excludes it for HIPAA.
    // Options:
    //   (a) Add a NEW endpoint GET /generations/:id/payload that returns hydrated_payload
    //       behind isStaff auth (admin-only viewing — same auth as everything else)
    //   (b) Add ?include=payload query param to existing endpoint
    // Pick (a) for cleanliness.
    reportsApi.getGenerationPayload(id)
      .then(setGeneration)
      .catch((err) => showToast(err.response?.data?.error || 'Failed to load report', 'error'))
      .finally(() => setLoading(false));
  }, [id, showToast]);

  if (loading) return <Box sx={{ p: 4 }}><Typography>Loading…</Typography></Box>;
  if (!generation) return <Box sx={{ p: 4 }}><Typography>Report not found.</Typography></Box>;
  if (!generation.hydrated_payload) return (
    <Box sx={{ p: 4 }}>
      <Typography>Report data unavailable. Status: {generation.status}.</Typography>
      {generation.error_message && (
        <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block', fontFamily: 'monospace' }}>
          {generation.error_message}
        </Typography>
      )}
    </Box>
  );

  const handleDownload = async () => {
    const blob = await reportsApi.downloadGeneration(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report-${id}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ p: 1, borderBottom: '1px solid #eee' }}>
        <IconButton onClick={() => navigate('/admin/reports')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {generation.template_name || 'Report'} — {new Date(generation.generated_at).toLocaleString()}
        </Typography>
        {generation.pdf_file_id && (
          <Button startIcon={<DownloadIcon />} onClick={handleDownload}>Download PDF</Button>
        )}
      </Stack>
      <Box sx={{ p: 4, background: '#f8f8f8' }}>
        <ReportRendererPage payload={generation.hydrated_payload} />
      </Box>
    </Box>
  );
}
```

The `<ReportRendererPage payload={...} />` already exists (used by Puppeteer). It's the same component — same widgets, same layout — rendered live in the admin app instead of in the headless renderer.

- [ ] **Step 2: Backend endpoint for payload**

In `server/routes/reports.js`, add a new endpoint that returns the full row including `hydrated_payload`. Auth-gated (`isStaff` is already applied router-wide):

```js
router.get('/generations/:id/payload', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT g.id, g.template_id, g.template_version, g.client_ids, g.filters,
              g.status, g.error_message, g.description, g.pdf_file_id, g.csv_file_id,
              g.hydrated_payload, g.generated_by, g.generation_source,
              g.generated_at, g.completed_at, t.name AS template_name
       FROM report_generations g
       LEFT JOIN report_templates t ON t.id = g.template_id
       WHERE g.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[reports] get generation payload:', err);
    res.status(500).json({ error: 'Failed to get generation' });
  }
});
```

Add to `src/api/reports.js`:

```js
getGenerationPayload: async (id) => (await axios.get(`/api/reports/generations/${id}/payload`)).data,
```

- [ ] **Step 3: Add route**

`src/routes/MainRoutes.jsx`:
```jsx
const ReportViewer = Loadable(lazy(() => import('views/admin/AdminHub/reports/ReportViewer')));
// in routes:
{ path: 'admin/reports/generations/:id', element: <ReportViewer /> },
```

- [ ] **Step 4: ReportsList "View" button**

For complete generations, add a "View" button alongside "Download PDF":

```jsx
{r.status === 'complete' && (
  <Stack direction="row" spacing={0.5}>
    <Button size="small" onClick={() => navigate(`/admin/reports/generations/${r.id}`)}>View</Button>
    {r.pdf_file_id && <Button size="small" onClick={() => handleDownload(r.id)}>PDF</Button>}
    {r.csv_file_id && <Button size="small" onClick={() => handleDownloadCsv(r.id)}>CSV</Button>}
  </Stack>
)}
```

- [ ] **Step 5: Build + commit**

```bash
yarn build
git add server/routes/reports.js src/api/reports.js src/views/admin/AdminHub/reports/ReportViewer.jsx src/routes/MainRoutes.jsx src/views/admin/AdminHub/reports/ReportsList.jsx
git commit -m "feat(reports): in-browser report viewer at /admin/reports/generations/:id"
```

---

## Task 7-C: Schedule "next runs at" preview + version diff viewer

Two related polish features.

**Files:**
- Modify: `src/views/admin/AdminHub/reports/PropertiesPanel.jsx` (ScheduleEditor)
- Modify: `src/views/admin/AdminHub/reports/VersionHistoryDrawer.jsx`

### Schedule preview

- [ ] **Step 1: Add `nextRunAt` helper to layoutHelpers (or a new util)**

The same logic as `server/services/reports/scheduler.js`'s `nextRunAt` lives server-side. Mirror it client-side in `src/views/admin/AdminHub/reports/utils/scheduleNext.js`:

```js
export function nextRunAt(schedule, fromDate = new Date()) {
  if (!schedule?.freq) return null;
  const d = new Date(fromDate);
  const hour = schedule.hour ?? 9;
  d.setHours(hour, 0, 0, 0);
  if (schedule.freq === 'daily') {
    if (d <= fromDate) d.setDate(d.getDate() + 1);
    return d;
  }
  if (schedule.freq === 'weekly') {
    const day = schedule.day_of_week ?? 1;
    while (d.getDay() !== day || d <= fromDate) d.setDate(d.getDate() + 1);
    return d;
  }
  if (schedule.freq === 'monthly') {
    const dom = schedule.day_of_month ?? 1;
    d.setDate(dom);
    if (d <= fromDate) d.setMonth(d.getMonth() + 1);
    return d;
  }
  return null;
}

export function nextNRuns(schedule, n = 3) {
  if (!schedule) return [];
  const out = [];
  let cursor = new Date();
  for (let i = 0; i < n; i++) {
    const next = nextRunAt(schedule, cursor);
    if (!next) break;
    out.push(next);
    cursor = new Date(next.getTime() + 60 * 1000);  // +1 min so weekly/monthly advance
  }
  return out;
}
```

- [ ] **Step 2: Show next 3 runs in ScheduleEditor**

In `PropertiesPanel.jsx` `ScheduleEditor`, below the recipients section:

```jsx
import { nextNRuns } from './utils/scheduleNext';

// at the bottom of ScheduleEditor, before the closing Stack:
{(() => {
  const upcoming = nextNRuns(schedule, 3);
  if (upcoming.length === 0) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Next runs (your local time)
      </Typography>
      <Stack spacing={0.25}>
        {upcoming.map((d, i) => (
          <Typography key={i} variant="caption" sx={{ fontFamily: 'monospace' }}>
            {d.toLocaleString()}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
})()}
```

### Version diff viewer

- [ ] **Step 3: Diff utility**

`src/views/admin/AdminHub/reports/utils/versionDiff.js`:

```js
// Compute structural diff between two layouts — added, removed, moved widgets.
export function diffLayouts(prev, next) {
  const prevWidgets = new Map();
  for (const page of prev?.pages || []) for (const w of page.widgets || []) {
    prevWidgets.set(w.id, { ...w, _pageId: page.id });
  }
  const nextWidgets = new Map();
  for (const page of next?.pages || []) for (const w of page.widgets || []) {
    nextWidgets.set(w.id, { ...w, _pageId: page.id });
  }

  const added = [];
  const removed = [];
  const moved = [];
  const resized = [];
  const unchanged = [];

  for (const [id, w] of nextWidgets) {
    const p = prevWidgets.get(id);
    if (!p) { added.push(w); continue; }
    const positionChanged = p.x !== w.x || p.y !== w.y || p._pageId !== w._pageId;
    const sizeChanged = p.w !== w.w || p.h !== w.h;
    if (positionChanged) moved.push({ id, type: w.type, from: { x: p.x, y: p.y, page: p._pageId }, to: { x: w.x, y: w.y, page: w._pageId } });
    else if (sizeChanged) resized.push({ id, type: w.type, from: { w: p.w, h: p.h }, to: { w: w.w, h: w.h } });
    else unchanged.push(w);
  }
  for (const [id, w] of prevWidgets) {
    if (!nextWidgets.has(id)) removed.push(w);
  }

  const pageDiff = {
    pageCountDelta: (next?.pages?.length || 0) - (prev?.pages?.length || 0),
  };

  return { added, removed, moved, resized, unchanged, pageDiff };
}
```

- [ ] **Step 4: Show diff in VersionHistoryDrawer**

When a version is selected (other than current), fetch BOTH the selected version and the current layout, compute diff, and render a summary above the Restore button:

```jsx
import { diffLayouts } from './utils/versionDiff';

// Inside VersionHistoryDrawer, when selectedVersion changes, fetch the full version data:
const [selectedVersionData, setSelectedVersionData] = useState(null);
useEffect(() => {
  if (!selectedVersion || !templateId) { setSelectedVersionData(null); return; }
  reportsApi.getVersion(templateId, selectedVersion).then(setSelectedVersionData).catch(() => {});
}, [selectedVersion, templateId]);

// And the diff (assuming the prop `currentLayout` is passed in):
const diff = useMemo(() => {
  if (!selectedVersionData?.layout || !currentLayout) return null;
  return diffLayouts(selectedVersionData.layout, currentLayout);
}, [selectedVersionData, currentLayout]);

// Render the diff summary (added/removed/moved/resized counts) above the Restore button:
{diff && (
  <Box sx={{ mt: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
    <Typography variant="caption" color="text.secondary">Changes vs current</Typography>
    <Stack spacing={0.25} sx={{ mt: 0.5 }}>
      <Typography variant="caption">+ {diff.added.length} added</Typography>
      <Typography variant="caption">− {diff.removed.length} removed</Typography>
      <Typography variant="caption">↔ {diff.moved.length} moved</Typography>
      <Typography variant="caption">⤢ {diff.resized.length} resized</Typography>
      {diff.pageDiff.pageCountDelta !== 0 && (
        <Typography variant="caption">{diff.pageDiff.pageCountDelta > 0 ? '+' : ''}{diff.pageDiff.pageCountDelta} pages</Typography>
      )}
    </Stack>
  </Box>
)}
```

ReportBuilder needs to pass `currentLayout={layoutState.value}` to VersionHistoryDrawer.

- [ ] **Step 5: Build + commit**

```bash
yarn build
git add src/views/admin/AdminHub/reports/PropertiesPanel.jsx src/views/admin/AdminHub/reports/VersionHistoryDrawer.jsx src/views/admin/AdminHub/reports/utils/scheduleNext.js src/views/admin/AdminHub/reports/utils/versionDiff.js src/views/admin/AdminHub/reports/ReportBuilder.jsx
git commit -m "feat(reports): schedule next-runs preview + version diff summary"
```

---

# Phase 8 — Robustness

## Task 8-A: Conditional formatting on KPI tile

**Files:**
- Modify: `src/views/admin/AdminHub/reports/widgets/kpiTile/KpiTile.jsx`
- Modify: `src/views/admin/AdminHub/reports/widgets/kpiTile/KpiTilePropsForm.jsx`
- Modify: `src/views/admin/AdminHub/reports/widgets/kpiTile/index.js`

**Goal:** Admin can set thresholds on a KPI tile so the tile background or value color shifts based on value (good/warning/bad). Useful for "is this metric in range?" at-a-glance.

- [ ] **Step 1: Extend props**

Default props gain:
```js
thresholds: null,  // or { good_above: 100, warn_below: 50 }
threshold_target: 'value',  // 'value' (the big number) | 'background' | 'border'
```

- [ ] **Step 2: PropsForm — Thresholds section**

Add an Accordion (collapsed by default) with:
- Switch: enable thresholds
- TextField "Good if value ≥" (number)
- TextField "Bad if value ≤" (number, must be < good)
- SelectField "Apply to" with options Value / Background / Border

When `value.thresholds` is null and the user enables, default to `{ good_above: null, warn_below: null }`.

- [ ] **Step 3: Component — apply formatting**

```jsx
function resolveColor(value, thresholds) {
  if (!thresholds || typeof value !== 'number') return null;
  const { good_above, warn_below } = thresholds;
  if (typeof good_above === 'number' && value >= good_above) return 'success';
  if (typeof warn_below === 'number' && value <= warn_below) return 'error';
  return null;
}
```

In the Tile component, compute `colorState = resolveColor(numericValue, config.thresholds)`. Apply based on `config.threshold_target`:
- `'value'` → wrap the value Typography with `sx={{ color: theme => colorState ? theme.palette[colorState].main : undefined }}`
- `'background'` → tile container gets `bgcolor: colorState ? alpha(theme.palette[colorState].main, 0.1) : 'transparent'`
- `'border'` → `borderColor: colorState ? theme.palette[colorState].main : undefined`

For percent format metrics, the thresholds are read as decimals (0.5 = 50%). For currency metrics, dollar values. PropsForm helper text should clarify.

- [ ] **Step 4: Build + commit**

```bash
yarn build
git add src/views/admin/AdminHub/reports/widgets/kpiTile/
git commit -m "feat(reports): conditional formatting on KPI tile (thresholds → color)"
```

---

## Task 8-B: Empty states + loading skeletons

**Files:** several widget components + ReportBuilder canvas + ReportViewer

**Goal:** Replace blank/awkward "no data" rendering with proper empty states. Show skeletons during load.

- [ ] **Step 1: Shared EmptyData component**

`src/views/admin/AdminHub/reports/widgets/_shared/EmptyData.jsx`:

```jsx
import { Box, Typography } from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';

export default function EmptyData({ message = 'No data in this range', sx = {} }) {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', p: 2, ...sx }}>
      <InboxIcon sx={{ fontSize: 32, opacity: 0.4 }} />
      <Typography variant="caption" sx={{ mt: 1, fontStyle: 'italic' }}>{message}</Typography>
    </Box>
  );
}
```

- [ ] **Step 2: Update each widget to use it**

For each table/chart widget — when `data?.rows?.length === 0` (or equivalent: `data?.value == null` for KPI, `data?.text` empty for AI insights, etc.) AND `mode !== 'builder'`, render `<EmptyData />` instead of an empty table or zero-bar chart.

Example for `LeadSourceBreakdown.jsx`:
```jsx
if (!data?.error && (!view.rows || view.rows.length === 0) && mode !== 'builder') {
  return <EmptyData />;
}
```

Apply to: `lead_source_breakdown`, `lead_activity_table`, `leads_by_day_table`, `utm_sources_table`, `google_ads_campaigns`, `meta_campaigns`, `ga4_traffic_summary`, `metric_comparison_chart`. (KPI tile already shows `0` which is fine — don't change it.)

- [ ] **Step 3: Loading skeletons in builder canvas**

When the user opens an existing template, while the template is being fetched, show skeleton boxes in the canvas instead of the empty default layout. In `ReportBuilder.jsx`, add `loading` state, set true during the initial fetch, false after. While loading, render a `<Skeleton variant="rectangular" />` per widget bounding box.

(Keep this minimal — full skeletons per widget is overkill. A single skeleton for the whole canvas is fine.)

- [ ] **Step 4: Loading skeletons in ReportViewer**

When `loading=true`, render `<Skeleton variant="rectangular" width={816} height={1056} sx={{ margin: '0 auto' }} />` for each expected page (or just one if the template hasn't loaded yet — we don't know page count until then).

- [ ] **Step 5: Build + commit**

```bash
yarn build
git add src/views/admin/AdminHub/reports/widgets/ src/views/admin/AdminHub/reports/ReportBuilder.jsx src/views/admin/AdminHub/reports/ReportViewer.jsx
git commit -m "feat(reports): empty-state component for widgets + loading skeletons"
```

---

## Task 8-C: Bulk generate across multiple clients

**Files:**
- Modify: `src/views/admin/AdminHub/reports/GenerateDialog.jsx` (already supports multiple clients; ensure it loops correctly)
- Modify: `server/routes/reports.js` POST `/generations/bulk`
- Modify: `src/api/reports.js`
- Modify: `src/views/admin/AdminHub/reports/ReportsList.jsx` (show progress for bulk runs)

**Goal:** Admin can pick a template and click "Generate for All Clients" to fire one generation per client with one click. Each generation runs as its own row; the queue handles concurrency.

- [ ] **Step 1: Backend bulk endpoint**

```js
router.post('/generations/bulk', async (req, res) => {
  try {
    const { template_id, client_ids, filters, output_format } = req.body || {};
    if (!template_id) return res.status(400).json({ error: 'template_id required' });
    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({ error: 'client_ids must be a non-empty array' });
    }

    const tmplRes = await query(`SELECT * FROM report_templates WHERE id = $1`, [template_id]);
    const template = tmplRes.rows[0];
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const versionRes = await query(
      `SELECT MAX(version) AS v FROM report_template_versions WHERE template_id = $1`,
      [template_id]
    );
    const version = versionRes.rows[0]?.v || 1;

    const generations = [];
    const fmt = output_format || 'pdf';
    for (const clientId of client_ids) {
      const ins = await query(
        `INSERT INTO report_generations
           (template_id, template_version, client_ids, filters, generated_by, generation_source, status, output_format)
         VALUES ($1, $2, $3::uuid[], $4::jsonb, $5, 'manual', 'pending', $6)
         RETURNING id, status`,
        [template_id, version, [clientId], JSON.stringify(filters || {}), req.user.id, fmt]
      );
      const gen = ins.rows[0];
      generations.push(gen);

      enqueueGenerationJob(async () => {
        // Same body as the single-generation handler — extract this into a helper.
        // ... see existing /generations route handler ...
      });
    }

    res.status(202).json({ generations });
  } catch (err) {
    console.error('[reports] bulk generation:', err);
    res.status(500).json({ error: 'Failed to create bulk generations' });
  }
});
```

Refactor: extract the queue-job body into a shared helper `runGenerationJob(generationId, template, version, clientIds, filters, fmt, userId)` so both `/generations` and `/generations/bulk` use the same code path.

- [ ] **Step 2: Frontend API client**

`src/api/reports.js`:
```js
createBulkGenerations: async (body) => (await axios.post('/api/reports/generations/bulk', body)).data,
```

- [ ] **Step 3: GenerateDialog — bulk option**

Add a Switch "Generate one report per client" (visible only when ≥2 clients selected). When on, submit calls `createBulkGenerations` instead of a single `createGeneration` with all client_ids in the array.

When off and multiple clients are selected, the existing behavior produces one rollup report (current). Both modes are useful.

- [ ] **Step 4: ReportsList — bulk progress**

When a bulk run is fired (which produces N generations in quick succession), the existing list view already shows them all. The polling code already handles "any in-flight" — no special bulk progress is needed.

For better UX: optionally group consecutive bulk runs in the list (same template_id + same minute window). Skip this in v1 — it's not necessary.

- [ ] **Step 5: Build + commit**

```bash
yarn build
git add server/routes/reports.js src/api/reports.js src/views/admin/AdminHub/reports/GenerateDialog.jsx
git commit -m "feat(reports): bulk generation endpoint + per-client mode in dialog"
```

---

# Phase 9 — Enterprise (optional, layered)

These are real enterprise features. Each one is independently shippable.

## Task 9-A: Per-template ACL

**Goal:** Restrict who can edit a template. Some templates are owned by one admin and shouldn't be edited by another.

**Schema change:** Add `editable_by_user_ids UUID[]` and `viewable_by_user_ids UUID[]` to `report_templates`. Empty array = inherits "all staff." Migration: `migrate_report_template_acl.sql`.

**Frontend:** Properties panel gets a "Sharing" section listing users who can edit / view. User picker via `Autocomplete` against `/api/hub/users?role=staff`.

**Backend:** PATCH route checks `req.user.id` is in `editable_by_user_ids` (or array empty); GET route checks `viewable_by_user_ids`. Generation route uses `viewable_by_user_ids`.

Estimated: 1 dispatch, ~2 hours.

## Task 9-B: Annotations on generations

**Goal:** Reviewer/admin can leave comments on a generation ("This week's spike was due to a viral post — note for client").

**Schema change:** New table `report_generation_annotations(id, generation_id, body, created_by, created_at)`.

**Backend:** POST `/generations/:id/annotations`, GET `/generations/:id/annotations`, DELETE.

**Frontend:** ReportViewer has a sidebar/footer with the annotation list + a "Add note" form. Annotations not shown in PDFs (admin-only context).

Estimated: 1 dispatch.

## Task 9-C: Public share links (read-only)

**Goal:** Generate a tokenized URL for a generation that allows non-logged-in users (e.g. a client) to view the report without an account.

**Schema:** `report_share_links(id UUID, generation_id, token TEXT UNIQUE, expires_at, created_by)`. Token is HMAC-signed similar to `signedToken.js`, but with longer TTL (configurable, default 30 days).

**Backend:** POST `/generations/:id/share` returns `{token, url}`. GET `/share/:token` validates and returns the same shape as `/generations/:id/payload`. No auth on this route — token is the auth.

**Frontend:** ReportViewer has a "Share" button that opens a dialog with the URL + copy-to-clipboard + expiration controls.

**HIPAA note:** Share links carry PHI in the rendered report. They MUST: (a) require the recipient to log in if the client is medical, OR (b) only share PDFs not the live data path, OR (c) be disabled for medical clients entirely. Pick (c) for v1 — don't allow share links on medical-client templates.

Estimated: 2 dispatches (security review for the share link + HIPAA gate is non-trivial).

## Task 9-D: Audit trail expansion

**Goal:** More granular audit logging — track template edits, share-link creation, annotation creation, deletes.

**Backend:** Wrap existing route handlers with `logSecurityEvent` calls. Add `event_type` constants for each action.

Estimated: 1 dispatch.

## Task 9-E: Performance — virtualize the canvas + lazy-load widgets

**Goal:** A template with 50+ widgets shouldn't slow the builder. Virtualize the canvas so only visible widgets render. Lazy-load widget components (`React.lazy`).

**Frontend:** Use `react-window` or similar for the widget list. Each widget is wrapped in `React.lazy` so its bundle is only loaded when needed.

**Caveat:** absolute positioning + virtualization is hard. The widget list is already absolute-positioned, so we'd need to compute viewport intersection and render only widgets that overlap. May not be worth it until we hit a real performance issue.

Estimated: 2 dispatches if pursued; recommend SKIPPING until users complain.

---

# Self-review notes

**Spec coverage check:**
- All Phase 7 + 8 items match the original "remaining work" list from the previous session.
- Phase 9 items are layered additions, not in the original phases. Each is independently shippable and optional.

**Type consistency:**
- `getGenerationPayload` (new API method) consistent across 7-A, 7-B.
- `runGenerationJob` (extracted helper) named consistently between bulk and single endpoints.
- `EmptyData` component name consistent across all widget updates in 8-B.

**Caveats engineer must verify at runtime:**
- `viewable_by_user_ids` check in 9-A might collide with the existing `isStaff` middleware — make sure the new check goes AFTER auth, not before
- The bulk endpoint's queue worker (8-C) needs to use the SAME refactored `runGenerationJob` helper as the single endpoint to avoid drift
- Share link token (9-C) reuses `crypto.timingSafeEqual` pattern from `signedToken.js`

**Branch state at plan write time:** `feature/report-builder-phase1` at `3e16cf9`. 63 commits since spec.
