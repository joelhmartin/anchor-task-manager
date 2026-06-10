# Feature: Audit Log + Enhanced Time Tracking (TM-020)

## Problem

### Audit Log Gaps

The current audit trail is fragmented across three separate systems:
1. `user_activity_logs` — 5 task action types (VIEW, CREATE, UPDATE, COMPLETE, DELETE), 30-day retention, auto-cleaned
2. `task_automation_runs` — automation execution history only
3. `task_events` (TM-014) — comprehensive event log, but oriented toward event bus, not user-facing audit

There is no unified admin-facing audit log for the task system. Administrators cannot answer "who changed what, when?" for compliance reporting.

### Time Tracking Gaps

| Feature | Status |
|---------|--------|
| Create time entries | Works |
| Edit time entries | No endpoint |
| Delete time entries | No endpoint |
| Approval workflow | None |
| Rate cards / hourly rates | None |
| Billing lockout (no edits after X days) | None |
| Time entry policy (required before status change) | None |
| Invoice generation | None |
| Client-facing reports | None |

## Solution

1. **Unified Audit Log UI** — A pane that queries `task_events` (from TM-014) with rich filtering, powered by the event bus. No new table needed — the event bus spec already defined the storage.
2. **Time Entry CRUD** — Add missing edit/delete endpoints + frontend support.
3. **Time Tracking Policies** — Board-level configuration for time entry requirements.
4. **Rate Cards** — Per-user or per-board hourly rates for billing.
5. **Enhanced Billing** — Approval workflow, lockout periods, improved reports.

## Prerequisites

- **TM-014**: Event Bus (audit log reads from `task_events` table)
- **TM-012**: Missing CRUD endpoints (time entry edit/delete is part of this spec but overlaps)

---

## Part 1: Audit Log

### No New Tables

The `task_events` table from TM-014 already captures all mutations with `event_type`, `actor_id`, `old_value`, `new_value`, `created_at`. The audit log is a **read-only view** of this data with user-friendly formatting.

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workspaces/:id/audit-log` | Query audit events with filters |
| GET | `/workspaces/:id/audit-log/export` | Export as CSV |

**GET `/workspaces/:id/audit-log`** query params:

| Param | Type | Description |
|-------|------|-------------|
| `event_type` | string | Filter by event type (e.g., `item.status_changed`) |
| `entity_type` | string | Filter by entity (e.g., `item`, `board`, `automation`) |
| `entity_id` | UUID | Filter by specific entity |
| `actor_id` | UUID | Filter by who did it |
| `board_id` | UUID | Filter by board |
| `date_from` | ISO date | Start of date range |
| `date_to` | ISO date | End of date range |
| `cursor` | UUID | Cursor-based pagination |
| `limit` | int | Page size (default 50, max 200) |

**Response:**
```json
{
  "events": [
    {
      "id": "uuid",
      "event_type": "item.status_changed",
      "description": "John changed status from 'To Do' to 'Done'",
      "entity": { "type": "item", "id": "uuid", "name": "Fix login bug" },
      "board": { "id": "uuid", "name": "Development" },
      "actor": { "id": "uuid", "name": "John Martin", "avatar": "url" },
      "changes": {
        "status": { "from": "To Do", "to": "Done" }
      },
      "created_at": "2026-03-04T10:30:00Z"
    }
  ],
  "next_cursor": "uuid",
  "total_count": 1250
}
```

### Human-Readable Descriptions

Format events into readable strings server-side:

```js
const EVENT_DESCRIPTIONS = {
  'item.created': (e) => `${e.actor_name} created item "${e.new_value?.name}"`,
  'item.status_changed': (e) => `${e.actor_name} changed status from "${e.old_value?.status}" to "${e.new_value?.status}"`,
  'item.archived': (e) => `${e.actor_name} archived item "${e.old_value?.name}"`,
  'assignee.added': (e) => `${e.actor_name} assigned ${e.metadata?.assignee_name}`,
  'assignee.removed': (e) => `${e.actor_name} unassigned ${e.metadata?.assignee_name}`,
  'automation.created': (e) => `${e.actor_name} created automation "${e.new_value?.name}"`,
  // ... etc for all 35 event types
};
```

### UI: AuditLogPane.jsx

New pane accessible from sidebar (admin/superadmin only):

```
+-- Audit Log                    [Export CSV]
|
|   +-- Filters:
|   |   Board: [All ▼]  User: [All ▼]  Type: [All ▼]  Date: [Last 7 days ▼]
|   |
|   +-- Event List:
|   |   10:30 AM  John changed status from "To Do" to "Done" on "Fix login bug"
|   |   10:28 AM  Jane assigned John to "Design landing page"
|   |   10:25 AM  System automation "Auto-flag overdue" set needs_attention on 3 items
|   |   10:20 AM  John created item "Write unit tests" on Development board
|   |   ...
|   |   [Load More]
```

Uses DataTable (existing shared component) with custom row rendering for event entries.

---

## Part 2: Enhanced Time Tracking

### Data Model Changes

```sql
-- Add to existing task_time_entries table
ALTER TABLE task_time_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'rejected'
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Rate cards: per-user or per-board hourly rates
CREATE TABLE IF NOT EXISTS task_rate_cards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = workspace default
  board_id UUID REFERENCES task_boards(id) ON DELETE CASCADE,  -- NULL = all boards
  hourly_rate NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,  -- NULL = no end date
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id, board_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_task_rate_cards_workspace
  ON task_rate_cards (workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_rate_cards_user
  ON task_rate_cards (user_id);

-- Board-level time tracking policy
CREATE TABLE IF NOT EXISTS task_time_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  require_time_on_status_change BOOLEAN NOT NULL DEFAULT FALSE,
  -- when true: status changes to done_state require at least one time entry
  min_entry_minutes INTEGER,  -- minimum per entry (e.g., 15 min)
  max_entry_minutes INTEGER,  -- maximum per entry (e.g., 480 min = 8 hours)
  lockout_days INTEGER,       -- entries older than this can't be edited (NULL = no lockout)
  require_approval BOOLEAN NOT NULL DEFAULT FALSE,
  require_category BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(board_id)
);
```

### Time Entry CRUD Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/time-entries/:id` | Update time entry (minutes, description, category, billable) |
| DELETE | `/time-entries/:id` | Delete time entry |
| POST | `/time-entries/:id/approve` | Approve time entry (workspace admin) |
| POST | `/time-entries/:id/reject` | Reject time entry with reason |
| GET | `/boards/:boardId/time-policy` | Get time tracking policy |
| PUT | `/boards/:boardId/time-policy` | Set time tracking policy |
| GET | `/workspaces/:id/rate-cards` | List rate cards |
| POST | `/workspaces/:id/rate-cards` | Create rate card |
| PATCH | `/rate-cards/:id` | Update rate card |
| DELETE | `/rate-cards/:id` | Delete rate card |

