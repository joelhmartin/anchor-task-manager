# Feature: TaskContext for Shared State (TM-010)

## Problem

Five different components independently fetch and maintain their own copies of board/workspace data, causing redundant API calls and state synchronization issues:

| Component | What It Fetches | API Call |
|-----------|----------------|----------|
| TaskManager.jsx | Boards for active workspace | `fetchTaskBoards(workspaceId)` |
| TaskManager.jsx | All boards (reports pane) | `fetchTaskBoardsAll()` |
| TaskSidebarPanel.jsx | Workspaces + boards per workspace | `fetchTaskWorkspaces()` + `fetchTaskBoards(w.id)` per workspace |
| AutomationsPane.jsx | All boards | `fetchTaskBoardsAll()` |
| BillingPane.jsx | All boards | `fetchTaskBoardsAll()` |

When a user navigates between panes, the same data is re-fetched. When a board is created/deleted/renamed in one component, others hold stale data until they independently reload.

### Specific Duplication

- **Board list**: Fetched 4+ times across components (`fetchTaskBoardsAll` × 3, `fetchTaskBoards` × 2)
- **Workspace members**: Fetched in TaskManager, not available to panes without prop-drilling
- **Status labels**: Derived from `boardView.status_labels` in TaskManager, prop-drilled to every child
- **Active board/workspace**: Stored in TaskManager URL params, manually parsed in sidebar

## Solution

Create a `TaskContext` React Context that holds shared state and provides it to all task-system components. This eliminates duplicate fetches and ensures all components see consistent data.

## Prerequisites

- **TM-009**: TaskManager decomposition (the hooks from TM-009 will consume TaskContext instead of local state)

---

## Data Model

No database changes. This is a frontend-only refactor.

---

## Context Shape

```js
const TaskContext = createContext({
  // Workspace state
  workspaces: [],                  // all workspaces user can access
  workspacesLoading: false,
  activeWorkspaceId: null,         // derived from URL: ?workspace=
  activeWorkspace: null,           // computed: workspaces.find(w => w.id === activeWorkspaceId)

  // Board state
  boardsByWorkspace: {},           // { workspaceId: [boards] } — replaces sidebar's own state
  allBoards: [],                   // flattened array — replaces AutomationsPane/BillingPane fetches
  boardsLoading: false,
  activeBoardId: null,             // derived from URL: ?board=
  activeBoard: null,               // computed: allBoards.find(b => b.id === activeBoardId)

  // Workspace members (for the active workspace)
  workspaceMembers: [],
  workspaceMembersLoading: false,

  // Status labels (for the active board)
  statusLabels: [],                // board-level + global, merged

  // Actions
  loadWorkspaces: async () => {},
  loadBoardsForWorkspace: async (workspaceId) => {},
  loadAllBoards: async () => {},
  loadWorkspaceMembers: async (workspaceId) => {},
  setActiveWorkspace: (workspaceId) => {},
  setActiveBoard: (boardId) => {},

  // Mutators (update local state after CRUD operations)
  addBoard: (board) => {},
  updateBoard: (boardId, updates) => {},
  removeBoard: (boardId) => {},
  addWorkspace: (workspace) => {},
  removeWorkspace: (workspaceId) => {},
  updateWorkspaceMember: (userId, updates) => {},
  setStatusLabels: (labels) => {},
});
```

---

## Implementation

### New file: `src/contexts/TaskContext.jsx`

