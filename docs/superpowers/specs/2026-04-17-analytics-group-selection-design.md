# Analytics Group Selection — Implementation Spec

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Add multi-client/group selection to analytics dashboard and reports

## Overview

Add a shared analytics selection layer that supports single client, client group, or custom subset selection. Every chart, KPI, and report resolves through this layer. The selection object is canonical — dashboard and reports use the same schema.

## Selection Object Schema

```typescript
interface AnalyticsSelection {
  mode: 'single' | 'group' | 'custom';
  userId: string | null;       // for mode=single
  groupId: string | null;      // for mode=group
  includedUserIds: string[];   // for mode=custom, or resolved members for group
  excludedUserIds: string[];   // manual exclusions from a group
}
```

**Resolution rules:**
- `single`: use `userId` directly
- `group`: resolve all members of `groupId` from `client_groups` + `client_profiles.client_group_id`, subtract `excludedUserIds`
- `custom`: use `includedUserIds` directly

## API Contracts

### Selection Options

**GET /analytics/selection-options**

Returns clients, groups, and platform coverage for the selector UI.

```json
{
  "clients": [
    {
      "user_id": "uuid",
      "first_name": "...",
      "last_name": "...",
      "client_group_id": "uuid|null",
      "has_ga4": true,
      "has_meta": false,
      "has_google_ads": true,
      "has_ctm": true
    }
  ],
  "groups": [
    {
      "id": "uuid",
      "name": "Ortho Group",
      "color": "#...",
      "member_count": 12
    }
  ]
}
```

### Selection-Based Analytics

New POST endpoints accept the selection object in the body. Old GET `/:userId/...` routes remain as thin wrappers.

**POST /analytics/overview**
```json
{
  "selection": { "mode": "group", "groupId": "uuid", "excludedUserIds": [] },
  "start": "2026-03-17",
  "end": "2026-04-16"
}
```

Response adds coverage metadata:
```json
{
  "kpis": { ... },
  "byPlatform": { ... },
  "timeSeries": [ ... ],
  "coverage": {
    "totalSelected": 12,
    "withGA4": 10,
    "withMeta": 8,
    "withGoogleAds": 7,
    "withCTM": 12,
    "failed": ["uuid1"],
    "resolvedUserIds": ["uuid1", "uuid2", ...]
  },
  "errors": [ ... ]
}
```

Same pattern for:
- **POST /analytics/traffic**
- **POST /analytics/calls-leads**
- **POST /analytics/funnel**
- **POST /analytics/insights**

### Reports

Report template `config.selection` replaces `config.userId`:
```json
{
  "selection": { "mode": "group", "groupId": "uuid", "excludedUserIds": [] },
  "sections": ["executive_summary", "meta_ads", ...],
  "dateRangeType": "rolling_30d",
  "includeComparison": true,
  "reportMode": "rollup_only"
}
```

`reportMode` options:
- `rollup_only` — aggregate numbers only
- `rollup_plus_client_appendix` — aggregate + per-client breakdown pages

Generated reports store snapshots:
```sql
ALTER TABLE analytics_generated_reports
  ADD COLUMN selection_snapshot JSONB,
  ADD COLUMN coverage_snapshot JSONB;
```

## Backend: Selection Resolver

**New file: `server/services/analytics/selectionResolver.js`**

```javascript
export async function resolveAnalyticsSelection(selection) {
  // Returns { userIds: string[], label: string, coverage: {...} }
}
```

Resolution logic:
- `single`: `[selection.userId]`, label = client name
- `group`: query `client_profiles WHERE client_group_id = $1`, subtract `excludedUserIds`, label = group name + count
- `custom`: `selection.includedUserIds`, label = "Custom (N clients)"

After resolving userIds, batch-query tracking_configs and client_profiles to build coverage metadata.

## Backend: Group Aggregation Service

**New file: `server/services/analytics/groupAnalytics.js`**

```javascript
export async function fetchGroupAnalytics(userIds, startDate, endDate, concurrency = 3) {
  // Fetch per-client analytics with concurrency limit
  // Merge into aggregate with correct math
  // Return { kpis, byPlatform, timeSeries, perClient, coverage }
}
```

### Merge Rules (Critical)

**Never average percentages or averages across clients.** Recompute from raw totals.

| Metric | Merge Rule |
|--------|-----------|
| totalLeads | SUM of each client's qualifiedCalls |
| totalSpend | SUM of each client's (meta.spend + google.spend) |
| costPerLead | totalSpend / totalLeads (recomputed) |
| totalSessions | SUM of each client's ga4.sessions |
| conversionRate | totalLeads / totalSessions * 100 (recomputed) |
| CTR | totalClicks / totalImpressions * 100 (recomputed) |
| CPC | totalSpend / totalClicks (recomputed) |
| bounceRate | weighted average by sessions (recomputed) |
| avgDuration | totalDurationSec / answeredCalls (recomputed) |

**Time series merge:** Sum by date across all clients. Fill missing dates with zeros per client before summing.

**Source/medium merge:** Aggregate by (source, medium) key across clients. Sum sessions, users, conversions.

**Landing pages:** Aggregate by page path across clients. Sum sessions, recompute bounce rate weighted by sessions.

**Call sources:** Aggregate by source across clients. Sum total, calls, forms, qualified. Recompute qualifiedRate.

### Paid Ads: Do NOT Merge Campaigns

Campaigns across different clients are NOT merged by name. In multi-client mode:

