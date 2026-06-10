import { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchMyWork, fetchTaskBoardsAll, fetchTaskBoardView, fetchTaskWorkspaceMembers } from 'api/tasks';

export default function useMyWork(pane, userId) {
  const [myWorkBoards, setMyWorkBoards] = useState([]);
  const [myWorkSubitems, setMyWorkSubitems] = useState([]);
  const [myWorkLoading, setMyWorkLoading] = useState(false);
  const [myWorkMembers, setMyWorkMembers] = useState([]);

  const refreshMyWork = useCallback(async () => {
    try {
      const result = await fetchMyWork();
      if (Array.isArray(result.boards)) setMyWorkBoards(result.boards);
      if (Array.isArray(result.subitems)) setMyWorkSubitems(result.subitems);
    } catch (_err) {
      // ignore
    }
  }, []);

  // Load My Work (assigned to current user), grouped by board
  useEffect(() => {
    if (pane !== 'my-work') return;
    setMyWorkLoading(true);
    const run = async () => {
      let rows = [];
      let subs = [];
      try {
        const result = await fetchMyWork();
        rows = result.boards || [];
        subs = result.subitems || [];
      } catch (_err) {
        rows = [];
        subs = [];
      }

      if (rows && rows.length) {
        setMyWorkBoards(rows);
        setMyWorkSubitems(subs);
        setMyWorkLoading(false);
        return;
      }

      // Fallback: derive my work client-side across all boards
      try {
        const boards = await fetchTaskBoardsAll();
        const me = userId;
        const grouped = [];
        for (const b of boards) {
          try {
            const view = await fetchTaskBoardView(b.id);
            const assigneesByItem = view?.assignees_by_item || {};
            const items = (view?.items || []).filter((it) => {
              const assignees = assigneesByItem[it.id] || [];
              return assignees.some((a) => a.user_id === me);
            });
            if (items.length) {
              grouped.push({
                board_id: b.id,
                board_name: b.name,
                workspace_id: b.workspace_id,
                workspace_name: b.workspace_name,
                items
              });
            }
          } catch (_err) {
            // ignore individual board errors
          }
        }
        setMyWorkBoards(grouped);
        setMyWorkSubitems(subs);
      } catch (_err) {
        setMyWorkBoards([]);
        setMyWorkSubitems([]);
      } finally {
        setMyWorkLoading(false);
      }
    };
    run();
  }, [pane, userId]);

  // Load members for all workspaces represented in My Work so the People picker works
  useEffect(() => {
    if (pane !== 'my-work') return;
    const workspaceIds = Array.from(new Set((myWorkBoards || []).map((b) => b.workspace_id).filter(Boolean)));
    if (!workspaceIds.length) {
      setMyWorkMembers([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const lists = await Promise.all(
          workspaceIds.map((wsId) =>
            fetchTaskWorkspaceMembers(wsId)
              .then((m) => m || [])
              .catch(() => [])
          )
        );
        if (cancelled) return;
        const merged = [];
        const seen = new Set();
        for (const list of lists) {
          for (const m of list) {
            if (m?.user_id && !seen.has(m.user_id)) {
              seen.add(m.user_id);
              merged.push(m);
            }
          }
        }
        setMyWorkMembers(merged);
      } catch (_err) {
        if (!cancelled) setMyWorkMembers([]);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [pane, myWorkBoards]);

  const myWorkGroups = useMemo(() => {
    if (!Array.isArray(myWorkBoards)) return [];
    return myWorkBoards.map((b) => ({
      id: b.board_id,
      name: b.board_name,
      count: (b.items || []).length
    }));
  }, [myWorkBoards]);

  const myWorkItemsByGroup = useMemo(() => {
    const map = {};
    if (!Array.isArray(myWorkBoards)) return map;
    for (const b of myWorkBoards) {
      const gid = b.board_id;
      map[gid] = (b.items || []).map((it) => ({
        ...it,
        group_id: gid
      }));
    }
    return map;
  }, [myWorkBoards]);

  const myWorkAssigneesByItem = useMemo(() => {
    const map = {};
    if (!Array.isArray(myWorkBoards)) return map;
    for (const b of myWorkBoards) {
      for (const it of b.items || []) {
        if (it.id) map[it.id] = it.assignees || [];
      }
    }
    return map;
  }, [myWorkBoards]);

  const myWorkUpdateCounts = useMemo(() => {
    const map = {};
    if (!Array.isArray(myWorkBoards)) return map;
    for (const b of myWorkBoards) {
      for (const it of b.items || []) {
        if (it.id) map[it.id] = Number(it.update_count || 0);
      }
    }
    return map;
  }, [myWorkBoards]);

  const myWorkTimeTotals = useMemo(() => {
    const map = {};
    if (!Array.isArray(myWorkBoards)) return map;
    for (const b of myWorkBoards) {
      for (const it of b.items || []) {
        if (it.id) map[it.id] = Number(it.time_total_minutes || 0);
      }
    }
    return map;
  }, [myWorkBoards]);

  return {
    myWorkBoards, myWorkSubitems, myWorkLoading, myWorkMembers,
    myWorkGroups, myWorkItemsByGroup, myWorkAssigneesByItem, myWorkUpdateCounts, myWorkTimeTotals,
    refreshMyWork
  };
}
