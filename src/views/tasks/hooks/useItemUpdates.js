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
  // Reply drafts keyed by parent update id; null = no active reply form.
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [postingReply, setPostingReply] = useState(false);
  const replyInputRef = useRef(null);
  // Mention state shared across the main and reply inputs; `target` records
  // which input owns the open dropdown so insertMention writes to the right field.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOptions, setMentionOptions] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionTarget, setMentionTarget] = useState('update'); // 'update' | 'reply'
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

  const refreshAfterPost = useCallback(async (activeItemId) => {
    const data = await fetchTaskItemUpdates(activeItemId);
    const updates = data.updates || [];
    setItemUpdates(updates);
    setAiSummaryMeta((prev) => ({ ...prev, is_stale: true }));
    if (updates.length) {
      const updateIds = updates.map((u) => u.id);
      markUpdatesViewed(updateIds).catch(() => {});
      fetchUpdateViews(updateIds)
        .then((views) => setUpdateViews(views))
        .catch(() => {});
    }
  }, []);

  const handlePostUpdate = useCallback(async (activeItemId) => {
    if (!activeItemId || !newUpdateText.trim()) return;
    setPostingUpdate(true);
    setError('');
    try {
      await createTaskItemUpdate(activeItemId, { content: newUpdateText.trim() });
      await refreshAfterPost(activeItemId);
      setNewUpdateText('');
      toast.success('Update posted');
    } catch (err) {
      setError(err.message || 'Unable to post update');
    } finally {
      setPostingUpdate(false);
    }
  }, [newUpdateText, setError, toast, refreshAfterPost]);

  const handlePostReply = useCallback(async (activeItemId) => {
    if (!activeItemId || !replyTo || !replyText.trim()) return;
    setPostingReply(true);
    setError('');
    try {
      await createTaskItemUpdate(activeItemId, {
        content: replyText.trim(),
        parent_update_id: replyTo
      });
      await refreshAfterPost(activeItemId);
      setReplyText('');
      setReplyTo(null);
      toast.success('Reply posted');
    } catch (err) {
      setError(err.message || 'Unable to post reply');
    } finally {
      setPostingReply(false);
    }
  }, [replyTo, replyText, setError, toast, refreshAfterPost]);

  function getMentionStateFromText(text, caretIndex) {
    const before = String(text || '').slice(0, caretIndex);
    const at = before.lastIndexOf('@');
    if (at < 0) return { active: false };
    const afterAt = before.slice(at + 1);
    // Don't reopen the picker when the caret sits inside an already-inserted
    // `@[Name](uuid)` token — those carry a `[` right after the `@`.
    if (afterAt.startsWith('[')) return { active: false };
    if (/\s/.test(afterAt)) return { active: false };
    return { active: true, query: afterAt, atIndex: at };
  }

  const mentionDisplayName = useCallback((member) => {
    if (!member) return '';
    const name = clientLabel(member);
    if (name && name.trim()) return name.trim();
    return member.email || 'teammate';
  }, []);

  const insertMention = useCallback((member) => {
    if (!member?.user_id) return;
    const isReply = mentionTarget === 'reply';
    const el = isReply ? replyInputRef.current : updateInputRef.current;
    const text = isReply ? (replyText || '') : (newUpdateText || '');
    const caret = el?.selectionStart ?? text.length;
    const state = getMentionStateFromText(text, caret);
    if (!state.active) return;
    const display = mentionDisplayName(member);
    const token = `@[${display}](${member.user_id}) `;
    const before = text.slice(0, state.atIndex);
    const after = text.slice(caret);
    const next = `${before}${token}${after}`;
    if (isReply) setReplyText(next);
    else setNewUpdateText(next);
    setMentionOpen(false);
    setMentionQuery('');
    requestAnimationFrame(() => {
      const target = isReply ? replyInputRef.current : updateInputRef.current;
      if (!target) return;
      const pos = (before + token).length;
      target.focus();
      target.setSelectionRange(pos, pos);
    });
  }, [mentionTarget, newUpdateText, replyText, mentionDisplayName]);

  const openMentionPicker = useCallback((target, query) => {
    setMentionTarget(target);
    setMentionQuery(query || '');
    setMentionOpen(true);
  }, []);

  const beginReply = useCallback((parentUpdateId) => {
    setReplyTo(parentUpdateId);
    setReplyText('');
  }, []);

  const cancelReply = useCallback(() => {
    setReplyTo(null);
    setReplyText('');
    if (mentionTarget === 'reply') {
      setMentionOpen(false);
      setMentionQuery('');
    }
  }, [mentionTarget]);

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
    setReplyTo(null);
    setReplyText('');
  }, []);

  return {
    itemUpdates, itemUpdatesLoading, newUpdateText, setNewUpdateText, postingUpdate,
    updateInputRef, mentionOpen, setMentionOpen, mentionQuery, setMentionQuery, mentionOptions, mentionLoading,
    mentionTarget, openMentionPicker,
    replyTo, replyText, setReplyText, replyInputRef, postingReply,
    beginReply, cancelReply, handlePostReply,
    updateViews,
    aiSummary, aiSummaryMeta, aiSummaryLoading, aiSummaryRefreshing,
    handlePostUpdate, getMentionStateFromText, insertMention, handleRefreshAiSummary,
    loadUpdates, loadAiSummary, reset
  };
}
