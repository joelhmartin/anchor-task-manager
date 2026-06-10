# Task Manager Enterprise Upgrade — Design Spec

**Date**: 2026-04-03
**Status**: Approved
**Scope**: Internal team task management — no client-facing permissions needed

## Context

The task manager has a solid foundation: full CRUD for items/subitems/groups/boards/workspaces, an event bus with 35 event types, a multi-step automation engine with if/else branching, condition groups (AND/OR, 10 operators), quota enforcement, circuit breaker, dry-run testing, and per-step execution tracking. AI-powered daily overviews and per-item summaries via Vertex AI.

**Problem**: Only 5 of 22 automation actions are implemented (the rest are stubs returning errors). No global label system exists. Filter/sort buttons are disabled. Only table view is available — Kanban and Timeline are grayed out. No task dependencies, recurring tasks, or dashboards.

**Goal**: Bring the task manager to enterprise-grade quality through a phased upgrade, prioritizing automation completeness and global labels first.

## Architecture Decisions

- **Approach B (Unified Label System)**: A single `task_label_definitions` table with categories and optional mutual exclusivity. No dedicated priority column — priority is a label category with `is_exclusive = true`. This keeps everything in one system, one set of automation triggers, and matches the services pattern from the client portal.
- **Sequence 2 (Automations first, labels second)**: The 17 stubbed actions are low-hanging fruit since all infrastructure exists. Global labels land with full automation support from day one.
- **@xyflow/react**: The automation builder UI will eventually use a visual node-based flow editor. The step data model (parent_step_id, step_order) maps naturally to nodes/edges. Position columns (x/y) will be added to `task_automation_steps` when building the visual canvas.

---

## Phase 1 — Complete the 17 Stubbed Automation Actions

Wire up `executeAction()` in `server/services/taskAutomations.js` for each stubbed action type. The frontend already renders them (just grayed out with "Soon" badges) — removing the badges is the only UI change.

### Tier 1 — Simple Field Updates

| Action | Logic |
|--------|-------|
| `set_priority` | Deferred to Phase 2 — priority is a label, not a column |
| `set_due_date` | `UPDATE task_items SET due_date = config.due_date WHERE id = $1` |
| `clear_due_date` | `UPDATE task_items SET due_date = NULL WHERE id = $1` |
| `archive_item` | `UPDATE task_items SET archived_at = NOW() WHERE id = $1` |

### Tier 2 — Relational Operations

| Action | Logic |
|--------|-------|
| `assign_user` | INSERT into `task_item_assignees` + emit `assignee_added` event |
| `remove_assignee` | DELETE from `task_item_assignees` + emit `assignee_removed` event |
| `move_to_group` | `UPDATE task_items SET group_id = config.group_id` + emit event |
| `move_to_board` | Find/create target group in destination board, UPDATE item's `group_id` + emit event |
| `create_item` | INSERT new item in target group (reuse existing create logic) |
| `duplicate_item` | SELECT existing + INSERT copy (new UUID, reset dates/status) |
| `create_subitem` | INSERT into `task_subitems` (reuse existing logic) |

### Tier 3 — Integrations

| Action | Logic |
|--------|-------|
| `send_email` | Call existing Mailgun service with template variables (to, subject, body from config) |
| `send_webhook` | HTTP POST to `config.url` with event payload, signed with HMAC-SHA256 |
| `add_file` | Low priority — skip for now |

### Tier 4 — Timer Operations

| Action | Logic |
|--------|-------|
| `start_time_tracking` | INSERT `task_time_entries` with `started_at = NOW()`, null `time_spent_minutes` |
| `stop_time_tracking` | Find active entry (null time_spent), calculate elapsed, UPDATE `time_spent_minutes` |

### Schema Change

None needed for Phase 1. Priority gets handled via the label system in Phase 2.

### Frontend Change

Remove "Soon" chips from the 16 action types in `EditAutomationDialog.jsx`. Enable them in the action dropdown. No new UI components needed — action config fields (status pickers, group selectors, user selectors) are built as each action is wired up.

### Also in Phase 1

- **`set_column_value`** deferred — depends on a future custom fields system
- **`add_file`** deferred — low utility in automation context
- **`set_priority`** deferred to Phase 2 — becomes `add_label` with priority category

Effective count: **14 actions implemented in Phase 1**.

---

## Phase 2 — Global Labels System

### New Tables

**`task_label_definitions`** — the global label pool

