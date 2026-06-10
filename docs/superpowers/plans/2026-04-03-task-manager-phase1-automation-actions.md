# Task Manager Phase 1: Complete Automation Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 14 stubbed automation actions so the full automation engine is functional end-to-end.

**Architecture:** All 14 actions are added to the existing `executeAction()` function in `server/services/taskAutomations.js`. Each new action type is also added to the `LEGACY_ACTION_TYPES` set in `server/services/ruleEngine.js` so the rule engine routes them correctly. Frontend changes are minimal — remove `soon: true` flags and add config field UI for each action.

**Tech Stack:** Express.js, PostgreSQL, Mailgun (for send_email), Node fetch (for send_webhook)

**Design Spec:** `docs/superpowers/specs/2026-04-03-task-manager-enterprise-upgrade-design.md`

**Verification:** This project has NO automated test suite. Verify via:
1. `yarn build` — must succeed (catches import errors, dead code)
2. `yarn lint` — must pass
3. Manual test — create automations in the UI and trigger them

---

## File Map

| File | Action |
|------|--------|
| `server/services/taskAutomations.js` | Modify: add 14 new cases to `executeAction()` (lines 107-172) |
| `server/services/ruleEngine.js` | Modify: expand `LEGACY_ACTION_TYPES` set (line 55-57) |
| `src/constants/automationTypes.js` | Modify: remove `soon: true` from 14 actions, add config fields (lines 17-40, 105-122) |
| `src/views/tasks/components/EditAutomationDialog.jsx` | Modify: add config UI for each new action type |

---

### Task 1: Implement Tier 1 actions — set_due_date, clear_due_date, archive_item

**Files:**
- Modify: `server/services/taskAutomations.js:164-171` (add cases before the default return)
- Modify: `server/services/ruleEngine.js:55-57` (expand LEGACY_ACTION_TYPES)

- [ ] **Step 1: Add three action cases to executeAction()**

In `server/services/taskAutomations.js`, add three new `if` blocks before the final `return { ok: false, error: ... }` at line 171:

```javascript
  if (actionType === 'set_due_date') {
    const dueDate = action.due_date || null;
    if (!dueDate) return { ok: false, error: 'Missing due_date' };
    await query(`UPDATE task_items SET due_date = $1, updated_at = NOW() WHERE id = $2`, [dueDate, itemId]);
    return { ok: true };
  }

  if (actionType === 'clear_due_date') {
    await query(`UPDATE task_items SET due_date = NULL, updated_at = NOW() WHERE id = $1`, [itemId]);
    return { ok: true };
  }

  if (actionType === 'archive_item') {
    await query(
      `UPDATE task_items SET archived_at = COALESCE(archived_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [itemId]
    );
    return { ok: true };
  }
```

- [ ] **Step 2: Register in LEGACY_ACTION_TYPES**

In `server/services/ruleEngine.js`, expand the set at lines 55-57:

```javascript
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item'
]);
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success, no errors

- [ ] **Step 4: Commit**

```bash
git add server/services/taskAutomations.js server/services/ruleEngine.js
git commit -m "feat(tasks): implement set_due_date, clear_due_date, archive_item automation actions"
```

---

### Task 2: Implement Tier 2a actions — assign_user, remove_assignee

**Files:**
- Modify: `server/services/taskAutomations.js` (add cases)
- Modify: `server/services/ruleEngine.js:55-57` (expand set)

- [ ] **Step 1: Add two action cases to executeAction()**

In `server/services/taskAutomations.js`, add before the final return:

```javascript
  if (actionType === 'assign_user') {
    const userId = action.user_id;
    if (!userId) return { ok: false, error: 'Missing user_id' };
    await query(
      `INSERT INTO task_item_assignees (item_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [itemId, userId]
    );
    return { ok: true };
  }

  if (actionType === 'remove_assignee') {
    const userId = action.user_id;
    if (!userId) return { ok: false, error: 'Missing user_id' };
    await query(`DELETE FROM task_item_assignees WHERE item_id = $1 AND user_id = $2`, [itemId, userId]);
    return { ok: true };
  }
