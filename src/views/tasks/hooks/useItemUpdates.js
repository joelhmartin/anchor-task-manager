import { useEffect, useRef, useState, useCallback } from 'react';
import { clientLabel } from 'hooks/useClientLabel';
import {
  fetchTaskItemUpdates, createTaskItemUpdate,
  searchTaskWorkspaceMembers,
  fetchTaskItemAiSummary, refreshTaskItemAiSummary,
  markUpdatesViewed, fetchUpdateViews
} from 'api/tasks';
import { useToast } from 'contexts/ToastContext';

export default function useItemUpdates(workspaceMembers, activeWorkspaceId, setError) {
  const toast = useToast();
  const [itemUpdates, setItemUpdates] = useState([]);
  const [itemUpdatesLoading, setItemUpdatesLoading] = useState(false);
  const [newUpdateText, setNewUpdateText] = useState('');
  const [postingUpdate, setPostingUpdate] = useState(false);
  const updateInputRef = useRef(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOptions, setMentionOptions] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [updateViews, setUpdateViews] = useState({});
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryMeta, setAiSummaryMeta] = useState({ is_stale: false, latest_update_at: null });
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryRefreshing, setAiSummaryRefreshing] = useState(false);

  // Mention autocomplete search
  useEffect(() => {
    if (!mentionOpen || !activeWorkspaceId) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      const q = mentionQuery.trim();
      if (!q) {
        const local = (workspaceMembers || []).slice(0, 5);
        setMentionOptions(local);
        return;
      }
      setMentionLoading(true);
      searchTaskWorkspaceMembers(activeWorkspaceId, q)
        .then((rows) => {
          if (cancelled) return;
          setMentionOptions(rows);
        })
        .catch(() => {
          if (cancelled) return;
          const ql = q.toLowerCase();
          const local = (workspaceMembers || []).filter((m) => {
            const name = clientLabel(m).toLowerCase();
            return (m.email || '').toLowerCase().includes(ql) || name.includes(ql);
          });
          setMentionOptions(local.slice(0, 10));
        })
        .finally(() => {
          if (cancelled) return;
          setMentionLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mentionOpen, mentionQuery, activeWorkspaceId, workspaceMembers]);

  const loadUpdates = useCallback(async (itemId) => {
    if (!itemId) return [];
    setItemUpdatesLoading(true);
    try {
      const data = await fetchTaskItemUpdates(itemId);
      const updates = data.updates || [];
      setItemUpdates(updates);
      if (updates.length) {
        const updateIds = updates.map((u) => u.id);
        markUpdatesViewed(updateIds).catch(() => {});
        fetchUpdateViews(updateIds)
          .then((views) => setUpdateViews(views))
          .catch(() => {});
      } else {
        setUpdateViews({});
      }
      return updates;
    } catch (err) {
      setError(err.message || 'Unable to load updates');
      return [];
    } finally {
      setItemUpdatesLoading(false);
    }
  }, [setError]);

  const loadAiSummary = useCallback(async (itemId) => {
    if (!itemId) return null;
    setAiSummaryLoading(true);
    try {
      const ai = await fetchTaskItemAiSummary(itemId);
      setAiSummary(ai.summary || null);
      setAiSummaryMeta({ is_stale: Boolean(ai.is_stale), latest_update_at: ai.latest_update_at || null });
      return ai;
    } catch (_err) {
      return null;
    } finally {
      setAiSummaryLoading(false);
    }
  }, []);

  const handlePostUpdate = useCallback(async (activeItemId) => {
    if (!activeItemId || !newUpdateText.trim()) return;
    setPostingUpdate(true);
    setError('');
    try {
      await createTaskItemUpdate(activeItemId, { content: newUpdateText.trim() });
      const data = await fetchTaskItemUpdates(activeItemId);
      const updates = data.updates || [];
      setItemUpdates(updates);
      setNewUpdateText('');
      setAiSummaryMeta((prev) => ({ ...prev, is_stale: true }));
      if (updates.length) {
        const updateIds = updates.map((u) => u.id);
        markUpdatesViewed(updateIds).catch(() => {});
        fetchUpdateViews(updateIds)
          .then((views) => setUpdateViews(views))
          .catch(() => {});
      }
      toast.success('Update posted');
    } catch (err) {
      setError(err.message || 'Unable to post update');
    } finally {
      setPostingUpdate(false);
    }
  }, [newUpdateText, setError, toast]);

  function getMentionStateFromText(text, caretIndex) {
    const before = String(text || '').slice(0, caretIndex);
    const at = before.lastIndexOf('@');
    if (at < 0) return { active: false };
    const afterAt = before.slice(at + 1);
    if (/\s/.test(afterAt)) return { active: false };
    return { active: true, query: afterAt, atIndex: at };
  }

  const insertMention = useCallback((email) => {
    const el = updateInputRef.current;
    const text = newUpdateText || '';
    const caret = el?.selectionStart ?? text.length;
    const state = getMentionStateFromText(text, caret);
    if (!state.active) return;
    const before = text.slice(0, state.atIndex);
    const after = text.slice(caret);
    const next = `${before}@${email} ${after}`;
    setNewUpdateText(next);
    setMentionOpen(false);
    setMentionQuery('');
    requestAnimationFrame(() => {
      if (!updateInputRef.current) return;
      const pos = (before + `@${email} `).length;
      updateInputRef.current.focus();
      updateInputRef.current.setSelectionRange(pos, pos);
    });
  }, [newUpdateText]);

  const handleRefreshAiSummary = useCallback(async (activeItemId) => {
    if (!activeItemId) return;
    setAiSummaryRefreshing(true);
    setError('');
    try {
      const summary = await refreshTaskItemAiSummary(activeItemId);
      setAiSummary(summary);
      setAiSummaryMeta((prev) => ({ ...prev, is_stale: false }));
      toast.success('AI summary refreshed');
    } catch (err) {
      setError(err.message || 'Unable to refresh AI summary');
    } finally {
      setAiSummaryRefreshing(false);
    }
  }, [setError, toast]);

  const reset = useCallback(() => {
    setNewUpdateText('');
    setItemUpdates([]);
    setItemUpdatesLoading(true);
    setAiSummary(null);
    setAiSummaryMeta({ is_stale: false, latest_update_at: null });
    setAiSummaryLoading(true);
    setUpdateViews({});
  }, []);

  return {
    itemUpdates, itemUpdatesLoading, newUpdateText, setNewUpdateText, postingUpdate,
    updateInputRef, mentionOpen, setMentionOpen, mentionQuery, setMentionQuery, mentionOptions, mentionLoading,
    updateViews,
    aiSummary, aiSummaryMeta, aiSummaryLoading, aiSummaryRefreshing,
    handlePostUpdate, getMentionStateFromText, insertMention, handleRefreshAiSummary,
    loadUpdates, loadAiSummary, reset
  };
}