- First level = client selector (which client's campaigns to view)
- Or flat list with client name prefix: `[Bell Road] Brand Search | [TMJ NT] Awareness`
- Campaign IDs are unique per account, so `(userId, campaignId)` is the natural key

### Concurrency Control

Use a semaphore for parallel API calls. GA4 and ad platform APIs have rate limits.

```javascript
async function withConcurrency(tasks, limit = 3) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r; });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.allSettled(results);
}
```

## Frontend: AnalyticsSelectionControl

**New file: `src/views/admin/AnalyticsDashboard/AnalyticsSelectionControl.jsx`**

Shared component used in both dashboard header and report create dialog.

### UI States

**Mode: Single** (default, current behavior)
- Standard SelectField dropdown with client list
- Same as today

**Mode: Group**
- Group dropdown (from client_groups)
- Shows member count
- Expandable chip list showing all members with checkboxes
- Deselect individual members → adds to excludedUserIds
- Summary: "Ortho Group (10 of 12 selected)"

**Mode: Custom**
- Multi-select client list with checkboxes
- Search/filter
- "Select All" / "Clear" buttons
- Summary: "8 clients selected"

### Layout

```
[Single ▾] [Group ▾] [Custom ▾]   ← mode toggle (ToggleButtonGroup)
[Client: Bell Road Dentistry ▾]    ← mode=single
[Group: Ortho (10/12) ▾] [🔽]     ← mode=group, expandable member list
[8 clients selected ▾]             ← mode=custom, expandable checklist
```

Compact enough for the dashboard header. Same component opens in a dialog for report creation.

### Props

```typescript
interface AnalyticsSelectionControlProps {
  selection: AnalyticsSelection;
  onChange: (selection: AnalyticsSelection) => void;
  clients: Client[];
  groups: Group[];
  compact?: boolean; // true for dashboard header, false for report dialog
}
```

## Dashboard Integration

### index.jsx Changes

Replace `selectedClient` state with `selection` state:

```javascript
const [selection, setSelection] = useState({ mode: 'single', userId: null, ... });
```

The `loadData` function changes:
- `single`: call existing GET `/:userId/overview` (no change)
- `group`/`custom`: call new POST `/analytics/overview` with selection body

All tabs receive `selection` instead of `userId`. Tabs that need per-client data for drilldown can access `selection.userId` in single mode or show client-level breakdown in multi mode.

### Tab Behavior in Multi-Client Mode

| Tab | Single Client | Multi-Client |
|-----|--------------|-------------|
| Overview | Same as today | Roll-up KPIs + "Top Clients" contribution table |
| Paid Ads | Campaign drill-down | Client selector first, then campaign drill-down per client |
| Traffic | Source/medium/pages tables | Aggregated tables with "Per-client avg" toggle |
| Calls & Leads | CTM analytics | Aggregated with source drill-in by client |
| Reports | Single client reports | Group/custom reports with optional appendix |
| Settings | Connection status | Coverage matrix (clients × platforms) |

## Database Changes

### Migration: `server/sql/migrate_analytics_selection.sql`

```sql
-- Add selection snapshot columns to generated reports
ALTER TABLE analytics_generated_reports
  ADD COLUMN IF NOT EXISTS selection_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS coverage_snapshot JSONB;

-- Ensure client_groups table exists (may already be in init.sql)
CREATE TABLE IF NOT EXISTS client_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Phased Rollout

### Phase 1: Foundation
- Fix funnel query (done)
- Fix reports list subject labeling (done)
- Add `GET /analytics/selection-options` endpoint
- Build `resolveAnalyticsSelection()` service
- Build `AnalyticsSelectionControl` component
- Replace single-client selector in dashboard header (backward compatible — starts in single mode)

### Phase 2: Aggregation Backend
- Build `fetchGroupAnalytics()` with correct merge rules
- Add `POST /analytics/overview` endpoint (selection-based)
- Add `POST /analytics/traffic`, `POST /analytics/calls-leads`, `POST /analytics/funnel`
- Add coverage metadata to all responses

### Phase 3: Dashboard Integration
- Migrate Overview tab to handle multi-client roll-ups
- Add "Top Clients" contribution table in multi mode
- Migrate Traffic and Calls & Leads tabs
- Paid Ads: add client-level view before campaign drill-down

### Phase 4: Reports Integration
- Update report template config to use `selection` instead of `userId`
- Update `AnalyticsSelectionControl` in report create dialog
- Add `reportMode` toggle (rollup only / rollup + client appendix)
- Store selection and coverage snapshots on generated reports
- Update PDF generator for multi-client structure

### Phase 5: Hardening
- Concurrency limits for group API calls
- Caching layer for frequently-requested group aggregates
- Tests for selection resolution, metric recomputation, partial failures
- Handle mixed currencies (flag in coverage metadata)

## Risks

| Risk | Mitigation |
|------|-----------|
| Mixed currencies across ad accounts | Flag in coverage, don't sum spend across currencies |
| Partial platform coverage distorts charts | Coverage metadata shown prominently, missing clients noted |
| Averaging client-level rates | All rates recomputed from raw totals server-side |
| Campaign name collisions | Key by (userId, campaignId), show client prefix in multi mode |
| Dynamic group membership vs reproducibility | Snapshot resolved userIds on every generated report |
| API rate limits with large groups | Concurrency semaphore (3 parallel), background generation for 10+ clients |
