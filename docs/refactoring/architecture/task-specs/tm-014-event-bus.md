# Feature: Event Bus Architecture (TM-014)

## Problem

The task system has 35 mutation endpoints but only 4 have activity logging and only 3 trigger automations. Side effects (automations, notifications, activity log) are manually wired per-endpoint, leading to massive blind spots. Adding new automation triggers or audit logging requires modifying the route handler for every relevant endpoint.

### Current Coverage

| Mutation | Activity Log | Automations | Notifications |
|----------|-------------|-------------|---------------|
| Item created | CREATE_TASK | — | — |
| Item updated | UPDATE_TASK/COMPLETE_TASK | status_change | — |
| Item archived | DELETE_TASK | — | — |
| Assignee added | — | assignee_added | Direct to assignee |
| Update created | — | — | @mention only |
| **All other 30 mutations** | **—** | **—** | **—** |

## Solution

Introduce an in-process event bus (Node.js EventEmitter) that every mutation emits to. Subscribers (automations, activity log, notifications, future audit log) listen for events they care about. This decouples mutation logic from side-effect logic.

### Why In-Process EventEmitter (Not Cloud Pub/Sub)

| Factor | EventEmitter | Cloud Pub/Sub |
|--------|-------------|---------------|
| Latency | <1ms | 50-200ms |
| Infrastructure | None | Pub/Sub topic, subscription, IAM |
| Cost | Free | ~$40/month at moderate volume |
| Reliability | Lost on crash | Durable, at-least-once |
| Complexity | Low | High |
| Current scale | 1-10 workspaces, 5-50 boards | Overkill |

For current scale, EventEmitter is sufficient. If the system grows to need durable event delivery, the event schema and subscriber pattern make migration to Pub/Sub straightforward — just swap the transport layer.

---

## Data Model

### task_events (append-only log)

```sql
CREATE TABLE IF NOT EXISTS task_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,         -- e.g., 'item.created', 'item.status_changed'
  workspace_id UUID REFERENCES task_workspaces(id) ON DELETE SET NULL,
  board_id UUID REFERENCES task_boards(id) ON DELETE SET NULL,
  item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,        -- 'workspace', 'board', 'group', 'item', 'subitem', etc.
  entity_id UUID NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'system' | 'automation'
  old_value JSONB,                  -- before-state (for mutations)
  new_value JSONB,                  -- after-state (for mutations)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- additional context
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events (event_type);
CREATE INDEX IF NOT EXISTS idx_task_events_entity ON task_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_task_events_workspace ON task_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_events_board ON task_events (board_id);
CREATE INDEX IF NOT EXISTS idx_task_events_item ON task_events (item_id);
CREATE INDEX IF NOT EXISTS idx_task_events_actor ON task_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_task_events_created ON task_events (created_at);
```

**Retention:** Partition by month. Default retention: 1 year. Configurable via `TASK_EVENT_RETENTION_DAYS` env var.

**Note:** This table replaces `task_automation_runs` as the primary audit trail. `task_automation_runs` continues to exist for deduplication of scheduled automations but could be merged into events in a future iteration.

---

## Event Schema

```js
{
  event_type: 'item.status_changed',    // dotted entity.action format
  workspace_id: 'uuid',                 // resolved at emit time
  board_id: 'uuid',                     // resolved at emit time
  item_id: 'uuid',                      // when applicable
  entity_type: 'item',                  // what was mutated
  entity_id: 'uuid',                    // ID of the mutated entity
  actor_id: 'uuid',                     // who did it (null for system/cron)
  actor_type: 'user',                   // 'user' | 'system' | 'automation'
  old_value: { status: 'To Do' },       // relevant before-state
  new_value: { status: 'Done' },        // relevant after-state
  metadata: { source: 'api' }           // additional context
}
```

### Event Types (35 total, matching all mutation endpoints)

#### Workspace Events
| Event Type | Triggered By |
|-----------|-------------|
| `workspace.created` | POST /workspaces |
| `workspace.deleted` | DELETE /workspaces/:id |
| `workspace.member_added` | POST /workspaces/:id/members |
| `workspace.member_role_changed` | PATCH /workspaces/:id/members/:userId |
| `workspace.member_removed` | DELETE /workspaces/:id/members/:userId |

#### Board Events
| Event Type | Triggered By |
|-----------|-------------|
| `board.created` | POST /workspaces/:id/boards |
| `board.updated` | PATCH /boards/:id |
| `board.deleted` | DELETE /boards/:id |

#### Group Events
| Event Type | Triggered By |
|-----------|-------------|
| `group.created` | POST /boards/:id/groups |
| `group.deleted` | DELETE /groups/:id |

#### Item Events (most important for automations)
| Event Type | Triggered By |
|-----------|-------------|
| `item.created` | POST /groups/:id/items |
| `item.updated` | PATCH /items/:id (non-status fields) |
| `item.status_changed` | PATCH /items/:id (when status changes) |
| `item.completed` | PATCH /items/:id (when status becomes a done_state) |
| `item.due_date_changed` | PATCH /items/:id (when due_date changes) |
| `item.archived` | DELETE /items/:id |
| `item.restored` | POST /items/:id/restore |

