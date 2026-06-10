import { useState, useCallback } from 'react';
import { fetchTaskItemSubitems, createTaskSubitem, updateTaskSubitem, deleteTaskSubitem } from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

export default function useItemSubitems(setError) {
  const toast = useToast();
  const [subitems, setSubitems] = useState([]);
  const [subitemsLoading, setSubitemsLoading] = useState(false);
  const [newSubitemName, setNewSubitemName] = useState('');
  const [creatingSubitem, setCreatingSubitem] = useState(false);

  const loadSubitems = useCallback(async (itemId) => {
    if (!itemId) return [];
    setSubitemsLoading(true);
    try {
      const subs = await fetchTaskItemSubitems(itemId);
      setSubitems(subs);
      return subs;
    } catch (err) {
      setError(err.message || 'Unable to load subitems');
      return [];
    } finally {
      setSubitemsLoading(false);
    }
  }, [setError]);

  const handleCreateSubitem = useCallback(async (activeItemId) => {
    if (!activeItemId || !newSubitemName.trim()) return;
    setCreatingSubitem(true);
    setError('');
    try {
      const sub = await createTaskSubitem(activeItemId, { name: newSubitemName.trim() });
      setSubitems((prev) => [sub, ...prev]);
      setNewSubitemName('');
      toast.success('Subitem added');
    } catch (err) {
      setError(err.message || 'Unable to create subitem');
    } finally {
      setCreatingSubitem(false);
    }
  }, [newSubitemName, setError, toast]);

  const handleToggleSubitemDone = useCallback(async (sub) => {
    if (!sub?.id) return;
    setError('');
    try {
      const nextStatus = sub.status === 'done' ? 'todo' : 'done';
      const updated = await updateTaskSubitem(sub.id, { status: nextStatus });
      setSubitems((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
    } catch (err) {
      setError(err.message || 'Unable to update subitem');
    }
  }, [setError]);

  const handleDeleteSubitem = useCallback(async (subitemId) => {
    if (!subitemId) return;
    setError('');
    try {
      await deleteTaskSubitem(subitemId);
      setSubitems((prev) => prev.filter((s) => s.id !== subitemId));
      toast.success('Subitem deleted');
    } catch (err) {
      setError(err.message || 'Unable to delete subitem');
    }
  }, [setError, toast]);

  const reset = useCallback(() => {
    setSubitems([]);
    setSubitemsLoading(true);
    setNewSubitemName('');
  }, []);

  return {
    subitems, subitemsLoading, newSubitemName, setNewSubitemName, creatingSubitem,
    handleCreateSubitem, handleToggleSubitemDone, handleDeleteSubitem,
    loadSubitems, reset
  };
}
