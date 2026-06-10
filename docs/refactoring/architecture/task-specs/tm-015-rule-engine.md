# Feature: Rule Engine Upgrade (TM-015)

## Problem

The current automation engine supports only 3 trigger types and 5 action types with no conditional logic, no multi-step chains, and no cross-board actions. Users cannot build workflows like "When status = Done AND assignee is in Engineering, move to QA Board" or "When item created, auto-assign to project lead AND add a welcome comment."

## Solution

Upgrade the automation engine to support multi-step chains, conditional branching, 5 new trigger types, and 10 new action types. The rule engine subscribes to events from the event bus (TM-014) instead of being called directly from route handlers.

## Prerequisites

- **TM-014**: Event Bus must be implemented (the rule engine subscribes to events)

---

## Data Model

### Extend existing tables (additive only)

```sql
-- Add execution metadata to existing automation tables
ALTER TABLE task_board_automations
  ADD COLUMN IF NOT EXISTS trigger_events TEXT[] DEFAULT '{}',  -- event types this rule listens to
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE task_global_automations
  ADD COLUMN IF NOT EXISTS trigger_events TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
```

### New tables

```sql
-- Multi-step action chains for an automation
CREATE TABLE IF NOT EXISTS task_automation_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL,           -- FK to board or global automations (intentionally not constrained)
  automation_scope TEXT NOT NULL,         -- 'board' | 'global'
  step_order INTEGER NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition_type TEXT,                   -- NULL (always run), 'if', 'else'
  condition_config JSONB,               -- { field, operator, value } for 'if' conditions
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_automation_steps_automation
  ON task_automation_steps (automation_scope, automation_id, step_order);

-- Rate limiting per account
CREATE TABLE IF NOT EXISTS task_automation_quota (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start DATE NOT NULL DEFAULT (CURRENT_DATE - (EXTRACT(day FROM CURRENT_DATE)::int - 1) * INTERVAL '1 day')::date,
  actions_consumed INTEGER NOT NULL DEFAULT 0,
  actions_limit INTEGER NOT NULL DEFAULT 10000,  -- default monthly limit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_start)
);
```

---

## Trigger Types (8 total: 3 existing + 5 new)

### Existing (unchanged behavior, now event-bus-driven)

| Trigger | Event Type | Notes |
|---------|-----------|-------|
| `status_change` | `item.status_changed` | Optional `to_status` filter |
| `assignee_added` | `assignee.added` | No filter config |
| `due_date_relative` | Cron-driven | Remains cron-based (not event-driven) |

### New Triggers

| Trigger | Event Type | Config |
|---------|-----------|--------|
| `item_created` | `item.created` | Optional `board_id` or `group_id` filter |
| `item_archived` | `item.archived` | Optional `board_id` filter |
| `update_created` | `update.created` | Optional: only when content contains keyword |
| `assignee_removed` | `assignee.removed` | No filter config |
| `recurring_schedule` | Cron-driven | `{ cron_expression, timezone }` — daily/weekly/monthly |

### Trigger Registration

Each automation's `trigger_events` array maps to event bus subscriptions. On startup, the rule engine registers listeners for all event types that have active rules.

```js
// In taskEventSubscribers.js
onTaskEvent('item.created', async (event) => {
  await ruleEngine.evaluateRules('item_created', event);
});

onTaskEvent('item.status_changed', async (event) => {
  await ruleEngine.evaluateRules('status_change', event);
});
// ... etc
```

---

## Action Types (15 total: 5 existing + 10 new)

### Existing (unchanged)

| Action | Implementation |
|--------|---------------|
| `notify_admins` | Send notification to all admins |
| `notify_assignees` | Send notification to item assignees |
| `set_status` | Update item status |
| `set_needs_attention` | Set/clear needs_attention flag |
| `add_update` | Add system-generated comment |

### New Actions

| Action | Config | Implementation |
|--------|--------|---------------|
| `move_item_to_group` | `{ group_id }` | UPDATE task_items SET group_id |
| `move_item_to_board` | `{ board_id, group_id }` | Update item's group to a group on the target board. Permission check: actor must have access to both boards. |
| `create_item` | `{ board_id, group_id, name, status }` | INSERT into task_items. Name supports template variables: `{item.name}`, `{item.status}`. |
| `duplicate_item` | `{ target_group_id, copy_assignees, copy_subitems }` | Clone item with configurable field copying |
| `create_subitem` | `{ name, status }` | INSERT into task_subitems on the triggering item |
| `send_email` | `{ to, subject, body }` | Via Mailgun (already integrated). Supports template variables. |
| `archive_item` | `{}` | SET archived_at = NOW() on the triggering item |
| `assign_person` | `{ user_id }` | INSERT into task_item_assignees |
| `start_time_tracking` | `{ category, description }` | INSERT time entry with start timestamp (future: real-time tracking) |
| `trigger_webhook` | `{ url, method, headers }` | Outbound HTTP POST/PUT with signed payload (HMAC-SHA256) |

### Template Variables

Actions that accept string config (`name`, `subject`, `body`) support variable interpolation:

| Variable | Value |
|----------|-------|
| `{item.name}` | Item name |
| `{item.status}` | Item status |
| `{item.due_date}` | Item due date |
| `{board.name}` | Board name |
| `{actor.name}` | User who triggered the event |
| `{actor.email}` | User email |
| `{assignee.name}` | (For assignee triggers) the added/removed assignee |

---

## Multi-Step Chains

An automation can have multiple steps executed sequentially. Steps are stored in `task_automation_steps` ordered by `step_order`.

### Execution Flow