```jsx
import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchTaskWorkspaces,
  fetchTaskBoards,
  fetchTaskBoardsAll,
  fetchTaskWorkspaceMembers,
} from 'api/tasks';

const TaskContext = createContext(null);

export function TaskProvider({ children }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // --- Core state ---
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [boardsByWorkspace, setBoardsByWorkspace] = useState({});
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [workspaceMembersLoading, setWorkspaceMembersLoading] = useState(false);
  const [statusLabels, setStatusLabels] = useState([]);

  // --- Derived from URL ---
  const activeWorkspaceId = searchParams.get('workspace') || null;
  const activeBoardId = searchParams.get('board') || null;
  const pane = searchParams.get('pane') || 'home';

  // --- Computed ---
  const allBoards = useMemo(() =>
    Object.values(boardsByWorkspace).flat(),
    [boardsByWorkspace]
  );

  const activeWorkspace = useMemo(() =>
    workspaces.find(w => w.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId]
  );

  const activeBoard = useMemo(() =>
    allBoards.find(b => b.id === activeBoardId) || null,
    [allBoards, activeBoardId]
  );

  // --- Loaders ---
  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    try {
      const data = await fetchTaskWorkspaces();
      setWorkspaces(data);
      return data;
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  const loadBoardsForWorkspace = useCallback(async (workspaceId) => {
    setBoardsLoading(true);
    try {
      const data = await fetchTaskBoards(workspaceId);
      setBoardsByWorkspace(prev => ({ ...prev, [workspaceId]: data }));
      return data;
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  const loadAllBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const data = await fetchTaskBoardsAll();
      // Group by workspace_id
      const grouped = {};
      for (const board of data) {
        const wsId = board.workspace_id;
        if (!grouped[wsId]) grouped[wsId] = [];
        grouped[wsId].push(board);
      }
      setBoardsByWorkspace(grouped);
      return data;
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  const loadWorkspaceMembers = useCallback(async (workspaceId) => {
    setWorkspaceMembersLoading(true);
    try {
      const data = await fetchTaskWorkspaceMembers(workspaceId);
      setWorkspaceMembers(data);
      return data;
    } finally {
      setWorkspaceMembersLoading(false);
    }
  }, []);

  // --- Mutators ---
  const addBoard = useCallback((board) => {
    setBoardsByWorkspace(prev => ({
      ...prev,
      [board.workspace_id]: [...(prev[board.workspace_id] || []), board]
    }));
  }, []);

  const updateBoard = useCallback((boardId, updates) => {
    setBoardsByWorkspace(prev => {
      const next = { ...prev };
      for (const wsId of Object.keys(next)) {
        next[wsId] = next[wsId].map(b =>
          b.id === boardId ? { ...b, ...updates } : b
        );
      }
      return next;
    });
  }, []);

  const removeBoard = useCallback((boardId) => {
    setBoardsByWorkspace(prev => {
      const next = { ...prev };
      for (const wsId of Object.keys(next)) {
        next[wsId] = next[wsId].filter(b => b.id !== boardId);
      }
      return next;
    });
  }, []);

  // --- Navigation ---
  const setActiveWorkspace = useCallback((workspaceId) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (workspaceId) {
        next.set('workspace', workspaceId);
      } else {
        next.delete('workspace');
      }
      next.delete('board'); // clear board when changing workspace
      next.set('pane', 'boards');
      return next;
    });
  }, [setSearchParams]);

  const setActiveBoard = useCallback((boardId) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (boardId) {
        next.set('board', boardId);
      } else {
        next.delete('board');
      }
      next.set('pane', 'boards');
      return next;
    });
  }, [setSearchParams]);

  // --- Auto-load workspace members when workspace changes ---
  useEffect(() => {
    if (activeWorkspaceId) {
      loadWorkspaceMembers(activeWorkspaceId);
    }
  }, [activeWorkspaceId, loadWorkspaceMembers]);

  // --- Context value (memoized to prevent unnecessary re-renders) ---
  const value = useMemo(() => ({
    workspaces, workspacesLoading, activeWorkspaceId, activeWorkspace,
    boardsByWorkspace, allBoards, boardsLoading, activeBoardId, activeBoard,
    workspaceMembers, workspaceMembersLoading,
    statusLabels, setStatusLabels,
    pane,
    loadWorkspaces, loadBoardsForWorkspace, loadAllBoards, loadWorkspaceMembers,
    setActiveWorkspace, setActiveBoard,
    addBoard, updateBoard, removeBoard,
    setWorkspaces,
  }), [
    workspaces, workspacesLoading, activeWorkspaceId, activeWorkspace,
    boardsByWorkspace, allBoards, boardsLoading, activeBoardId, activeBoard,
    workspaceMembers, workspaceMembersLoading,
    statusLabels, pane,
    loadWorkspaces, loadBoardsForWorkspace, loadAllBoards, loadWorkspaceMembers,
    setActiveWorkspace, setActiveBoard,
    addBoard, updateBoard, removeBoard,
  ]);

  return (
    <TaskContext.Provider value={value}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTaskContext() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}

export default TaskContext;
```

