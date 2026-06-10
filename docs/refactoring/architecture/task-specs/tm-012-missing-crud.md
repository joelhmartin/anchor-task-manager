# Feature: Missing CRUD Endpoints (TM-012)

## Problem

Six resource types are missing basic update and/or delete operations:

| Resource | Create | Read | Update | Delete |
|----------|--------|------|--------|--------|
| Groups | POST `/boards/:id/groups` | GET (via board view) | **MISSING** | DELETE `/groups/:id` |
| Files | POST `/items/:id/files` | GET `/items/:id/files` | **MISSING** | **MISSING** |
| Time Entries | POST `/items/:id/time-entries` | GET `/items/:id/time-entries` | **MISSING** | **MISSING** |
| Updates/Comments | POST `/items/:id/updates` | GET `/items/:id/updates` | **MISSING** | **MISSING** |

Users cannot rename groups, delete uploaded files, correct time entries, or edit comments. These are basic expectations for any project management tool.

## Solution

Add the missing PATCH and DELETE endpoints. Each follows existing patterns (parameterized queries, workspace access checks, soft-delete where appropriate).

---

## API Endpoints

### 1. Group Rename/Reorder

**PATCH `/tasks/groups/:groupId`**

```js
// Request
{ "name": "New Group Name", "order_index": 2 }

// Both fields optional. At least one required.

// Response
{ "id": "uuid", "name": "New Group Name", "order_index": 2, "board_id": "uuid" }
```

**Implementation:**
```js
router.patch('/groups/:groupId', authenticateRequest, async (req, res) => {
  const { groupId } = req.params;
  const { name, order_index } = req.body;

  if (!name && order_index === undefined) {
    return res.status(400).json({ error: 'name or order_index required' });
  }

  // Resolve board for access check
  const { rows: [group] } = await query(
    'SELECT g.*, b.workspace_id FROM task_groups g JOIN task_boards b ON b.id = g.board_id WHERE g.id = $1',
    [groupId]
  );
  if (!group) return res.status(404).json({ error: 'Group not found' });

  await assertWorkspaceAccess(req, group.workspace_id);

  const sets = [];
  const vals = [];
  let idx = 1;

  if (name) { sets.push(`name = $${idx++}`); vals.push(name.trim()); }
  if (order_index !== undefined) { sets.push(`order_index = $${idx++}`); vals.push(order_index); }

  vals.push(groupId);
  const { rows: [updated] } = await query(
    `UPDATE task_groups SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  res.json(updated);
});
```

### 2. File Delete

**DELETE `/tasks/files/:fileId`**

```js
// Response
{ "success": true }
```

**Implementation:**
```js
router.delete('/files/:fileId', authenticateRequest, async (req, res) => {
  const { fileId } = req.params;

  // Resolve file + board for access check
  const { rows: [file] } = await query(
    `SELECT f.*, g.board_id, b.workspace_id
     FROM task_files f
     JOIN task_items i ON i.id = f.item_id
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE f.id = $1`,
    [fileId]
  );
  if (!file) return res.status(404).json({ error: 'File not found' });

  await assertWorkspaceAccess(req, file.workspace_id);

  // Delete DB record
  await query('DELETE FROM task_files WHERE id = $1', [fileId]);

  // Delete from GCS (fire-and-forget — if physical delete fails, file is orphaned but DB is clean)
  if (file.gcs_path) {
    deleteFileFromGCS(file.gcs_path).catch(err =>
      console.error('Failed to delete file from GCS:', err.message)
    );
  }

  res.json({ success: true });
});
```

**Note:** The `deleteFileFromGCS` helper needs to be created or imported. If files are stored via `@google-cloud/storage`, the pattern is:
```js
async function deleteFileFromGCS(gcsPath) {
  const bucket = storage.bucket(process.env.GCS_BUCKET);
  await bucket.file(gcsPath).delete();
}
```

If GCS storage is not used (files stored as base64 or URL references), skip the physical deletion.

### 3. Time Entry Edit/Delete

**PATCH `/tasks/time-entries/:entryId`**

```js
// Request (all fields optional, at least one required)
{
  "time_spent_minutes": 120,
  "billable_minutes": 90,
  "description": "Updated description",
  "work_category": "Development",
  "is_billable": true
}

