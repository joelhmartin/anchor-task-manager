# Feature: Dashboard Widget Engine (TM-019)

## Problem

The current home pane only shows an AI-generated daily overview with text-based summaries. There are no visual dashboards, no charts, and no way to aggregate data across multiple boards. The existing board reports endpoint returns raw counts but there is no UI for configuring or displaying widgets. Users cannot build custom dashboards showing KPIs, charts, or filtered views from their boards.

### Current State

| Feature | Implementation |
|---------|---------------|
| Home pane | AI daily overview (text summary, todo list, mentions) |
| Board reports | `POST /tasks/reports/boards` returns status counts per board |
| Billing reports | `POST /tasks/reports/billing` returns time entries by category |
| Charts | None |
| Custom dashboards | None |

## Solution

Add a dashboard system where users create named dashboards containing configurable widgets. Widgets pull data from one or more boards with filters. Start with 5 core widget types that cover the most common reporting needs.

## Prerequisites

- **TM-014**: Event Bus (widgets can subscribe to real-time updates)
- **TM-017**: Board Views (shared view config for filtered data)

---

## Data Model

### New tables

```sql
-- User-created dashboards
CREATE TABLE IF NOT EXISTS task_dashboards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- layout: [{ widget_id, x, y, w, h }] — grid positions
  is_default BOOLEAN NOT NULL DEFAULT FALSE,  -- workspace default dashboard
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_dashboards_workspace
  ON task_dashboards (workspace_id);

-- Individual widgets on a dashboard
CREATE TABLE IF NOT EXISTS task_dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dashboard_id UUID NOT NULL REFERENCES task_dashboards(id) ON DELETE CASCADE,
  widget_type TEXT NOT NULL,  -- 'chart' | 'number' | 'battery' | 'table' | 'timeline'
  title TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- config schema varies by widget_type (see below)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_dashboard_widgets_dashboard
  ON task_dashboard_widgets (dashboard_id);
```

### Layout Grid System

Dashboards use a 12-column responsive grid. Each widget has:

| Field | Type | Description |
|-------|------|-------------|
| `widget_id` | UUID | Reference to task_dashboard_widgets |
| `x` | int | Column position (0-11) |
| `y` | int | Row position |
| `w` | int | Width in columns (1-12) |
| `h` | int | Height in rows (1-4) |

Layout stored as JSONB array in `task_dashboards.layout`.

---

## Widget Types

### 1. Chart Widget

Bar, line, pie, or stacked bar chart from board data.

**Config:**
```json
{
  "chart_type": "bar",
  "board_ids": ["uuid1", "uuid2"],
  "x_axis": "status",
  "y_axis": "count",
  "filters": {
    "status": ["To Do", "Working on it"],
    "assignee_ids": ["uuid"],
    "date_range": { "field": "due_date", "start": "2026-01-01", "end": "2026-03-31" }
  },
  "group_by": "board",
  "colors": "status"
}
```

**Supported chart types:** `bar`, `line`, `pie`, `stacked_bar`, `donut`

**Data axes:**
- X: `status`, `assignee`, `group`, `board`, `date_week`, `date_month`
- Y: `count`, `sum_time_minutes`, `sum_billable_minutes`

### 2. Number Widget

Single KPI value with optional comparison.

**Config:**
```json
{
  "board_ids": ["uuid"],
  "metric": "count",
  "filters": { "status": ["Done"] },
  "comparison": {
    "type": "previous_period",
    "period": "month"
  },
  "format": "number",
  "suffix": "items"
}
```

**Metrics:** `count`, `sum_time_minutes`, `sum_billable_minutes`, `percent_done`

**Display:** Large number + comparison arrow (up/down with percentage change).

### 3. Battery Widget