#### Subitem Events
| Event Type | Triggered By |
|-----------|-------------|
| `subitem.created` | POST /items/:id/subitems |
| `subitem.updated` | PATCH /subitems/:id |
| `subitem.archived` | DELETE /subitems/:id |
| `subitem.restored` | POST /subitems/:id/restore |

#### Assignee Events
| Event Type | Triggered By |
|-----------|-------------|
| `assignee.added` | POST /items/:id/assignees |
| `assignee.removed` | DELETE /items/:id/assignees/:userId |

#### Update Events
| Event Type | Triggered By |
|-----------|-------------|
| `update.created` | POST /items/:id/updates |

#### File Events
| Event Type | Triggered By |
|-----------|-------------|
| `file.uploaded` | POST /items/:id/files |

#### Time Entry Events
| Event Type | Triggered By |
|-----------|-------------|
| `time_entry.created` | POST /items/:id/time-entries |

#### Status Label Events
| Event Type | Triggered By |
|-----------|-------------|
| `status_label.created` | POST /boards/:id/status-labels, POST /status-labels/global |
| `status_label.updated` | PATCH /status-labels/:id |
| `status_label.deleted` | DELETE /status-labels/:id |
| `status_label.batch_initialized` | POST /boards/:id/status-labels/init |

#### Automation Events
| Event Type | Triggered By |
|-----------|-------------|
| `automation.created` | POST /boards/:id/automations, POST /automations/global |
| `automation.updated` | PATCH /automations/:id |
| `automation.deleted` | DELETE /automations/:id |

---

## API Implementation

### New file: `server/services/taskEventBus.js`

```js
import { EventEmitter } from 'events';
import { query } from '../index.js';

const bus = new EventEmitter();
bus.setMaxListeners(50);  // we'll have multiple subscribers

/**
 * Emit a task event.
 * 1. Persists to task_events table (async, non-blocking)
 * 2. Emits to in-process subscribers
 */
export async function emitTaskEvent(event) {
  const {
    event_type, workspace_id, board_id, item_id,
    entity_type, entity_id, actor_id,
    actor_type = 'user', old_value, new_value, metadata = {}
  } = event;

  // Persist to DB (fire-and-forget — don't block the response)
  query(
    `INSERT INTO task_events
     (event_type, workspace_id, board_id, item_id, entity_type, entity_id,
      actor_id, actor_type, old_value, new_value, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [event_type, workspace_id, board_id, item_id, entity_type, entity_id,
     actor_id, actor_type,
     old_value ? JSON.stringify(old_value) : null,
     new_value ? JSON.stringify(new_value) : null,
     JSON.stringify(metadata)]
  ).catch(err => console.error('Failed to persist task event:', err.message));

  // Emit to in-process subscribers
  bus.emit(event_type, event);
  bus.emit('*', event);  // wildcard for subscribers that want all events
}

/**
 * Subscribe to task events.
 * @param {string} eventType - Event type or '*' for all
 * @param {Function} handler - async (event) => void
 */
export function onTaskEvent(eventType, handler) {
  bus.on(eventType, (event) => {
    // Wrap in try/catch so one subscriber failure doesn't affect others
    Promise.resolve(handler(event)).catch(err => {
      console.error(`Task event subscriber error [${eventType}]:`, err.message);
    });
  });
}

/**
 * Helper: resolve workspace_id and board_id for an item.
 * Caches in the event metadata to avoid repeated lookups.
 */
export async function resolveItemContext(itemId) {
  const { rows } = await query(
    `SELECT b.workspace_id, g.board_id
     FROM task_items i
     JOIN task_groups g ON g.id = i.group_id
     JOIN task_boards b ON b.id = g.board_id
     WHERE i.id = $1`,
    [itemId]
  );
  return rows[0] || {};
}

export default bus;
```

### Integration Pattern (per endpoint)

**Before (current):**
```js
// PATCH /items/:itemId
const itemBefore = /* query */;
await query('UPDATE task_items SET status = $1 ...', [newStatus]);
const itemAfter = /* query */;

// Manual side effects
logTaskActivity({ ... }).catch(() => {});
runEventAutomationsForItemChange({ itemBefore, itemAfter, actorUserId }).catch(() => {});
```

**After (with event bus):**
```js
// PATCH /items/:itemId
const itemBefore = /* query */;
await query('UPDATE task_items SET status = $1 ...', [newStatus]);
const itemAfter = /* query */;