// Response — updated entry
{
  "id": "uuid", "item_id": "uuid", "user_id": "uuid",
  "time_spent_minutes": 120, "billable_minutes": 90,
  "description": "Updated description", "work_category": "Development",
  "is_billable": true, "created_at": "..."
}
```

**Permissions:** Entry creator OR workspace admin can edit.

**DELETE `/tasks/time-entries/:entryId`**

```js
// Response
{ "success": true }
```

**Permissions:** Entry creator OR workspace admin can delete.

**Implementation:**
```js
router.patch('/time-entries/:entryId', authenticateRequest, async (req, res) => {
  const { entryId } = req.params;
  const { time_spent_minutes, billable_minutes, description, work_category, is_billable } = req.body;

  // Resolve entry + board for access check
  const { rows: [entry] } = await query(
    `SELECT t.*, g.board_id, b.workspace_id
     FROM task_time_entries t
     JOIN task_items i ON i.id = t.item_id
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE t.id = $1`,
    [entryId]
  );
  if (!entry) return res.status(404).json({ error: 'Time entry not found' });

  await assertWorkspaceAccess(req, entry.workspace_id);

  // Only creator or admin can edit
  const eff = req.user.effective_role;
  if (entry.user_id !== req.user.id && !['superadmin', 'admin'].includes(eff)) {
    return res.status(403).json({ error: 'Only the creator or an admin can edit this entry' });
  }

  const sets = [];
  const vals = [];
  let idx = 1;

  if (time_spent_minutes !== undefined) { sets.push(`time_spent_minutes = $${idx++}`); vals.push(time_spent_minutes); }
  if (billable_minutes !== undefined) { sets.push(`billable_minutes = $${idx++}`); vals.push(billable_minutes); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
  if (work_category !== undefined) { sets.push(`work_category = $${idx++}`); vals.push(work_category); }
  if (is_billable !== undefined) { sets.push(`is_billable = $${idx++}`); vals.push(is_billable); }

  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });

  vals.push(entryId);
  const { rows: [updated] } = await query(
    `UPDATE task_time_entries SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  res.json(updated);
});

router.delete('/time-entries/:entryId', authenticateRequest, async (req, res) => {
  const { entryId } = req.params;

  const { rows: [entry] } = await query(
    `SELECT t.*, b.workspace_id
     FROM task_time_entries t
     JOIN task_items i ON i.id = t.item_id
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE t.id = $1`,
    [entryId]
  );
  if (!entry) return res.status(404).json({ error: 'Time entry not found' });

  await assertWorkspaceAccess(req, entry.workspace_id);

  const eff = req.user.effective_role;
  if (entry.user_id !== req.user.id && !['superadmin', 'admin'].includes(eff)) {
    return res.status(403).json({ error: 'Only the creator or an admin can delete this entry' });
  }

  await query('DELETE FROM task_time_entries WHERE id = $1', [entryId]);
  res.json({ success: true });
});
```

### 4. Update/Comment Edit/Delete

**PATCH `/tasks/updates/:updateId`**

```js
// Request
{ "content": "Updated comment text" }

// Response — updated comment
{ "id": "uuid", "item_id": "uuid", "user_id": "uuid", "content": "Updated comment text", "created_at": "..." }
```

**Permissions:** Only the comment creator can edit.

**DELETE `/tasks/updates/:updateId`**

```js
// Response
{ "success": true }
```

**Permissions:** Comment creator OR workspace admin can delete.

**Implementation:**
```js
router.patch('/updates/:updateId', authenticateRequest, async (req, res) => {
  const { updateId } = req.params;
  const { content } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

  const { rows: [update] } = await query(
    `SELECT u.*, g.board_id, b.workspace_id
     FROM task_updates u
     JOIN task_items i ON i.id = u.item_id
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE u.id = $1`,
    [updateId]
  );
  if (!update) return res.status(404).json({ error: 'Update not found' });

  await assertWorkspaceAccess(req, update.workspace_id);

  // Only creator can edit their own comment
  if (update.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the author can edit this comment' });
  }

  const { rows: [updated] } = await query(
    'UPDATE task_updates SET content = $1 WHERE id = $2 RETURNING *',
    [content.trim(), updateId]
  );

  res.json(updated);
});

router.delete('/updates/:updateId', authenticateRequest, async (req, res) => {
  const { updateId } = req.params;

  const { rows: [update] } = await query(
    `SELECT u.*, b.workspace_id
     FROM task_updates u
     JOIN task_items i ON i.id = u.item_id
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE u.id = $1`,
    [updateId]
  );
  if (!update) return res.status(404).json({ error: 'Update not found' });

  await assertWorkspaceAccess(req, update.workspace_id);

  const eff = req.user.effective_role;
  if (update.user_id !== req.user.id && !['superadmin', 'admin'].includes(eff)) {
    return res.status(403).json({ error: 'Only the author or an admin can delete this comment' });
  }

  // Also delete associated read receipts
  await query('DELETE FROM task_update_views WHERE update_id = $1', [updateId]);
  await query('DELETE FROM task_updates WHERE id = $1', [updateId]);

  res.json({ success: true });
});
```

---

## Frontend API Methods

Add to `src/api/tasks.js`:

```js
// Groups
export const updateTaskGroup = (groupId, data) =>
  api.patch(`/tasks/groups/${groupId}`, data).then(r => r.data);

// Files
export const deleteTaskFile = (fileId) =>
  api.delete(`/tasks/files/${fileId}`).then(r => r.data);

// Time Entries
export const updateTaskTimeEntry = (entryId, data) =>
  api.patch(`/tasks/time-entries/${entryId}`, data).then(r => r.data);
export const deleteTaskTimeEntry = (entryId) =>
  api.delete(`/tasks/time-entries/${entryId}`).then(r => r.data);

// Updates/Comments
export const updateTaskItemUpdate = (updateId, data) =>
  api.patch(`/tasks/updates/${updateId}`, data).then(r => r.data);
export const deleteTaskItemUpdate = (updateId) =>
  api.delete(`/tasks/updates/${updateId}`).then(r => r.data);
```

---

## UI Changes

### Group Header (BoardTable.jsx)

Add inline rename: double-click group name → editable TextField → blur/Enter saves via `updateTaskGroup`.

### File List (Item Drawer)

Add delete button (trash icon) on each file row. Click → ConfirmDialog → `deleteTaskFile` → remove from local state.

### Time Entry List (Item Drawer)

Add edit (pencil) and delete (trash) icons on each time entry row:
- Edit → inline edit or small FormDialog → `updateTaskTimeEntry` → update local state
- Delete → ConfirmDialog → `deleteTaskTimeEntry` → remove from local state

### Updates/Comments (Item Drawer)

Add "Edit" and "Delete" actions to each comment (only visible to the comment author or admin):
- Edit → switch comment to editable TextField → save via `updateTaskItemUpdate`
- Delete → ConfirmDialog → `deleteTaskItemUpdate` → remove from local state

---

## Validation

1. `yarn build` — passes
2. Rename group → verify name updates in board view
3. Reorder group → verify order changes
4. Delete file → verify file disappears from item drawer
5. Edit time entry (change minutes) → verify updated value shows
6. Delete time entry → verify removed from list
7. Edit comment → verify updated text shows
8. Delete comment → verify removed from list
9. Non-author tries to edit comment → verify 403
10. Non-admin non-author tries to delete time entry → verify 403

## Files Affected

### Modified Files
- `server/routes/tasks.js` — 7 new endpoints (1 group, 1 file, 2 time entry, 2 update, totaling ~200 lines)
- `src/api/tasks.js` — 6 new API methods
- `src/views/tasks/components/BoardTable.jsx` — inline group rename
- `src/views/tasks/TaskManager.jsx` — edit/delete UI for files, time entries, updates in item drawer