```

- [ ] **Step 2: Register in LEGACY_ACTION_TYPES**

In `server/services/ruleEngine.js`, add to the set:

```javascript
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item',
  'assign_user', 'remove_assignee'
]);
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add server/services/taskAutomations.js server/services/ruleEngine.js
git commit -m "feat(tasks): implement assign_user, remove_assignee automation actions"
```

---

### Task 3: Implement Tier 2b actions — move_to_group, move_to_board

**Files:**
- Modify: `server/services/taskAutomations.js` (add cases)
- Modify: `server/services/ruleEngine.js:55-57` (expand set)

- [ ] **Step 1: Add two action cases to executeAction()**

In `server/services/taskAutomations.js`, add before the final return:

```javascript
  if (actionType === 'move_to_group') {
    const groupId = action.group_id;
    if (!groupId) return { ok: false, error: 'Missing group_id' };
    await query(`UPDATE task_items SET group_id = $1, updated_at = NOW() WHERE id = $2`, [groupId, itemId]);
    return { ok: true };
  }

  if (actionType === 'move_to_board') {
    const targetBoardId = action.board_id;
    if (!targetBoardId) return { ok: false, error: 'Missing board_id' };
    // Find the first group on the target board, or create a default one
    let { rows: targetGroups } = await query(
      `SELECT id FROM task_groups WHERE board_id = $1 ORDER BY order_index ASC LIMIT 1`,
      [targetBoardId]
    );
    let targetGroupId;
    if (targetGroups.length > 0) {
      targetGroupId = targetGroups[0].id;
    } else {
      const { rows: newGroup } = await query(
        `INSERT INTO task_groups (board_id, name, order_index) VALUES ($1, 'General', 0) RETURNING id`,
        [targetBoardId]
      );
      targetGroupId = newGroup[0].id;
    }
    await query(`UPDATE task_items SET group_id = $1, updated_at = NOW() WHERE id = $2`, [targetGroupId, itemId]);
    return { ok: true };
  }
