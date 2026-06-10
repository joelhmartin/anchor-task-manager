# Feature: Board Views — Kanban, Timeline, Calendar (TM-017)

## Problem

The task system only has a table/list view. Users cannot visualize work as a Kanban board, timeline, or calendar. The `boardViewType` state variable exists in TaskManager.jsx but is unused. There is no view persistence — switching away and back resets to table view.

## Solution

Add three new board view modes alongside the existing table view: **Kanban** (highest priority), **Timeline/Gantt**, and **Calendar**. Views are switchable via a toolbar and persist per-user per-board. Each view reads the same data (items, groups, status labels) but renders differently.

## Prerequisites

- **TM-009**: TaskManager decomposition (view state lives in `useBoardView` hook)
- **TM-013**: BoardTable virtualization (timeline/calendar benefit from virtual rendering)

---

## Data Model

### New tables

```sql
-- Persist view preferences per user per board
CREATE TABLE IF NOT EXISTS task_board_view_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  view_type TEXT NOT NULL DEFAULT 'table',  -- 'table' | 'kanban' | 'timeline' | 'calendar'
  view_config JSONB NOT NULL DEFAULT '{}'::jsonb,  -- view-specific settings
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, board_id)
);

-- Saved view configurations (named presets)
CREATE TABLE IF NOT EXISTS task_saved_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  view_type TEXT NOT NULL,
  view_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- view_config contains: filters, sort, group_by, hidden_columns, etc.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_saved_views_board
  ON task_saved_views (board_id);
```

### view_config Schema (per view type)

**Kanban:**
```json
{
  "group_by": "status",
  "card_fields": ["assignees", "due_date", "needs_attention"],
  "collapsed_columns": ["Done"],
  "wip_limits": { "Working on it": 5 }
}
```

**Timeline:**
```json
{
  "zoom_level": "week",
  "show_dependencies": true,
  "group_by": "group",
  "date_field": "due_date"
}
```

**Calendar:**
```json
{
  "calendar_view": "month",
  "date_field": "due_date",
  "color_by": "status"
}
```

---

## View Implementations

### 1. Kanban View (Highest Priority)

Cards arranged in columns by status (or group). Drag-and-drop to change status.

```
+-- Kanban Board
|   +-- [To Do]          [Working on it]    [Stuck]          [Done]
|   |   +-- Card 1       +-- Card 4        +-- Card 7       +-- Card 9
|   |   |  Task name     |  Task name      |  Task name     |  Task name
|   |   |  @user  📅     |  @user  📅      |  @user  📅     |  @user  📅
|   |   +-- Card 2       +-- Card 5        +-- Card 8
|   |   |  ...           |  ...            |  ...
|   |   +-- Card 3       +-- Card 6
|   |   [+ Add Item]     [+ Add Item]      [+ Add Item]     [+ Add Item]
```

**Behavior:**
- Columns = status labels (from `task_board_status_labels`), ordered by `order_index`
- Cards = items in that status, ordered by `created_at` (or drag-reordered)
- Drag card between columns → PATCH `/items/:id` with new status
- Drag within column → reorder (store in `view_config.item_order` or add `kanban_order` column)
- Configurable card face: which fields show on card (assignees, due date, flags)
- Column header shows count and optional WIP limit
- Click card → opens item drawer (existing behavior)
- `+ Add Item` at bottom of each column → creates item with that status

**Component:** `KanbanView.jsx`
- Uses `@dnd-kit/core` for drag-and-drop (already a common React DnD library, lightweight)
- Renders `KanbanColumn` → `KanbanCard` components
- Card renders: name, status chip, assignee avatars, due date, needs_attention flag

### 2. Timeline/Gantt View

Horizontal timeline showing items as bars. Items without due dates show as milestones at creation date.

```
+-- Timeline
|   +-- [Day] [Week] [Month] [Quarter]     ← zoom controls
|   +-- Group: Development
|   |   |  Task 1  ████████████░░░░░░░  (Mar 1 - Mar 15)
|   |   |  Task 2       ██████████████  (Mar 5 - Mar 20)
|   |   |  Task 3  ◆                    (Mar 1, no end date)
|   +-- Group: Design
|   |   |  Task 4  ██████░░░░░░░░░░░░░  (Mar 1 - Mar 25)
```

**Behavior:**
- Rows = items, grouped by task group
- Bar start = `created_at` (or configured start date field)
- Bar end = `due_date` (items without due date show as milestone diamonds)
- Drag bar edges → change due date (PATCH `/items/:id`)
- Drag entire bar → shift dates
- Color = status color from status labels
- Zoom levels: day, week, month, quarter
- Today marker (vertical red line)
- Future: dependency arrows (after TM-018)

**Component:** `TimelineView.jsx`
- Custom canvas/SVG rendering OR use a library like `gantt-task-react` (evaluate)
- Row virtualization for boards with many items
- Horizontal scroll with sticky row labels

