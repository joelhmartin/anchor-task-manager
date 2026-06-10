# Feature: Enhanced RBAC (TM-016)

## Problem

The current permission model has only two granularity levels: staff roles (superadmin/admin/team) that bypass all checks, and workspace membership (admin/member) with no distinction between read and write access. There is no column-level visibility, no board-level permissions, and no custom role definitions. Every workspace member can see and edit everything on every board.

### Current State

| Level | Implementation | Gaps |
|-------|---------------|------|
| System roles | `superadmin`, `admin`, `team` — all bypass workspace checks | No per-board restrictions for staff |
| Workspace membership | `admin` or `member` — both get full read/write | No read-only, no per-board scoping |
| Board-level | None | All workspace members see all boards |
| Item-level | None | All members can edit all items |
| Column-level | None | No field hiding or read-only fields |

## Solution

Add a layered permission system that extends (not replaces) the current model. Custom roles define capabilities at account, workspace, board, and column scope. The system is **additive** — existing staff auto-pass behavior is preserved for backward compatibility, controlled by a feature flag.

### Design Principles

1. **Additive only** — new tables, no modifications to existing role columns
2. **Deny by default** — custom roles must explicitly grant permissions
3. **Staff override** — superadmin/admin/team bypass custom RBAC (configurable per-workspace)
4. **Performance** — permission checks cached in-memory per request (loaded once, checked many times)

## Prerequisites

- **TM-014**: Event Bus (role changes emit events for audit)

---

## Data Model

### New tables

```sql
-- Named permission roles (e.g., "Board Viewer", "Department Lead", "External Contractor")
CREATE TABLE IF NOT EXISTS task_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,  -- system roles can't be deleted
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, name)
);

-- Permission grants for a role
-- permission_key examples: 'board.view', 'board.edit_items', 'board.manage_groups',
--   'board.manage_automations', 'board.manage_permissions', 'board.delete',
--   'workspace.create_boards', 'workspace.manage_members', 'workspace.manage_roles'
CREATE TABLE IF NOT EXISTS task_role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES task_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'workspace',  -- 'workspace' | 'board'
  scope_id UUID,  -- NULL = applies to all in parent scope; set = specific board
  granted BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(role_id, permission_key, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'))
);

CREATE INDEX IF NOT EXISTS idx_task_role_permissions_role
  ON task_role_permissions (role_id);

-- Assign roles to users within a workspace
CREATE TABLE IF NOT EXISTS task_user_role_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES task_roles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES task_workspaces(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_task_user_role_assignments_user
  ON task_user_role_assignments (user_id, workspace_id);

-- Column visibility overrides per role per board
CREATE TABLE IF NOT EXISTS task_column_visibility (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES task_roles(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
  column_key TEXT NOT NULL,  -- 'status', 'due_date', 'assignees', 'time_entries', 'files', etc.
  visibility TEXT NOT NULL DEFAULT 'visible',  -- 'visible' | 'read_only' | 'hidden'
  UNIQUE(role_id, board_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_task_column_visibility_role_board
  ON task_column_visibility (role_id, board_id);
```

### Seed system roles

On workspace creation, auto-create 3 system roles:

```sql
-- Workspace Admin (full access)
INSERT INTO task_roles (workspace_id, name, description, is_system_role) VALUES
  ($1, 'Workspace Admin', 'Full access to all boards and settings', true);

-- Board Editor (can view and edit items, but not manage structure)
INSERT INTO task_roles (workspace_id, name, description, is_system_role) VALUES
  ($1, 'Board Editor', 'View boards and edit items', true);

-- Board Viewer (read-only)
INSERT INTO task_roles (workspace_id, name, description, is_system_role) VALUES
  ($1, 'Board Viewer', 'View boards without editing', true);
```

### Permission Keys

