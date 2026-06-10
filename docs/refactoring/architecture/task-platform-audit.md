# Task Platform Audit

> Generated 2026-03-04. Comprehensive audit covering backend (routes, services, SQL) and frontend (TaskManager, BoardTable, panes, sidebar, API client).
>
> **Backend files:** `server/routes/tasks.js` (3,089 lines), `server/services/taskAutomations.js` (397 lines), `server/services/taskCleanup.js` (27 lines), task-related schema in `server/sql/init.sql`, cron configuration in `server/index.js`.
>
> **Frontend files:** `src/views/tasks/TaskManager.jsx` (2,374 lines), `src/views/tasks/components/BoardTable.jsx` (867 lines), `src/views/tasks/panes/HomePane.jsx` (352 lines), `src/views/tasks/panes/MyWorkPane.jsx` (72 lines), `src/views/tasks/panes/AutomationsPane.jsx` (452 lines), `src/views/tasks/panes/BillingPane.jsx` (631 lines), `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx` (1,215 lines), `src/api/tasks.js` (245 lines).

---

## Table of Contents

### Part 1: Backend
1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema (18 tables)](#2-database-schema-18-tables)
3. [API Endpoints (55 routes)](#3-api-endpoints-55-routes)
4. [Permission Model](#4-permission-model)
5. [Automation Engine](#5-automation-engine)
6. [Cleanup & Retention](#6-cleanup--retention)
7. [AI Integration](#7-ai-integration)
8. [Monday.com Integration](#8-mondaycom-integration)
9. [Notification System](#9-notification-system)
10. [Data Flow Patterns](#10-data-flow-patterns)
11. [Performance Concerns (Backend)](#11-performance-concerns)
12. [Bugs & Inconsistencies (Backend)](#12-bugs--inconsistencies)
13. [Missing Features for Enterprise](#13-missing-features-for-enterprise)

### Part 2: Frontend
14. [Frontend Architecture](#14-frontend-architecture)
15. [TaskManager.jsx — The Monolith](#15-taskmanagerjsx--the-monolith)
16. [BoardTable.jsx — Grid Component](#16-boardtablejsx--grid-component)
17. [Pane Components](#17-pane-components)
18. [TaskSidebarPanel.jsx — Navigation](#18-tasksidebarpaneljsx--navigation)
19. [API Layer (api/tasks.js)](#19-api-layer-apitasksjs)
20. [Frontend Cross-Cutting Concerns](#20-frontend-cross-cutting-concerns)

### Unified Summary
21. [All Known Bugs](#21-all-known-bugs)
22. [Prioritized Upgrade Recommendations](#22-prioritized-upgrade-recommendations)
23. [Statistics](#23-statistics)

---

## 1. Architecture Overview

The task management system is a Monday.com-inspired project management platform built directly into the Anchor CRM. It follows a **Workspace > Board > Group > Item > Subitem** hierarchy with bolted-on systems for automations, time tracking, file attachments, AI summaries, and status label customization.

### Component Map

```
server/routes/tasks.js            — All 55 REST endpoints (3,089 lines, single file)
server/services/taskAutomations.js — Automation engine (3 trigger types, 5 action types)
server/services/taskCleanup.js     — Archived task purge (30-day retention)
server/services/monday.js          — Monday.com GraphQL integration (separate from task system)
server/services/activityLog.js     — Activity logging (CREATE_TASK, UPDATE_TASK, etc.)
server/services/notifications.js   — In-app notification dispatch
server/services/ai.js              — Vertex AI (Gemini) for summaries
```

### Hierarchy

```
task_workspaces
  └── task_workspace_memberships (M2M: users)
  └── task_boards
        └── task_board_status_labels
        └── task_board_automations
        └── task_groups
              └── task_items
                    ├── task_subitems
                    ├── task_item_assignees (M2M: users)
                    ├── task_updates
                    │     └── task_update_views (M2M: users)
                    ├── task_files
                    ├── task_time_entries
                    └── task_item_ai_summaries (1:1)

task_global_automations           — Cross-board automation rules
task_global_status_labels         — Shared status label definitions
task_automation_runs              — Audit log for all automation executions
task_ai_daily_overviews           — Per-user daily AI digest cache
```

---

## 2. Database Schema (18 tables)

### 2.1 task_workspaces

```sql
CREATE TABLE task_workspaces (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:** None (PK only)
- **FK:** `created_by` -> `users.id` (SET NULL on delete)
- **Notes:** No `updated_at` column. No soft delete support.

### 2.2 task_workspace_memberships

```sql
CREATE TABLE task_workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);
```

- **Indexes:** Composite PK (workspace_id, user_id)
- **FK:** CASCADE delete on both workspace and user
- **Notes:** Role is unconstrained TEXT (no CHECK constraint). Staff (superadmin/admin/team) are implicit members — never stored here.

### 2.3 task_boards

```sql
CREATE TABLE task_boards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  board_prefix  TEXT,  -- Added via ALTER
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:** `idx_task_boards_workspace` on (workspace_id)
- **FK:** CASCADE delete from workspace
- **Notes:** No `updated_at`. `board_prefix` is auto-prepended to new item names.

### 2.4 task_groups

```sql
CREATE TABLE task_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id    UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);
```

- **Indexes:** `idx_task_groups_board` on (board_id)
- **FK:** CASCADE delete from board
- **Notes:** No `created_at`, `updated_at`, or `created_by`. No rename endpoint exists.

### 2.5 task_items

```sql
CREATE TABLE task_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'To Do',  -- Free-form, matches board labels
  due_date        DATE,
  is_voicemail    BOOLEAN NOT NULL DEFAULT FALSE,
  needs_attention BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ,       -- Added via ALTER
  archived_by     UUID REFERENCES users(id) ON DELETE SET NULL  -- Added via ALTER
);
```

- **Indexes:**
  - `idx_task_items_group` on (group_id)
  - `idx_task_items_status` on (status)
  - `idx_task_items_archived_at` on (archived_at)
- **FK:** CASCADE from group, SET NULL on created_by/archived_by
- **Notes:** Status is free-form TEXT matching board-level label strings. `is_voicemail` is a domain-specific flag for CTM integration. No priority field. No description/body field.

### 2.6 task_subitems

```sql
CREATE TABLE task_subitems (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_item_id  UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'To Do',
  due_date        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ,       -- Added via ALTER
  archived_by     UUID REFERENCES users(id) ON DELETE SET NULL  -- Added via ALTER
);
```

- **Indexes:**
  - `idx_task_subitems_parent` on (parent_item_id)
  - `idx_task_subitems_archived_at` on (archived_at)
- **FK:** CASCADE from parent item
- **Notes:** No `updated_at`, `created_by`. Subitems lack assignees, time tracking, files, updates. No automation support.

### 2.7 task_item_assignees

```sql
CREATE TABLE task_item_assignees (
  item_id    UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_id, user_id)
);
```

- **Indexes:** Composite PK only
- **Notes:** No `assigned_by` field. Missing index on `user_id` for "my work" queries.

### 2.8 task_updates

```sql
CREATE TABLE task_updates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id    UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:** `idx_task_updates_item` on (item_id)
- **Notes:** No `updated_at` (updates are immutable). `user_id` is NULL for automation-generated updates. Content is plain text (no rich text / HTML).

### 2.9 task_files

```sql
CREATE TABLE task_files (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id     UUID REFERENCES task_items(id) ON DELETE CASCADE,
  update_id   UUID REFERENCES task_updates(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_url    TEXT NOT NULL,
  file_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:**
  - `idx_task_files_item` on (item_id)
  - `idx_task_files_update` on (update_id)
- **Notes:** Files stored on local disk (`uploads/tasks/`). No `file_size` or `mime_type` columns. `update_id` supports attaching files to specific updates (not currently used by API). No file deletion endpoint exists.

### 2.10 task_time_entries

```sql
CREATE TABLE task_time_entries (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id            UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  time_spent_minutes INTEGER NOT NULL DEFAULT 0,
  billable_minutes   INTEGER NOT NULL DEFAULT 0,
  description        TEXT,
  work_category      TEXT,
  is_billable        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT task_time_billable_minutes_check CHECK (billable_minutes >= 0),
  CONSTRAINT task_time_spent_minutes_check CHECK (time_spent_minutes >= 0)
);
```

- **Indexes:**
  - `idx_task_time_entries_item` on (item_id)
  - `idx_task_time_entries_user` on (user_id)
- **Notes:** No `updated_at` (entries are immutable after creation). No edit/delete endpoint for time entries. No date range field — only `created_at` tracks when.

### 2.11 task_board_automations

```sql
CREATE TABLE task_board_automations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id       UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL,       -- 'status_change' | 'assignee_added' | 'due_date_relative'
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type    TEXT NOT NULL,       -- 'notify_admins' | 'notify_assignees' | 'set_status' | 'set_needs_attention' | 'add_update'
  action_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:**
  - `idx_task_board_automations_board` on (board_id)
  - `idx_task_board_automations_active` on (is_active)
- **Notes:** No `updated_at`. trigger_type and action_type are unconstrained TEXT (validated in app layer only).

### 2.12 task_global_automations

```sql
CREATE TABLE task_global_automations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type    TEXT NOT NULL,
  action_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:** `idx_task_global_automations_active` on (is_active)
- **Notes:** Identical schema to board automations minus `board_id`. Global rules fire on all boards.

### 2.13 task_automation_runs

```sql
CREATE TABLE task_automation_runs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope               TEXT NOT NULL,          -- 'board' | 'global'
  automation_id       UUID NOT NULL,          -- NOT FK'd (supports both tables)
  board_id            UUID REFERENCES task_boards(id) ON DELETE CASCADE,
  item_id             UUID REFERENCES task_items(id) ON DELETE CASCADE,
  trigger_type        TEXT NOT NULL,
  trigger_fingerprint TEXT,
  status              TEXT NOT NULL DEFAULT 'success',  -- success | error | skipped
  error               TEXT,
  meta                JSONB NOT NULL DEFAULT '{}'::jsonb,
  ran_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:**
  - `idx_task_automation_runs_automation` on (scope, automation_id)
  - `idx_task_automation_runs_item` on (item_id)
  - `idx_task_automation_runs_ran_at` on (ran_at)
  - `idx_task_automation_runs_dedupe` UNIQUE on (scope, automation_id, item_id, trigger_fingerprint) WHERE trigger_fingerprint IS NOT NULL
- **Notes:** `automation_id` is NOT a foreign key — intentionally supports both board and global tables. The dedupe index prevents repeated scheduled triggers from firing on the same item. No retention policy — this table grows indefinitely.

### 2.14 task_item_ai_summaries

```sql
CREATE TABLE task_item_ai_summaries (
  item_id      UUID PRIMARY KEY REFERENCES task_items(id) ON DELETE CASCADE,
  summary      TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'vertex',
  model        TEXT,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_meta  JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

- **Indexes:** `idx_task_item_ai_summaries_generated_at` on (generated_at)
- **Notes:** 1:1 with task_items. Upserted on refresh. Tracks provider/model for audit.

### 2.15 task_board_status_labels

```sql
CREATE TABLE task_board_status_labels (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id      UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#808080',
  order_index   INTEGER NOT NULL DEFAULT 0,
  is_done_state BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:** `idx_task_board_status_labels_board` on (board_id)
- **Notes:** No unique constraint on (board_id, label) — duplicate labels possible. Color supports #RRGGBB and #RRGGBBAA.

### 2.16 task_global_status_labels

```sql
CREATE TABLE task_global_status_labels (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label         TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#808080',
  order_index   INTEGER NOT NULL DEFAULT 0,
  is_done_state BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Indexes:** `idx_task_global_status_labels_order` on (order_index)
- **Notes:** Defined twice in init.sql (lines 524 and 741) — both are `IF NOT EXISTS` so no conflict. Merged with board-specific labels at read time.

### 2.17 task_update_views

```sql
CREATE TABLE task_update_views (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  update_id UUID NOT NULL REFERENCES task_updates(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(update_id, user_id)
);
```

- **Indexes:**
  - `idx_task_update_views_update` on (update_id)
  - `idx_task_update_views_user` on (user_id)
- **Notes:** Read-receipt tracking for task updates. No retention policy — grows indefinitely.

### 2.18 task_ai_daily_overviews

```sql
CREATE TABLE task_ai_daily_overviews (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overview_date      DATE NOT NULL,
  summary            TEXT NOT NULL,
  todo_items         JSONB NOT NULL DEFAULT '[]'::jsonb,
  pending_mentions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  unanswered_mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider           TEXT NOT NULL DEFAULT 'vertex',
  model              TEXT,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, overview_date)
);
```

- **Indexes:** `idx_task_ai_daily_overviews_user_date` on (user_id, overview_date)
- **Notes:** One row per user per day. Cached until explicit refresh. No retention policy — grows indefinitely.

---

## 3. API Endpoints (55 routes)

All routes are mounted under `/api/tasks` via `router.use(requireAuth); router.use(isStaff);` — every endpoint requires authentication AND staff role (superadmin, admin, or team).

### 3.1 Workspaces (5 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/workspaces` | List workspaces (staff sees all; non-staff sees memberships only) | requireAuth + isStaff |
| POST | `/workspaces` | Create workspace (creator auto-becomes admin member) | superadmin/admin only |
| DELETE | `/workspaces/:workspaceId` | Delete workspace (CASCADE to boards/groups/items) | superadmin/admin + workspace access |
| GET | `/workspaces/:workspaceId/members` | List workspace members (includes implicit staff) | workspace access |
| GET | `/workspaces/:workspaceId/members/search` | Search members by name/email (LIMIT 10) | workspace access |

### 3.2 Workspace Members (3 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| POST | `/workspaces/:workspaceId/members` | Add member (by user_id or email) | superadmin/admin + workspace access |
| PATCH | `/workspaces/:workspaceId/members/:memberUserId` | Change member role | superadmin/admin + workspace access |
| DELETE | `/workspaces/:workspaceId/members/:memberUserId` | Remove member | superadmin/admin + workspace access |

### 3.3 Boards (5 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/workspaces/:workspaceId/boards` | List boards in workspace | workspace access |
| GET | `/boards` | List ALL boards across workspaces (staff only) | isStaff (implicit) |
| POST | `/workspaces/:workspaceId/boards` | Create board in workspace | workspace access |
| PATCH | `/boards/:boardId` | Update board (name, description, move to different workspace) | workspace access (+ dest workspace if moving) |
| DELETE | `/boards/:boardId` | Delete board (CASCADE) | superadmin/admin + workspace access |

### 3.4 Status Labels (8 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/boards/:boardId/status-labels` | Get merged (global + board) labels with defaults fallback | workspace access |
| POST | `/boards/:boardId/status-labels` | Create board-specific label | superadmin/admin + workspace access |
| POST | `/boards/:boardId/status-labels/init` | Initialize default labels (one-time) | superadmin/admin + workspace access |
| PATCH | `/status-labels/:labelId` | Update board label | superadmin/admin + workspace access |
| DELETE | `/status-labels/:labelId` | Delete board label | superadmin/admin + workspace access |
| GET | `/status-labels/global` | List global labels | superadmin/admin |
| POST | `/status-labels/global` | Create global label | superadmin/admin |
| *(missing)* | `PATCH/DELETE /status-labels/global/:id` | **Not implemented** | -- |

### 3.5 Board View & Reporting (5 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/boards/:boardId/view` | Full board data (board + groups + items + assignees + time totals + update counts + status labels) | workspace access |
| GET | `/boards/:boardId/report` | Aggregate stats (status counts, flags) | workspace access |
| POST | `/reports/boards` | Bulk board report (multiple boards, date range) | workspace access per board |
| POST | `/reports/billing` | Billing report — items with time entries in range | workspace access per board |
| GET | `/boards/:boardId/export.csv` | CSV export of all items (audit logged) | workspace access |

### 3.6 Groups (2 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| POST | `/boards/:boardId/groups` | Create group | workspace access |
| DELETE | `/groups/:groupId` | Delete group (CASCADE items) | superadmin/admin + workspace access |
| *(missing)* | `PATCH /groups/:groupId` | **No rename/reorder endpoint** | -- |
| *(missing)* | `GET /groups/:groupId` | **No individual group read** | -- |

### 3.7 Items (4 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| POST | `/groups/:groupId/items` | Create item (auto-applies board prefix, logs activity) | workspace access |
| PATCH | `/items/:itemId` | Update item (fires status_change automations, logs activity) | workspace access |
| DELETE | `/items/:itemId` | Soft-archive item (sets archived_at, logs activity) | workspace access |
| POST | `/items/:itemId/restore` | Restore archived item | workspace access |

### 3.8 Subitems (4 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/items/:itemId/subitems` | List non-archived subitems | workspace access |
| POST | `/items/:itemId/subitems` | Create subitem | workspace access |
| PATCH | `/subitems/:subitemId` | Update subitem | workspace access |
| DELETE | `/subitems/:subitemId` | Soft-archive subitem | workspace access |
| POST | `/subitems/:subitemId/restore` | Restore archived subitem | workspace access |

### 3.9 Assignees (3 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/items/:itemId/assignees` | List assignees with user info | workspace access |
| POST | `/items/:itemId/assignees` | Add assignee (validates workspace access for target user, sends notification, fires automations) | workspace access |
| DELETE | `/items/:itemId/assignees/:assigneeUserId` | Remove assignee | workspace access |

### 3.10 Updates (2 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/items/:itemId/updates` | List all updates (unbounded, no pagination) | workspace access |
| POST | `/items/:itemId/updates` | Create update (fires mention notifications) | workspace access |
| *(missing)* | `PATCH/DELETE /updates/:id` | **No edit or delete** | -- |

### 3.11 Files (2 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/items/:itemId/files` | List files | workspace access |
| POST | `/items/:itemId/files` | Upload file (25MB limit, local disk storage) | workspace access |
| *(missing)* | `DELETE /files/:id` | **No file deletion** | -- |

### 3.12 Time Entries (2 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/items/:itemId/time-entries` | List time entries | workspace access |
| POST | `/items/:itemId/time-entries` | Create time entry | workspace access |
| *(missing)* | `PATCH/DELETE /time-entries/:id` | **No edit or delete** | -- |

### 3.13 Update Views (2 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| POST | `/updates/mark-viewed` | Batch mark updates as viewed | requireAuth (no additional check) |
| POST | `/updates/views` | Get view info by update_ids | requireAuth (no additional check) |

### 3.14 Automations (7 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/boards/:boardId/automations` | List board automations | workspace access |
| POST | `/boards/:boardId/automations` | Create board automation | superadmin/admin + workspace access |
| PATCH | `/automations/:automationId` | Update automation (board or global) | superadmin/admin (+ workspace if board) |
| DELETE | `/automations/:automationId` | Delete automation (board or global) | superadmin/admin (+ workspace if board) |
| GET | `/automations/global` | List global automations | superadmin/admin |
| POST | `/automations/global` | Create global automation | superadmin/admin |
| GET | `/automations/runs` | List execution log (with scope/board filters) | workspace access for board scope |

### 3.15 AI Features (3 endpoints)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/items/:itemId/ai-summary` | Get cached AI summary + staleness flag | workspace access |
| POST | `/items/:itemId/ai-summary/refresh` | Regenerate AI summary (Vertex AI or fallback) | workspace access |
| GET | `/ai/daily-overview` | AI daily work digest (per user, cached per day) | requireAuth |

### 3.16 My Work (1 endpoint)

| Method | Path | Purpose | Auth Check |
|--------|------|---------|------------|
| GET | `/my-work` | Items assigned to current user, grouped by board | requireAuth |

---

## 4. Permission Model

### 4.1 Middleware Stack

Every route passes through:
1. `requireAuth` — validates JWT, populates `req.user`
2. `isStaff` — rejects non-staff users (client role cannot access tasks at all)

### 4.2 Role Hierarchy

| Role | Workspace Access | Create/Delete Entities | Manage Automations | Manage Labels |
|------|-----------------|----------------------|-------------------|--------------|
| superadmin | All (implicit) | Yes | Yes | Yes |
| admin | All (implicit) | Yes | Yes | Yes |
| team | All (implicit) | Items/updates only | No | No |
| member (workspace) | Explicit membership only | Items/updates only | No | No |
| client | **Blocked by isStaff** | N/A | N/A | N/A |

### 4.3 Access Check Function

```javascript
async function assertWorkspaceAccess({ effRole, userId, workspaceId })
```

- Staff roles (superadmin/admin/team) get **implicit access to ALL workspaces** — no membership row needed.
- Non-staff must have an explicit `task_workspace_memberships` row.
- This function is called on nearly every endpoint (some exceptions noted below).

### 4.4 Permission Gaps

1. **Update views endpoints** (`POST /updates/mark-viewed`, `POST /updates/views`) perform **no workspace access check** — any authenticated staff user can mark/read views for any update.
2. **My Work endpoint** has no workspace access check (returns all assigned items regardless of workspace membership — acceptable since it's "my items").
3. **AI Daily Overview** has no workspace scope limiting — returns items from ALL workspaces.
4. **No row-level security** — anyone with workspace access can modify/delete any item in the workspace.
5. **team role** can create items and updates but **cannot** create workspaces, boards, groups, automations, or labels. However, team members CAN delete items (archive) even though they cannot delete boards/groups.

---

## 5. Automation Engine

### 5.1 Architecture

The automation engine lives in `server/services/taskAutomations.js` (397 lines). It supports two scopes:

- **Board-scoped automations** (`task_board_automations`): Fire only for items on that board
- **Global automations** (`task_global_automations`): Fire for items on ANY board

Both scopes use the same trigger/action definitions and are evaluated together.

### 5.2 Trigger Types (3)

| Trigger | How It Fires | Invoked From |
|---------|-------------|--------------|
| `status_change` | **Event-driven:** fires synchronously after `PATCH /items/:itemId` when status changes | `runEventAutomationsForItemChange()` called in item update handler |
| `assignee_added` | **Event-driven:** fires after `POST /items/:itemId/assignees` when a new assignee is inserted | `runEventAutomationsForAssigneeAdded()` called in assignee handler |
| `due_date_relative` | **Cron-driven:** evaluated every hour via `runDueDateAutomations()` | `cron.schedule('0 * * * *', ...)` in `server/index.js` |

#### status_change trigger details
- Compares `itemBefore.status` vs `itemAfter.status`
- Optional `trigger_config.to_status` — if set, only fires when new status matches
- If `to_status` is omitted, fires on ANY status change

#### assignee_added trigger details
- Fires after a new assignee is inserted (not on duplicate/no-op assignments)
- No trigger_config filtering — fires for any assignee addition

#### due_date_relative trigger details
- `trigger_config.days_from_due` (integer, -365 to +365)
- Semantics: fires when `item.due_date == today - days_from_due`
  - `days_from_due = -10`: fires 10 days BEFORE due date
  - `days_from_due = 0`: fires ON the due date
  - `days_from_due = +1`: fires 1 day AFTER due date
- Only considers non-archived items
- Uses UTC date to avoid timezone drift

### 5.3 Action Types (5)

| Action | Implementation |
|--------|---------------|
| `notify_admins` | Queries all users with `role IN ('superadmin','admin')`, sends notification to each |
| `notify_assignees` | Sends notification to all item assignees (excluding actor). Special case for `assignee_added` trigger: notifies only the newly added assignee |
| `set_status` | `UPDATE task_items SET status = $1` — directly mutates item status |
| `set_needs_attention` | `UPDATE task_items SET needs_attention = $1` — sets/clears attention flag |
| `add_update` | `INSERT INTO task_updates (item_id, user_id, content) VALUES ($1, NULL, $2)` — adds a system-generated update (user_id=NULL) |

### 5.4 Deduplication Strategy

- **Event-driven triggers** (status_change, assignee_added): `trigger_fingerprint` is set to NULL — no deduplication. They fire every time the event occurs. Execution is logged but not deduped.
- **Scheduled triggers** (due_date_relative): `trigger_fingerprint` is set to `due_date_relative:{daysFromDue}:{due_date}` — unique per rule per item per specific due date.
- The `task_automation_runs` table has a unique index: `(scope, automation_id, item_id, trigger_fingerprint) WHERE trigger_fingerprint IS NOT NULL`
- Before executing a scheduled rule, `wasScheduledRunAlreadyLogged()` checks if a matching row exists; if so, the rule is skipped.

### 5.5 Execution Flow

**Event-driven (status_change, assignee_added):**
1. Route handler completes the mutation (update item / add assignee)
2. Calls `runEventAutomationsForItemChange()` or `runEventAutomationsForAssigneeAdded()` **asynchronously** (`.catch()` — fire-and-forget)
3. Function looks up the board ID from the item
4. Fetches BOTH board-scoped AND global automations
5. Iterates through all matching rules sequentially
6. For each match: executes action, logs run

**Cron-driven (due_date_relative):**
1. `cron.schedule('0 * * * *', ...)` triggers `runDueDateAutomations()`
2. Fetches ALL active `due_date_relative` rules from BOTH tables
3. For each rule: computes the target due_date, queries matching items
4. For each matching item: checks dedupe, executes action if not already processed
5. Returns total processed count

### 5.6 Limitations

1. **No rate limiting** — a global automation on status_change fires for every status change on every board. Heavy boards could generate many notifications.
2. **No cascade prevention** — a `set_status` action does NOT trigger further `status_change` automations (because it uses direct SQL, not the route handler). This is actually safe but may be surprising.
3. **Sequential processing** — rules are processed in a `for` loop, not in parallel. A slow notification could delay subsequent rules.
4. **No cross-board actions** — an automation cannot create items on another board or assign users cross-board.
5. **No conditional logic** — no AND/OR conditions; each rule is a single trigger-action pair.
6. **No webhook/HTTP action** — cannot call external services.
7. **Error isolation is good** — each rule execution is wrapped in try/catch, so one failure does not block others.

---

## 6. Cleanup & Retention

### 6.1 taskCleanup.js

**Single function: `purgeArchivedTasks()`**

```javascript
export async function purgeArchivedTasks({ retentionDays = 30 } = {})
```

- **Schedule:** Daily at 2:20 AM ET (`cron.schedule('20 2 * * *', ...)`)
- **Behavior:** Hard deletes `task_items` where `archived_at < NOW() - retentionDays`
- **Cascade:** Deleting items cascades to subitems, updates, assignees, files (DB-level), time entries
- **Configurable:** `TASK_ARCHIVE_RETENTION_DAYS` env var (default 30)
- **Error handling:** Catches errors, logs to console, returns `{ deleted: 0, error }` on failure

### 6.2 What Is NOT Cleaned Up

The following tables have **no retention/cleanup**:
- `task_automation_runs` — grows indefinitely
- `task_update_views` — grows indefinitely
- `task_ai_daily_overviews` — grows indefinitely (one per user per day)
- `task_item_ai_summaries` — orphaned when items are deleted (CASCADE handles this)
- Uploaded files on disk — file rows cascade-delete but **physical files on disk are never cleaned up**

---

## 7. AI Integration

### 7.1 Item-Level AI Summary

**Endpoint:** `POST /items/:itemId/ai-summary/refresh`

- Gathers item metadata + last 50 updates
- Builds a structured prompt asking for summary, status, blockers, next steps
- Calls `generateAiResponse()` (Vertex AI / Gemini)
- Falls back to `localSummarizeUpdates()` if AI fails (simple text extraction)
- Upserts result into `task_item_ai_summaries`
- Staleness detection: compares `latest_update_at` with stored `source_meta.latest_update_at`

### 7.2 Daily Overview

**Endpoint:** `GET /ai/daily-overview`

- Queries ALL non-done items assigned to the user (no limit)
- Queries ALL updates from last 60 days for those items
- Performs in-memory @mention detection and response tracking
- Builds a large structured prompt (~130 lines) requesting JSON output
- Calls `generateAiResponse()` with 2000 max tokens
- Caches result in `task_ai_daily_overviews` (1 per user per day)
- Falls back to static overview structure if AI call fails
- Uses `LATERAL` joins for per-item counts (good pattern but potentially expensive)

### 7.3 Concerns

1. **No AI rate limiting** — any user can repeatedly call refresh
2. **No cost tracking** — AI calls are not metered
3. **Large prompt for daily overview** — serializes ALL assigned items and 60 days of updates into the prompt; could exceed token limits for active users
4. **Mention detection is fragile** — searches for first name in update content, which could match non-mention text

---

## 8. Monday.com Integration

### 8.1 Architecture

`server/services/monday.js` is a **standalone Monday.com API client** — it is NOT integrated with the task_ tables. It is used by the onboarding/client request flow (in `server/routes/hub.js`) to push work requests to Monday.com boards.

### 8.2 Capabilities

| Function | Purpose |
|----------|---------|
| `listBoards()` | List Monday.com boards (limit 200) |
| `listGroups(boardId)` | List groups within a board |
| `listColumns(boardId)` | List board columns |
| `listPeople()` | List Monday.com users |
| `findPersonById(id)` | Look up a single Monday user |
| `buildRequestColumnValues()` | Build column values for client requests |
| `createRequestItem()` | Create an item on a Monday.com board |
| `listItemsByGroups()` | List items in specific groups (limit 100) |
| `createItemUpdate()` | Post an update to a Monday item |
| `changeColumnValue()` | Change a column value on an item |
| `uploadFileToColumn()` | Upload a file to a Monday column |

### 8.3 Settings

Stored in `app_settings` table under key `'monday'`. Configurable:
- Status column ID, status labels (Assigned/Rush Job)
- Due date column ID, client files column ID
- Person column ID and default person
- API token (from `MONDAY_API_TOKEN` env var)

### 8.4 Key Observation

**The internal task system and Monday.com are completely separate.** There is no sync between `task_items` and Monday.com items. The Monday.com integration is for the legacy client request workflow, while the task platform is a new internal tool. An upgrade path could involve bidirectional sync, but nothing exists today.

---

## 9. Notification System

### 9.1 Notification Triggers from Tasks

| Event | Who Gets Notified | Method |
|-------|------------------|--------|
| Assignee added to item | The new assignee (if not self-assigning) | `createNotification()` in route handler |
| @mention in update | All mentioned users with workspace access (excluding actor) | `notifyMentionedUsers()` fire-and-forget |
| Automation: notify_admins | All superadmin/admin users | `executeAction()` |
| Automation: notify_assignees | All item assignees (excluding actor) | `executeAction()` |

### 9.2 Mention Detection

```javascript
function extractMentionEmails(text) {
  // Pattern: @email@example.com
  const regex = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  // ...
}
```

- Only matches full email addresses after `@`
- Validates workspace access before sending notifications (prevents information leakage)
- Fire-and-forget — errors are logged but don't affect the response

---

## 10. Data Flow Patterns

### 10.1 Standard Mutation Pattern

```
Client Request
  → Zod validation (schema)
  → Extract user ID/role from req.user
  → Resolve workspace ID (1-3 joins depending on entity depth)
  → assertWorkspaceAccess() check
  → Role-based permission check (if needed)
  → Execute SQL mutation (parameterized query)
  → Fire side effects asynchronously (automations, notifications, activity log)
  → Return mutated entity
```

### 10.2 Workspace Resolution Helpers

The file defines 6 helper functions for resolving workspace IDs up the hierarchy:

| Function | Joins Required |
|----------|---------------|
| `getWorkspaceIdForBoard(boardId)` | 1 (boards) |
| `getWorkspaceIdForGroup(groupId)` | 2 (groups -> boards) |
| `getWorkspaceIdForItem(itemId)` | 3 (items -> groups -> boards) |
| `getWorkspaceIdForSubitem(subitemId)` | 4 (subitems -> items -> groups -> boards) |
| `getBoardIdForItem(itemId)` | 1 (items -> groups) |
| `getBoardIdForGroup(groupId)` | 1 (groups) |

**These are called on every single request**, resulting in 1-4 extra queries per API call just for authorization.

### 10.3 Board View Pattern (GET /boards/:boardId/view)

This is the most complex read endpoint. It executes **6 sequential queries** (some parallelized):

1. `getWorkspaceIdForBoard()` — resolve workspace
2. `assertWorkspaceAccess()` — auth check
3. Board data query
4. Groups query
5. Items query (filtered by board, non-archived)
6. If items exist:
   - Assignees query (batch by item IDs)
   - Time totals query (aggregate by item)
   - Update counts query (aggregate by item)
7. Status labels queries (board + global, parallel)

**Total: 7-9 queries per board view.**

---

## 11. Performance Concerns

### 11.1 Critical: N+1 and Unbounded Queries

| Issue | Location | Severity |
|-------|----------|----------|
| **Workspace resolution queries on every request** | All 55 endpoints | Medium — each adds 1-4 queries. Could be cached. |
| **GET /items/:itemId/updates has no LIMIT** | Line 2288 | High — an item with 10,000 updates returns all of them |
| **GET /items/:itemId/time-entries has no LIMIT** | Line 2672 | Medium — typically fewer entries, but unbounded |
| **GET /items/:itemId/files has no LIMIT** | Line 2345 | Medium — unbounded |
| **Daily overview queries ALL assigned items** | Line 2806 | High — no LIMIT. Heavy users could have hundreds of items |
| **Daily overview queries ALL updates from 60 days** | Line 2826 | High — could be thousands of updates |
| **POST /updates/mark-viewed loops instead of batching** | Line 2729 | Medium — uses sequential `for` loop with individual INSERT |
| **Report endpoints join boards->groups->items for aggregation** | Lines 1081-1133 | Medium — acceptable for bounded board_ids but no result limit |
| **Board view loads ALL non-archived items for a board** | Line 1290 | High — boards with 10,000+ items return everything |
| **My Work uses LATERAL joins per item** | Lines 2124-2129 | Medium — efficient for small sets but scales O(n) |

### 11.2 Missing Indexes

| Table | Missing Index | Impact |
|-------|--------------|--------|
| `task_item_assignees` | Index on `user_id` alone | "My Work" query and daily overview JOIN on `user_id` without covering index |
| `task_items` | Composite index on `(group_id, archived_at)` | Board view filters by both |
| `task_items` | Index on `due_date` | Due date automations scan all items by date |
| `task_items` | Index on `created_by` | No way to efficiently query "items I created" |
| `task_updates` | Index on `created_at` | Daily overview queries by date range |

### 11.3 File Storage

- Files stored on **local disk** under `uploads/tasks/` — NOT cloud storage
- No cleanup of orphaned physical files when DB rows cascade-delete
- 25MB per-file limit
- No virus scanning, content type validation, or access control on stored files

---

## 12. Bugs & Inconsistencies

### 12.1 Status Mismatch in Reports

The report endpoints (lines 1085-1090) use hardcoded status values:
```sql
SUM(CASE WHEN i.status = 'todo' THEN 1 ELSE 0 END)::int AS todo,
SUM(CASE WHEN i.status = 'working' THEN 1 ELSE 0 END)::int AS working,
SUM(CASE WHEN i.status = 'blocked' THEN 1 ELSE 0 END)::int AS blocked,
SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END)::int AS done,
```

But the actual default statuses are `'To Do'`, `'Working on it'`, `'Stuck'`, `'Done'`, `'Needs Attention'`. The report queries use **different strings** (`todo`, `working`, `blocked`) that will never match. This means **reports always show 0 for these status counts** unless items have been set to these exact lowercase values.

### 12.2 Daily Overview Hardcoded Status

Line 2817: `WHERE i.status != 'done'` — uses lowercase `'done'` but actual done status is `'Done'` (capitalized). This means **done items are still included in the daily overview**.

### 12.3 Missing Global Status Label CRUD

Global status labels can be listed and created but there are **no PATCH or DELETE endpoints** for global labels. They can only be managed via direct DB access.

### 12.4 Duplicate Table Definition

`task_global_status_labels` is defined twice in init.sql (lines 524 and 741). Both use `IF NOT EXISTS` so this causes no SQL error, but it indicates a messy migration history.

### 12.5 No Group Rename/Reorder

There is no PATCH endpoint for groups — they cannot be renamed or reordered via the API.

### 12.6 File Deletion Orphans

When a file DB row is cascade-deleted, the physical file on disk remains. No cleanup process exists.

### 12.7 `update_ids` in Mark-Viewed Not Validated

The `POST /updates/mark-viewed` endpoint does not validate that `update_ids` are valid UUIDs or that the user has access to the corresponding workspace. Any staff user can mark any update as viewed.

### 12.8 Automation `set_status` Does Not Trigger Further Automations

When an automation changes an item's status via `set_status`, it uses direct SQL (`UPDATE task_items SET status = $1`). This bypasses the route handler and does NOT trigger any `status_change` automations. This prevents infinite loops but may surprise users expecting chained automations.

---

## 13. Missing Features for Enterprise

### 13.1 Core Task Features

- **No item description/body field** — items only have a name
- **No priority field** — no high/medium/low/urgent
- **No labels/tags** — only status-based categorization
- **No dependencies** — cannot link items as blockers/predecessors
- **No recurring tasks** — no repeat schedule
- **No templates** — no board/item templates
- **No item movement** — cannot move items between groups or boards via API
- **No bulk operations** — no batch status change, batch assign, batch archive
- **No search** — no full-text search across items/updates

### 13.2 Collaboration

- **No real-time updates** — no WebSocket/SSE; clients must poll
- **No rich text in updates** — plain text only
- **No threaded replies** — updates are flat
- **No reactions/emoji** — no lightweight acknowledgment
- **No activity feed** — activity logged but no endpoint to retrieve it per item

### 13.3 Access Control

- **No board-level permissions** — all-or-nothing per workspace
- **No item-level permissions** — no private items
- **No guest access** — clients cannot see task items at all
- **No role-based field visibility** — all fields visible to all staff

### 13.4 Integration

- **No bidirectional Monday.com sync** — Monday.com and tasks are completely separate
- **No email-to-task** — cannot create tasks from email
- **No calendar integration** — due dates not synced to Google/Outlook
- **No Slack/Teams notifications** — only in-app

### 13.5 Reporting & Analytics

- **No burndown/burnup charts** — aggregate counts only
- **No velocity tracking** — no sprint concept
- **No SLA tracking** — no response time metrics
- **No custom fields** — fixed schema per item

### 13.6 Infrastructure

- **File storage on local disk** — not scalable, not cloud-friendly
- **No pagination on any list endpoint** — unbounded result sets
- **No cursor-based pagination** — would be needed for large datasets
- **No WebSocket layer** — no real-time collaboration
- **No background job queue** — automations run inline or via simple cron
- **task_automation_runs has no retention policy** — grows indefinitely

---

---

# Part 2: Frontend

## 14. Frontend Architecture

### 14.1 System Overview

```
TaskSidebarPanel.jsx (sidebar)        TaskManager.jsx (main content)
  |                                     |
  |-- Workspace accordion              |-- Pane router (URL ?pane=)
  |-- Board list (grouped/ungrouped)   |   |-- HomePane (AI overview)
  |-- Drag-drop reorder                |   |-- MyWorkPane (cross-board)
  |-- Local grouping (localStorage)    |   |-- AutomationsPane (rules)
  |                                    |   |-- BillingPane (time reports)
  | <--- URL params sync --->          |   |-- Boards pane (default)
  |                                    |       |-- BoardHeader
  |                                    |       |-- BoardTable
  |                                    |
  |                                    |-- Item Drawer (right side)
  |                                    |   |-- Updates tab
  |                                    |   |-- Files tab
  |                                    |   |-- Time Tracking tab
  |                                    |
  |                                    |-- Automations Drawer (right side)
  |                                    |-- Status Labels Dialog
  |                                    |-- Edit Automation Dialog
```

### 14.2 Communication Model

- **Sidebar <-> TaskManager**: Communicate exclusively via URL search params (`?workspace=`, `?board=`, `?pane=`, `?item=`)
- **Panes <-> TaskManager**: Props passed down from TaskManager; panes are stateless except for their own fetch-and-render logic
- **No shared state context**: All state lives in `TaskManager.useState()` or `TaskSidebarPanel.useState()`

---

## 15. TaskManager.jsx — The Monolith

**File**: `src/views/tasks/TaskManager.jsx`
**Lines**: 2,374
**Severity**: CRITICAL — single largest component, highest refactoring priority

### 15.1 State Variables (87 total useState calls)

#### Core Navigation & Loading (8 vars)
`error`, `activeWorkspaceId`, `activeBoardId`, `boardViewLoading`, `boardView`, `boardSearch`, `boardViewType`, `workspaceMembers`

#### Board Report (3 vars)
`boardReport`, `boardReportLoading`, `exportingCsv`

#### Board Automations Drawer (12 vars)
`automations`, `automationsLoading`, `creatingAutomation`, `automationsDrawerOpen`, `automationToStatus`, `automationAction`, `automationTitle`, `automationBody`, `automationRuns`, `automationRunsLoading`, `editingAutomation`, `editDraft`

#### Status Labels Editor (5 vars)
`statusLabelsDialogOpen`, `editingLabel`, `newLabelText`, `newLabelColor`, `savingLabel`

#### Group/Item CRUD (4 vars)
`newGroupName`, `creatingGroup`, `newItemNameByGroup`, `creatingItemByGroup`

#### Item Drawer (27+ vars)
`activeItem`, `itemDrawerOpen`, `drawerTab`, `itemUpdates`, `itemUpdatesLoading`, `newUpdateText`, `postingUpdate`, `updateInputRef`, `mentionOpen`, `mentionQuery`, `mentionOptions`, `mentionLoading`, `updateViews`, `viewPopperAnchor` (**DEAD**), `viewPopperUpdateId` (**DEAD**), `itemFiles`, `itemFilesLoading`, `uploadingFile`, `timeEntries`, `timeEntriesLoading`, `loggingTime`, `timeBillable`, `timeCategory`, `timeDescription`, `timeHours`, `timeMins`, `billableHours`, `billableMins`, `billableTouched`, `aiSummary`, `aiSummaryMeta`, `aiSummaryLoading`, `aiSummaryRefreshing`, `assignees`, `assigneesLoading`, `newAssigneeUserId`, `addingAssignee`, `subitems`, `subitemsLoading`, `newSubitemName`, `creatingSubitem`

#### Confirmation Dialogs (4 vars)
`deleteLabelConfirmOpen`, `labelToDelete`, `deleteAutomationConfirmOpen`, `automationToDelete`

#### Board Scroll/Highlight (2 vars)
`itemCardRefs`, `highlightedItemId`

#### Reporting — ORPHANED (8 vars)
`reportRows`, `reportLoading`, `allBoards`, `allBoardsLoading`, `reportBoardQuery`, `reportStartInput`, `reportEndInput`, `selectedReportBoards`

#### My Work (3 vars)
`myWorkBoards`, `myWorkLoading`, `myWorkMembers`

#### Workspace Boards (2 vars)
`workspaceBoards`, `workspaceBoardsLoading`

### 15.2 Pane Routing

Determined by `?pane=` URL param:
- `home` → HomePane (AI daily overview)
- `boards` → Board view (default when board selected)
- `my-work` → MyWorkPane (cross-board assigned items)
- `automations` → AutomationsPane (full rule builder)
- `billing` → BillingPane (time tracking reports)
- `reports` → **ORPHANED** — code exists (~280 lines) but pane value not in validation list

Additional URL params: `?workspace=<uuid>`, `?board=<uuid>`, `?item=<uuid>` (deep-link)

### 15.3 Board Data Loading Flow

1. URL changes → useEffect on [activeBoardId, pane] fires
2. If pane === 'boards': `loadBoardView(activeBoardId)` → GET `/tasks/boards/:id/view`
3. Response normalized (dates → YYYY-MM-DD), set into `boardView`
4. Also loads: automations, board report
5. If no board but has workspace: loads workspace board list

**Key observation**: Board view endpoint returns denormalized data (items + groups + assignees + update counts + time totals + status labels) in one response. Efficient for initial load but every mutation triggers a full board reload.

### 15.4 Item Drawer Architecture

When item is clicked:
1. Set `activeItem`, open drawer, sync URL `?item=<id>`
2. Reset ALL 27+ drawer state variables
3. Fire 6 parallel API calls (updates, files, time entries, AI summary, assignees, subitems)
4. On success: populate arrays, fire-and-forget `markUpdatesViewed()` + `fetchUpdateViews()`

Drawer tabs: **Updates** (@mentions, AI summary, read receipts), **Files** (upload/list), **Time Tracking** (categories, billable/non-billable)

### 15.5 Frontend Bugs in TaskManager

1. **`selectedItem` undefined reference (line 375)**: Archive function checks `selectedItem?.id` but variable is `activeItem` — drawer never auto-closes on archive
2. **`handleToggleGlobalAutomation` references undeclared state (line 965)**: Calls `setGlobalAutomations()` which doesn't exist — would throw ReferenceError
3. **Dead state variables**: `viewPopperAnchor` and `viewPopperUpdateId` declared but never written to
4. **Orphaned reports pane**: ~280 lines of rendering code unreachable

---

## 16. BoardTable.jsx — Grid Component

**File**: `src/views/tasks/components/BoardTable.jsx`
**Lines**: 867

### 16.1 Columns

| Column | Width | Features |
|--------|-------|----------|
| Name | 320px (sticky) | Single-click opens drawer (180ms delay), double-click inline edit |
| Status | 160px | Dropdown select with colored pill, "Add Label" for admins |
| People | 180px | Avatar stack (max 3), click opens Popper-based picker |
| Date | 160px | Native date input, fires onChange immediately |
| Updates | 90px | Button showing count, opens drawer updates tab |
| Time | 110px | Formatted total (display only) |

**Fixed-width grid**: CSS Grid = `320px 160px 180px 160px 90px 110px` (1,020px total). **No responsive behavior.**

### 16.2 Inline Editing
- **Name**: Double-click → TextField. 180ms setTimeout to distinguish from single-click (adds perceptible lag).
- **Status**: MUI Select dropdown, fires immediately on change.
- **Date**: Native HTML date input, fires immediately on change (no debounce).
- **People**: Popper with search + avatar chips. **Bug: No click-outside-to-close.**

### 16.3 Performance Concerns
- **No virtualization**: All items rendered to DOM simultaneously
- **No React.memo on rows**: Any state change re-renders every row
- **180ms click delay** on every item name click
- **Status Select per row**: 100 items × 5 labels = 500+ MenuItems in DOM
- **Date inputs always rendered** even when rarely used

### 16.4 Duplicated Code
- `DEFAULT_STATUS_LABELS`: copied in 3 files (TaskManager, BoardTable, MyWorkPane)
- `getStatusColor()`: copied in 2 files (TaskManager, BoardTable)
- `fmtMinutes()`: copied in 2 files (BoardTable, BillingPane)

### 16.5 Missing: Shared Components
- Archive item dialog uses raw Dialog (not ConfirmDialog)
- Delete group dialog uses raw Dialog (not ConfirmDialog)
- No drag-drop for items or groups

---

## 17. Pane Components

### 17.1 HomePane.jsx (352 lines)
AI-generated daily overview. Sections: greeting, summary, priorities (P1-P5 chips), mentions, at-risk items, suggestions.

**Issues**: Priority items not clickable (no navigation), mentions not clickable, no auto-refresh, full-page skeleton only.

### 17.2 MyWorkPane.jsx (72 lines)
Cross-board assigned items. Pure presentational wrapper around BoardTable.

**Issues**: Fallback path fires N+1 sequential API calls (one per board). No archive action. Uses default status labels (board-specific lost). Empty state uses plain Typography (not EmptyState component).

### 17.3 AutomationsPane.jsx (452 lines)
Board-scoped + global automation management. Trigger/action config UI.

**Issues**: Independently fetches `fetchTaskBoardsAll()` (duplicated). No editing capability (only create/enable/disable/delete). Automation runs capped at 20 with no pagination.

### 17.4 BillingPane.jsx (631 lines)
Time tracking reports. Date range, single/multi-board, category grouping, CSV export.

**Issues**: Independently fetches `fetchTaskBoardsAll()` (duplicated). Board table has no search. No currency/rate calculations. No date range presets. No print-friendly layout.

---

## 18. TaskSidebarPanel.jsx — Navigation

**File**: `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx`
**Lines**: 1,215

### 18.1 Structure
Workspace accordions → Board lists with local groups (localStorage). HTML5 native drag-drop for board ordering. Client-side groups (Cmd+Click multi-select).

### 18.2 Issues
1. **No keyboard navigation**: Entirely mouse-driven
2. **Dialogs not using shared components**: All 5 dialogs use raw Dialog
3. **Silent error swallowing**: All API catches are empty
4. **No board rename in sidebar**: Must go to BoardHeader
5. **Undiscoverable group creation**: Cmd+Click has no hint/tutorial
6. **No workspace rename**: Only create/delete
7. **Full upfront load**: All workspaces + boards loaded on mount
8. **No search/filter for boards**

---

## 19. API Layer (api/tasks.js)

**File**: `src/api/tasks.js`
**Lines**: 245
**Methods**: 52

Organized by domain: Workspaces (8), Boards (8), Groups (2), Items (4), Item Sub-resources (14), AI (3), Automations (8), Reports (2), Status Labels (6), Update Views (2).

### 19.1 API Layer Issues
- **No request cancellation** (AbortController) — rapid pane switching causes stale responses
- **No request deduplication** — multiple components fire same `fetchTaskBoardsAll()` simultaneously
- **No caching layer** — every mount re-fetches
- `fetchBoardStatusLabels` exists but is **never imported or used** (board view includes labels inline)

---

## 20. Frontend Cross-Cutting Concerns

### 20.1 State Management
- 87 useState in TaskManager, ~15 in BoardTable, ~20 in Sidebar, 8-14 per pane
- No Context or Redux — TaskManager is single source of truth
- URL params for routing, localStorage for sidebar grouping

### 20.2 Missing Features Users Expect
1. Item drag-drop reorder
2. Group reorder
3. Kanban view (disabled in UI)
4. Timeline/Gantt view (disabled in UI)
5. Column customization (show/hide, reorder, resize)
6. Board filtering (disabled in UI)
7. Board sorting (disabled in UI)
8. Bulk actions (multi-select)
9. Undo for destructive actions
10. Real-time updates (WebSocket/SSE)
11. Item priority field
12. Item labels/tags
13. Dependencies
14. Recurring tasks
15. Board templates
16. Item activity log
17. Global search
18. Workspace member management UI
19. Time entry editing/deletion
20. File deletion

### 20.3 Accessibility Gaps
1. No ARIA on board grid (CSS Grid, not semantic table)
2. People picker Popper: no focus trap, no keyboard nav
3. Drag-drop mouse-only (no keyboard alternative)
4. Color-only status differentiation
5. No skip navigation
6. Double-click-to-edit undiscoverable
7. Time entry form: no step labels/range constraints
8. Emoji close button on status label editor
9. Cmd+Click group creation undiscoverable, no keyboard equivalent

---

# Unified Summary

## 21. All Known Bugs

### Backend Bugs (8)
| # | Bug | Location | Severity |
|---|-----|----------|----------|
| B1 | Report status counts always 0 — lowercase `'todo'`/`'working'`/`'blocked'` vs actual `'To Do'`/`'Working on it'`/`'Stuck'` | `tasks.js:1085-1090` | HIGH |
| B2 | Daily overview includes done items — `status != 'done'` vs `'Done'` | `tasks.js:2817` | MEDIUM |
| B3 | No global status label PATCH/DELETE endpoints | `tasks.js` | LOW |
| B4 | Duplicate `task_global_status_labels` table definition | `init.sql:524,741` | LOW |
| B5 | No group rename/reorder endpoint | `tasks.js` | LOW |
| B6 | File deletion orphans physical files on disk | `taskCleanup.js` | MEDIUM |
| B7 | `mark-viewed` endpoint has no workspace access check | `tasks.js:2729` | LOW |
| B8 | `set_status` automation action doesn't trigger further automations | `taskAutomations.js` | INFO (by design) |

### Frontend Bugs (5)
| # | Bug | Location | Severity |
|---|-----|----------|----------|
| F1 | `selectedItem` undefined — drawer never auto-closes on archive | `TaskManager.jsx:375` | MEDIUM |
| F2 | `handleToggleGlobalAutomation` references undeclared `setGlobalAutomations` | `TaskManager.jsx:965` | HIGH |
| F3 | Dead state vars: `viewPopperAnchor`, `viewPopperUpdateId` | `TaskManager.jsx:233-234` | LOW |
| F4 | ~280 lines orphaned reports pane code | `TaskManager.jsx` | LOW |
| F5 | People picker Popper has no click-outside-to-close | `BoardTable.jsx` | MEDIUM |

---

## 22. Prioritized Upgrade Recommendations

### Priority 1: Fix Known Bugs (LOW risk, immediate)
Fix all 13 bugs listed above. Most are 1-5 line changes. The status mismatch (B1, B2) is the highest-impact bug — reports and daily overview produce incorrect data.

### Priority 2: Break Up TaskManager.jsx Monolith (MEDIUM risk, HIGH impact)
Extract 87 state variables into focused hooks:
- `useBoardView.js` — board loading, search, groups, items
- `useItemDrawer.js` — drawer state, active item, tab switching
- `useItemUpdates.js` — updates feed, mentions, view tracking
- `useItemTimeTracking.js` — time entries, billable logic
- `useItemFiles.js` — file upload/list
- `useItemSubitems.js` — subitems CRUD
- `useAutomations.js` — board + global automations
- `useStatusLabels.js` — label CRUD

Extract components: `ItemDrawer.jsx`, `AutomationsDrawer.jsx`, `StatusLabelsDialog.jsx`

### Priority 3: Introduce TaskContext (MEDIUM risk, HIGH impact)
Shared context to eliminate duplicate fetches and data duplication across TaskManager, sidebar, AutomationsPane, BillingPane.

### Priority 4: Add Missing Indexes + Pagination (LOW risk, MEDIUM impact)
Add 5 missing indexes. Add pagination to all list endpoints (updates, files, time entries, board view items).

### Priority 5: Virtualize BoardTable (MEDIUM risk, HIGH impact)
Replace CSS Grid with virtualized list. Render only visible rows (~20 of potentially hundreds).

### Priority 6: Deduplicate Shared Code (LOW risk, LOW impact)
Extract `DEFAULT_STATUS_LABELS`, `getStatusColor()`, `fmtMinutes()` to shared files. Convert raw Dialogs to ConfirmDialog/FormDialog.

### Priority 7: Automation Engine Upgrade (Phase 1 from upgrade plan)
Event bus, rule engine with multi-step chains and conditional branching, new trigger/action types.

### Priority 8: Board Views (Phase 2 from upgrade plan)
Kanban, Timeline/Gantt, Calendar, Chart views. Item drag-drop. Dependencies.

---

## 23. Statistics

| Metric | Backend | Frontend | Total |
|--------|---------|----------|-------|
| Files audited | 5 | 9 | 14 |
| Lines of code | ~3,913 | ~6,375 | ~10,288 |
| API endpoints | 55 | — | 55 |
| API client methods | — | 52 | 52 |
| Database tables | 18 | — | 18 |
| State variables | — | ~161 | ~161 |
| Automation triggers | 3 | — | 3 |
| Automation actions | 5 | — | 5 |
| Known bugs | 8 | 5 | 13 |
| Missing indexes | 5 | — | 5 |
| Missing CRUD operations | 6 | — | 6 |
| Missing user-expected features | — | 20 | 20 |
| Accessibility gaps | — | 9 | 9 |