### 3. Calendar View

Monthly/weekly/daily calendar showing items on their due dates.

```
+-- Calendar                                [Month ▼]  [< Mar 2026 >]
|   +-- Mon      Tue      Wed      Thu      Fri      Sat    Sun
|   |   1        2        3        4        5        6      7
|   |   Task A   Task C   ·        Task E   ·        ·      ·
|   |   Task B   ·        ·        ·        ·        ·      ·
|   |   8        9        10       11       12       13     14
|   |   ·        Task F   ·        Task G   Task H   ·      ·
```

**Behavior:**
- Items placed on their `due_date` cell
- Items without due dates listed in a "No Date" sidebar
- Click day → create new item with that due date
- Drag item between days → change due date (PATCH `/items/:id`)
- Color = status color
- View modes: month, week
- Click item → opens item drawer

**Component:** `CalendarView.jsx`
- CSS Grid layout for month view
- Day cells with overflow → "+N more" popover
- Item chips show name + status color dot

---

## View Switcher

A toolbar component next to the board header:

```
[Table] [Kanban] [Timeline] [Calendar]  |  [Save View ▼]
```

**Component:** `ViewSwitcher.jsx`
- Icon buttons for each view type
- Active view highlighted
- "Save View" dropdown with named presets
- Switching views persists preference via API

---

## API Endpoints

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/boards/:boardId/view-preference` | Get user's saved view type for this board |
| PUT | `/boards/:boardId/view-preference` | Save view type + config |
| GET | `/boards/:boardId/saved-views` | List saved view presets |
| POST | `/boards/:boardId/saved-views` | Create saved view |
| PATCH | `/saved-views/:viewId` | Update saved view |
| DELETE | `/saved-views/:viewId` | Delete saved view |

### Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `GET /boards/:boardId/view` | Add optional `view_type` query param; for timeline view, include `created_at` in item response |

---

## UI Changes

### TaskManager.jsx / useBoardView hook

- Replace hardcoded `boardViewType: 'main'` with dynamic state from view preference API
- Load view preference on board selection
- Pass `viewType` and `viewConfig` to board content area

### Board Content Area

```jsx
{viewType === 'table' && <BoardTable {...tableProps} />}
{viewType === 'kanban' && <KanbanView {...kanbanProps} />}
{viewType === 'timeline' && <TimelineView {...timelineProps} />}
{viewType === 'calendar' && <CalendarView {...calendarProps} />}
```

All views receive the same core data: `items`, `groups`, `statusLabels`, `workspaceMembers`.

### BoardHeader.jsx

Add `ViewSwitcher` component to the header bar.

---

## Migration Strategy

### Phase A: Kanban (ship first, highest value)
1. Create DB tables (view preferences, saved views)
2. Implement `KanbanView.jsx` with drag-and-drop
3. Add `ViewSwitcher.jsx` to board header
4. Wire up view preference persistence

### Phase B: Timeline
1. Implement `TimelineView.jsx` with zoom controls
2. Add bar dragging for date changes

### Phase C: Calendar
1. Implement `CalendarView.jsx` with month/week modes
2. Add drag-and-drop date changes

### Feature Flag

`TASK_BOARD_VIEWS=true` — when enabled, ViewSwitcher appears and new views are accessible. When disabled, only table view shown (current behavior).

---

## Dependencies (npm)

| Package | Purpose | Size |
|---------|---------|------|
| `@dnd-kit/core` + `@dnd-kit/sortable` | Kanban drag-and-drop | ~30KB |
| `date-fns` | Date math for timeline/calendar | Already used in project |

No heavy Gantt library — timeline view is custom-built to keep bundle small and avoid lock-in.

---

## Validation

1. `yarn build` — passes
2. Switch to Kanban view → verify items appear in status columns
3. Drag card from "To Do" to "Done" → verify status updates via API
4. Switch to Timeline → verify items appear on correct dates
5. Drag timeline bar end → verify due date updates
6. Switch to Calendar → verify items on correct days
7. Drag item to different day → verify due date updates
8. Close and reopen board → verify last view type persists
9. Create saved view with specific config → verify loads correctly

## Files Affected

### New Files
- `server/sql/task-board-views.sql`
- `src/views/tasks/components/KanbanView.jsx`
- `src/views/tasks/components/KanbanColumn.jsx`
- `src/views/tasks/components/KanbanCard.jsx`
- `src/views/tasks/components/TimelineView.jsx`
- `src/views/tasks/components/CalendarView.jsx`
- `src/views/tasks/components/ViewSwitcher.jsx`

### Modified Files
- `server/routes/tasks.js` — new view preference and saved views endpoints
- `server/index.js` — run migration
- `src/views/tasks/TaskManager.jsx` — integrate ViewSwitcher, render view by type
- `src/views/tasks/components/BoardHeader.jsx` — add ViewSwitcher
- `src/api/tasks.js` — new API methods for view preferences and saved views
