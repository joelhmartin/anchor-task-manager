import { useEffect, useRef, useState, useCallback } from 'react';
import {
  fetchTaskItemAssignees, addTaskItemAssignee, removeTaskItemAssignee,
  updateTaskItem
} from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

export default function useItemDrawer(activeBoardId, searchParams, setSearchParams, setError) {
  const toast = useToast();
  const [activeItem, setActiveItem] = useState(null);
  const [itemDrawerOpen, setItemDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('updates');
  const [highlightedItemId, setHighlightedItemId] = useState('');
  const itemCardRefs = useRef({});
  const [assignees, setAssignees] = useState([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [newAssigneeUserId, setNewAssigneeUserId] = useState('');
  const [addingAssignee, setAddingAssignee] = useState(false);

  const closeItemDrawer = useCallback(() => {
    setItemDrawerOpen(false);
    setActiveItem(null);
    const next = new URLSearchParams(searchParams);
    next.delete('item');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // openItemDrawer accepts resetFns (from sub-hooks) and loadFns (parallel data loaders)
  const openItemDrawer = useCallback(async (item, { resetFns = [], loadFns = [] } = {}) => {
    setActiveItem(item);
    setItemDrawerOpen(true);
    // keep deep link in sync
    if (activeBoardId && item?.id) {
      const next = new URLSearchParams(searchParams);
      next.set('board', activeBoardId);
      next.set('item', item.id);
      setSearchParams(next, { replace: true });
    }
    // Reset all sub-hook state
    for (const fn of resetFns) fn();
    setAssignees([]);
    setAssigneesLoading(true);
    setNewAssigneeUserId('');

    try {
      // loadFns return promises for parallel data loading (updates, files, time, ai, subitems)
      const results = await Promise.all([
        fetchTaskItemAssignees(item.id),
        ...loadFns.map((fn) => fn(item.id))
      ]);
      setAssignees(results[0]);
    } catch (err) {
      setError(err.message || 'Unable to load item data');
    } finally {
      setAssigneesLoading(false);
    }
  }, [activeBoardId, searchParams, setSearchParams, setError]);

  const handleAddAssignee = useCallback(async () => {
    if (!activeItem?.id || !newAssigneeUserId) return;
    setAddingAssignee(true);
    setError('');
    try {
      const assignee = await addTaskItemAssignee(activeItem.id, { user_id: newAssigneeUserId });
      if (assignee?.user_id) {
        setAssignees((prev) => {
          const exists = prev.some((a) => a.user_id === assignee.user_id);
          return exists ? prev : [...prev, assignee];
        });
      }
      setNewAssigneeUserId('');
      toast.success('Assignee added');
    } catch (err) {
      setError(err.message || 'Unable to add assignee');
    } finally {
      setAddingAssignee(false);
    }
  }, [activeItem, newAssigneeUserId, setError, toast]);

  const handleRemoveAssignee = useCallback(async (assigneeUserId) => {
    if (!activeItem?.id || !assigneeUserId) return;
    setError('');
    try {
      await removeTaskItemAssignee(activeItem.id, assigneeUserId);
      setAssignees((prev) => prev.filter((a) => a.user_id !== assigneeUserId));
      toast.success('Assignee removed');
    } catch (err) {
      setError(err.message || 'Unable to remove assignee');
    }
  }, [activeItem, setError, toast]);

  const updateItemField = useCallback(async (patch, { loadBoardView, loadBoardReport } = {}) => {
    if (!activeItem?.id) return;
    setError('');
    try {
      const next = await updateTaskItem(activeItem.id, patch);
      setActiveItem(next);
      if (activeBoardId) {
        if (loadBoardView) loadBoardView(activeBoardId);
        if (loadBoardReport) loadBoardReport(activeBoardId);
      }
    } catch (err) {
      setError(err.message || 'Unable to update item');
    }
  }, [activeItem, activeBoardId, setError]);

  // Optimistic rename: paints the new name immediately, reverts on failure.
  // Used by the inline-edit heading in ItemDrawer.
  const renameItem = useCallback(async (rawName, { loadBoardView, loadBoardReport } = {}) => {
    if (!activeItem?.id) return false;
    const next = String(rawName ?? '').trim();
    if (!next || next === activeItem.name) return false;
    const prev = activeItem;
    setActiveItem({ ...prev, name: next });
    setError('');
    try {
      const server = await updateTaskItem(prev.id, { name: next });
      setActiveItem(server);
      if (activeBoardId) {
        if (loadBoardView) loadBoardView(activeBoardId);
        if (loadBoardReport) loadBoardReport(activeBoardId);
      }
      return true;
    } catch (err) {
      setActiveItem(prev);
      toast.error(err.message || 'Unable to rename item');
      return false;
    }
  }, [activeItem, activeBoardId, setError, toast]);

  // Scroll-into-view on item open
  useEffect(() => {
    const id = activeItem?.id;
    if (!id) return;
    const el = itemCardRefs.current?.[id];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    setHighlightedItemId(id);
    const t = setTimeout(() => setHighlightedItemId(''), 4000);
    return () => clearTimeout(t);
  }, [activeItem?.id]);

  return {
    activeItem, setActiveItem, itemDrawerOpen, drawerTab, setDrawerTab,
    highlightedItemId, itemCardRefs,
    assignees, setAssignees, assigneesLoading, newAssigneeUserId, setNewAssigneeUserId, addingAssignee,
    openItemDrawer, closeItemDrawer,
    handleAddAssignee, handleRemoveAssignee, updateItemField, renameItem
  };
}
