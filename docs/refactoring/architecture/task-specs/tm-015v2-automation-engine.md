# Feature: Automation Engine v2 (TM-015v2)

> **Supersedes:** `tm-015-rule-engine.md` (original 8-trigger, 15-action spec)
> **Depends on:** `tm-014-event-bus.md` (event infrastructure — unchanged)
> **Status:** Spec complete, execution pending

## Problem

The current automation engine is a toy. Three triggers (`status_change`, `assignee_added`, `due_date_relative`), five actions, single trigger→action pairs, no chaining, no conditions. Users can't express even basic workflows like "When Person A finishes → assign Person B and C → when both finish → QC stage."

The original TM-015 spec adds multi-step chains and basic if/else, bringing us to 8 triggers and 15 actions. But it still lacks the features that make automation engines genuinely useful in production: **fan-out/fan-in workflows, delay blocks, AND/OR condition groups, workspace-scoped rules, and pre-built templates.**

### Competitive Landscape

| Feature | Monday.com | Asana | ClickUp | Jira | This Spec |
|---------|-----------|-------|---------|------|-----------|
| Multi-step chains | Yes | Yes | Yes | Yes | Yes |
| Conditional branching | If/then/else | Rules | If/else | Yes (advanced) | AND/OR groups |
| Fan-out (parallel actions) | Yes | Limited | Yes | Yes | Yes |
| Fan-in (wait for all) | No | No | No | No | **Yes** |
| Delay blocks | Yes | No | No | Yes | Yes |
| Cross-board actions | Yes | Cross-project | Yes | Cross-project | Yes |
| Pre-built templates | ~200 | ~50 | ~100 | ~50 | ~15 (MVP) |
| Workspace-scope rules | Yes | Yes | Yes | Yes | Yes |

**Differentiation opportunity:** No platform handles fan-in (wait for multiple assignees/subitems to complete before proceeding) as a first-class primitive. Our `all_subitems_completed` trigger is a genuine differentiator.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Mutation Endpoints              │
│           (35 endpoints in routes/tasks.js)       │
└───────────────────┬─────────────────────────────┘
                    │ emitTaskEvent()
                    ▼
┌─────────────────────────────────────────────────┐
│            TM-014: Event Bus                     │
│    (EventEmitter + task_events persistence)       │
│                                                   │
│  Events: item.created, item.status_changed,       │
│          subitem.updated, assignee.added, ...      │
└───────────────────┬─────────────────────────────┘
                    │ onTaskEvent(type, handler)
                    ▼
┌─────────────────────────────────────────────────┐
│         TM-015v2: Rule Engine v2                 │
│                                                   │
│  1. Match rules by trigger_type + event_type      │
│  2. Evaluate condition_group (AND/OR)             │
│  3. Execute multi-step chain                      │
│     - action steps                                │
│     - if/else branches (nested)                   │
│     - delay blocks (cron-resumed)                 │
│  4. Track execution in workflow_runs              │
│  5. Enforce quota + circuit breaker               │
└─────────────────────────────────────────────────┘
```

**Separation of concerns:**
- **TM-014** owns event infrastructure: `emitTaskEvent()`, `onTaskEvent()`, `task_events` table, recursive prevention via `actor_type`. This spec does NOT modify TM-014.
- **TM-015v2** owns the rule engine: matching, conditions, step execution, delays, fan-in, quotas. It subscribes to TM-014 events via `onTaskEvent()`.

---

## Trigger Catalog (15 types)

### Existing Triggers (3 — unchanged behavior, event-bus-driven)

| # | Trigger | Event Type | Config | Notes |
|---|---------|-----------|--------|-------|
| 1 | `status_change` | `item.status_changed` | `{ to_status? }` | Optional filter to specific target status |
| 2 | `assignee_added` | `assignee.added` | — | Fires on any assignee addition |
| 3 | `due_date_relative` | Cron-driven | `{ days_from_due }` | Evaluated daily by cron job, not event-driven |

### From Original TM-015 (5 — new, event-bus-driven)

| # | Trigger | Event Type | Config | Notes |
|---|---------|-----------|--------|-------|
| 4 | `item_created` | `item.created` | `{ board_id?, group_id? }` | Filter to specific board/group |
| 5 | `item_archived` | `item.archived` | `{ board_id? }` | Filter to specific board |
| 6 | `update_created` | `update.created` | `{ keyword? }` | Optionally match content containing keyword |
| 7 | `assignee_removed` | `assignee.removed` | — | Fires on any assignee removal |
| 8 | `recurring_schedule` | Cron-driven | `{ cron_expression, timezone }` | Daily/weekly/monthly via cron |

### New Triggers (7 — the v2 additions)

| # | Trigger | Event Type | Config | Notes |
|---|---------|-----------|--------|-------|
| 9 | `item_completed` | `item.completed` | — | Status changes to a label with `is_done_state = true`. Distinct from generic `status_change` — fires specifically on completion semantics. Maps to existing TM-014 event type `item.completed`. |
| 10 | `all_subitems_completed` | `subitem.updated` | — | **Fan-in trigger.** Fires when the last non-archived subitem of an item reaches a `is_done_state` status. Evaluated on every `subitem.updated` event. See [Fan-In Patterns](#fan-in-patterns). |
| 11 | `all_assignees_completed` | `subitem.updated` | — | **Fan-in trigger.** Pattern: one subitem per assignee. Fires when all assignee-linked subitems are done. Implementation is identical to `all_subitems_completed` but the workflow pattern assumes subitems were created per-assignee. |
| 12 | `field_changed` | `item.updated` | `{ field: 'priority' \| 'due_date' \| 'name' \| 'needs_attention' }` | Generic field change. Evaluates `event.old_value[field] !== event.new_value[field]`. |
| 13 | `time_entry_logged` | `time_entry.created` | — | Time tracked on item |
| 14 | `file_uploaded` | `file.uploaded` | — | File attached to item |
| 15 | `webhook_received` | N/A | `{ secret }` | Inbound webhook. **Phase 3** — flagged for future. Requires a new endpoint and HMAC validation. Not event-bus-driven; triggered directly by HTTP request. |

### Trigger-to-Event Mapping

Every trigger (except cron-driven and future `webhook_received`) maps to exactly one TM-014 event type. The subscriber layer registers handlers for each event type:

```js
// In taskEventSubscribers.js — one handler per event type
const TRIGGER_EVENT_MAP = {
  'status_change':           'item.status_changed',
  'item_completed':          'item.completed',
  'item_created':            'item.created',
  'item_archived':           'item.archived',
  'update_created':          'update.created',
  'assignee_added':          'assignee.added',
  'assignee_removed':        'assignee.removed',
  'field_changed':           'item.updated',
  'time_entry_logged':       'time_entry.created',
  'file_uploaded':           'file.uploaded',
  'all_subitems_completed':  'subitem.updated',
  'all_assignees_completed': 'subitem.updated',
};

