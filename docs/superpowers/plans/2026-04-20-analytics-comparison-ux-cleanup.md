# Analytics Comparison + UX Cleanup

> Status as of 2026-04-20: Plan reflects what is **left** to do after the snapshot
> commit `149e661 feat(analytics): comparison cards + meta restructure (snapshot)`.
> Group-mode comparison charts, ComparisonKpiCard deltas, MetricDefinitionStrip,
> per-campaign deltas in Meta/Google views, and Google Ads status filter are
> already in place from prior work.

## Goal
Make comparison mode first-class everywhere in analytics, remove weak/duplicative
visuals, standardize chart copy and KPI card layout, and replace the busy daily
combo chart with a cumulative pacing summary.

## Audit (current state vs. plan)

| Item | Status |
|------|--------|
| Group comparison charts | ✅ done (Overview/Paid/Traffic/Calls) |
| MetricDefinitionStrip | ✅ done |
| ComparisonKpiCard deltas (overview) | ✅ done |
| Per-campaign deltas (Meta cards, Google table) | ✅ done |
| Calls KPI card deltas | ✅ done |
| Google Ads status filter | ✅ done |
| Hide FunnelChart | ❌ still rendered in `OverviewTab.jsx:429` |
| Remove Spend by Campaign (Meta) | ❌ still rendered in `MetaAdsView.jsx:289-313` |
| Remove Spend by Campaign (Google) | ❌ still rendered in `GoogleAdsView.jsx:514-533` |
| Meta status filter (Active/Paused/Removed) | ❌ missing |
| Meta account-level KPI deltas | ❌ no comparison wired up to account KPIs |
| Google account-level KPI deltas | ❌ no comparison wired up to account KPIs |
| Replace TimeSeriesChart with PacingSummary | ❌ daily combo still rendered |
| Outcome-based bar coloring (good=green, bad=red) | ❌ uses neutral grey for comparison |
| Tooltip with current/comparison/delta | ❌ tooltips show value only |
| Per-ChartCard one-sentence descriptors | ❌ most cards have no `subtitle` |
| Standardized KPI card heights | ❌ Meta uses 1.5p `Paper`, Calls uses 2.5p `KpiCard`, Overview different |
| Single-client categorical chart comparison | ❌ LeadSources, AdPerformance, top pages, CallSummary, rating, lead type, volume, duration, source tables |
| Centralized metric polarity config | ❌ duplicated across files |

## Execution order (commit per phase)

### Phase 1 — Surgical removals (lowest risk, immediate UX win)
- Hide `FunnelChart` from `OverviewTab` single-client path. Keep import + code.
- Remove `Spend by Campaign` chart block from `MetaAdsView`.
- Remove `Spend by Campaign` chart block from `GoogleAdsView`.

### Phase 2 — Shared comparison utilities (foundation)
Create `src/views/admin/AnalyticsDashboard/analyticsComparison.js`:
- `METRIC_POLARITY` map (key → `{ label, upIsGood, format }`)
- `getOutcomeColor(theme, current, comparison, upIsGood)` → returns palette color or neutral when no comparison
- `buildComparisonBarColors(theme, currentSeries, comparisonSeries, upIsGood, baseColor)` → per-bar color array for distributed bar charts
- `buildComparisonTooltip({ formatter, labels, currentSeries, comparisonSeries })` → custom tooltip with value, prev, delta %
- `formatDelta(current, comparison, upIsGood)` → `{ percent, isImproved, isWorse, sign }`

### Phase 3 — Meta + Google account-level KPI deltas + Meta status filter
- `MetaAdsView`: add `ToggleButtonGroup` (All/Active/Paused/Removed) above campaign cards; filter `data` like Google does.
- `MetaAdsView`: thread `comparisonAccountMetrics` through and add delta caption to each account KPI tile.
- `GoogleAdsView`: thread `comparisonAccountMetrics` through and add delta caption to each account KPI tile.

### Phase 4 — Standardized KPI card
Extract a single `AccountKpiCard` component used by Meta, Google, Calls (account-level), so all account-level KPI rows share spacing/height/delta render.

### Phase 5 — Replace TimeSeriesChart with PacingSummary on Overview
- New `PacingSummary.jsx`:
  - Headline: MTD (or selected-range) spend, qualified leads, CPQL plus comparison.
  - Cumulative chart: x-axis = elapsed days, two series (current, comparison) for qualified leads, with CPQL shown as a secondary stat strip per current/comparison.
- Stop rendering `TimeSeriesChart` inside Overview. Leave the file/import path intact for the Paid view if it's reused later, otherwise leave commented/dormant.

### Phase 6 — Outcome-based coloring + delta tooltips on group comparison charts
- Update group `makeHorizontalBarOptions` in `OverviewTab`, `PaidAdsTab`, `TrafficTab`, `CallsLeadsTab` to:
  - Color current bars per metric polarity vs comparison (green improved, red regressed).
  - Use `buildComparisonTooltip` so hover shows current / previous / Δ%.

### Phase 7 — One-sentence ChartCard descriptors
- Audit every `<ChartCard title="...">` and add a `subtitle` describing the metric in plain language (NOT chart mechanics).

### Phase 8 — Single-client categorical comparison

**Done in 2026-04-20 pass:**
- Single-client Overview: `LeadSourcesChart`, `AdPerformanceChart`, Top Landing Pages list (delta), `CallSummaryCard` (delta beneath each stat).
- Single-client Traffic: delta on `Source / Medium` and `Landing Pages` tables; Device Breakdown shows Current/Previous total chips.
- Single-client Calls: paired Current/Comparison bars on Rating Breakdown and Call Duration Distribution; Lead Type donut shows Current/Previous total chips; Volume chart shows period-total comparison chips above; Source Attribution table gains per-row delta.

**Notes / still parked:**
- Group Calls comparison charts (rating/category) — would require extending `fetchGroupCallsLeads` comparison branch to surface ratings/categories/etc per period; not requested by users yet.
- Volume / Pacing charts intentionally keep their daily x-axis for the current period; comparison context is shown via period-total chips rather than overlaid daily series, since comparison ranges generally have a different number of days and overlaying produces noisy charts.

### Phase 9 — Verification
- `yarn build` clean.
- `yarn lint` clean (allowing project's existing baseline warnings).
- Manual smoke: open `/analytics`, single-client mode (Joel Dental), and group/custom modes with comparison enabled. Hit each tab. Confirm pacing chart, no Spend by Campaign, no funnel, working Meta status filter, descriptors visible, KPI card heights consistent.

## Notes / assumptions
- "Outcome-based" coloring is per-bar: each Current bar is colored relative to its own Comparison value.
- Donut charts keep their existing palette but always show explicit current/comparison total chips when comparison is enabled.
- Funnel and removed charts stay in source as commented-out blocks (or the imports/files preserved) so a later iteration can revive them.
- We will commit after each phase to keep changes reviewable and rollback-safe.