---

## Migration: Component by Component

### 1. TaskManager.jsx

**Remove:**
- Local `workspaces`, `activeWorkspaceId`, `activeWorkspace` state
- Local `boardsByWorkspace`, `boardsLoading` state
- Local `workspaceMembers`, `workspaceMembersLoading` state
- `useEffect` that parses workspace/board from URL
- `useEffect` that fetches workspace members on workspace change
- `handleSelectWorkspace`, `handleSelectBoard` handlers (replaced by context setters)

**Replace with:**
```jsx
const {
  workspaces, activeWorkspaceId, activeWorkspace,
  allBoards, boardsLoading, activeBoardId, activeBoard,
  workspaceMembers, workspaceMembersLoading,
  statusLabels, setStatusLabels,
  pane,
  loadWorkspaces, loadBoardsForWorkspace,
  setActiveWorkspace, setActiveBoard,
  addBoard, updateBoard, removeBoard,
} = useTaskContext();
```

**Keep:** Board view state (`boardView`, `boardViewLoading`) — this is board-specific data, not shared state. It stays in the `useBoardView` hook (TM-009).

### 2. TaskSidebarPanel.jsx

**Remove:**
- Local `workspaces`, `boardsByWorkspace`, `loadingWorkspaces` state
- `useEffect` that fetches workspaces and boards on mount
- Duplicate `fetchTaskWorkspaces()` and `fetchTaskBoards()` calls

**Replace with:**
```jsx
const {
  workspaces, workspacesLoading, boardsByWorkspace,
  activeWorkspaceId, activeBoardId, pane,
  setActiveWorkspace, setActiveBoard,
  loadWorkspaces, loadBoardsForWorkspace,
} = useTaskContext();

// Load on mount
useEffect(() => {
  loadWorkspaces().then(ws => {
    for (const w of ws) loadBoardsForWorkspace(w.id);
  });
}, []);
```

### 3. AutomationsPane.jsx

**Remove:**
- Local `allBoards`, `loadingBoards` state
- `useEffect` that fetches all boards on mount

**Replace with:**
```jsx
const { allBoards, boardsLoading } = useTaskContext();
```

### 4. BillingPane.jsx

**Remove:**
- Local `allBoards`, `loadingBoards` state
- `useEffect` that fetches all boards on mount

**Replace with:**
```jsx
const { allBoards, boardsLoading } = useTaskContext();
```

---

## Provider Placement

Wrap `TaskProvider` around the task system routes in the router config:

```jsx
// In src/routes/ or wherever task routes are defined
<Route path="/tasks" element={<TaskProvider><TaskManager /></TaskProvider>} />
```

The provider must be above `TaskManager` and `TaskSidebarPanel` in the component tree. Since the sidebar is in `MainLayout`, the provider should wrap both:

```jsx
// In MainLayout.jsx or the route that renders both sidebar and main content
<TaskProvider>
  <MainLayout sidebar={<TaskSidebarPanel />}>
    <TaskManager />
  </MainLayout>
</TaskProvider>
```

Exact placement depends on how the layout renders the sidebar — check the route config.

---

## Validation

1. `yarn build` — passes
2. Navigate to Tasks → verify workspaces load in sidebar
3. Click workspace → verify boards load (single API call, not duplicated)
4. Switch to Automations pane → verify boards available immediately (no additional fetch)
5. Switch to Billing pane → verify boards available immediately
6. Create a board → verify it appears in sidebar AND in pane board lists
7. Delete a board → verify it disappears from all components
8. Check network tab → verify no duplicate `fetchTaskBoardsAll` or `fetchTaskBoards` calls

## Files Affected

### New Files
- `src/contexts/TaskContext.jsx` (~200 lines)

### Modified Files
- `src/views/tasks/TaskManager.jsx` — consume context instead of local state
- `src/layout/MainLayout/Sidebar/TaskSidebarPanel.jsx` — consume context
- `src/views/tasks/panes/AutomationsPane.jsx` — consume context
- `src/views/tasks/panes/BillingPane.jsx` — consume context
- Route config (router file) — wrap with `TaskProvider`