Status distribution as a horizontal stacked bar (like monday.com's battery).

**Config:**
```json
{
  "board_ids": ["uuid1", "uuid2"],
  "filters": {},
  "show_labels": true,
  "show_percentages": true
}
```

**Display:** Colored segments proportional to item count per status. Labels below.

### 4. Table Widget

Filtered item list from one or more boards.

**Config:**
```json
{
  "board_ids": ["uuid1"],
  "columns": ["name", "status", "assignees", "due_date", "board_name"],
  "filters": {
    "needs_attention": true,
    "due_date": { "operator": "lte", "value": "today+7d" }
  },
  "sort": { "field": "due_date", "direction": "asc" },
  "limit": 20
}
```

**Display:** DataTable component (existing shared component) with configured columns and filters.

### 5. Timeline Widget

Mini Gantt view of items from selected boards.

**Config:**
```json
{
  "board_ids": ["uuid"],
  "zoom_level": "month",
  "group_by": "board",
  "filters": {}
}
```

**Display:** Simplified version of TimelineView (TM-017) rendered in widget size.

---

## Data Aggregation API

### New Endpoint: Widget Data

**POST `/dashboards/widgets/:widgetId/data`** (or for previewing: **POST `/dashboards/widget-preview`**)

Takes widget config, returns aggregated data:

```js
// For chart widget (bar chart, x=status, y=count)
{
  "data": [
    { "label": "To Do", "value": 12, "color": "#C4C4C4" },
    { "label": "Working on it", "value": 8, "color": "#FDAB3D" },
    { "label": "Done", "value": 25, "color": "#00C875" }
  ],
  "total": 45
}

// For number widget
{
  "value": 25,
  "comparison": { "previous_value": 18, "change_percent": 38.9, "direction": "up" }
}

// For battery widget
{
  "segments": [
    { "status": "To Do", "count": 12, "percent": 26.7, "color": "#C4C4C4" },
    { "status": "Working on it", "count": 8, "percent": 17.8, "color": "#FDAB3D" },
    { "status": "Done", "count": 25, "percent": 55.6, "color": "#00C875" }
  ],
  "total": 45
}
```

**Backend aggregation query pattern:**
```sql
SELECT
  COALESCE(bsl.label, i.status) as status_label,
  COALESCE(bsl.color, '#C4C4C4') as color,
  COUNT(*) as count
FROM task_items i
JOIN task_groups g ON g.id = i.group_id
LEFT JOIN task_board_status_labels bsl
  ON bsl.board_id = g.board_id AND bsl.label = i.status
WHERE g.board_id = ANY($1::uuid[])
  AND i.archived_at IS NULL
  -- apply filters
GROUP BY status_label, color
ORDER BY count DESC
```

---

## API Endpoints

### Dashboard CRUD

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workspaces/:id/dashboards` | List dashboards |
| POST | `/workspaces/:id/dashboards` | Create dashboard |
| GET | `/dashboards/:id` | Get dashboard with widgets and layout |
| PATCH | `/dashboards/:id` | Update dashboard (name, description, layout) |
| DELETE | `/dashboards/:id` | Delete dashboard |

### Widget CRUD

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/dashboards/:id/widgets` | Add widget |
| PATCH | `/dashboard-widgets/:id` | Update widget config |
| DELETE | `/dashboard-widgets/:id` | Remove widget |
| POST | `/dashboard-widgets/:id/data` | Fetch widget data |
| POST | `/dashboards/widget-preview` | Preview widget data without saving |

---

## UI Changes

### DashboardPane.jsx (new pane)

Add "Dashboards" to sidebar navigation (alongside Home, Boards, My Work, etc.).

```
+-- Dashboard: [Project Overview ▼]  [+ New Dashboard]  [Edit Layout]
|
|   +-- [Chart: Tasks by Status]        [Number: Completed This Month]
|   |   ██████████████                  25
|   |   ████████████                    ↑ 38% vs last month
|   |   ████████
|   |
|   +-- [Battery: Overall Progress]     [Table: Items Due This Week]
|   |   ████████████████░░░░░░░░        Name    Status    Due    Assignee
|   |   Done 56%  Working 18%  To Do 26%   ...     ...    ...    ...
```

**Edit Layout Mode:**
- Grid becomes editable (drag to move, resize handles)
- Widget config panel opens on click
- "Add Widget" button shows widget type selector
- Save/Cancel layout changes

### Widget Config Panel

Slide-out panel when editing a widget:

```
+-- Widget Type: [Chart ▼]
+-- Title: [____________]
+-- Boards: [Board 1 ✓] [Board 2 ✓] [Board 3]
+-- Chart Type: [Bar ▼]
+-- X Axis: [Status ▼]
+-- Y Axis: [Count ▼]
+-- Filters:
|   +-- Status: [Working on it] [Stuck]
|   +-- Assignee: [John] [Jane]
|   +-- Date Range: [This Month ▼]
+-- [Preview]
+-- [Save]
```

### HomePane.jsx

Keep the existing AI daily overview. Add an optional "pinned widgets" section below it that can show 1-2 widgets from any dashboard.

---

## Charting Library

Use **Recharts** (React-native charting library built on D3):
- Already React-compatible (no wrapper needed)
- Declarative API
- Responsive containers
- ~45KB gzipped
- Supports: bar, line, pie, area, stacked, donut

No other charting dependency needed.

---

## Permission Model

- Dashboards are workspace-scoped — any workspace member can view
- Only dashboard creator (or workspace admin) can edit layout/widgets
- Widget data respects board-level permissions — if user can't view a board, widget shows "No access" for that board's data
- RBAC check (TM-016): `board.view` required for each board referenced in widget

---

## Migration Strategy

### Phase A: Dashboard + Number/Battery Widgets
1. Create DB tables
2. Implement dashboard CRUD endpoints
3. Build DashboardPane with grid layout
4. Implement Number and Battery widgets (simplest data queries)

### Phase B: Chart Widget
1. Integrate Recharts
2. Implement Chart widget with all chart types
3. Widget config panel with axis/filter controls

### Phase C: Table + Timeline Widgets
1. Implement Table widget using existing DataTable component
2. Implement Timeline widget (mini version of TM-017 TimelineView)
3. Add drag-and-drop layout editing

### Feature Flag

`TASK_DASHBOARDS=true` — enables dashboard pane in sidebar and all dashboard endpoints.

---

## Dependencies (npm)

| Package | Purpose | Size |
|---------|---------|------|
| `recharts` | Chart rendering | ~45KB gzipped |
| `react-grid-layout` | Dashboard grid with drag/resize | ~20KB gzipped |

---

## Validation

1. `yarn build` — passes
2. Create dashboard → add Number widget for "Done items this month" → verify correct count
3. Add Battery widget for multi-board status distribution → verify segments match reality
4. Add Chart widget (bar chart, status by board) → verify correct aggregation
5. Add Table widget with filters → verify items match filter criteria
6. Drag widgets to rearrange → save layout → reload → verify layout persists
7. User without board access → verify widget shows "No access" message
8. Delete widget → verify removed from dashboard
9. Delete dashboard → verify all widgets cascade-deleted

## Files Affected

### New Files
- `server/sql/task-dashboards.sql`
- `src/views/tasks/panes/DashboardPane.jsx`
- `src/views/tasks/components/widgets/NumberWidget.jsx`
- `src/views/tasks/components/widgets/BatteryWidget.jsx`
- `src/views/tasks/components/widgets/ChartWidget.jsx`
- `src/views/tasks/components/widgets/TableWidget.jsx`
- `src/views/tasks/components/widgets/TimelineWidget.jsx`
- `src/views/tasks/components/widgets/WidgetConfigPanel.jsx`

### Modified Files
- `server/routes/tasks.js` — dashboard and widget CRUD + data endpoints
- `server/index.js` — run migration
- `src/views/tasks/TaskManager.jsx` — add DashboardPane to pane routing
- `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx` — add Dashboards nav item
- `src/api/tasks.js` — new API methods for dashboards and widgets