```sql
CREATE TABLE IF NOT EXISTS task_label_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES task_workspaces(id) ON DELETE CASCADE,
    category        VARCHAR(50) NOT NULL,       -- "priority", "workflow", "custom"
    label           VARCHAR(100) NOT NULL,
    color           VARCHAR(7) NOT NULL,         -- hex color
    icon            VARCHAR(50),                 -- optional MUI icon name
    is_exclusive    BOOLEAN DEFAULT false,       -- one per category per item
    is_system       BOOLEAN DEFAULT false,       -- prevents deletion
    order_index     INT DEFAULT 0,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_label_def_ws_cat_label ON task_label_definitions(workspace_id, category, label);
```

**`task_item_labels`** — junction table

```sql
CREATE TABLE IF NOT EXISTS task_item_labels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    label_id        UUID NOT NULL REFERENCES task_label_definitions(id) ON DELETE CASCADE,
    applied_by      UUID REFERENCES users(id),
    applied_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(item_id, label_id)
);
CREATE INDEX idx_item_labels_item ON task_item_labels(item_id);
CREATE INDEX idx_item_labels_label ON task_item_labels(label_id);
```

### Starter Labels (seeded as `is_system = true`)

**Priority** (`is_exclusive = true`):
| Label | Color |
|-------|-------|
| High | #e2445c (red) |
| Medium | #fdab3d (orange) |
| Low | #579bfc (blue) |
| None | #c4c4c4 (gray) |

**Workflow** (`is_exclusive = false` — item can have multiple):
| Label | Color |
|-------|-------|
| Stuck | #e2445c (red) |
| Waiting on Client | #fdab3d (orange) |
| Under Client Review | #a25ddc (purple) |
| Under Team Review | #579bfc (blue) |
| Approved | #00c875 (green) |
| Ready for QC | #66ccff (light blue) |

### Behavior

- Every board automatically sees all labels from its workspace — no per-board configuration
- Creating a label on the fly INSERTs into `task_label_definitions` (same UX as services on client portal)
- System labels (`is_system = true`) cannot be deleted but can be recolored
- Exclusive categories: applying "High" auto-removes any existing priority label from that item (handled server-side in the POST endpoint)

### API Endpoints

```
GET    /tasks/labels                           — all labels for workspace
POST   /tasks/labels                           — create new label definition
PATCH  /tasks/labels/:labelId                  — update (color, name, order, icon)
DELETE /tasks/labels/:labelId                  — delete (403 if is_system)
GET    /tasks/items/:itemId/labels             — labels on an item
POST   /tasks/items/:itemId/labels             — apply label (handles exclusivity)
DELETE /tasks/items/:itemId/labels/:labelId    — remove label
```

### Automation Integration

**New triggers** (added to `TRIGGER_EVENT_MAP` and event bus):
- `label_added` — fires when label applied. Config: `{ label_id }` or `{ category }` for any in category
- `label_removed` — fires when label removed. Config: same

**New actions** (added to `executeAction()`):
- `add_label` — apply label to item. Config: `{ label_id }`. Respects exclusivity.
- `remove_label` — remove label. Config: `{ label_id }` or `{ category }` to clear all in category.

**Replaces `set_priority`**: use `add_label` with a priority-category label.

### Frontend

- **Board table**: new "Labels" column after Status — renders colored chips, click to open label picker
- **Item drawer**: label picker section grouped by category, with search and create-on-the-fly
- **Label management**: settings page for reordering, recoloring, adding/archiving labels
- **Automation editor**: `label_added`/`label_removed` in trigger dropdown, `add_label`/`remove_label` in actions, both with label picker widget
- **Condition builder**: new field options `item.labels`, `item.priority_label` for condition evaluation

---

## Phase 3 — Filters, Sort, and Kanban View

### Filters

Un-stub the disabled filter button on BoardHeader.