| Key | Scope | Description |
|-----|-------|-------------|
| `workspace.create_boards` | workspace | Create new boards |
| `workspace.manage_members` | workspace | Add/remove/change member roles |
| `workspace.manage_roles` | workspace | Create/edit custom roles |
| `workspace.manage_automations` | workspace | Create/edit global automations |
| `board.view` | board | View board and its items |
| `board.edit_items` | board | Create, update, archive items |
| `board.manage_groups` | board | Create, rename, delete, reorder groups |
| `board.manage_status_labels` | board | Create, edit, delete status labels |
| `board.manage_automations` | board | Create, edit board automations |
| `board.manage_permissions` | board | Assign roles to this board |
| `board.export` | board | Export board data (CSV) |
| `board.delete` | board | Delete the board |
| `board.manage_time_entries` | board | Edit/delete others' time entries |

### Column Keys (for visibility rules)

| Column Key | Maps To | Default |
|-----------|---------|---------|
| `status` | Item status | visible |
| `due_date` | Due date | visible |
| `assignees` | Assigned users | visible |
| `updates` | Comments/updates | visible |
| `files` | Attachments | visible |
| `time_entries` | Time tracking | visible |
| `subitems` | Sub-items | visible |
| `ai_summary` | AI summary | visible |
| `needs_attention` | Attention flag | visible |

---

## Permission Resolution

```
function resolvePermissions(userId, workspaceId, boardId):
  1. Staff check: if user.effective_role in (superadmin, admin, team) → GRANT ALL
     (unless workspace has TASK_RBAC_STAFF_OVERRIDE=false, future config)

  2. Load user's role assignments for this workspace:
     SELECT r.*, rp.* FROM task_user_role_assignments ura
     JOIN task_roles r ON r.id = ura.role_id
     JOIN task_role_permissions rp ON rp.role_id = r.id
     WHERE ura.user_id = $1 AND ura.workspace_id = $2

  3. For each permission_key, resolve:
     a. Check scope_type='board' AND scope_id=boardId grants (most specific)
     b. If none, check scope_type='workspace' grants (workspace-wide)
     c. If none, DENY (deny by default)

  4. For column visibility:
     SELECT column_key, visibility FROM task_column_visibility
     WHERE role_id IN (user's roles) AND board_id = $1
     → If multiple roles, most permissive wins (visible > read_only > hidden)

  5. Cache result on req object for reuse within the request
```

### Middleware Implementation

```js
// New file: server/middleware/taskPermissions.js

/**
 * Middleware factory for checking task permissions.
 * Usage: router.patch('/items/:id', requireTaskPermission('board.edit_items'), handler)
 */
export function requireTaskPermission(permissionKey) {
  return async (req, res, next) => {
    const userId = req.user.id;
    const effectiveRole = req.user.effective_role;

    // Staff auto-pass (backward compat)
    if (['superadmin', 'admin', 'team'].includes(effectiveRole)) {
      return next();
    }

    // Resolve board context from route params
    const boardId = req.params.boardId || req.boardId;  // set by earlier middleware
    const workspaceId = req.workspaceId;  // set by earlier middleware

    const granted = await checkPermission(userId, workspaceId, boardId, permissionKey);
    if (!granted) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Strip hidden columns from item data before sending response.
 */
export async function filterColumnsForUser(userId, workspaceId, boardId, items) {
  const visibility = await getColumnVisibility(userId, workspaceId, boardId);
  return items.map(item => {
    const filtered = { ...item };
    for (const [col, vis] of Object.entries(visibility)) {
      if (vis === 'hidden') {
        delete filtered[col];
      }
    }
    return filtered;
  });
}
```

---

