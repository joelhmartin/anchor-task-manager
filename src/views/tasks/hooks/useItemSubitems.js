import { useState, useCallback, useRef } from 'react';
import {
  fetchTaskItemSubitems,
  createTaskSubitem,
  updateTaskSubitem,
  archiveTaskSubitem,
  restoreTaskSubitem,
  reorderTaskSubitems,
  addSubitemAssignee,
  removeSubitemAssignee
} from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

export default function useItemSubitems(setError) {
  const toast = useToast();
  const [subitems, setSubitems] = useState([]);
  const [subitemsLoading, setSubitemsLoading] = useState(false);
  const [newSubitemName, setNewSubitemName] = useState('');
  const [creatingSubitem, setCreatingSubitem] = useState(false);

  const loadSubitems = useCallback(
    async (itemId) => {
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
    },
    [setError]
  );

  const handleCreateSubitem = useCallback(
    async (activeItemId) => {
      if (!activeItemId || !newSubitemName.trim()) return;
      setCreatingSubitem(true);
      setError('');
      try {
        const sub = await createTaskSubitem(activeItemId, { name: newSubitemName.trim() });
        // New subitems sort to the bottom of the list (largest position).
        setSubitems((prev) => [...prev, { ...sub, assignees: sub.assignees || [] }]);
        setNewSubitemName('');
        toast.success('Subitem added');
      } catch (err) {
        setError(err.message || 'Unable to create subitem');
      } finally {
        setCreatingSubitem(false);
      }
    },
    [newSubitemName, setError, toast]
  );

  const handleToggleSubitemDone = useCallback(
    async (sub) => {
      if (!sub?.id) return;
      setError('');
      try {
        const nextStatus = sub.status === 'Done' ? 'To Do' : 'Done';
        const updated = await updateTaskSubitem(sub.id, { status: nextStatus });
        setSubitems((prev) => prev.map((s) => (s.id === sub.id ? { ...s, ...updated, assignees: s.assignees } : s)));
      } catch (err) {
        setError(err.message || 'Unable to update subitem');
      }
    },
    [setError]
  );

  const handleRenameSubitem = useCallback(
    async (subitemId, name) => {
      const trimmed = String(name || '').trim();
      if (!subitemId || !trimmed) return;
      setError('');
      try {
        const updated = await updateTaskSubitem(subitemId, { name: trimmed });
        setSubitems((prev) => prev.map((s) => (s.id === subitemId ? { ...s, ...updated, assignees: s.assignees } : s)));
      } catch (err) {
        setError(err.message || 'Unable to rename subitem');
      }
    },
    [setError]
  );

  const handleSetSubitemStatus = useCallback(
    async (subitemId, status) => {
      if (!subitemId || !status) return;
      setError('');
      // Optimistic: reflect the new status immediately so the chip color updates
      // without a roundtrip; if the PATCH fails we revert to the captured prior
      // status so the chip never shows an unpersisted value.
      let previousStatus;
      setSubitems((prev) =>
        prev.map((s) => {
          if (s.id !== subitemId) return s;
          previousStatus = s.status;
          return { ...s, status };
        })
      );
      try {
        const updated = await updateTaskSubitem(subitemId, { status });
        setSubitems((prev) => prev.map((s) => (s.id === subitemId ? { ...s, ...updated, assignees: s.assignees } : s)));
      } catch (err) {
        setSubitems((prev) =>
          prev.map((s) => (s.id === subitemId && s.status === status ? { ...s, status: previousStatus } : s))
        );
        setError(err.message || 'Unable to update subitem status');
      }
    },
    [setError]
  );

  const handleArchiveSubitem = useCallback(
    async (subitemId) => {
      if (!subitemId) return;
      setError('');
      try {
        await archiveTaskSubitem(subitemId);
        setSubitems((prev) => prev.filter((s) => s.id !== subitemId));
        toast.success('Subitem archived');
      } catch (err) {
        setError(err.message || 'Unable to archive subitem');
      }
    },
    [setError, toast]
  );

  const handleRestoreSubitem = useCallback(
    async (subitemId) => {
      if (!subitemId) return;
      setError('');
      try {
        const restored = await restoreTaskSubitem(subitemId);
        setSubitems((prev) => [...prev, { ...restored, assignees: restored.assignees || [] }]);
        toast.success('Subitem restored');
      } catch (err) {
        setError(err.message || 'Unable to restore subitem');
      }
    },
    [setError, toast]
  );

  const handleAddSubitemAssignee = useCallback(
    async (subitemId, member) => {
      if (!subitemId || !member?.user_id) return;
      setError('');
      try {
        const assignee = await addSubitemAssignee(subitemId, member.user_id);
        setSubitems((prev) =>
          prev.map((s) => {
            if (s.id !== subitemId) return s;
            const existing = s.assignees || [];
            if (existing.some((a) => (a.user_id || a.id) === member.user_id)) return s;
            // The POST endpoint returns {id, first_name, last_name, email, avatar_url};
            // normalize to the {user_id, ...} shape used by the list endpoint so
            // every consumer in the tree can read `a.user_id` uniformly.
            const normalized = assignee
              ? {
                  user_id: assignee.id || assignee.user_id,
                  email: assignee.email,
                  first_name: assignee.first_name,
                  last_name: assignee.last_name,
                  avatar_url: assignee.avatar_url
                }
              : {
                  user_id: member.user_id,
                  email: member.email,
                  first_name: member.first_name,
                  last_name: member.last_name,
                  avatar_url: member.avatar_url
                };
            return { ...s, assignees: [...existing, normalized] };
          })
        );
      } catch (err) {
        setError(err.message || 'Unable to assign subitem');
      }
    },
    [setError]
  );

  const handleRemoveSubitemAssignee = useCallback(
    async (subitemId, userId) => {
      if (!subitemId || !userId) return;
      setError('');
      try {
        await removeSubitemAssignee(subitemId, userId);
        setSubitems((prev) =>
          prev.map((s) => (s.id !== subitemId ? s : { ...s, assignees: (s.assignees || []).filter((a) => (a.user_id || a.id) !== userId) }))
        );
      } catch (err) {
        setError(err.message || 'Unable to remove assignee');
      }
    },
    [setError]
  );

  // Request-token guard: each reorder bumps a monotonic counter; rollbacks only
  // apply when this request is still the latest, so a stale failure can't
  // overwrite a newer drag's order.
  const reorderRequestRef = useRef(0);

  const handleReorderSubitems = useCallback(
    async (itemId, orderedIds) => {
      if (!itemId || !Array.isArray(orderedIds) || !orderedIds.length) return;
      setError('');
      const requestId = ++reorderRequestRef.current;
      // Optimistic reorder: rearrange local state immediately so the drag feels
      // instant; if the server rejects, revert and surface the error.
      let previous;
      setSubitems((prev) => {
        previous = prev;
        const byId = new Map(prev.map((s) => [s.id, s]));
        const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
        const tail = prev.filter((s) => !orderedIds.includes(s.id));
        return [...reordered, ...tail];
      });
      try {
        await reorderTaskSubitems(itemId, orderedIds);
      } catch (err) {
        if (previous && requestId === reorderRequestRef.current) setSubitems(previous);
        setError(err.message || 'Unable to reorder subitems');
      }
    },
    [setError]
  );

  const reset = useCallback(() => {
    setSubitems([]);
    setSubitemsLoading(true);
    setNewSubitemName('');
  }, []);

  return {
    subitems,
    subitemsLoading,
    newSubitemName,
    setNewSubitemName,
    creatingSubitem,
    handleCreateSubitem,
    handleToggleSubitemDone,
    handleArchiveSubitem,
    handleRestoreSubitem,
    handleRenameSubitem,
    handleSetSubitemStatus,
    handleAddSubitemAssignee,
    handleRemoveSubitemAssignee,
    handleReorderSubitems,
    loadSubitems,
    reset
  };
}