// Registration
for (const [triggerType, eventType] of Object.entries(TRIGGER_EVENT_MAP)) {
  onTaskEvent(eventType, async (event) => {
    if (event.actor_type === 'automation') return;  // TM-014 recursive prevention
    await ruleEngine.evaluateRules(triggerType, event);
  });
}
```

---

## Action Catalog (22 types)

### Existing Actions (5 — unchanged)

| # | Action | Config | Implementation |
|---|--------|--------|---------------|
| 1 | `notify_admins` | `{ title, body }` | Notify all superadmin/admin users via `createNotification()` |
| 2 | `notify_assignees` | `{ title, body }` | Notify item assignees (skips actor). For `assignee_added` trigger, notifies only the new assignee |
| 3 | `set_status` | `{ status }` | `UPDATE task_items SET status = $1` |
| 4 | `set_needs_attention` | `{ value: true/false }` | `UPDATE task_items SET needs_attention = $1` |
| 5 | `add_update` | `{ content }` | `INSERT INTO task_updates` with `user_id = NULL` (system-generated) |

### From Original TM-015 (10 — new)

| # | Action | Config | Implementation |
|---|--------|--------|---------------|
| 6 | `move_item_to_group` | `{ group_id }` | `UPDATE task_items SET group_id = $1`. Validates group exists on same board. |
| 7 | `move_item_to_board` | `{ board_id, group_id }` | Update item's `group_id` to a group on the target board. Permission: automation creator must have access to both boards. |
| 8 | `create_item` | `{ board_id, group_id, name, status? }` | `INSERT INTO task_items`. Name supports template variables. |
| 9 | `duplicate_item` | `{ target_group_id, copy_assignees, copy_subitems }` | Clone item with configurable field copying |
| 10 | `create_subitem` | `{ name, status? }` | `INSERT INTO task_subitems` on the triggering item |
| 11 | `send_email` | `{ to, subject, body }` | Via Mailgun (`services/mailgun.js`). Supports template variables. Rate limited separately (Mailgun plan limits). |
| 12 | `archive_item` | `{}` | `UPDATE task_items SET archived_at = NOW()` on the triggering item |
| 13 | `assign_person` | `{ user_id }` | `INSERT INTO task_item_assignees`. No-op if already assigned. |
| 14 | `start_time_tracking` | `{ category?, description? }` | `INSERT INTO task_time_entries` with start timestamp |
| 15 | `trigger_webhook` | `{ url, method, headers? }` | Outbound HTTP POST/PUT with signed payload (HMAC-SHA256). Timeout: 10s. |

### New Actions (7 — the v2 additions)

| # | Action | Config | Implementation |
|---|--------|--------|---------------|
| 16 | `remove_assignee` | `{ user_id }` | `DELETE FROM task_item_assignees WHERE item_id = $1 AND user_id = $2`. No-op if not assigned. |
| 17 | `set_due_date` | `{ mode: 'absolute' \| 'relative', value }` | Absolute: `value = '2026-04-15'`. Relative: `value = '+3 days'` or `'-1 week'`. Relative mode calculates from current `due_date` (or from `NOW()` if no due date set). |
| 18 | `set_priority` | `{ priority }` | `UPDATE task_items SET priority = $1`. Validates against allowed priority values. |
| 19 | `notify_person` | `{ user_id?, role?, title, body }` | Notify a specific user by ID, or the first user matching a role on the workspace. More targeted than `notify_admins`. Supports template variables. |
| 20 | `create_update_on_item` | `{ target_item_id, content }` | Post a system comment on a DIFFERENT item. Use case: cross-item communication. `target_item_id` can be a template variable: `{trigger.parent_item_id}`. |
| 21 | `delay` | `{ duration, unit: 'minutes' \| 'hours' \| 'days' }` | Pause chain execution. Implemented via `task_automation_delayed_runs` table + cron. See [Delay Blocks](#delay-blocks). Max: 30 days. |
| 22 | `stop_chain` | `{}` | Explicitly halt chain execution. Useful after conditional branches: "If priority is Low, stop; else continue." Logged as `halted` (not error). |

### Template Variables

Actions that accept string config (`name`, `subject`, `body`, `content`, `title`, `description`) support variable interpolation:

| Variable | Value | Available In |
|----------|-------|-------------|
| `{item.name}` | Item name | All triggers |
| `{item.status}` | Current item status | All triggers |
| `{item.priority}` | Item priority | All triggers |
| `{item.due_date}` | Item due date (YYYY-MM-DD) | All triggers |
| `{board.name}` | Board name | All triggers |
| `{workspace.name}` | Workspace name | All triggers |
| `{actor.name}` | User who triggered the event | Event-driven triggers |
| `{actor.email}` | Actor's email | Event-driven triggers |
| `{actor.role}` | Actor's role | Event-driven triggers |
| `{assignee.name}` | Added/removed assignee name | `assignee_added`, `assignee_removed` |
| `{assignee.email}` | Added/removed assignee email | `assignee_added`, `assignee_removed` |
| `{date.today}` | Today's date (YYYY-MM-DD) | All triggers |
| `{date.now}` | Current datetime (ISO 8601) | All triggers |
| `{trigger.old_status}` | Status before change | `status_change`, `item_completed` |
| `{trigger.new_status}` | Status after change | `status_change`, `item_completed` |

**Resolution:** Template variables are resolved at execution time by the `resolveTemplateVariables(template, context)` function. The context object is built from the event payload, current item state (fetched from DB), and actor info.

```js
function resolveTemplateVariables(template, ctx) {
  return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (match, path) => {
    const value = getNestedValue(ctx, path);
    return value != null ? String(value) : match;  // leave unresolved vars as-is
  });
}
```

---

## Condition System

### Overview

The original TM-015 spec has simple single-field conditions (`condition_type: 'if'` with one `{ field, operator, value }`). This spec replaces that with **condition groups** supporting AND/OR logic and nested evaluation.

### Condition Group Schema

```jsonc
{
  "logic": "and",  // "and" | "or"
  "conditions": [
    {
      "field": "item.status",
      "operator": "equals",
      "value": "Done"
    },
    {
      "field": "item.priority",
      "operator": "in",
      "value": ["High", "Critical"]
    }
  ]
}
```

**AND** = all conditions must be true. **OR** = at least one must be true.

### Operators (12)

| Operator | Description | Value Type |
|----------|-------------|-----------|
| `equals` | Exact match (case-sensitive) | string, number, boolean |
| `not_equals` | Not an exact match | string, number, boolean |
| `contains` | String contains substring (case-insensitive) | string |
| `not_contains` | String does not contain substring | string |
| `gt` | Greater than | number, date string |
| `gte` | Greater than or equal | number, date string |
| `lt` | Less than | number, date string |
| `lte` | Less than or equal | number, date string |
| `in` | Value is in array | array |
| `not_in` | Value is not in array | array |
| `is_empty` | Value is null, undefined, or empty string | — (no value needed) |
| `is_not_empty` | Value is not null/undefined/empty | — (no value needed) |

### Evaluable Fields

Conditions reference fields via dot-path notation. The evaluation context is built from the event payload and current item state:

| Field Path | Source | Description |
|-----------|--------|-------------|
| `item.status` | DB lookup | Current item status |
| `item.priority` | DB lookup | Current item priority |
| `item.due_date` | DB lookup | Current due date |
| `item.name` | DB lookup | Item name |
| `item.needs_attention` | DB lookup | Boolean flag |
| `event.old_value.status` | Event payload | Status before change |
| `event.new_value.status` | Event payload | Status after change |
| `event.old_value.priority` | Event payload | Priority before change |
| `event.new_value.priority` | Event payload | Priority after change |
| `actor.id` | Event payload | Actor user ID |
| `actor.role` | DB lookup | Actor's role |
| `board.id` | Event payload | Board ID |
| `board.name` | DB lookup | Board name |
| `assignees.count` | DB lookup | Number of current assignees |

### Condition Evaluation

```js
function evaluateConditionGroup(group, context) {
  if (!group || !group.conditions?.length) return true;  // no condition = always pass

  const results = group.conditions.map(cond => {
    const fieldValue = getNestedValue(context, cond.field);
    return evaluateOperator(cond.operator, fieldValue, cond.value);
  });

  return group.logic === 'or'
    ? results.some(Boolean)
    : results.every(Boolean);
}
```

### Backward Compatibility

Existing automations have no conditions. The engine treats `condition_group = NULL` as "always true" — no migration needed for existing rules.

The original TM-015 single-condition format (`{ field, operator, value }`) is automatically wrapped:

```js
// Migration: single condition → condition group
if (step.condition_config && !step.condition_config.logic) {
  step.condition_config = {
    logic: 'and',
    conditions: [step.condition_config]
  };
}
```

---

## Multi-Step Chain Execution

### Step Types

Each step in a chain has one of these types:

| Step Type | Purpose | Has action? | Has condition? |
|-----------|---------|------------|---------------|
| `action` | Execute an action (optionally gated by condition) | Yes | Optional `condition_group` |
| `if` | Conditional branch — execute child steps if true | No | Required `condition_group` |
| `else` | Execute child steps if preceding `if` was false | No | No |
| `delay` | Pause chain, resume later | Yes (`delay` action) | Optional `condition_group` |

### Step Storage

Steps are stored in `task_automation_steps` (see [Database Schema](#database-schema)):

```sql
-- Example chain: "When Done → if High priority → notify + move; else → just archive"
-- automation_id = 'abc-123', scope = 'board'