## API Endpoints

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workspaces/:id/roles` | List roles for workspace |
| POST | `/workspaces/:id/roles` | Create custom role |
| PATCH | `/roles/:roleId` | Update role name/description |
| DELETE | `/roles/:roleId` | Delete custom role (not system roles) |
| GET | `/roles/:roleId/permissions` | List permissions for role |
| PUT | `/roles/:roleId/permissions` | Set permissions (full replacement) |
| GET | `/roles/:roleId/boards/:boardId/columns` | Get column visibility for role on board |
| PUT | `/roles/:roleId/boards/:boardId/columns` | Set column visibility |
| POST | `/workspaces/:id/members/:userId/roles` | Assign role to member |
| DELETE | `/workspaces/:id/members/:userId/roles/:roleId` | Remove role from member |
| GET | `/workspaces/:id/members/:userId/roles` | List roles for a member |

### Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `GET /boards/:boardId/view` | Filter columns based on caller's visibility rules |
| All item mutation endpoints | Check `board.edit_items` permission |
| `POST /boards/:boardId/automations` | Check `board.manage_automations` permission |
| `POST /workspaces/:id/boards` | Check `workspace.create_boards` permission |
| `POST /workspaces/:id/members` | Check `workspace.manage_members` permission |

---

## UI Changes

### RolesDialog.jsx (new)

Accessible from workspace settings. Shows:

```
+-- Roles List
|   +-- Workspace Admin (system) — [View]
|   +-- Board Editor (system) — [View]
|   +-- Board Viewer (system) — [View]
|   +-- Custom Role 1 — [Edit] [Delete]
|   +-- [+ Create Role]
|
+-- Role Editor
|   +-- Name: [____________]
|   +-- Description: [____________]
|   +-- Permissions Matrix:
|   |   +-- Workspace Permissions
|   |   |   □ Create boards
|   |   |   □ Manage members
|   |   |   □ Manage roles
|   |   +-- Board Permissions (default for all boards)
|   |   |   □ View  □ Edit items  □ Manage groups
|   |   |   □ Manage status labels  □ Manage automations
|   |   |   □ Export  □ Delete
|   +-- Column Visibility (per board):
|       +-- Board: [dropdown]
|       |   Status: [visible ▼]  Due Date: [visible ▼]
|       |   Assignees: [visible ▼]  Time Entries: [hidden ▼]
```

### Member Role Assignment

In the existing workspace members panel, add a "Roles" column showing assigned roles with a dropdown to assign/remove.

---

## Migration Strategy

### Phase A: Database + Backend
1. Run migrations (create 4 new tables)
2. Seed system roles on existing workspaces
3. Implement permission resolution with caching
4. Add `requireTaskPermission` middleware to mutation endpoints
5. Add column filtering to board view endpoint

### Phase B: Frontend
1. Build RolesDialog component
2. Add role assignment to member management
3. Board-level column visibility UI
4. Permission-aware UI (hide edit buttons when read-only)

### Feature Flag

`TASK_ENHANCED_RBAC=true` — when enabled, custom role checks are enforced for non-staff users. When disabled, existing behavior (workspace membership = full access) continues.

### Backward Compatibility

- Existing workspace admins are auto-assigned the "Workspace Admin" system role
- Existing workspace members are auto-assigned the "Board Editor" system role
- Staff roles continue to bypass all checks (unchanged)
- No existing API contracts change (only new checks added)

---

## Validation

1. `yarn build` — passes
2. Create custom role with `board.view` only → assign to member → verify member can view but not edit
3. Set column visibility `time_entries=hidden` → verify time entries stripped from board view response
4. Staff user → verify all permissions still granted (backward compat)
5. Delete custom role → verify member falls back to deny-by-default
6. Workspace admin role → verify can manage members and roles
7. Board-scoped permission → verify only applies to specific board

## Files Affected

### New Files
- `server/sql/task-roles.sql`
- `server/middleware/taskPermissions.js`
- `src/views/tasks/components/RolesDialog.jsx`

### Modified Files
- `server/routes/tasks.js` — add role CRUD endpoints, add permission middleware to mutations
- `server/index.js` — run migration, seed system roles for existing workspaces
- `src/views/tasks/TaskManager.jsx` — permission-aware UI rendering
- `src/views/tasks/components/BoardTable.jsx` — hide edit controls when read-only
- `src/api/tasks.js` — new API methods for roles