### PATCH `/time-entries/:id`

**Validation:**
- Only entry creator can edit (or workspace admin)
- Cannot edit if `locked = true`
- Cannot edit if `status = 'approved'` (must be unapproved first)
- Lockout check: `created_at + lockout_days < NOW()` → reject with 403
- Min/max minutes from board policy

**Body:**
```json
{
  "time_spent_minutes": 120,
  "billable_minutes": 90,
  "description": "Updated description",
  "work_category": "Development",
  "is_billable": true
}
```

### DELETE `/time-entries/:id`

**Validation:**
- Only entry creator can delete (or workspace admin)
- Cannot delete if `locked = true`
- Cannot delete if `status = 'approved'`

### Time Entry Policy Enforcement

When `require_time_on_status_change = true`:

In the PATCH `/items/:id` endpoint, before updating status to a done_state:
```js
if (policy.require_time_on_status_change && isDoneState) {
  const { rows } = await query(
    'SELECT COUNT(*) FROM task_time_entries WHERE item_id = $1',
    [itemId]
  );
  if (rows[0].count === 0) {
    return res.status(400).json({
      error: 'Time entry required before completing this item',
      code: 'TIME_ENTRY_REQUIRED'
    });
  }
}
```

Frontend shows a prompt when user tries to move to done_state without time entries.

### Approval Workflow

```
Creator logs time → status: 'pending'
                  ↓
Workspace admin reviews → 'approved' (included in billing)
                        → 'rejected' (creator notified, can edit and resubmit)
```

Only `approved` entries are included in billing reports when `require_approval = true` on the board.

### Rate Card Resolution

When calculating billing amounts:

```
1. Check user + board specific rate (most specific)
2. Check user-level rate (all boards)
3. Check board-level rate (all users)
4. Check workspace default rate (user_id=NULL, board_id=NULL)
5. If no rate found → show minutes only, no dollar amount
```

---

## UI Changes

### BillingPane.jsx Enhancements

Add to existing billing pane:

```
+-- Billing Report                        [Date Range ▼]  [Export CSV]
|
|   +-- Summary
|   |   Total Hours: 142.5    Billable: 120.0    Amount: $18,000.00
|   |
|   +-- By Category
|   |   Development:  85.0h  ($12,750.00)
|   |   Design:       25.0h  ($3,750.00)
|   |   Meetings:     10.0h  ($1,500.00)
|   |
|   +-- Pending Approval: 12 entries (8.5h)  [Review All]
|   |
|   +-- Rate Cards  [Manage]
|   |   Default: $150/hr
|   |   John (Development): $175/hr
|   |   Design board: $125/hr
```