-- Step 1: if priority is High (parent: null)
INSERT INTO task_automation_steps VALUES (
  'step-1', 'abc-123', 'board', 1,
  'if', NULL, '{}',                    -- step_type=if, no action
  '{"logic":"and","conditions":[{"field":"item.priority","operator":"equals","value":"High"}]}',
  NULL                                  -- parent_step_id=null (top level)
);

-- Step 1a: notify admins (child of step-1)
INSERT INTO task_automation_steps VALUES (
  'step-1a', 'abc-123', 'board', 1,
  'action', 'notify_admins', '{"title":"High-priority item completed","body":"{item.name}"}',
  NULL,                                 -- no condition (parent if handles it)
  'step-1'                              -- parent_step_id=step-1
);

-- Step 1b: move to Done group (child of step-1)
INSERT INTO task_automation_steps VALUES (
  'step-1b', 'abc-123', 'board', 2,
  'action', 'move_item_to_group', '{"group_id":"done-group-uuid"}',
  NULL,
  'step-1'
);

-- Step 2: else (parent: null, follows step-1)
INSERT INTO task_automation_steps VALUES (
  'step-2', 'abc-123', 'board', 2,
  'else', NULL, '{}',
  NULL,
  NULL
);

-- Step 2a: archive item (child of step-2)
INSERT INTO task_automation_steps VALUES (
  'step-2a', 'abc-123', 'board', 1,
  'action', 'archive_item', '{}',
  NULL,
  'step-2'
);
```

### Execution Model

```
Event arrives
  → Subscriber calls ruleEngine.evaluateRules(triggerType, event)
  → Match rules: find all active automations where trigger_type matches
  → For each matched rule:
      1. Check quota (checkAndIncrementQuota)
         - Exceeded? Log as 'skipped', continue to next rule
      2. Check circuit breaker (error_count < 5)
         - Tripped? Log as 'skipped' with reason 'circuit_breaker', continue
      3. Create workflow_run record (status: 'running')
      4. Build execution context (event payload + item state + actor info)
      5. Load top-level steps (parent_step_id IS NULL) ordered by step_order
      6. Execute steps sequentially:

         For each step:
           CASE step_type:

             'action':
               - If condition_group exists, evaluate it
               - If condition passes (or no condition): execute action
               - If action is 'delay': create delayed_run, mark workflow_run as 'delayed', stop
               - If action is 'stop_chain': mark workflow_run as 'halted', stop
               - If action fails: log error on step, mark workflow_run as 'error', stop

             'if':
               - Evaluate condition_group
               - If TRUE: load child steps, execute them sequentially
               - If FALSE: set flag so next 'else' at same level executes
               - Track last_if_result per nesting level

             'else':
               - Only execute children if preceding 'if' at same level was FALSE
               - If preceding 'if' was TRUE: skip all children

             'delay':
               - Same as action type delay

      7. All steps complete? Mark workflow_run as 'success'
      8. Increment quota counter
