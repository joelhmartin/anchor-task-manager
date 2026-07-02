import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  fetchTaskBoardView, fetchTaskBoards, fetchTaskBoardReport,
  createTaskGroup, deleteTaskGroup, createTaskItem,
  downloadTaskBoardCsv, updateTaskItem, archiveTaskItem,
  addTaskItemAssignee, removeTaskItemAssignee, fetchTaskItemAssignees,
  fetchItemLabels, applyItemLabel, removeItemLabel,
  bulkUpdateTaskItemStatus, bulkUpdateTaskItemLabels,
  bulkUpdateTaskItemAssignees, bulkArchiveTaskItems
} from 'api/tasks';
import { DEFAULT_STATUS_LABELS } from 'constants/taskDefaults';
import { useToast } from 'contexts/ToastContext';

function normalizeDateStr(value) {
  if (!value) return value;
  if (typeof value === 'string') return value.slice(0, 10);
  return value;
}

function normalizeBoardView(view) {
  if (!view) return view;
  const items = Array.isArray(view?.items)
    ? view.items.map((it) => ({
        ...it,
        due_date: normalizeDateStr(it.due_date),
        start_date: normalizeDateStr(it.start_date)
      }))
    : [];
  return { ...view, items };
}

export default function useBoardView(activeBoardId, activeWorkspaceId, pane, searchParams, setSearchParams, setError) {
  const toast = useToast();
  const [boardViewLoading, setBoardViewLoading] = useState(false);
  const [boardView, setBoardView] = useState(null);
  const [boardSearch, setBoardSearch] = useState('');
  const [boardViewType, setBoardViewType] = useState('main');
  const [boardReport, setBoardReport] = useState(null);
  const [boardReportLoading, setBoardReportLoading] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newItemNameByGroup, setNewItemNameByGroup] = useState({});
  const [creatingItemByGroup, setCreatingItemByGroup] = useState({});
  const [workspaceBoards, setWorkspaceBoards] = useState([]);
  const [workspaceBoardsLoading, setWorkspaceBoardsLoading] = useState(false);
  const [itemLabelsMap, setItemLabelsMap] = useState({}); // { [itemId]: label[] }

  const statusLabels = boardView?.status_labels || DEFAULT_STATUS_LABELS;

  // Callback for useStatusLabels to update labels inside boardView
  const updateStatusLabelsInView = useCallback((updater) => {
    setBoardView((prev) => {
      if (!prev) return prev;
      const current = prev.status_labels || [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, status_labels: next };
    });
  }, []);

  const loadBoardView = useCallback(async (boardId) => {
    if (!boardId) {
      setBoardView(null);
      return;
    }
    setBoardViewLoading(true);
    setError('');
    try {
      const PAGE_SIZE = 500;
      const firstPage = await fetchTaskBoardView(boardId, { limit: PAGE_SIZE, offset: 0 });
      let data = normalizeBoardView(firstPage);

      // Auto-paginate: if there are more items than the first page, fetch the rest
      const total = firstPage.pagination?.total || firstPage.total_items || data.items?.length || 0;
      if (total > PAGE_SIZE && data.items) {
        const pages = Math.ceil(total / PAGE_SIZE);
        for (let page = 1; page < pages; page++) {
          const nextPage = await fetchTaskBoardView(boardId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
          const normalized = normalizeBoardView(nextPage);
          if (normalized.items?.length) {
            data = {
              ...data,
              items: [...data.items, ...normalized.items],
              assignees_by_item: { ...(data.assignees_by_item || {}), ...(normalized.assignees_by_item || {}) },
              time_totals_by_item: { ...(data.time_totals_by_item || {}), ...(normalized.time_totals_by_item || {}) },
              update_counts_by_item: { ...(data.update_counts_by_item || {}), ...(normalized.update_counts_by_item || {}) }
            };
          }
        }
      }

      setBoardView(data);
      if (firstPage?.board?.workspace_id && !activeWorkspaceId) {
        const next = new URLSearchParams(searchParams);
        next.set('workspace', firstPage.board.workspace_id);
        setSearchParams(next, { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Unable to load board');
      setBoardView(null);
    } finally {
      setBoardViewLoading(false);
    }
  }, [activeWorkspaceId, searchParams, setSearchParams, setError]);

  const loadBoardReport = useCallback(async (boardId) => {
    if (!boardId) {
      setBoardReport(null);
      return;
    }
    setBoardReportLoading(true);
    try {
      const report = await fetchTaskBoardReport(boardId);
      setBoardReport(report);
    } catch (_err) {
      setBoardReport(null);
    } finally {
      setBoardReportLoading(false);
    }
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (!activeBoardId || !newGroupName.trim()) return;
    setCreatingGroup(true);
    setError('');
    try {
      await createTaskGroup(activeBoardId, { name: newGroupName.trim() });
      setNewGroupName('');
      toast.success('Group created');
      await loadBoardView(activeBoardId);
    } catch (err) {
      setError(err.message || 'Unable to create group');
      toast.error(err.message || 'Unable to create group');
    } finally {
      setCreatingGroup(false);
    }
  }, [activeBoardId, newGroupName, loadBoardView, setError, toast]);

  const handleDeleteGroup = useCallback(async (groupId, closeDrawerFn) => {
    if (!groupId || !activeBoardId) return;
    try {
      await deleteTaskGroup(groupId);
      if (closeDrawerFn) closeDrawerFn();
      toast.success('Group deleted');
      await loadBoardView(activeBoardId);
    } catch (err) {
      setError(err.message || 'Unable to delete group');
      toast.error(err.message || 'Unable to delete group');
    }
  }, [activeBoardId, loadBoardView, setError, toast]);

  const handleCreateItem = useCallback(async (groupId) => {
    const name = (newItemNameByGroup[groupId] || '').trim();
    if (!name) return;
    setCreatingItemByGroup((prev) => ({ ...prev, [groupId]: true }));
    setError('');
    try {
      await createTaskItem(groupId, { name });
      setNewItemNameByGroup((prev) => ({ ...prev, [groupId]: '' }));
      toast.success('Item created');
      await loadBoardView(activeBoardId);
    } catch (err) {
      setError(err.message || 'Unable to create item');
      toast.error(err.message || 'Unable to create item');
    } finally {
      setCreatingItemByGroup((prev) => ({ ...prev, [groupId]: false }));
    }
  }, [activeBoardId, newItemNameByGroup, loadBoardView, setError, toast]);

  const handleDownloadCsv = useCallback(async () => {
    if (!activeBoardId) return;
    setExportingCsv(true);
    setError('');
    try {
      const blob = await downloadTaskBoardCsv(activeBoardId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `board-${activeBoardId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Board exported as CSV');
    } catch (err) {
      setError(err.message || 'Unable to export CSV');
    } finally {
      setExportingCsv(false);
    }
  }, [activeBoardId, setError, toast]);

  const updateItemInline = useCallback(async (itemId, patch, { activeItem, setActiveItem, refreshMyWork } = {}) => {
    if (!itemId) return;
    setError('');
    setBoardView((prev) => {
      if (!prev?.items) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, ...patch, due_date: normalizeDateStr(patch.due_date ?? it.due_date), start_date: normalizeDateStr(patch.start_date ?? it.start_date) } : it
        )
      };
    });
    try {
      const updated = await updateTaskItem(itemId, patch);
      setBoardView((prev) => {
        if (!prev?.items) return prev;
        return {
          ...prev,
          items: prev.items.map((it) => (it.id === itemId ? { ...updated, due_date: normalizeDateStr(updated.due_date), start_date: normalizeDateStr(updated.start_date) } : it))
        };
      });
      if (activeItem?.id === itemId && setActiveItem) {
        setActiveItem({ ...updated, due_date: normalizeDateStr(updated.due_date), start_date: normalizeDateStr(updated.start_date) });
      }
      if (pane === 'my-work' && refreshMyWork) {
        refreshMyWork();
      }
    } catch (err) {
      setError(err.message || 'Unable to update item');
      if (activeBoardId) loadBoardView(activeBoardId);
    }
  }, [activeBoardId, pane, loadBoardView, setError]);

  const toggleAssigneeInline = useCallback(async (itemId, userId, isCurrentlyAssigned, { workspaceMembers, activeItem, setAssignees, refreshMyWork } = {}) => {
    if (!itemId || !userId) return;
    setBoardView((prev) => {
      if (!prev) return prev;
      const existing = prev.assignees_by_item || {};
      const list = Array.isArray(existing[itemId]) ? [...existing[itemId]] : [];
      if (isCurrentlyAssigned) {
        const nextList = list.filter((a) => a.user_id !== userId);
        return { ...prev, assignees_by_item: { ...existing, [itemId]: nextList } };
      }
      const member = (workspaceMembers || []).find((m) => m.user_id === userId);
      const nextList = [
        ...list,
        {
          user_id: userId,
          email: member?.email,
          first_name: member?.first_name,
          last_name: member?.last_name,
          avatar_url: member?.avatar_url
        }
      ];
      return { ...prev, assignees_by_item: { ...existing, [itemId]: nextList } };
    });

    try {
      if (isCurrentlyAssigned) {
        await removeTaskItemAssignee(itemId, userId);
      } else {
        await addTaskItemAssignee(itemId, { user_id: userId });
      }
      if (activeItem?.id === itemId && setAssignees) {
        const ass = await fetchTaskItemAssignees(itemId);
        setAssignees(ass);
      }
      if (activeBoardId) await loadBoardView(activeBoardId);
      if (pane === 'my-work' && refreshMyWork) {
        refreshMyWork();
      }
    } catch (err) {
      setError(err.message || 'Unable to update assignees');
      if (activeBoardId) loadBoardView(activeBoardId);
    }
  }, [activeBoardId, pane, loadBoardView, setError]);

  // Bulk mutations powered by the sticky bulk-action toolbar. Each helper
  // refreshes the board view (and My Work when relevant) once the server
  // transaction commits so the UI reflects the post-write state.
  const bulkUpdateStatus = useCallback(async (itemIds, status, { refreshMyWork } = {}) => {
    if (!itemIds?.length || !status) return { updated_count: 0 };
    try {
      const result = await bulkUpdateTaskItemStatus(itemIds, status);
      toast.success(`Updated ${result.updated_count} item${result.updated_count === 1 ? '' : 's'}`);
      if (activeBoardId) await loadBoardView(activeBoardId);
      if (pane === 'my-work' && refreshMyWork) await refreshMyWork();
      return result;
    } catch (err) {
      toast.error(err.message || 'Unable to update items');
      throw err;
    }
  }, [activeBoardId, pane, loadBoardView, toast]);

  const bulkUpdateAssignees = useCallback(async (itemIds, userId, action, { refreshMyWork } = {}) => {
    if (!itemIds?.length || !userId) return { updated_count: 0 };
    try {
      const result = await bulkUpdateTaskItemAssignees(itemIds, userId, action);
      const verb = action === 'add' ? 'Assigned' : 'Unassigned';
      toast.success(`${verb} on ${result.updated_count} item${result.updated_count === 1 ? '' : 's'}`);
      if (activeBoardId) await loadBoardView(activeBoardId);
      if (pane === 'my-work' && refreshMyWork) await refreshMyWork();
      return result;
    } catch (err) {
      toast.error(err.message || 'Unable to update assignees');
      throw err;
    }
  }, [activeBoardId, pane, loadBoardView, toast]);

  const bulkUpdateLabels = useCallback(async (itemIds, labelId, action) => {
    if (!itemIds?.length || !labelId) return { updated_count: 0 };
    try {
      const result = await bulkUpdateTaskItemLabels(itemIds, labelId, action);
      const verb = action === 'add' ? 'Added label to' : 'Removed label from';
      toast.success(`${verb} ${result.updated_count} item${result.updated_count === 1 ? '' : 's'}`);
      if (activeBoardId) await loadBoardView(activeBoardId);
      // Refresh labels for the affected items so the table cells re-render.
      const affected = result.updated_ids || [];
      if (affected.length) {
        const fetched = await Promise.all(
          affected.map((id) => fetchItemLabels(id).then((labels) => ({ id, labels })).catch(() => null))
        );
        setItemLabelsMap((prev) => {
          const next = { ...prev };
          for (const entry of fetched) {
            if (entry) next[entry.id] = entry.labels;
          }
          return next;
        });
      }
      return result;
    } catch (err) {
      toast.error(err.message || 'Unable to update labels');
      throw err;
    }
  }, [activeBoardId, loadBoardView, toast]);

  const bulkArchive = useCallback(async (itemIds, { closeDrawerFn, refreshMyWork, activeItem } = {}) => {
    if (!itemIds?.length) return { updated_count: 0 };
    try {
      const result = await bulkArchiveTaskItems(itemIds);
      toast.success(`Archived ${result.updated_count} item${result.updated_count === 1 ? '' : 's'}`);
      if (activeBoardId) await loadBoardView(activeBoardId);
      if (pane === 'my-work' && refreshMyWork) await refreshMyWork();
      if (activeItem?.id && itemIds.includes(activeItem.id) && closeDrawerFn) closeDrawerFn();
      return result;
    } catch (err) {
      toast.error(err.message || 'Unable to archive items');
      throw err;
    }
  }, [activeBoardId, pane, loadBoardView, toast]);

  const archiveItem = useCallback(async (itemId, { closeDrawerFn, refreshMyWork, activeItem } = {}) => {
    if (!itemId) return;
    try {
      await archiveTaskItem(itemId);
    } catch (err) {
      toast.error(err.message || 'Unable to archive item');
      return;
    }
    toast.success('Item archived');
    if (activeBoardId) {
      await loadBoardView(activeBoardId);
    }
    if (pane === 'my-work' && refreshMyWork) {
      await refreshMyWork();
    }
    if (activeItem?.id === itemId && closeDrawerFn) {
      closeDrawerFn();
    }
  }, [activeBoardId, pane, loadBoardView, toast]);

  // Batch-load item labels for all visible items
  const loadItemLabels = useCallback(async (items) => {
    if (!items?.length) {
      setItemLabelsMap({});
      return;
    }
    try {
      const results = await Promise.all(items.map((it) => fetchItemLabels(it.id).then((labels) => ({ id: it.id, labels }))));
      const map = {};
      for (const r of results) {
        map[r.id] = r.labels;
      }
      setItemLabelsMap(map);
    } catch (_err) {
      // Silently fail — labels are non-critical
    }
  }, []);

  const toggleItemLabel = useCallback(async (itemId, labelId, isCurrentlyApplied) => {
    if (!itemId || !labelId) return;
    // Optimistic update
    setItemLabelsMap((prev) => {
      const current = prev[itemId] || [];
      if (isCurrentlyApplied) {
        return { ...prev, [itemId]: current.filter((l) => l.id !== labelId) };
      }
      // We don't have the full label object for optimistic add, so we'll refetch
      return prev;
    });
    try {
      if (isCurrentlyApplied) {
        await removeItemLabel(itemId, labelId);
      } else {
        await applyItemLabel(itemId, labelId);
      }
      // Refetch this item's labels to get the correct state
      const labels = await fetchItemLabels(itemId);
      setItemLabelsMap((prev) => ({ ...prev, [itemId]: labels }));
    } catch (err) {
      setError(err.message || 'Unable to update label');
      // Refetch to restore correct state
      const labels = await fetchItemLabels(itemId);
      setItemLabelsMap((prev) => ({ ...prev, [itemId]: labels }));
    }
  }, [setError]);

  // Load board view + workspace boards when board/pane changes
  useEffect(() => {
    if (pane !== 'boards') return;
    loadBoardView(activeBoardId);
    loadBoardReport(activeBoardId);
    if (!activeBoardId && activeWorkspaceId) {
      setWorkspaceBoardsLoading(true);
      fetchTaskBoards(activeWorkspaceId)
        .then((rows) => setWorkspaceBoards(rows || []))
        .catch(() => setWorkspaceBoards([]))
        .finally(() => setWorkspaceBoardsLoading(false));
    } else {
      setWorkspaceBoards([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoardId, pane]);

  // Load item labels when board view items change
  useEffect(() => {
    if (boardView?.items?.length) {
      loadItemLabels(boardView.items);
    } else {
      setItemLabelsMap({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardView?.items]);

  // Reload boards list when workspace changes
  useEffect(() => {
    if (pane !== 'boards') return;
    setWorkspaceBoards([]);
    setWorkspaceBoardsLoading(true);
    if (!activeWorkspaceId) {
      setWorkspaceBoardsLoading(false);
      return;
    }
    fetchTaskBoards(activeWorkspaceId)
      .then((rows) => setWorkspaceBoards(rows || []))
      .catch(() => setWorkspaceBoards([]))
      .finally(() => setWorkspaceBoardsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, pane]);

  const itemsByGroup = useMemo(() => {
    const map = {};
    const items = (boardView?.items || []).filter((it) => {
      if (!boardSearch.trim()) return true;
      return String(it.name || '')
        .toLowerCase()
        .includes(boardSearch.trim().toLowerCase());
    });
    for (const it of items) {
      if (!map[it.group_id]) map[it.group_id] = [];
      map[it.group_id].push(it);
    }
    return map;
  }, [boardView, boardSearch]);

  return {
    boardView, setBoardView, boardViewLoading, boardSearch, setBoardSearch, boardViewType, setBoardViewType,
    boardReport, boardReportLoading, exportingCsv,
    workspaceBoards, workspaceBoardsLoading,
    statusLabels, itemsByGroup, itemLabelsMap,
    newGroupName, setNewGroupName, creatingGroup,
    newItemNameByGroup, setNewItemNameByGroup, creatingItemByGroup,
    loadBoardView, loadBoardReport,
    handleCreateGroup, handleDeleteGroup, handleCreateItem, handleDownloadCsv,
    updateItemInline, toggleAssigneeInline, archiveItem,
    bulkUpdateStatus, bulkUpdateAssignees, bulkUpdateLabels, bulkArchive,
    updateStatusLabelsInView, toggleItemLabel, loadItemLabels
  };
}
