import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchTaskWorkspaces,
  fetchTaskBoards,
  fetchTaskBoardsAll,
  fetchTaskWorkspaceMembers,
  fetchLabels
} from 'api/tasks';

const TaskContext = createContext(null);

export function TaskProvider({ children }) {
  const [searchParams] = useSearchParams();

  // Core state
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [boardsByWorkspace, setBoardsByWorkspace] = useState({});
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [workspaceMembersLoading, setWorkspaceMembersLoading] = useState(false);
  const [workspaceLabels, setWorkspaceLabels] = useState([]);
  const [workspaceLabelsLoading, setWorkspaceLabelsLoading] = useState(false);

  // Derived from URL
  const activeWorkspaceId = searchParams.get('workspace') || '';
  const activeBoardId = searchParams.get('board') || '';
  const pane = searchParams.get('pane') || 'home';

  // Computed
  const allBoards = useMemo(
    () => Object.values(boardsByWorkspace).flat(),
    [boardsByWorkspace]
  );

  // Loaders
  const loadWorkspaces = useCallback(async () => {
    setWorkspacesLoading(true);
    try {
      const data = await fetchTaskWorkspaces();
      setWorkspaces(data || []);
      return data || [];
    } catch (_err) {
      setWorkspaces([]);
      return [];
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  const loadBoardsForWorkspace = useCallback(async (workspaceId) => {
    if (!workspaceId) return [];
    setBoardsLoading(true);
    try {
      const data = await fetchTaskBoards(workspaceId);
      setBoardsByWorkspace((prev) => ({ ...prev, [workspaceId]: data || [] }));
      return data || [];
    } catch (_err) {
      return [];
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  const loadAllBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const data = await fetchTaskBoardsAll();
      const grouped = {};
      for (const board of data || []) {
        const wsId = board.workspace_id;
        if (!grouped[wsId]) grouped[wsId] = [];
        grouped[wsId].push(board);
      }
      setBoardsByWorkspace(grouped);
      return data || [];
    } catch (_err) {
      return [];
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  const loadWorkspaceMembers = useCallback(async (workspaceId) => {
    if (!workspaceId) {
      setWorkspaceMembers([]);
      return [];
    }
    setWorkspaceMembersLoading(true);
    try {
      const data = await fetchTaskWorkspaceMembers(workspaceId);
      setWorkspaceMembers(data || []);
      return data || [];
    } catch (_err) {
      setWorkspaceMembers([]);
      return [];
    } finally {
      setWorkspaceMembersLoading(false);
    }
  }, []);

  const loadLabels = useCallback(async (workspaceId) => {
    if (!workspaceId) {
      setWorkspaceLabels([]);
      return [];
    }
    setWorkspaceLabelsLoading(true);
    try {
      const data = await fetchLabels(workspaceId);
      setWorkspaceLabels(data || []);
      return data || [];
    } catch (_err) {
      setWorkspaceLabels([]);
      return [];
    } finally {
      setWorkspaceLabelsLoading(false);
    }
  }, []);

  // Mutators
  const addBoard = useCallback((board) => {
    setBoardsByWorkspace((prev) => ({
      ...prev,
      [board.workspace_id]: [...(prev[board.workspace_id] || []), board]
    }));
  }, []);

  const updateBoard = useCallback((boardId, updates) => {
    setBoardsByWorkspace((prev) => {
      const next = { ...prev };
      for (const wsId of Object.keys(next)) {
        next[wsId] = next[wsId].map((b) => (b.id === boardId ? { ...b, ...updates } : b));
      }
      return next;
    });
  }, []);

  const removeBoard = useCallback((boardId) => {
    setBoardsByWorkspace((prev) => {
      const next = { ...prev };
      for (const wsId of Object.keys(next)) {
        next[wsId] = next[wsId].filter((b) => b.id !== boardId);
      }
      return next;
    });
  }, []);

  const addWorkspace = useCallback((workspace) => {
    setWorkspaces((prev) => [...prev, workspace]);
  }, []);

  const removeWorkspace = useCallback((workspaceId) => {
    setWorkspaces((prev) => prev.filter((w) => w.id !== workspaceId));
    setBoardsByWorkspace((prev) => {
      const next = { ...prev };
      delete next[workspaceId];
      return next;
    });
  }, []);

  // Auto-load workspace members when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      loadWorkspaceMembers(activeWorkspaceId);
    } else {
      setWorkspaceMembers([]);
    }
  }, [activeWorkspaceId, loadWorkspaceMembers]);

  // Auto-load workspace labels when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) {
      loadLabels(activeWorkspaceId);
    } else {
      setWorkspaceLabels([]);
    }
  }, [activeWorkspaceId, loadLabels]);

  const value = useMemo(
    () => ({
      workspaces, workspacesLoading, activeWorkspaceId,
      boardsByWorkspace, allBoards, boardsLoading, activeBoardId,
      workspaceMembers, workspaceMembersLoading,
      workspaceLabels, workspaceLabelsLoading,
      pane,
      loadWorkspaces, loadBoardsForWorkspace, loadAllBoards, loadWorkspaceMembers,
      loadLabels,
      addBoard, updateBoard, removeBoard, addWorkspace, removeWorkspace,
      setWorkspaces, setBoardsByWorkspace
    }),
    [
      workspaces, workspacesLoading, activeWorkspaceId,
      boardsByWorkspace, allBoards, boardsLoading, activeBoardId,
      workspaceMembers, workspaceMembersLoading,
      workspaceLabels, workspaceLabelsLoading,
      pane,
      loadWorkspaces, loadBoardsForWorkspace, loadAllBoards, loadWorkspaceMembers,
      loadLabels,
      addBoard, updateBoard, removeBoard, addWorkspace, removeWorkspace
    ]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTaskContext() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider');
  return ctx;
}

export default TaskContext;