### Time Entry Edit in Item Drawer

In the existing time entries section of the item drawer:

```
+-- Time Entries
|   +-- 2h 30m  Development  "API refactoring"  @John  Mar 4  [✏️] [🗑️]  ● Pending
|   +-- 1h 00m  Meetings     "Sprint planning"  @Jane  Mar 3  [✏️] [🗑️]  ✅ Approved
|   +-- [+ Log Time]
```

- Edit icon → inline edit or dialog
- Delete icon → ConfirmDialog
- Status indicator (pending/approved/rejected)
- Rejected entries show reason on hover

### TimePolicyDialog.jsx (new)

Board settings dialog for time tracking policy:

```
+-- Time Tracking Policy for [Board Name]
|
|   □ Require time entry before completing items
|   □ Require category on time entries
|   □ Require approval before billing inclusion
|
|   Min entry: [15] minutes    Max entry: [480] minutes
|   Lockout after: [30] days (entries older than this cannot be edited)
|
|   [Save]  [Cancel]
```

### AuditLogPane.jsx (new pane)

See Part 1 above.

---

## Event Bus Integration

Time tracking events (from TM-014):

| Event Type | Triggered By |
|-----------|-------------|
| `time_entry.created` | POST /items/:id/time-entries (already defined in TM-014) |
| `time_entry.updated` | PATCH /time-entries/:id |
| `time_entry.deleted` | DELETE /time-entries/:id |
| `time_entry.approved` | POST /time-entries/:id/approve |
| `time_entry.rejected` | POST /time-entries/:id/reject |

These events feed into the audit log automatically.

---

## Permission Model

| Action | Who Can Do It |
|--------|--------------|
| Create time entry | Any board member on their own items |
| Edit own time entry | Creator (if not locked/approved) |
| Edit others' time entry | Workspace admin or `board.manage_time_entries` role |
| Delete time entry | Same as edit |
| Approve/reject entries | Workspace admin or `board.manage_time_entries` role |
| View audit log | Workspace admin, superadmin, admin |
| Export audit log | Workspace admin, superadmin, admin |
| Manage rate cards | Workspace admin |
| Manage time policy | Board admin (from TM-016) or workspace admin |

---

## Migration Strategy

### Phase A: Time Entry CRUD + Audit Log UI
1. Add columns to `task_time_entries` (status, approved_by, etc.)
2. Implement PATCH/DELETE time entry endpoints
3. Build AuditLogPane (reads from `task_events` table)
4. Add audit log to sidebar navigation

### Phase B: Policies + Approval
1. Create `task_time_policies` table
2. Implement policy enforcement in status change endpoint
3. Implement approval workflow endpoints
4. Update BillingPane with approval indicators

### Phase C: Rate Cards + Billing
1. Create `task_rate_cards` table
2. Implement rate card CRUD
3. Enhance billing reports with dollar amounts
4. Add rate card management UI

### Feature Flag

`TASK_ENHANCED_TIME_TRACKING=true` — enables approval workflow, policies, rate cards. When disabled, time entries work as before (no approval required, no policy checks).

`TASK_AUDIT_LOG_UI=true` — enables the audit log pane. The underlying `task_events` data is always collected (from TM-014).

---

## Validation

1. `yarn build` — passes
2. Edit time entry → verify minutes/description updated
3. Delete time entry → verify removed (ConfirmDialog required)
4. Edit locked entry → verify 403 error
5. Edit approved entry → verify 403 error
6. Set policy: require time before completion → try completing without entry → verify error
7. Approve time entry → verify status changes, included in billing
8. Reject time entry → verify creator notified with reason
9. Audit log → filter by board → verify correct events shown
10. Audit log → export CSV → verify file downloads with correct data
11. Rate card → set $150/hr → verify billing report calculates amounts correctly

## Files Affected

### New Files
- `server/sql/task-time-tracking-enhanced.sql` (ALTER + new tables)
- `src/views/tasks/panes/AuditLogPane.jsx`
- `src/views/tasks/components/TimePolicyDialog.jsx`
- `src/views/tasks/components/RateCardDialog.jsx`

### Modified Files
- `server/routes/tasks.js` — time entry PATCH/DELETE, approval, policy, rate card endpoints, audit log query
- `server/index.js` — run migration
- `src/views/tasks/TaskManager.jsx` — add AuditLogPane to pane routing
- `src/views/tasks/panes/BillingPane.jsx` — approval indicators, rate-based amounts
- `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx` — add Audit Log nav item
- `src/api/tasks.js` — new API methods for time entry CRUD, approval, policies, rate cards, audit log