**Filterable fields**:
- Status (multi-select from board's status labels)
- Labels (multi-select from global labels, grouped by category)
- Priority (shortcut for priority label category)
- Assignee (multi-select from workspace members)
- Due date (overdue, today, this week, next week, no date, custom range)
- Needs attention (yes/no)
- Group (multi-select)

**Filter logic**: AND across fields, OR within a field.

**Saved filters** — new table:

```sql
CREATE TABLE IF NOT EXISTS task_saved_filters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID REFERENCES task_workspaces(id) ON DELETE CASCADE,
    board_id        UUID REFERENCES task_boards(id) ON DELETE CASCADE,  -- NULL = workspace-wide
    name            VARCHAR(100) NOT NULL,
    config          JSONB NOT NULL,             -- filter configuration
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

UI: "Save current filter" button + dropdown to load saved filters.

### Sort

Un-stub the sort button. Multi-level sort (primary + optional secondary), asc/desc per level. Sortable columns: name, status, priority, due date, assignee count, update count, time logged. Sort state is ephemeral (component state) unless part of a saved filter.

### Kanban View

Enable "Kanban" in the board view selector dropdown.

- **Columns** = status labels (each status is a swim lane)
- **Cards** = items showing: name, priority chip, assignee avatars, due date, label chips
- **Drag-and-drop** between columns = PATCH item status (existing endpoint)
- **Vertical ordering** = add `order_index INT` column to `task_items`
- **Collapsed columns** supported
- **Same filter bar** applies to both table and kanban views
- **No new backend** — purely frontend rendering of existing `fetchTaskBoardView` data

---

## Phase 4 — Timeline View, Dependencies, Recurring Tasks

### Timeline / Gantt View

Third option in the board view selector.

- **X-axis**: calendar (day/week/month zoom)
- **Y-axis**: items grouped by group or assignee
- **Bars**: span from `start_date` to `due_date`
- **Schema**: add `start_date TIMESTAMPTZ` column to `task_items`
- **Colors**: bar color = status label color, with label chips overlaid
- **Drag**: bar edges change start/due dates, whole bar shifts both
- **Dependencies**: arrow lines between connected bars
- **Today line**: vertical marker

### Task Dependencies

```sql
CREATE TABLE IF NOT EXISTS task_item_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    predecessor_id  UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    successor_id    UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    dependency_type VARCHAR(30) DEFAULT 'finish_to_start',
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(predecessor_id, successor_id)
);
```

- **Cycle detection**: DFS check on INSERT to prevent circular dependencies
- **New trigger**: `dependency_resolved` — fires when all predecessors of an item reach a done status
- **UI**: "Dependencies" section in item drawer with item search picker

### Recurring Tasks

```sql
CREATE TABLE IF NOT EXISTS task_recurrence_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
    pattern         VARCHAR(20) NOT NULL,       -- "daily","weekly","biweekly","monthly","custom"
    rrule           VARCHAR(255),               -- iCal RRULE for custom patterns
    next_occurrence TIMESTAMPTZ,
    last_generated  TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT true,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

- Template item is never completed — cron clones it at `next_occurrence`
- Clone inherits: group, labels, assignees, status reset to first non-done status
- Extends existing `runDueDateAutomations` daily cron pattern
- UI: "Repeat" toggle in item drawer with pattern selector

---

## Phase 5 — Dashboards and Reporting

### New Tables

```sql
CREATE TABLE IF NOT EXISTS task_dashboards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    layout          JSONB,                      -- grid positions
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_dashboard_widgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id    UUID NOT NULL REFERENCES task_dashboards(id) ON DELETE CASCADE,
    widget_type     VARCHAR(30) NOT NULL,
    config          JSONB NOT NULL,             -- boards, date range, filters, grouping
    position        JSONB NOT NULL              -- { x, y, w, h }
);
```

### Widget Types

| Widget | Display |
|--------|---------|
| `status_breakdown` | Pie/donut — items by status across selected boards |
| `priority_distribution` | Bar chart — items by priority label |
| `workload` | Horizontal bars — items per assignee, colored by status |
| `burndown` | Line chart — completed items over time vs target |
| `overdue` | Table — items past due date, sorted by urgency |
| `kpi_number` | Single big number — open items, avg completion time, etc. |
| `recent_activity` | Feed — latest events from task event bus |
| `label_distribution` | Stacked bar — items by label across boards |

### Behavior

- Cross-board: widgets pull from one, multiple, or all boards
- Date ranges: last 7/30 days, custom range
- Drag-and-drop layout with react-grid-layout or similar
- Default dashboard auto-created per workspace with starter widgets
- Refresh on page load + manual refresh button (no WebSocket)
- Time tracking summary: hours by person, board, label, billable vs non
- Automation health widget: quota trend, most-triggered rules, error rate

---

## Summary

| Phase | Focus | New Tables | Schema Changes |
|-------|-------|-----------|----------------|
| 1 | 14 automation actions | — | — |
| 2 | Global labels | `task_label_definitions`, `task_item_labels` | — |
| 3 | Filters, sort, kanban | `task_saved_filters` | `order_index` on `task_items` |
| 4 | Timeline, deps, recurring | `task_item_dependencies`, `task_recurrence_rules` | `start_date` on `task_items` |
| 5 | Dashboards | `task_dashboards`, `task_dashboard_widgets` | — |

Total: 6 new tables, 2 column additions, across 5 incremental phases.