```

### Execution Context Object

Built once per workflow run and passed to all steps:

```js
const context = {
  item: {
    id, name, status, priority, due_date, needs_attention,
    group_id, board_id, workspace_id
  },
  event: {
    type: event.event_type,
    old_value: event.old_value,
    new_value: event.new_value,
    metadata: event.metadata
  },
  actor: {
    id: event.actor_id,
    name, email, role  // looked up from users table
  },
  board: { id, name },
  workspace: { id, name },
  assignees: {
    count,  // SELECT COUNT(*) FROM task_item_assignees
    list    // [{ user_id, name, email }]
  },
  trigger: {
    old_status: event.old_value?.status,
    new_status: event.new_value?.status
  },
  date: {
    today: 'YYYY-MM-DD',
    now: 'ISO 8601'
  }
};
```

### Legacy Rule Support (No Steps)

Existing automations that have `action_type` and `action_config` directly on the automation row (no steps in `task_automation_steps`) continue to work. The engine checks:

```js
const steps = await loadSteps(automation.id, automation.scope);
if (steps.length === 0) {
  // Legacy single-action rule — execute directly
  await executeAction({ actionType: automation.action_type, config: automation.action_config, ... });
} else {
  // Multi-step chain
  await executeChain(steps, context);
}
```

---

## Fan-Out / Fan-In Patterns

### Fan-Out (One Trigger → Multiple Parallel Effects)

Fan-out is naturally supported by multi-step chains. Multiple action steps at the same level execute sequentially (not truly parallel, but from the user's perspective they happen "at once" since they complete within milliseconds).

**Example: "When status = Done → assign reviewer + set flag + notify"**
```
Trigger: status_change (to_status: "Done")
Steps:
  1. action: assign_person { user_id: "reviewer-uuid" }
  2. action: set_needs_attention { value: true }
  3. action: notify_person { user_id: "reviewer-uuid", title: "Review needed", body: "{item.name}" }
```

### Fan-In Patterns

Fan-in — waiting for multiple parallel paths to converge before proceeding — is the hard problem. No major competitor handles this well.

#### The `all_subitems_completed` Trigger

The fan-in primitive is the `all_subitems_completed` trigger. It fires when **every non-archived subitem** of an item has a status with `is_done_state = true`.

**Evaluation (on every `subitem.updated` event):**

```sql
-- Check: are there any non-done subitems left?
SELECT COUNT(*) AS remaining
FROM task_subitems s
JOIN task_board_status_labels l ON l.board_id = (
  SELECT g.board_id FROM task_items i
  JOIN task_groups g ON g.id = i.group_id
  WHERE i.id = s.item_id
) AND l.label = s.status
WHERE s.item_id = $1
  AND s.archived_at IS NULL
  AND (l.is_done_state IS NULL OR l.is_done_state = false);
```

If `remaining = 0` AND there is at least one subitem, the trigger fires.

**Edge cases:**
- Item has zero subitems → trigger does NOT fire (nothing to complete)
- All subitems archived → trigger does NOT fire (no active subitems)
- Subitem restored from archive → re-evaluate on next update
- Status label `is_done_state` changed after subitems set → does not retroactively fire (only fires on `subitem.updated` events)

#### The User's Workflow: End-to-End

> "Person A finishes → assign Person B and C → when both finish → QC stage"

Implemented as two automations:

**Automation 1: Fan-Out (assign reviewers)**
```
Trigger: status_change (to_status: "Person A Complete")
Steps:
  1. action: create_subitem { name: "Review by Person B", status: "To Do" }
  2. action: create_subitem { name: "Review by Person C", status: "To Do" }
  3. action: set_status { status: "In Review" }
  4. action: add_update { content: "Subitems created for Person B and Person C review." }