```

- [ ] **Step 2: Register in LEGACY_ACTION_TYPES**

In `server/services/ruleEngine.js`, add to the set:

```javascript
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item',
  'assign_user', 'remove_assignee',
  'move_to_group', 'move_to_board'
]);
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add server/services/taskAutomations.js server/services/ruleEngine.js
git commit -m "feat(tasks): implement move_to_group, move_to_board automation actions"
```

---

### Task 4: Implement Tier 2c actions — create_item, duplicate_item, create_subitem

**Files:**
- Modify: `server/services/taskAutomations.js` (add cases)
- Modify: `server/services/ruleEngine.js:55-57` (expand set)

- [ ] **Step 1: Add three action cases to executeAction()**

In `server/services/taskAutomations.js`, add before the final return:

```javascript
  if (actionType === 'create_item') {
    const name = String(action.name || '').trim();
    if (!name) return { ok: false, error: 'Missing name' };
    // Default: create in the same group as the triggering item
    let targetGroupId = action.group_id;
    if (!targetGroupId && itemId) {
      const { rows } = await query(`SELECT group_id FROM task_items WHERE id = $1`, [itemId]);
      targetGroupId = rows[0]?.group_id;
    }
    if (!targetGroupId) return { ok: false, error: 'Could not resolve target group' };
    const status = action.status || 'To Do';
    const dueDate = action.due_date || null;
    await query(
      `INSERT INTO task_items (group_id, name, status, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [targetGroupId, name, status, dueDate, actorUserId || null]
    );
    return { ok: true };
  }

  if (actionType === 'duplicate_item') {
    if (!itemId) return { ok: false, error: 'No item to duplicate' };
    const { rows: origRows } = await query(`SELECT * FROM task_items WHERE id = $1`, [itemId]);
    const orig = origRows[0];
    if (!orig) return { ok: false, error: 'Original item not found' };
    const targetGroupId = action.group_id || orig.group_id;
    const { rows: newRows } = await query(
      `INSERT INTO task_items (group_id, name, status, due_date, needs_attention, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [targetGroupId, orig.name + ' (copy)', 'To Do', orig.due_date, orig.needs_attention, actorUserId || null]
    );
    // Copy assignees
    const newId = newRows[0].id;
    await query(
      `INSERT INTO task_item_assignees (item_id, user_id)
       SELECT $1, user_id FROM task_item_assignees WHERE item_id = $2`,
      [newId, itemId]
    );
    return { ok: true };
  }

  if (actionType === 'create_subitem') {
    if (!itemId) return { ok: false, error: 'No parent item' };
    const name = String(action.name || '').trim();
    if (!name) return { ok: false, error: 'Missing name' };
    const status = action.status || 'To Do';
    await query(
      `INSERT INTO task_subitems (parent_item_id, name, status) VALUES ($1, $2, $3)`,
      [itemId, name, status]
    );
    return { ok: true };
  }
```

- [ ] **Step 2: Register in LEGACY_ACTION_TYPES**

In `server/services/ruleEngine.js`, add to the set:

```javascript
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item',
  'assign_user', 'remove_assignee',
  'move_to_group', 'move_to_board',
  'create_item', 'duplicate_item', 'create_subitem'
]);
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add server/services/taskAutomations.js server/services/ruleEngine.js
git commit -m "feat(tasks): implement create_item, duplicate_item, create_subitem automation actions"
```

---

### Task 5: Implement Tier 3 actions — send_email, send_webhook

**Files:**
- Modify: `server/services/taskAutomations.js` (add import + cases)
- Modify: `server/services/ruleEngine.js:55-57` (expand set)

- [ ] **Step 1: Add Mailgun import to taskAutomations.js**

At the top of `server/services/taskAutomations.js`, add after the existing imports (line 2):

```javascript
import { sendMailgunMessageWithLogging, isMailgunConfigured } from './mailgun.js';
```

- [ ] **Step 2: Add send_email action case**

In `server/services/taskAutomations.js`, add before the final return:

```javascript
  if (actionType === 'send_email') {
    if (!isMailgunConfigured()) return { ok: false, error: 'Mailgun not configured' };
    const to = action.to;
    if (!to) return { ok: false, error: 'Missing recipient (to)' };
    const subject = action.subject || title;
    const text = action.body || body;
    try {
      await sendMailgunMessageWithLogging(
        { to, subject, text },
        { emailType: 'task_automation', relatedEntityType: 'task_item', relatedEntityId: itemId }
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Email send failed: ${err.message}` };
    }
  }
```

- [ ] **Step 3: Add send_webhook action case**

In `server/services/taskAutomations.js`, add before the final return:

```javascript
  if (actionType === 'send_webhook') {
    const url = action.url;
    if (!url) return { ok: false, error: 'Missing webhook URL' };
    const payload = JSON.stringify({
      event: 'task_automation',
      automation_id: rule.id,
      item_id: itemId,
      board_id: boardId,
      action_type: actionType,
      timestamp: new Date().toISOString(),
      data: action.data || {}
    });
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) return { ok: false, error: `Webhook returned ${resp.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Webhook failed: ${err.message}` };
    }
  }
```

- [ ] **Step 4: Register in LEGACY_ACTION_TYPES**

In `server/services/ruleEngine.js`, add to the set:

```javascript
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item',
  'assign_user', 'remove_assignee',
  'move_to_group', 'move_to_board',
  'create_item', 'duplicate_item', 'create_subitem',
  'send_email', 'send_webhook'
]);
```

- [ ] **Step 5: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 6: Commit**

```bash
git add server/services/taskAutomations.js server/services/ruleEngine.js
git commit -m "feat(tasks): implement send_email, send_webhook automation actions"
```

---

### Task 6: Implement Tier 4 actions — start_time_tracking, stop_time_tracking

**Files:**
- Modify: `server/services/taskAutomations.js` (add cases)
- Modify: `server/services/ruleEngine.js:55-57` (expand set)

- [ ] **Step 1: Add two action cases to executeAction()**

In `server/services/taskAutomations.js`, add before the final return:

```javascript
  if (actionType === 'start_time_tracking') {
    if (!itemId) return { ok: false, error: 'No item' };
    const category = action.work_category || 'Automation';
    const description = action.description || 'Started by automation';
    await query(
      `INSERT INTO task_time_entries (item_id, user_id, time_spent_minutes, billable_minutes, is_billable, work_category, description)
       VALUES ($1, $2, 0, 0, false, $3, $4)`,
      [itemId, actorUserId || null, category, description]
    );
    return { ok: true };
  }

  if (actionType === 'stop_time_tracking') {
    if (!itemId) return { ok: false, error: 'No item' };
    // Find the most recent zero-minute entry (active timer) for this item
    const { rows } = await query(
      `SELECT id, created_at FROM task_time_entries
       WHERE item_id = $1 AND time_spent_minutes = 0
       ORDER BY created_at DESC LIMIT 1`,
      [itemId]
    );
    if (rows.length === 0) return { ok: false, error: 'No active timer found' };
    const entry = rows[0];
    const elapsed = Math.max(1, Math.round((Date.now() - new Date(entry.created_at).getTime()) / 60000));
    await query(
      `UPDATE task_time_entries SET time_spent_minutes = $1, updated_at = NOW() WHERE id = $2`,
      [elapsed, entry.id]
    );
    return { ok: true };
  }
```

- [ ] **Step 2: Register in LEGACY_ACTION_TYPES**

In `server/services/ruleEngine.js`, update the set to its final form:

```javascript
const LEGACY_ACTION_TYPES = new Set([
  'notify_admins', 'notify_assignees', 'set_status', 'set_needs_attention', 'add_update',
  'set_due_date', 'clear_due_date', 'archive_item',
  'assign_user', 'remove_assignee',
  'move_to_group', 'move_to_board',
  'create_item', 'duplicate_item', 'create_subitem',
  'send_email', 'send_webhook',
  'start_time_tracking', 'stop_time_tracking'
]);
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add server/services/taskAutomations.js server/services/ruleEngine.js
git commit -m "feat(tasks): implement start_time_tracking, stop_time_tracking automation actions"
```

---

### Task 7: Frontend — remove "Soon" badges from automationTypes.js

**Files:**
- Modify: `src/constants/automationTypes.js:17-40` (remove `soon: true` from 14 actions)
- Modify: `src/constants/automationTypes.js:105-122` (add config field definitions)

- [ ] **Step 1: Remove `soon: true` flags from implemented actions**

In `src/constants/automationTypes.js`, update the ACTIONS array. Remove `soon: true` from all actions EXCEPT `set_priority` (deferred to Phase 2 labels), `set_column_value` (deferred to custom fields), and `add_file` (deferred). The result:

```javascript
export const ACTIONS = [
  { id: 'notify_admins', label: 'Notify admins', category: 'Notifications' },
  { id: 'notify_assignees', label: 'Notify assignees', category: 'Notifications' },
  { id: 'set_status', label: 'Change status', category: 'Item' },
  { id: 'set_needs_attention', label: 'Set attention flag', category: 'Item' },
  { id: 'add_update', label: 'Post an update', category: 'Activity' },
  { id: 'move_to_group', label: 'Move to group', category: 'Item' },
  { id: 'move_to_board', label: 'Move to board', category: 'Item' },
  { id: 'archive_item', label: 'Archive item', category: 'Item' },
  { id: 'assign_user', label: 'Assign someone', category: 'People' },
  { id: 'remove_assignee', label: 'Remove assignee', category: 'People' },
  { id: 'set_due_date', label: 'Set due date', category: 'Dates' },
  { id: 'set_priority', label: 'Set priority', category: 'Item', soon: true },
  { id: 'send_email', label: 'Send email', category: 'Integrations' },
  { id: 'send_webhook', label: 'Send webhook', category: 'Integrations' },
  { id: 'create_item', label: 'Create item', category: 'Item' },
  { id: 'create_subitem', label: 'Create subitem', category: 'Subitems' },
  { id: 'duplicate_item', label: 'Duplicate item', category: 'Item' },
  { id: 'clear_due_date', label: 'Clear due date', category: 'Dates' },
  { id: 'set_column_value', label: 'Set column value', category: 'Item', soon: true },
  { id: 'add_file', label: 'Add file', category: 'Activity', soon: true },
  { id: 'start_time_tracking', label: 'Start timer', category: 'Activity' },
  { id: 'stop_time_tracking', label: 'Stop timer', category: 'Activity' }
];
```

- [ ] **Step 2: Add config field definitions to getActionConfigFields()**

In `src/constants/automationTypes.js`, replace the `getActionConfigFields` function (lines 105-122):

```javascript
export function getActionConfigFields(actionType) {
  switch (actionType) {
    case 'notify_admins':
    case 'notify_assignees':
      return [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'body', label: 'Body', type: 'text', multiline: true }
      ];
    case 'set_status':
      return [{ key: 'status', label: 'Status', type: 'status_select' }];
    case 'set_needs_attention':
      return [{ key: 'value', label: 'Value', type: 'boolean' }];
    case 'add_update':
      return [{ key: 'content', label: 'Update content', type: 'text', multiline: true }];
    case 'set_due_date':
      return [{ key: 'due_date', label: 'Due date', type: 'date' }];
    case 'clear_due_date':
    case 'archive_item':
      return []; // no config needed
    case 'move_to_group':
      return [{ key: 'group_id', label: 'Target group', type: 'group_select' }];
    case 'move_to_board':
      return [{ key: 'board_id', label: 'Target board', type: 'board_select' }];
    case 'assign_user':
    case 'remove_assignee':
      return [{ key: 'user_id', label: 'Person', type: 'member_select' }];
    case 'create_item':
      return [
        { key: 'name', label: 'Item name', type: 'text' },
        { key: 'group_id', label: 'Target group (optional)', type: 'group_select' },
        { key: 'status', label: 'Status (optional)', type: 'text' }
      ];
    case 'create_subitem':
      return [
        { key: 'name', label: 'Subitem name', type: 'text' },
        { key: 'status', label: 'Status (optional)', type: 'text' }
      ];
    case 'duplicate_item':
      return [{ key: 'group_id', label: 'Target group (optional)', type: 'group_select' }];
    case 'send_email':
      return [
        { key: 'to', label: 'Recipient email', type: 'text' },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'body', label: 'Body', type: 'text', multiline: true }
      ];
    case 'send_webhook':
      return [{ key: 'url', label: 'Webhook URL', type: 'text' }];
    case 'start_time_tracking':
      return [
        { key: 'work_category', label: 'Category (optional)', type: 'text' },
        { key: 'description', label: 'Description (optional)', type: 'text' }
      ];
    case 'stop_time_tracking':
      return []; // no config needed
    default:
      return [];
  }
}
```

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add src/constants/automationTypes.js
git commit -m "feat(tasks): enable 14 automation actions in UI, add config field definitions"
```

---

### Task 8: Frontend — add config field rendering for new action types in EditAutomationDialog

**Files:**
- Modify: `src/views/tasks/components/EditAutomationDialog.jsx` (add config field rendering)

The dialog currently has hardcoded config fields for the 5 existing actions (lines 99-154). We need to add config UI for the new action types. The new types need: date picker, group selector, board selector, member selector, and text fields.

Since the component receives `statusLabels` but NOT groups, boards, or members, we need to pass those in. However, looking at the dialog's parent usage, we should keep it simple: use text fields for IDs initially (the user can paste a group/board/member UUID), and enhance with proper selectors in a follow-up. This avoids scope creep. The critical path is: the actions WORK backend, and the UI ALLOWS configuring them.

**Better approach:** Use the `getActionConfigFields()` function we just enhanced to render config fields dynamically instead of hardcoding each one. This replaces the manual blocks at lines 99-154 with a single loop.

- [ ] **Step 1: Refactor EditAutomationDialog to use dynamic config fields**

Replace `src/views/tasks/components/EditAutomationDialog.jsx` with:

```jsx
import { Chip, ListSubheader, MenuItem, Stack, TextField } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { groupedTriggers, groupedActions, getActionConfigFields } from 'constants/automationTypes';

export default function EditAutomationDialog({
  open, onClose,
  automation, editDraft, onChangeDraft,
  statusLabels, groups, boards, members,
  onSave, loading
}) {
  const triggerCategories = groupedTriggers();
  const actionCategories = groupedActions();
  const activeAction = editDraft.action_type || automation?.action_type || '';
  const activeTrigger = editDraft.trigger_type || automation?.trigger_type || '';
  const configFields = getActionConfigFields(activeAction);

  function setConfig(key, value) {
    onChangeDraft((p) => ({ ...p, action_config: { ...(p.action_config || {}), [key]: value } }));
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={onSave}
      title="Edit automation"
      submitLabel="Save"
      loading={loading}
    >
      <TextField
        size="small"
        label="Name"
        value={editDraft.name}
        onChange={(e) => onChangeDraft((p) => ({ ...p, name: e.target.value }))}
      />

      <SelectField
        label="Trigger"
        size="small"
        value={activeTrigger}
        onChange={(e) => onChangeDraft((p) => ({ ...p, trigger_type: e.target.value, trigger_config: {} }))}
      >
        {Object.entries(triggerCategories).flatMap(([cat, items]) => [
          <ListSubheader key={`th-${cat}`} sx={{ lineHeight: '32px', fontSize: '0.75rem' }}>
            {cat}
          </ListSubheader>,
          ...items.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))
        ])}
      </SelectField>

      <SelectField
        label="Action"
        size="small"
        value={activeAction}
        onChange={(e) => onChangeDraft((p) => ({ ...p, action_type: e.target.value, action_config: {} }))}
      >
        {Object.entries(actionCategories).flatMap(([cat, items]) => [
          <ListSubheader key={`ah-${cat}`} sx={{ lineHeight: '32px', fontSize: '0.75rem' }}>
            {cat}
          </ListSubheader>,
          ...items.map((a) => (
            <MenuItem key={a.id} value={a.id} disabled={a.soon}>
              <Stack direction="row" spacing={1} alignItems="center">
                <span>{a.label}</span>
                {a.soon && <Chip label="Soon" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />}
              </Stack>
            </MenuItem>
          ))
        ])}
      </SelectField>

      {/* Trigger-specific config */}
      {activeTrigger === 'status_change' && (
        <SelectField
          label="Target status"
          size="small"
          value={editDraft.trigger_config?.to_status || ''}
          onChange={(e) =>
            onChangeDraft((p) => ({ ...p, trigger_config: { ...(p.trigger_config || {}), to_status: e.target.value } }))
          }
        >
          <MenuItem value="">Any status</MenuItem>
          {(statusLabels || []).map((sl) => (
            <MenuItem key={sl.id || sl.label} value={sl.label}>
              {sl.label}
            </MenuItem>
          ))}
        </SelectField>
      )}

      {activeTrigger === 'due_date_relative' && (
        <TextField
          size="small"
          type="number"
          label="Days from due date"
          helperText="-10 = 10 days before, 0 = on due date, 1 = 1 day after"
          value={editDraft.trigger_config?.days_from_due ?? 0}
          onChange={(e) =>
            onChangeDraft((p) => ({ ...p, trigger_config: { ...(p.trigger_config || {}), days_from_due: Number(e.target.value) } }))
          }
        />
      )}

      {/* Action config fields — rendered dynamically */}
      {configFields.map((field) => {
        if (field.type === 'status_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || (statusLabels || [])[0]?.label || 'To Do'}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              {(statusLabels || []).map((sl) => (
                <MenuItem key={sl.id || sl.label} value={sl.label}>{sl.label}</MenuItem>
              ))}
            </SelectField>
          );
        }
        if (field.type === 'boolean') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={String(Boolean(editDraft.action_config?.[field.key]))}
              onChange={(e) => setConfig(field.key, e.target.value === 'true')}
              options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
            />
          );
        }
        if (field.type === 'date') {
          return (
            <TextField
              key={field.key}
              size="small"
              type="date"
              label={field.label}
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          );
        }
        if (field.type === 'group_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              <MenuItem value="">Same group</MenuItem>
              {(groups || []).map((g) => (
                <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>
              ))}
            </SelectField>
          );
        }
        if (field.type === 'board_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              {(boards || []).map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
              ))}
            </SelectField>
          );
        }
        if (field.type === 'member_select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              size="small"
              value={editDraft.action_config?.[field.key] || ''}
              onChange={(e) => setConfig(field.key, e.target.value)}
            >
              {(members || []).map((m) => (
                <MenuItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</MenuItem>
              ))}
            </SelectField>
          );
        }
        // Default: text field
        return (
          <TextField
            key={field.key}
            size="small"
            label={field.label}
            multiline={field.multiline || false}
            minRows={field.multiline ? 2 : undefined}
            value={editDraft.action_config?.[field.key] || ''}
            onChange={(e) => setConfig(field.key, e.target.value)}
          />
        );
      })}
    </FormDialog>
  );
}
```

- [ ] **Step 2: Pass groups, boards, members props from AutomationsPane**

`EditAutomationDialog` is rendered only in `src/views/tasks/panes/AutomationsPane.jsx` at line 984. The `useTaskContext()` hook (line 161) already provides `allBoards` and `workspaceMembers`. Groups need to come from the active board's view data.

In `AutomationsPane.jsx`, update the `useTaskContext` destructure at line 161 to include `workspaceMembers`:

```javascript
const { allBoards, boardsLoading: loadingBoards, loadAllBoards, workspaceMembers } = useTaskContext();
```

Then at the `<EditAutomationDialog` render site (line 984), add the three new props:

```jsx
<EditAutomationDialog
  open={editDialogOpen}
  onClose={() => { setEditDialogOpen(false); setEditingAutomation(null); }}
  automation={editingAutomation}
  editDraft={editDraft}
  onChangeDraft={setEditDraft}
  statusLabels={effectiveStatusLabels}
  groups={boardGroups}
  boards={allBoards}
  members={workspaceMembers}
  onSave={handleSaveEdit}
