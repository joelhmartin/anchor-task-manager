# Feature: Board Connections & Dependencies (TM-018)

## Problem

Items exist in isolation. There is no way to link items across boards, mirror data from linked items, or define dependency relationships (e.g., "Task B cannot start until Task A is done"). The only parent-child relationship is subitems, which are scoped within a single item and have no cross-board capability.

## Solution

Add three interconnected features:

1. **Item Links** — Connect items within or across boards with typed relationships
2. **Mirror Columns** — Read-only columns that display values from linked items (future phase)
3. **Dependencies** — Finish-to-start scheduling constraints with visual indicators

Start with item links and finish-to-start dependencies. Mirror columns and advanced dependency types are fast-follows.

## Prerequisites

- **TM-014**: Event Bus (link/dependency changes emit events for automations)
- **TM-017**: Board Views (timeline view renders dependency arrows)

---

## Data Model

### New tables

```sql
-- Item-to-item links (cross-board capable)
CREATE TABLE IF NOT EXISTS task_item_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  target_item_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'related',  -- 'related' | 'blocks' | 'blocked_by' | 'duplicate'
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_item_id, target_item_id, link_type),
  CHECK (source_item_id != target_item_id)
);

CREATE INDEX IF NOT EXISTS idx_task_item_links_source
  ON task_item_links (source_item_id);
CREATE INDEX IF NOT EXISTS idx_task_item_links_target
  ON task_item_links (target_item_id);

-- Dependencies (scheduling constraints)
CREATE TABLE IF NOT EXISTS task_item_dependencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  predecessor_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  successor_id UUID NOT NULL REFERENCES task_items(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'finish_to_start',
  -- 'finish_to_start' (default, only type for v1)
  -- Future: 'start_to_start', 'finish_to_finish', 'start_to_finish'
  lag_days INTEGER NOT NULL DEFAULT 0,  -- positive = delay, negative = overlap
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(predecessor_id, successor_id),
  CHECK (predecessor_id != successor_id)
);

CREATE INDEX IF NOT EXISTS idx_task_item_dependencies_predecessor
  ON task_item_dependencies (predecessor_id);
CREATE INDEX IF NOT EXISTS idx_task_item_dependencies_successor
  ON task_item_dependencies (successor_id);
```

### Link Types

| Type | Meaning | Display |
|------|---------|---------|
| `related` | General association | "Related to" |
| `blocks` | Source blocks target | "Blocks → Target" |
| `blocked_by` | Source is blocked by target | "Blocked by ← Target" |
| `duplicate` | Source duplicates target | "Duplicate of" |

When creating a `blocks` link from A→B, automatically create inverse `blocked_by` from B→A. Deleting either removes both.

### Dependency Type (v1)

| Type | Rule |
|------|------|
| `finish_to_start` | Successor cannot start until predecessor is in a `done_state` status |

**Enforcement:** Dependencies are advisory in v1 — they show warnings but don't hard-block status changes. Hard enforcement is a future option.

---

## Circular Dependency Detection

Before creating a dependency, check for cycles:

```js
async function wouldCreateCycle(predecessorId, successorId) {
  // BFS from successorId following existing dependencies
  // If we reach predecessorId, creating this link would form a cycle
  const visited = new Set();
  const queue = [successorId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === predecessorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const { rows } = await query(
      `SELECT successor_id FROM task_item_dependencies WHERE predecessor_id = $1`,
      [current]
    );
    for (const row of rows) {
      queue.push(row.successor_id);
    }
  }
  return false;
}
```

Reject dependency creation with 400 error if cycle detected.

---

## API Endpoints

### Item Links

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/items/:itemId/links` | List all links for an item |
| POST | `/items/:itemId/links` | Create link to another item |
| DELETE | `/item-links/:linkId` | Remove link (and inverse if blocks/blocked_by) |

**POST body:**
```json
{
  "target_item_id": "uuid",
  "link_type": "related"
}
```

**GET response:**
```json
{
  "links": [
    {
      "id": "uuid",
      "link_type": "blocks",
      "direction": "outgoing",
      "linked_item": {
        "id": "uuid",
        "name": "Task B",
        "status": "To Do",
        "board_name": "Development",
        "board_id": "uuid"
      },
      "created_by": { "id": "uuid", "name": "John" },
      "created_at": "2026-03-04T..."
    }
  ]
}
```

### Dependencies

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/items/:itemId/dependencies` | List predecessors and successors |
| POST | `/items/:itemId/dependencies` | Create dependency |
| DELETE | `/item-dependencies/:depId` | Remove dependency |
| GET | `/boards/:boardId/dependency-graph` | Full dependency graph for board (for timeline view) |

**POST body:**
```json
{
  "predecessor_id": "uuid",
  "lag_days": 0
}
```
(The item in the URL is the successor.)

**GET `/items/:itemId/dependencies` response:**
```json
{
  "predecessors": [
    {
      "dependency_id": "uuid",
      "item": { "id": "uuid", "name": "Task A", "status": "Done", "due_date": "2026-03-01" },
      "dependency_type": "finish_to_start",
      "lag_days": 0,
      "is_satisfied": true
    }
  ],
  "successors": [
    {
      "dependency_id": "uuid",
      "item": { "id": "uuid", "name": "Task C", "status": "To Do", "due_date": "2026-03-15" },
      "dependency_type": "finish_to_start",
      "lag_days": 2,
      "is_satisfied": false
    }
  ]
}
```