```

Note: Assigning subitems to specific people requires either (a) the `assign_person` action targeting subitems (future enhancement) or (b) the reviewer picks up their named subitem manually. For v2, we use naming convention.

**Automation 2: Fan-In (advance to QC)**
```
Trigger: all_subitems_completed
Condition: { logic: "and", conditions: [
  { field: "item.status", operator: "equals", value: "In Review" }
]}
Steps:
  1. action: set_status { status: "QC" }
  2. action: assign_person { user_id: "qc-manager-uuid" }
  3. action: notify_person { user_id: "qc-manager-uuid",
       title: "Ready for QC",
       body: "{item.name} — all reviewers done" }
```

#### Why Subitem-Based (Not Tracking Tables)

Alternative: a `task_automation_fan_in_state` table that tracks which branches have completed. This requires:
- Complex state management (what if a branch errors? restarts? is added late?)
- Cleanup logic (what if the parent item is deleted mid-fan-in?)
- A new concept ("branches") that doesn't exist in the data model

The subitem approach reuses existing entities:
- Subitems already exist, have statuses, and cascade-delete with parents
- `all_subitems_completed` is a simple query, not a state machine
- Users can see progress in the UI (2 of 3 subitems done)
- Works with any number of parallel paths (just create more subitems)

---

## Delay Blocks

Delay blocks pause chain execution for a specified duration, then resume via a cron job.

### Storage: `task_automation_delayed_runs`

```sql
CREATE TABLE IF NOT EXISTS task_automation_delayed_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES task_workflow_runs(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL,
  automation_scope TEXT NOT NULL,    -- 'board' | 'global'
  item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  resume_step_order INTEGER NOT NULL,
  resume_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'resumed' | 'cancelled'
  context JSONB NOT NULL DEFAULT '{}'::jsonb,  -- snapshot of execution context
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delayed_runs_resume
  ON task_automation_delayed_runs (status, resume_at)
  WHERE status = 'pending';
```

### Execution Flow

**When a `delay` step is reached:**
1. Snapshot the current execution context (item state, event, actor, variables)
2. Calculate `resume_at = NOW() + duration`
3. Insert into `task_automation_delayed_runs`
4. Mark `workflow_run.status = 'delayed'`
5. Stop chain execution (remaining steps will run after resume)

**Cron job (every 60 seconds):**
```js
async function processDelayedRuns() {
  const { rows } = await query(
    `UPDATE task_automation_delayed_runs
     SET status = 'resumed'
     WHERE status = 'pending' AND resume_at <= NOW()
     RETURNING *`
  );
  for (const run of rows) {
    // Verify item still exists and is not archived
    const item = await getItem(run.item_id);
    if (!item || item.archived_at) {
      await markCancelled(run.id, 'item_archived_or_deleted');
      continue;
    }
    // Resume chain from resume_step_order
    await resumeChain(run);
  }
}
```

### Cancellation

Delayed runs are cancelled when:
- The item is archived or deleted before `resume_at`
- The automation is deactivated or deleted
- A user manually cancels the pending workflow

Cancelled runs are marked `status = 'cancelled'` with a reason in metadata.

### Limits

- Maximum delay: 30 days (configurable via `TASK_AUTOMATION_MAX_DELAY_DAYS`)
- Minimum delay: 1 minute
- Maximum pending delayed runs per automation: 100 (prevents runaway scheduling)

---

## Scope Levels

### Three Scopes (inspired by Jira)

| Scope | Applies To | Stored In | Filter |
|-------|-----------|-----------|--------|
| `board` | One specific board | `task_board_automations` | `board_id` column |
| `workspace` | All boards in a workspace | `task_global_automations` | `workspace_id` column (new) |
| `global` | All boards across all workspaces | `task_global_automations` | `workspace_id IS NULL` |

**Workspace scope** is the new addition. The `task_global_automations` table gets a new nullable `workspace_id` column:

```sql
ALTER TABLE task_global_automations
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES task_workspaces(id) ON DELETE CASCADE;
```

**Matching priority:** When an event fires, the engine collects rules from all three scopes. All matching rules execute (no priority/override — they're additive). If a user wants a board rule to "override" a workspace rule, they use conditions to make the workspace rule skip that board.

### Scope-Level Rule Matching

```js
async function findMatchingRules(triggerType, event) {
  const { board_id, workspace_id } = event;

  const [boardRules, workspaceRules, globalRules] = await Promise.all([
    // Board-level: specific to this board
    query(`SELECT * FROM task_board_automations
           WHERE board_id = $1 AND trigger_type = $2 AND is_active = true`,
          [board_id, triggerType]),

    // Workspace-level: applies to all boards in workspace
    query(`SELECT * FROM task_global_automations
           WHERE workspace_id = $1 AND trigger_type = $2 AND is_active = true`,
          [workspace_id, triggerType]),

    // Global: applies everywhere
    query(`SELECT * FROM task_global_automations
           WHERE workspace_id IS NULL AND trigger_type = $1 AND is_active = true`,
          [triggerType])
  ]);

  return [
    ...boardRules.rows.map(r => ({ ...r, scope: 'board' })),
    ...workspaceRules.rows.map(r => ({ ...r, scope: 'workspace' })),
    ...globalRules.rows.map(r => ({ ...r, scope: 'global' }))
  ];
}
```

---

## Rate Limiting & Safety

### Monthly Quota

Carried forward from TM-015:
- Default limit: 10,000 actions/month (env: `TASK_AUTOMATION_MONTHLY_LIMIT`)
- Tracked in `task_automation_quota` table
- Each action execution (not each rule evaluation) counts as 1
- Exceeded → log as `skipped` with reason `quota_exceeded`, continue to next rule

### Circuit Breaker (NEW)

Per-automation protection against broken rules:

```sql
ALTER TABLE task_board_automations
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

ALTER TABLE task_global_automations
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
```

**Logic:**
- On action error: increment `error_count`
- On successful action: reset `error_count` to 0
- When `error_count >= 5`: set `is_active = false`, `disabled_reason = 'circuit_breaker: 5 consecutive errors'`
- User can re-enable manually (resets `error_count`)

### Recursive Prevention

Inherited from TM-014:
- Actions emit events with `actor_type: 'automation'`
- Automation subscriber skips events where `actor_type === 'automation'`
- Result: automations never trigger other automations (no cascading)
- Future: controlled recursion via `max_chain_depth` config

### Hard Limits

| Limit | Value | Configurable |
|-------|-------|-------------|
| Monthly action quota | 10,000 | `TASK_AUTOMATION_MONTHLY_LIMIT` |
| Max chain length | 20 steps | `TASK_AUTOMATION_MAX_STEPS` |
| Max nested condition depth | 3 levels | Hardcoded |
| Max delay duration | 30 days | `TASK_AUTOMATION_MAX_DELAY_DAYS` |
| Min delay duration | 1 minute | Hardcoded |
| Circuit breaker threshold | 5 errors | Hardcoded |
| Max pending delayed runs per automation | 100 | Hardcoded |
| Webhook timeout | 10 seconds | Hardcoded |
| Template variable max length | 1000 chars | Hardcoded |

---

## Database Schema

### Modified Tables

```sql
-- Extend board automations with execution tracking
ALTER TABLE task_board_automations
  ADD COLUMN IF NOT EXISTS trigger_events TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

-- Extend global automations with workspace scope + execution tracking
ALTER TABLE task_global_automations
  ADD COLUMN IF NOT EXISTS trigger_events TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES task_workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_global_automations_workspace
  ON task_global_automations (workspace_id) WHERE workspace_id IS NOT NULL;
```

### New Tables

#### task_automation_steps (multi-step chain storage)

```sql
CREATE TABLE IF NOT EXISTS task_automation_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL,
  automation_scope TEXT NOT NULL,          -- 'board' | 'global'
  step_order INTEGER NOT NULL DEFAULT 0,
  step_type TEXT NOT NULL DEFAULT 'action',  -- 'action' | 'if' | 'else' | 'delay'
  action_type TEXT,                        -- null for 'if'/'else' steps
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition_group JSONB,                   -- { logic, conditions[] } — for 'if' and conditional 'action' steps
  parent_step_id UUID REFERENCES task_automation_steps(id) ON DELETE CASCADE,  -- for nesting (children of if/else)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_lookup
  ON task_automation_steps (automation_scope, automation_id, step_order);

CREATE INDEX IF NOT EXISTS idx_automation_steps_parent
  ON task_automation_steps (parent_step_id) WHERE parent_step_id IS NOT NULL;
```

#### task_automation_quota (monthly rate limiting)

```sql
CREATE TABLE IF NOT EXISTS task_automation_quota (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start DATE NOT NULL,
  actions_consumed INTEGER NOT NULL DEFAULT 0,
  actions_limit INTEGER NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_start)
);
```

#### task_workflow_runs (chain execution tracking)

```sql
CREATE TABLE IF NOT EXISTS task_workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL,
  automation_scope TEXT NOT NULL,          -- 'board' | 'global'
  board_id UUID REFERENCES task_boards(id) ON DELETE SET NULL,
  item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL,
  trigger_event_id UUID REFERENCES task_events(id) ON DELETE SET NULL,  -- link to TM-014 event
  status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'success' | 'partial' | 'error' | 'delayed' | 'halted' | 'skipped'
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_automation
  ON task_workflow_runs (automation_scope, automation_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_item
  ON task_workflow_runs (item_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON task_workflow_runs (status) WHERE status IN ('running', 'delayed');
```

**Note:** This table is more granular than the existing `task_automation_runs`, which continues to exist for backward compatibility and scheduled-run deduplication. `task_workflow_runs` tracks multi-step chain progress; `task_automation_runs` tracks individual fire-and-forget runs.

#### task_automation_delayed_runs (delay block scheduling)

```sql
CREATE TABLE IF NOT EXISTS task_automation_delayed_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES task_workflow_runs(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL,
  automation_scope TEXT NOT NULL,
  item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  resume_step_order INTEGER NOT NULL,
  resume_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'resumed' | 'cancelled'
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delayed_runs_pending
  ON task_automation_delayed_runs (status, resume_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_delayed_runs_automation
  ON task_automation_delayed_runs (automation_id);
```

### Schema Relationships

```
task_board_automations ─┐
                        ├──→ task_automation_steps (1:many, via automation_id + scope)
task_global_automations ┘        │
                                 └──→ task_automation_steps (self-ref: parent_step_id for nesting)
                        ┌──→ task_workflow_runs (1:many, via automation_id + scope)
task_board_automations ─┤
task_global_automations ┘        │
                                 └──→ task_automation_delayed_runs (1:1 per delayed chain)

task_events (TM-014) ←── task_workflow_runs.trigger_event_id (optional backlink)
task_automation_runs ←── still used for cron deduplication (unchanged)
```

---

## API Endpoints

### New Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/automations/:id/steps` | List steps for an automation | Admin+ |
| POST | `/automations/:id/steps` | Add step(s) to automation | Admin+ |
| PATCH | `/automations/steps/:stepId` | Update a step | Admin+ |
| DELETE | `/automations/steps/:stepId` | Delete a step (cascades to children) | Admin+ |
| POST | `/automations/steps/:stepId/reorder` | Change step_order | Admin+ |
| GET | `/automations/quota` | Current month's quota usage | Admin+ |
| GET | `/automations/:id/runs` | Execution history for one rule | Admin+ |
| POST | `/automations/:id/test` | Dry-run: evaluate without executing | Admin+ |

### Modified Endpoints

| Method | Path | Changes |
|--------|------|---------|
| POST | `/boards/:boardId/automations` | Accept optional `steps[]` for multi-step creation |
| POST | `/automations/global` | Accept optional `steps[]` + optional `workspace_id` for workspace scope |
| PATCH | `/automations/:automationId` | Accept `trigger_events[]`, `steps[]` updates |

### Dry-Run (`POST /automations/:id/test`)

Evaluates the automation against a provided or most-recent event without executing actions. Returns:

```json
{
  "would_fire": true,
  "matched_trigger": "status_change",
  "condition_results": [
    { "field": "item.priority", "operator": "equals", "value": "High", "result": true }
  ],
  "steps_that_would_execute": [
    { "step_order": 1, "action_type": "notify_admins", "would_run": true },
    { "step_order": 2, "action_type": "move_item_to_group", "would_run": true }
  ],
  "quota_remaining": 8742
}
```

---

## Pre-Built Templates (~15 Recipes)

Templates are stored as JSON definitions and instantiated into board or workspace automations. They are NOT a database table — they're hardcoded recipe definitions that the UI presents for one-click setup.

### Template Categories

#### Status Progression
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 1 | "When Done → move to next group" | `status_change` (to: Done) | `move_item_to_group` |
| 2 | "When status changes → clear needs_attention" | `status_change` | `set_needs_attention` (false) |

#### Assignment
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 3 | "When created → auto-assign to board owner" | `item_created` | `assign_person` (board owner) |
| 4 | "When status = In Review → assign reviewer" | `status_change` (to: In Review) | `assign_person` (configurable) |

#### Notifications
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 5 | "When overdue → notify admins daily" | `due_date_relative` (days: -1) | `notify_admins` |
| 6 | "When assigned → notify assignee" | `assignee_added` | `notify_assignees` |
| 7 | "When comment posted → notify assignees" | `update_created` | `notify_assignees` |

#### Escalation
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 8 | "When stuck > 3 days → flag + notify" | `due_date_relative` (days: -3) | `set_needs_attention` (true) + `notify_admins` |
| 9 | "When needs_attention set → notify admins" | `field_changed` (field: needs_attention) | `notify_admins` |

#### Handoff
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 10 | "When Person A done → assign Person B" | `status_change` (to: configurable) | `assign_person` + `notify_person` |
| 11 | "When completed → create follow-up task" | `item_completed` | `create_item` (name: "Follow-up: {item.name}") |

#### QC Pipeline
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 12 | "When all reviewers done → move to QC" | `all_subitems_completed` | `set_status` (QC) + `assign_person` (QC manager) + `notify_person` |

#### Time Tracking
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 13 | "When In Progress → start time tracking" | `status_change` (to: In Progress) | `start_time_tracking` |

#### Archival
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 14 | "When done for 30 days → auto-archive" | `due_date_relative` or `recurring_schedule` | Condition: item.status is done + `delay` (30 days) + `archive_item` |

#### Lifecycle
| # | Template | Trigger | Actions |
|---|----------|---------|---------|
| 15 | "When archived → notify admins" | `item_archived` | `notify_admins` |

### Template Definition Format

```js
const AUTOMATION_TEMPLATES = [
  {
    id: 'when-done-move-group',
    name: 'When Done → move to next group',
    category: 'status_progression',
    description: 'Automatically move completed items to a specified group.',
    trigger_type: 'status_change',
    trigger_config: { to_status: null },  // user selects which "done" status
    steps: [
      { step_type: 'action', action_type: 'move_item_to_group', action_config: { group_id: null } }
    ],
    configurable_fields: [
      { path: 'trigger_config.to_status', label: 'When status becomes', type: 'status_select' },
      { path: 'steps[0].action_config.group_id', label: 'Move to group', type: 'group_select' }
    ]
  },
  // ... etc
];
```

---

## Frontend UI Approach

### Two-Tier System

**Simple Mode (enhanced current UI):**
- Pick trigger → pick action → save
- One-click templates with minimal configuration
- Suitable for ~80% of use cases
- This is what `EditAutomationDialog.jsx` currently does, extended with new trigger/action types

**Advanced Mode (new step builder):**
- Structured list of steps (NOT a visual canvas / flowchart)
- Each step shows: order number + condition badge + action type + config summary
- Add step button at bottom
- Reorder via drag-drop or up/down arrows
- Each step expands to show condition builder and action config form
- If/else blocks indent their children

```
┌─ Automation: "QC Pipeline Handler" ──────────────────────┐
│                                                           │
│  Trigger: [Status changes to ▼] [Done ▼]                 │
│                                                           │
│  Steps:                                                   │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 1. IF priority IN [High, Critical]                  │  │
│  │    ├─ 1a. Notify admins: "High-pri item completed"  │  │
│  │    └─ 1b. Set due date: +3 days                     │  │
│  │ 2. ELSE                                             │  │
│  │    └─ 2a. Set due date: +7 days                     │  │
│  │ 3. Assign person: QC Manager                        │  │
│  │ 4. Move to group: QC Queue                          │  │
│  │ 5. Add update: "Ready for quality check"            │  │
│  │                                                     │  │
│  │ [+ Add Step]                                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  [Cancel]                              [Save Automation]  │
└───────────────────────────────────────────────────────────┘
```

**Why not a visual canvas?**
- Visual workflow builders (drag nodes, connect with arrows) are expensive to build (weeks of effort for the UI alone)
- A structured list/form is sufficient for 20-step chains with if/else
- The step builder is a natural extension of the current form-based UI
- If demand warrants a visual builder, it can be added later as a "Phase 3" enhancement without changing the data model

### Condition Builder UI

Inline within a step, expandable:

```
┌─ Condition ───────────────────────────────────────────┐
│  Match: [ALL ▼] of the following:                     │
│                                                        │
│  [item.priority ▼] [is one of ▼] [High, Critical ▼]  │
│  [item.status   ▼] [equals    ▼] [In Review      ▼]  │
│                                                        │
│  [+ Add condition]                                     │
└────────────────────────────────────────────────────────┘
```

"Match ALL" = AND logic, "Match ANY" = OR logic.

---

## Migration & Phasing

All phases depend on TM-014 (Event Bus) being implemented first.

### Phase 2A: Event Bus (TM-014)
- Create `task_events` table
- Implement `taskEventBus.js` and `taskEventSubscribers.js`
- Instrument all 35 mutation endpoints
- **No user-facing changes**

### Phase 2B: Rule Engine Core
- Run schema migrations (new tables, ALTER existing)
- Implement `ruleEngine.evaluateRules()` with multi-step support
- Implement condition group evaluation
- Register event bus subscribers for all 12 event-driven trigger types
- Implement new action types (start with moves, creates, assigns)
- Add quota tracking + circuit breaker
- Add step CRUD API endpoints
- Update `EditAutomationDialog.jsx` with new trigger/action pickers
- Build basic step builder UI (add/remove/reorder)

### Phase 2C: Fan-In + Delays
- Implement `all_subitems_completed` trigger with fan-in evaluation query
- Implement `delay` action + `task_automation_delayed_runs` table
- Add cron job for processing delayed runs
- Implement `stop_chain` action
- Add workflow run tracking (`task_workflow_runs`)
- Build execution history UI (`/automations/:id/runs`)

### Phase 2D: Templates + Advanced UI
- Define ~15 template recipes
- Build template picker UI (browse by category, one-click install)
- Build condition builder UI (field/operator/value dropdowns)
- Build dry-run endpoint and "Test" button
- Add advanced mode toggle (simple ↔ advanced)
- Add workspace-scope automation creation UI

### Feature Flag

```
TASK_RULE_ENGINE_V2=true   (default false)
```

When disabled, only original 3 triggers / 5 actions are shown in the UI and accepted by the API. When enabled, all triggers, actions, multi-step chains, conditions, and templates are available.

---

## Files Affected

### New Files
| File | Purpose | Phase |
|------|---------|-------|
| `server/sql/task-automation-steps.sql` | Steps table schema | 2B |
| `server/sql/task-automation-quota.sql` | Quota table schema | 2B |
| `server/sql/task-workflow-runs.sql` | Workflow runs table schema | 2C |
| `server/sql/task-automation-delayed-runs.sql` | Delayed runs table schema | 2C |
| `server/services/ruleEngine.js` | Core rule matching + chain execution | 2B |
| `server/services/conditionEvaluator.js` | Condition group evaluation logic | 2B |
| `server/services/templateVariables.js` | Template variable resolution | 2B |
| `server/services/automationTemplates.js` | Pre-built template definitions | 2D |
| `src/views/tasks/components/StepBuilder.jsx` | Multi-step chain editor UI | 2B |
| `src/views/tasks/components/ConditionBuilder.jsx` | AND/OR condition group editor | 2D |
| `src/views/tasks/components/TemplatePickerDialog.jsx` | Browse + install templates | 2D |

### Modified Files
| File | Changes | Phase |
|------|---------|-------|
| `server/services/taskAutomations.js` | Major rewrite: multi-step execution, new actions, condition groups, fan-in evaluation, delay scheduling | 2B-2C |
| `server/services/taskEventSubscribers.js` | Register handlers for all 12 event-driven trigger types | 2B |
| `server/routes/tasks.js` | Step CRUD, quota, runs, dry-run endpoints | 2B-2C |
| `server/index.js` | Migration functions for new tables, delayed-run cron job | 2B-2C |
| `src/api/tasks.js` | New API methods for steps, quota, runs, templates | 2B-2D |
| `src/views/tasks/panes/AutomationsPane.jsx` | Expanded trigger/action UI, step builder, template picker, execution history | 2B-2D |
| `src/views/tasks/components/EditAutomationDialog.jsx` | New trigger types, step builder integration, condition builder, template variables helper | 2B-2D |

---

## Validation Checklist

### Internal Consistency
- [ ] Every trigger (except cron-driven and `webhook_received`) maps to a TM-014 event type defined in `tm-014-event-bus.md`
- [ ] Every action has a clear implementation path using existing codebase functions (`query()`, `createNotification()`, Mailgun, etc.)
- [ ] All referenced database tables are defined in this spec or exist in `server/sql/init.sql`
- [ ] No circular dependencies between tables (steps self-ref via `parent_step_id` is intentional and safe with `ON DELETE CASCADE`)
- [ ] `task_automation_runs` (existing) and `task_workflow_runs` (new) coexist — runs table for cron dedup, workflow_runs for chain tracking

### User Workflow Verification
- [ ] Fan-out: "status=Done → assign Person B + assign Person C" — achievable with 2 `assign_person` action steps
- [ ] Fan-in: "when both finish → QC stage" — achievable with `all_subitems_completed` trigger + `set_status` action
- [ ] Delay: "wait 30 days then archive" — achievable with `delay` + `archive_item` steps
- [ ] Conditional: "if High priority, notify; else skip" — achievable with `if`/`else` step types + condition group
- [ ] Cross-board: "move to QA board when Done" — achievable with `move_item_to_board` action

### Safety Verification
- [ ] Recursive prevention: automation actions emit `actor_type: 'automation'`, subscriber skips these
- [ ] Quota: 10,000 actions/month prevents runaway rules
- [ ] Circuit breaker: 5 consecutive errors auto-disables a rule
- [ ] Chain length: 20-step max prevents infinite/huge chains
- [ ] Delay max: 30 days prevents indefinite scheduling
- [ ] Nested conditions: 3-level max prevents deeply nested evaluation

### Backward Compatibility
- [ ] Existing automations (no steps) continue to work via legacy single-action path
- [ ] Existing `task_automation_runs` table unchanged (cron dedup still works)
- [ ] All schema changes are additive (ALTER ADD COLUMN, new tables) — no destructive migrations
- [ ] Feature flag `TASK_RULE_ENGINE_V2` gates all new functionality