/>
```

For `groups`: the pane already fetches status labels per board. Add a `boardGroups` state that loads from the active board's view. If groups aren't readily available, pass `[]` and groups will show "Same group" as the only option (acceptable for Phase 1 — the backend defaults to the current group anyway).

- [ ] **Step 3: Verify build**

Run: `yarn build`
Expected: Success

- [ ] **Step 4: Verify lint**

Run: `yarn lint`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/views/tasks/components/EditAutomationDialog.jsx
git add src/views/tasks/panes/AutomationsPane.jsx
git add src/views/tasks/components/AutomationsDrawer.jsx
git commit -m "feat(tasks): dynamic config field rendering for all automation actions"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full build check**

Run: `yarn build`
Expected: Success, zero errors

- [ ] **Step 2: Lint check**

Run: `yarn lint`
Expected: No new warnings/errors

- [ ] **Step 3: Manual smoke test**

Start the dev server with `./dev.sh` and verify:
1. Navigate to Tasks → Automations pane
2. Click "New Automation"
3. Confirm all 14 previously-grayed-out actions are now selectable
4. Confirm the 3 remaining deferred actions (set_priority, set_column_value, add_file) still show "Soon"
5. Select each action type and confirm config fields appear correctly
6. Create a test automation (e.g., "When status changes to Done → archive_item") and verify it fires

- [ ] **Step 4: Push to remote**

```bash
git push origin HEAD
```