// Single event emission — subscribers handle the rest
emitTaskEvent({
  event_type: itemBefore.status !== itemAfter.status ? 'item.status_changed' : 'item.updated',
  workspace_id, board_id, item_id: itemId,
  entity_type: 'item', entity_id: itemId,
  actor_id: req.user.id,
  old_value: { status: itemBefore.status, due_date: itemBefore.due_date },
  new_value: { status: itemAfter.status, due_date: itemAfter.due_date }
});
```

### Subscriber Registration (`server/services/taskEventSubscribers.js`)

```js
import { onTaskEvent } from './taskEventBus.js';
import { runEventAutomationsForItemChange, runEventAutomationsForAssigneeAdded } from './taskAutomations.js';
import { logTaskActivity, ActivityEventTypes } from './activityLog.js';

export function registerTaskEventSubscribers() {
  // Automation subscriber (replaces direct calls in route handlers)
  onTaskEvent('item.status_changed', async (event) => {
    await runEventAutomationsForItemChange({
      itemBefore: event.old_value,
      itemAfter: event.new_value,
      actorUserId: event.actor_id
    });
  });

  onTaskEvent('assignee.added', async (event) => {
    await runEventAutomationsForAssigneeAdded({
      itemId: event.item_id,
      assigneeUserId: event.metadata.assignee_user_id,
      actorUserId: event.actor_id
    });
  });

  // Activity log subscriber (extends to ALL mutations)
  onTaskEvent('item.created', async (event) => {
    await logTaskActivity({
      userId: event.actor_id,
      actionType: ActivityEventTypes.CREATE_TASK,
      taskId: event.entity_id,
      taskName: event.new_value?.name
    });
  });

  // ... register for all event types that need activity logging
}
```

Called once during server startup in `server/index.js`:
```js
import { registerTaskEventSubscribers } from './services/taskEventSubscribers.js';
registerTaskEventSubscribers();
```

---

## Cascade Event Design

When a workspace is deleted, boards/groups/items cascade via foreign keys. The event bus should NOT try to emit individual events for cascaded entities (too complex, and the DB handles cleanup). Instead:

- `workspace.deleted` event includes `metadata: { cascade: true }`
- Subscribers that care about child cleanup handle it themselves
- The `task_events` table entries for child entities will have their FKs set to NULL (ON DELETE SET NULL)

---

## Recursive Event Prevention

When automation action `set_status` changes an item's status, it must NOT emit `item.status_changed` (infinite loop risk). Solution:

- `emitTaskEvent` accepts `actor_type: 'automation'`
- The automation subscriber filters: `if (event.actor_type === 'automation') return;`
- This is explicit and auditable (the event IS logged, but automations don't react to it)
- Future: add a `max_chain_depth` config to allow controlled recursion

---

## Migration Strategy

### Phase A: Add event bus infrastructure
1. Create `task_events` table
2. Create `taskEventBus.js` and `taskEventSubscribers.js`
3. Register subscribers that replicate current behavior (automations, activity log)

### Phase B: Instrument mutation endpoints (one domain at a time)
1. **Items first** (most important) — `item.created`, `item.updated`, `item.status_changed`, `item.archived`, `item.restored`
2. **Assignees** — `assignee.added`, `assignee.removed`
3. **Updates** — `update.created`
4. **Everything else** — workspace, board, group, file, time entry, labels, automations

### Phase C: Remove direct side-effect calls
1. Remove `logTaskActivity()` calls from route handlers (subscriber handles it)
2. Remove `runEventAutomationsForItemChange()` call from PATCH /items/:id (subscriber handles it)
3. Remove `runEventAutomationsForAssigneeAdded()` call from POST /items/:id/assignees (subscriber handles it)

### Feature Flag

During migration, use env var `TASK_EVENT_BUS_ENABLED=true` (default false). When disabled, the old direct calls continue. When enabled, events are emitted and subscribers run. After validation, remove the flag and the old direct calls.

---

## Permission Model

Events are internal server-side only. No API endpoint exposes the event stream directly. The `task_events` table is queryable by admins for audit purposes (future Phase 4 spec: TM-020).

---

## Validation

1. `yarn build` — passes
2. Create an item → verify `task_events` row with `event_type = 'item.created'`
3. Change item status → verify `item.status_changed` event AND automation still fires
4. Add assignee → verify `assignee.added` event AND notification still sent
5. Archive item → verify `item.archived` event AND activity log entry created
6. Automation `set_status` → verify event logged with `actor_type = 'automation'` AND no recursive trigger
7. Delete workspace → verify `workspace.deleted` event with `cascade: true`
8. Performance: measure response time for PATCH /items/:id — should not increase by >5ms

## Files Affected

### New Files
- `server/services/taskEventBus.js` (~60 lines)
- `server/services/taskEventSubscribers.js` (~100 lines)
- `server/sql/task-events.sql` (table definition + indexes)

### Modified Files
- `server/routes/tasks.js` — add `emitTaskEvent()` calls to all 35 mutation endpoints
- `server/index.js` — call `registerTaskEventSubscribers()` on startup, add migration
- `server/services/taskAutomations.js` — add `actor_type` parameter to `executeAction` for recursion prevention