```
Event arrives → Find matching rules → For each rule:
  1. Check rate limit quota
  2. Load steps ordered by step_order
  3. For each step:
     a. If condition_type is 'if': evaluate condition
        - If TRUE: execute this step's action, continue to next step
        - If FALSE: skip to next 'else' step (or end chain)
     b. If condition_type is 'else': only execute if previous 'if' was FALSE
     c. If condition_type is NULL: always execute
     d. If action fails: log error, halt chain
  4. Log automation run (success/error/partial)
  5. Increment rate limit counter
```

### Conditional Branching

Conditions evaluate against the event payload or current item state:

```js
// condition_config example
{
  "field": "new_value.status",  // dot-path into event
  "operator": "equals",         // equals, not_equals, contains, gt, lt, in
  "value": "Done"
}
```

Supported operators: `equals`, `not_equals`, `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `is_empty`, `is_not_empty`.

### Example: Multi-Step Chain

```
Automation: "When status = Done, process completion"
Steps:
  1. (always) set_needs_attention: false
  2. (if status was "Stuck") add_update: "Item recovered from Stuck and completed!"
  3. (always) notify_assignees: "Item completed"
  4. (always) create_subitem: "Post-completion review"
```

---

## Cross-Board Rules

A global automation can reference boards by ID in its action config. Permission check at rule creation time AND at execution time:

- **Creation**: The user creating the rule must have workspace access to all referenced boards
- **Execution**: The system verifies the target board still exists and the automation's creator still has access

If a cross-board action fails permission, the step is logged as `error` and the chain halts.

---

## Rate Limiting

Track actions consumed per month in `task_automation_quota`:

```js
async function checkAndIncrementQuota() {
  const periodStart = /* first day of current month */;
  const { rows } = await query(
    `INSERT INTO task_automation_quota (period_start, actions_consumed)
     VALUES ($1, 1)
     ON CONFLICT (period_start) DO UPDATE
     SET actions_consumed = task_automation_quota.actions_consumed + 1
     RETURNING actions_consumed, actions_limit`,
    [periodStart]
  );
  const { actions_consumed, actions_limit } = rows[0];
  if (actions_consumed > actions_limit) {
    throw new Error(`Automation quota exceeded: ${actions_consumed}/${actions_limit}`);
  }
}
```

Default limit: 10,000 actions/month (configurable via env var `TASK_AUTOMATION_MONTHLY_LIMIT`).

When quota is exceeded:
1. Log a warning event
2. Skip the automation (log as `skipped` with reason `quota_exceeded`)
3. Continue processing other automations (don't block the entire batch)

---

## API Endpoints

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/automations/:id/steps` | List steps for an automation |
| POST | `/automations/:id/steps` | Add step to automation |
| PATCH | `/automations/steps/:stepId` | Update a step |
| DELETE | `/automations/steps/:stepId` | Delete a step |
| PATCH | `/automations/steps/:stepId/reorder` | Change step_order |
| GET | `/automations/quota` | Get current month's quota usage |

### Modified Endpoints

| Method | Path | Changes |
|--------|------|---------|
| POST | `/boards/:boardId/automations` | Accept `steps[]` array for multi-step creation |
| PATCH | `/automations/:automationId` | Accept `trigger_events[]` for event bus registration |

---

## UI Changes

### AutomationsPane.jsx

Add step builder to automation creation/editing:

```
+-- Trigger selector (expanded to 8 types)
+-- Steps list (sortable)
|   +-- Step 1: [condition?] → [action type] → [config]
|   +-- Step 2: [condition?] → [action type] → [config]
|   +-- [+ Add Step]
+-- Save / Cancel
```

### EditAutomationDialog.jsx

Expand to support:
- New trigger types with appropriate config UI
- Step list with drag-drop reorder
- Condition builder (field, operator, value dropdowns)
- Action config forms for each action type
- Template variable helper (insert button)

---

## Migration Strategy

### Phase A: Database + Backend
1. Run migrations (new tables, ALTER existing)
2. Implement `ruleEngine.evaluateRules()` with multi-step support
3. Register event bus subscribers for all trigger types
4. Implement new action types one at a time (start with `move_item_to_group`, `create_item`)
5. Rate limiting middleware

### Phase B: Frontend
1. Expand trigger type selector
2. Build step builder UI
3. Condition builder UI
4. Action config forms for new types

### Feature Flag
`TASK_RULE_ENGINE_V2=true` — when enabled, new trigger/action types are available. When disabled, only the original 3/5 are shown.

---

## Validation

1. `yarn build` — passes
2. Create automation with `item_created` trigger → create item → verify automation fires
3. Create multi-step chain → trigger → verify steps execute in order
4. Create conditional chain (if/else) → verify correct branch executes
5. Cross-board `move_item_to_board` → verify item appears on target board
6. `trigger_webhook` → verify outbound HTTP with HMAC signature
7. Rate limit: set limit to 5, fire 6 actions → verify 6th is skipped
8. Chain failure: step 2 fails → verify step 3 does not execute, run logged as `partial`

## Files Affected

### New Files
- `server/sql/task-automation-steps.sql`
- `server/sql/task-automation-quota.sql`

### Modified Files
- `server/services/taskAutomations.js` — major rewrite to support steps, conditions, new actions
- `server/services/taskEventSubscribers.js` — register new trigger types
- `server/routes/tasks.js` — new step CRUD endpoints, quota endpoint
- `src/api/tasks.js` — new API methods for steps
- `src/views/tasks/panes/AutomationsPane.jsx` — expanded UI
- `src/views/tasks/components/EditAutomationDialog.jsx` — step builder