`is_satisfied` is computed: for finish_to_start, predecessor status must be in a `done_state`.

**GET `/boards/:boardId/dependency-graph` response:**
```json
{
  "nodes": [
    { "item_id": "uuid", "name": "Task A", "status": "Done", "due_date": "2026-03-01" }
  ],
  "edges": [
    { "id": "uuid", "predecessor_id": "uuid", "successor_id": "uuid", "lag_days": 0, "is_satisfied": true }
  ]
}
```

---

## UI Changes

### Item Drawer — Links Section

Add a "Links" section to the item drawer (below updates, above files):

```
+-- Links
|   +-- Related to: Task B (Development Board) [×]
|   +-- Blocks: Task C (QA Board) [×]
|   +-- [+ Add Link]
```

**"+ Add Link" flow:**
1. Click → dropdown: link type (Related, Blocks, Blocked by, Duplicate)
2. Search field → searches items across accessible boards (autocomplete)
3. Select item → POST creates link → link appears in list

### Item Drawer — Dependencies Section

Add a "Dependencies" section in the item drawer:

```
+-- Dependencies
|   +-- Waiting on:
|   |   ✅ Task A (Done) — satisfied
|   |   ⚠️ Task D (Working on it) — not yet done
|   +-- Blocking:
|   |   Task C (To Do)
|   +-- [+ Add Dependency]
```

- Green check = predecessor is in done_state
- Warning icon = predecessor not yet done
- Click predecessor name → navigate to that item

### BoardTable — Dependency Indicators

In the table view, items with unsatisfied dependencies show a small warning icon:

```
⚠️ Task C    To Do    Mar 15    @user
```

Hover tooltip: "Blocked by: Task D (Working on it)"

### Timeline View — Dependency Arrows

In the timeline view (TM-017), render arrows between dependent items:

```
Task A  ██████████████ ──→ Task C  ░░░░░░░████████
                    (finish_to_start)
```

Arrow connects end of predecessor bar to start of successor bar.

---

## Event Bus Integration

Emit events when links/dependencies change:

| Event Type | Triggered By |
|-----------|-------------|
| `item_link.created` | POST /items/:id/links |
| `item_link.deleted` | DELETE /item-links/:id |
| `dependency.created` | POST /items/:id/dependencies |
| `dependency.deleted` | DELETE /item-dependencies/:id |
| `dependency.satisfied` | When predecessor moves to done_state (checked by event subscriber) |
| `dependency.unsatisfied` | When predecessor moves out of done_state |

The `dependency.satisfied` / `dependency.unsatisfied` events enable automations like: "When all dependencies satisfied, auto-move item to 'Ready to Start'".

---

## Permission Model

- Creating links: user must have `board.edit_items` on both the source and target boards
- Cross-board links: user must have workspace access to workspaces containing both boards
- Dependencies: same permission model as links
- Viewing links: visible to anyone with `board.view` on the item's board; linked item details only shown if user has `board.view` on the linked board (otherwise show "Item on restricted board")

---

## Migration Strategy

### Phase A: Item Links
1. Create `task_item_links` table
2. Implement link CRUD endpoints
3. Add links section to item drawer
4. Cross-board item search endpoint

### Phase B: Dependencies (finish-to-start only)
1. Create `task_item_dependencies` table
2. Implement dependency CRUD + cycle detection
3. Add dependency section to item drawer
4. Warning indicators in BoardTable
5. Event bus subscribers for satisfied/unsatisfied

### Phase C: Timeline Integration (after TM-017)
1. Render dependency arrows in TimelineView
2. Dependency-aware date dragging (shift successors)

### Feature Flag

`TASK_ITEM_LINKS=true` — enables links UI and endpoints.
`TASK_DEPENDENCIES=true` — enables dependencies (requires links to be enabled).

---

## Validation

1. `yarn build` — passes
2. Create link between two items on same board → verify appears in both items' link sections
3. Create cross-board link → verify permission check works
4. Create `blocks` link → verify inverse `blocked_by` auto-created
5. Delete link → verify inverse also deleted
6. Create dependency A→B → verify shows in both items
7. Attempt circular dependency A→B→C→A → verify rejected with 400 error
8. Complete predecessor → verify `is_satisfied` becomes true
9. Move predecessor out of done_state → verify `is_satisfied` becomes false
10. Item with unsatisfied dependency → verify warning icon in table view

## Files Affected

### New Files
- `server/sql/task-item-links.sql`
- `server/sql/task-item-dependencies.sql`
- `src/views/tasks/components/ItemLinksSection.jsx`
- `src/views/tasks/components/ItemDependenciesSection.jsx`
- `src/views/tasks/components/LinkItemSearch.jsx`

### Modified Files
- `server/routes/tasks.js` — link and dependency CRUD endpoints, cross-board search
- `server/services/taskEventSubscribers.js` — dependency satisfied/unsatisfied event handlers
- `server/index.js` — run migrations
- `src/views/tasks/TaskManager.jsx` — pass link/dependency data to drawer
- `src/views/tasks/components/BoardTable.jsx` — dependency warning indicators
- `src/api/tasks.js` — new API methods for links and dependencies
