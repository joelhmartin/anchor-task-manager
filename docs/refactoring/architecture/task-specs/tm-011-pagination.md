# Feature: Backend List Endpoint Pagination (TM-011)

## Problem

Four list endpoints return ALL records with no pagination:

| Endpoint | Current Behavior | Risk |
|----------|-----------------|------|
| `GET /boards/:boardId/view` | Returns ALL items on board | Boards with 100+ items cause slow loads, memory bloat |
| `GET /items/:itemId/updates` | Returns ALL comments | Items with 50+ comments load unnecessarily |
| `GET /items/:itemId/files` | Returns ALL files | Minor risk, but unbounded |
| `GET /items/:itemId/time-entries` | Returns ALL entries | Items with months of entries load unnecessarily |

The board view endpoint is the worst offender — it fetches all items, then runs N+1 aggregate queries (assignees, time totals, update counts) for the full set. A board with 200 items triggers 200+ rows plus 4 aggregate queries over all 200 item IDs.

## Solution

Add cursor-based pagination to the item sub-resource endpoints (updates, files, time entries) and a configurable limit with offset-based pagination to the board view endpoint.

### Why Cursor-Based for Sub-Resources

Sub-resources (updates, files, time entries) are chronologically ordered and append-only. Cursor-based pagination (using `created_at` + `id` as cursor) avoids the offset drift problem when new records are inserted during pagination.

### Why Offset-Based for Board View

The board view groups items by group and needs to support sorting by multiple fields (name, status, due_date, updated_at). Cursor-based pagination is complex with multiple sort keys. Offset + limit is simpler and adequate since boards rarely exceed 500 items, and new item insertion during pagination is unlikely in a single user session.

## Prerequisites

- **TM-006**: Missing indexes (pagination queries benefit from proper indexes)

---

## Data Model

No new tables. The existing indexes from TM-006 support these queries. One additional index recommended:

```sql
-- Composite index for efficient paginated board view
CREATE INDEX IF NOT EXISTS idx_task_items_group_updated
  ON task_items (group_id, archived_at, updated_at DESC, id);
```

---

## API Changes

### 1. Board View — Offset Pagination

**`GET /boards/:boardId/view`**

New query params:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 500 | Max items per page |
| `offset` | int | 0 | Items to skip |

**Modified query:**
```sql
SELECT i.id, i.name, i.status, i.due_date, i.needs_attention,
       i.is_voicemail, i.created_by, i.created_at, i.updated_at
FROM task_items i
JOIN task_groups g ON g.id = i.group_id
WHERE g.board_id = $1 AND i.archived_at IS NULL
ORDER BY i.updated_at DESC, i.created_at DESC
LIMIT $2 OFFSET $3
```

**Response change:**
```json
{
  "board": { ... },
  "groups": [ ... ],
  "items": [ ... ],
  "pagination": {
    "total": 342,
    "limit": 500,
    "offset": 0,
    "has_more": false
  }
}
```

For the default limit of 500, most boards return all items in one page (no UI change needed). Only large boards hit pagination, at which point the frontend can implement "Load More" or infinite scroll.

**Total count query** (separate, for pagination metadata):
```sql
SELECT COUNT(*) FROM task_items i
JOIN task_groups g ON g.id = i.group_id
WHERE g.board_id = $1 AND i.archived_at IS NULL
```

### 2. Item Updates — Cursor Pagination

**`GET /items/:itemId/updates`**

New query params:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | Updates per page |
| `before` | UUID | null | Cursor: load updates before this ID |

**Modified query:**
```sql
SELECT u.id, u.content, u.created_at,
       json_build_object('id', usr.id, 'name', usr.name, 'avatar', usr.avatar) as user
FROM task_updates u
JOIN users usr ON usr.id = u.user_id
WHERE u.item_id = $1
  AND ($2::uuid IS NULL OR (u.created_at, u.id) < (
    SELECT u2.created_at, u2.id FROM task_updates u2 WHERE u2.id = $2
  ))
ORDER BY u.created_at DESC, u.id DESC
LIMIT $3
```

**Response:**
```json
{
  "updates": [ ... ],
  "pagination": {
    "has_more": true,
    "next_cursor": "uuid-of-last-update"
  }
}
```

### 3. Item Files — Cursor Pagination

**`GET /items/:itemId/files`**

Same pattern as updates:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | Files per page |
| `before` | UUID | null | Cursor |

### 4. Item Time Entries — Cursor Pagination

**`GET /items/:itemId/time-entries`**

Same pattern:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | Entries per page |
| `before` | UUID | null | Cursor |

---

## Frontend Changes

### API Client (`src/api/tasks.js`)

Update function signatures to accept pagination params:

```js
// Before
export const fetchTaskBoardView = (boardId) =>
  api.get(`/tasks/boards/${boardId}/view`).then(r => r.data);

// After
export const fetchTaskBoardView = (boardId, { limit = 500, offset = 0 } = {}) =>
  api.get(`/tasks/boards/${boardId}/view`, { params: { limit, offset } }).then(r => r.data);

export const fetchTaskItemUpdates = (itemId, { limit = 20, before } = {}) =>
  api.get(`/tasks/items/${itemId}/updates`, { params: { limit, before } }).then(r => r.data);

export const fetchTaskItemFiles = (itemId, { limit = 20, before } = {}) =>
  api.get(`/tasks/items/${itemId}/files`, { params: { limit, before } }).then(r => r.data);

export const fetchTaskItemTimeEntries = (itemId, { limit = 20, before } = {}) =>
  api.get(`/tasks/items/${itemId}/time-entries`, { params: { limit, before } }).then(r => r.data);
```

### Item Drawer (Updates Section)

Add "Load More" button at the bottom of the updates list when `has_more` is true:

```jsx
{updates.map(u => <UpdateCard key={u.id} update={u} />)}
{pagination.has_more && (
  <LoadingButton onClick={loadMoreUpdates} loading={loadingMore}>
    Load earlier updates
  </LoadingButton>
)}
```

`loadMoreUpdates` calls `fetchTaskItemUpdates(itemId, { before: lastUpdateId })` and prepends results to existing list.

### Board View (Large Boards)

For the default 500 limit, no UI change is needed initially. If `pagination.has_more` is true, show a banner:

```jsx
{boardPagination.has_more && (
  <Alert severity="info">
    Showing {items.length} of {boardPagination.total} items.
    <Button onClick={loadMoreItems}>Load more</Button>
  </Alert>
)}
```

---

## Backward Compatibility

All pagination params are optional with sensible defaults. Existing API clients that don't pass params get the same behavior as before (large default limits). The response shape adds a `pagination` object but existing fields are unchanged.

---

## Validation

1. `yarn build` — passes
2. Board with 10 items → verify all items returned (under default limit)
3. Board with 600 items → verify only 500 returned with `has_more: true`
4. Board with 600 items + `offset=500` → verify remaining 100 returned
5. Item with 30 updates → first load returns 20 with cursor → "Load More" returns remaining 10
6. Item with 5 updates → all returned in single page, no "Load More" shown
7. Verify no existing frontend functionality breaks (all calls default to large limits)

## Files Affected

### Modified Files
- `server/routes/tasks.js` — add pagination to 4 GET endpoints
- `src/api/tasks.js` — update function signatures with optional pagination params
- `src/views/tasks/TaskManager.jsx` — handle pagination in update/file/time-entry sections of item drawer
