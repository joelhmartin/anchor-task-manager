import { useEffect, useState } from 'react';
import {
  Autocomplete, Avatar, AvatarGroup, Box, Button, Chip, CircularProgress, Divider, Drawer,
  IconButton, List, ListItemButton, ListItemText, Menu, MenuItem, Paper,
  Popper, Select, Skeleton, Stack, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { IconClock, IconEye, IconPencil, IconPlus, IconRepeat, IconTrash, IconX } from '@tabler/icons-react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getStatusColor } from 'constants/taskDefaults';
import {
  fetchItemDependencies, addItemDependency, removeItemDependency,
  fetchItemRecurrence, setItemRecurrence, removeItemRecurrence,
  fetchItemLinks, createItemLink, deleteItemLink, searchItems
} from 'api/tasks';
import { clampNonNegInt, normalizeHm } from '../hooks/useItemTimeTracking';
import LabelPicker, { LabelChips } from './LabelPicker';
import { clientLabel } from 'hooks/useClientLabel';

export default function ItemDrawer({
  open, onClose, activeItem,
  drawerTab, onChangeTab,
  // Updates
  updatesProps,
  // Files
  filesProps,
  // Time
  timeProps,
  // Assignees
  assigneesProps,
  // AI summary
  aiProps,
  // Board context
  statusLabels, isAdmin,
  onUpdateItemField, onOpenStatusLabelsDialog,
  // Labels
  itemLabels = [],
  workspaceLabels = [],
  onToggleItemLabel,
  // Dependencies + recurrence context
  boardItems = [],
  workspaceMembers = []
}) {
  const toast = useToast();
  const [labelAnchor, setLabelAnchor] = useState(null);

  // ── Dependencies state ──
  const [predecessors, setPredecessors] = useState([]);
  const [successors, setSuccessors] = useState([]);
  const [depsLoading, setDepsLoading] = useState(false);
  const [depSearchValue, setDepSearchValue] = useState(null);

  // ── Links state ──
  const [links, setLinks] = useState([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkType, setLinkType] = useState('related');
  const [showLinkForm, setShowLinkForm] = useState(false);

  // ── Recurrence state ──
  const [recurrence, setRecurrence] = useState(null);
  const [recurrenceLoading, setRecurrenceLoading] = useState(false);
  const [recurrenceMenuAnchor, setRecurrenceMenuAnchor] = useState(null);

  // ── Destructive-action confirmation ──
  // Each entry: { title, message, secondaryText?, confirmLabel, loadingLabel, action }
  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    if (!pendingConfirm || confirming) return;
    setConfirming(true);
    try {
      await pendingConfirm.action();
    } finally {
      setConfirming(false);
      setPendingConfirm(null);
    }
  };

  const closeConfirm = () => {
    if (confirming) return;
    setPendingConfirm(null);
  };

  const RECURRENCE_OPTIONS = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Biweekly' },
    { value: 'monthly', label: 'Monthly' }
  ];

  // Load deps + recurrence when drawer opens
  useEffect(() => {
    if (!open || !activeItem?.id) {
      setPredecessors([]);
      setSuccessors([]);
      setRecurrence(null);
      setLinks([]);
      setShowLinkForm(false);
      return;
    }
    let cancelled = false;
    const loadData = async () => {
      setDepsLoading(true);
      setRecurrenceLoading(true);
      setLinksLoading(true);
      try {
        const [depsResult, recResult, linksResult] = await Promise.all([
          fetchItemDependencies(activeItem.id),
          fetchItemRecurrence(activeItem.id).catch(() => null),
          fetchItemLinks(activeItem.id).catch(() => [])
        ]);
        if (cancelled) return;
        setPredecessors(depsResult?.predecessors || []);
        setSuccessors(depsResult?.successors || []);
        setRecurrence(recResult || null);
        setLinks(linksResult || []);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load item details');
      } finally {
        if (!cancelled) {
          setDepsLoading(false);
          setRecurrenceLoading(false);
          setLinksLoading(false);
        }
      }
    };
    loadData();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeItem?.id]);

  // Filter items available as dependency targets (same board, not self, not already linked)
  const depOptions = boardItems.filter((it) => {
    if (it.id === activeItem?.id) return false;
    if (predecessors.some((p) => p.predecessor_id === it.id)) return false;
    if (successors.some((s) => s.item_id === it.id)) return false;
    return true;
  });

  const handleAddDependency = async (predecessorItem) => {
    if (!activeItem?.id || !predecessorItem?.id) return;
    try {
      const result = await addItemDependency(activeItem.id, predecessorItem.id);
      setPredecessors((prev) => [
        ...prev,
        { ...result.dependency, predecessor_name: predecessorItem.name }
      ]);
      setDepSearchValue(null);
      toast.success(`Dependency added`);
    } catch (err) {
      toast.error(err.message || 'Failed to add dependency');
    }
  };

  const handleRemoveDependency = async (depId, type) => {
    try {
      await removeItemDependency(activeItem.id, depId);
      if (type === 'predecessor') {
        setPredecessors((prev) => prev.filter((p) => p.id !== depId));
      } else {
        setSuccessors((prev) => prev.filter((s) => s.id !== depId));
      }
      toast.success('Dependency removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove dependency');
    }
  };

  // ── Link handlers ──
  const handleLinkSearch = async (query) => {
    setLinkSearchQuery(query);
    if (!query || query.length < 2) { setLinkSearchResults([]); return; }
    setLinkSearching(true);
    try {
      const results = await searchItems(query, activeItem?.id);
      setLinkSearchResults(results);
    } catch { setLinkSearchResults([]); }
    finally { setLinkSearching(false); }
  };

  const handleAddLink = async (targetItem) => {
    if (!activeItem?.id || !targetItem?.id) return;
    try {
      await createItemLink(activeItem.id, targetItem.id, linkType);
      const refreshed = await fetchItemLinks(activeItem.id);
      setLinks(refreshed || []);
      setShowLinkForm(false);
      setLinkSearchQuery('');
      setLinkSearchResults([]);
      toast.success('Link added');
    } catch (err) {
      toast.error(err.message || 'Failed to add link');
    }
  };

  const handleRemoveLink = async (linkId) => {
    try {
      await deleteItemLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      toast.success('Link removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove link');
    }
  };

  const LINK_TYPE_LABELS = { related: 'Related to', blocks: 'Blocks', blocked_by: 'Blocked by', duplicate: 'Duplicate of' };

  const handleSetRecurrence = async (pattern) => {
    setRecurrenceMenuAnchor(null);
    try {
      const result = await setItemRecurrence(activeItem.id, { pattern });
      setRecurrence(result);
      toast.success(`Recurrence set to ${pattern}`);
    } catch (err) {
      toast.error(err.message || 'Failed to set recurrence');
    }
  };

  const handleRemoveRecurrence = async () => {
    try {
      await removeItemRecurrence(activeItem.id);
      setRecurrence(null);
      toast.success('Recurrence removed');
    } catch (err) {
      toast.error(err.message || 'Failed to remove recurrence');
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: '40vw' } } }}>
      <Box sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="h3">{activeItem?.name || 'Item'}</Typography>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              Status
            </Typography>
            <Select
              size="small"
              value={activeItem?.status || 'To Do'}
              onChange={(e) => onUpdateItemField({ status: e.target.value })}
              sx={{
                width: '100%',
                '& .MuiSelect-select': { py: 0.5 },
                ...(activeItem?.status
                  ? {
                      bgcolor: getStatusColor(activeItem.status, statusLabels).bg,
                      color: getStatusColor(activeItem.status, statusLabels).fg,
                      '& .MuiSelect-select': { color: getStatusColor(activeItem.status, statusLabels).fg, py: 0.5 },
                      '& .MuiSvgIcon-root': { color: getStatusColor(activeItem.status, statusLabels).fg },
                      borderRadius: 999,
                      '.MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' }
                    }
                  : {})
              }}
            >
              {statusLabels.map((sl) => (
                <MenuItem key={sl.id} value={sl.label}>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-block',
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: sl.color,
                      mr: 1
                    }}
                  />
                  {sl.label}
                </MenuItem>
              ))}
            </Select>
            {isAdmin && (
              <Button
                size="small"
                startIcon={<IconPencil size={14} />}
                onClick={onOpenStatusLabelsDialog}
                sx={{ mt: 0.5, alignSelf: 'flex-start' }}
              >
                Edit Labels
              </Button>
            )}
          </Stack>

          {/* Dates: Start Date + Due Date */}
          <Stack direction="row" spacing={2}>
            <Stack spacing={0.5} sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">Start Date</Typography>
              <TextField
                size="small"
                type="date"
                value={activeItem?.start_date ? activeItem.start_date.slice(0, 10) : ''}
                onChange={(e) => onUpdateItemField({ start_date: e.target.value || null })}
                InputLabelProps={{ shrink: true }}
                sx={{ width: '100%' }}
              />
            </Stack>
            <Stack spacing={0.5} sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary">Due Date</Typography>
              <TextField
                size="small"
                type="date"
                value={activeItem?.due_date ? activeItem.due_date.slice(0, 10) : ''}
                onChange={(e) => onUpdateItemField({ due_date: e.target.value || null })}
                InputLabelProps={{ shrink: true }}
                sx={{ width: '100%' }}
              />
            </Stack>
          </Stack>

          {/* Item Labels */}
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              Labels
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <LabelChips
                labels={itemLabels}
                maxVisible={10}
                onDelete={(labelId) => onToggleItemLabel?.(activeItem?.id, labelId, true)}
              />
              <IconButton
                size="small"
                onClick={(e) => setLabelAnchor(e.currentTarget)}
                title="Add label"
                aria-label="Add label"
                sx={{ width: 28, height: 28 }}
              >
                <IconPlus size={16} />
              </IconButton>
            </Stack>
            <LabelPicker
              anchorEl={labelAnchor}
              open={Boolean(labelAnchor)}
              onClose={() => setLabelAnchor(null)}
              workspaceLabels={workspaceLabels}
              appliedLabelIds={itemLabels.map((l) => l.id)}
              onToggle={(labelId, isApplied) => onToggleItemLabel?.(activeItem?.id, labelId, isApplied)}
            />
          </Stack>

          {/* Dependencies */}
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">Dependencies</Typography>
            {depsLoading ? (
              <Stack direction="row" spacing={0.5} role="status" aria-live="polite" aria-busy="true" aria-label="Loading dependencies">
                <Skeleton variant="rounded" width={120} height={24} />
                <Skeleton variant="rounded" width={90} height={24} />
              </Stack>
            ) : (
              <Stack spacing={0.75}>
                {predecessors.length > 0 && (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Blocked by:</Typography>
                    {predecessors.map((dep) => {
                      const name = dep.predecessor_name || dep.predecessor_id;
                      return (
                        <Chip
                          key={dep.id}
                          label={name}
                          size="small"
                          onDelete={() =>
                            setPendingConfirm({
                              title: 'Remove dependency?',
                              message: <>Remove the &ldquo;blocked by&rdquo; link to <strong>{name}</strong>?</>,
                              secondaryText: 'Both items remain; only the dependency is removed.',
                              confirmLabel: 'Remove',
                              loadingLabel: 'Removing…',
                              action: () => handleRemoveDependency(dep.id, 'predecessor')
                            })
                          }
                          deleteIcon={<IconX size={14} />}
                          sx={{ height: 24, fontSize: '0.75rem' }}
                        />
                      );
                    })}
                  </Stack>
                )}
                {successors.length > 0 && (
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Blocks:</Typography>
                    {successors.map((dep) => {
                      const name = dep.item_name || dep.item_id;
                      return (
                        <Chip
                          key={dep.id}
                          label={name}
                          size="small"
                          onDelete={() =>
                            setPendingConfirm({
                              title: 'Remove dependency?',
                              message: <>Remove the &ldquo;blocks&rdquo; link to <strong>{name}</strong>?</>,
                              secondaryText: 'Both items remain; only the dependency is removed.',
                              confirmLabel: 'Remove',
                              loadingLabel: 'Removing…',
                              action: () => handleRemoveDependency(dep.id, 'successor')
                            })
                          }
                          deleteIcon={<IconX size={14} />}
                          sx={{ height: 24, fontSize: '0.75rem' }}
                        />
                      );
                    })}
                  </Stack>
                )}
                <Autocomplete
                  size="small"
                  value={depSearchValue}
                  onChange={(_e, newVal) => {
                    if (newVal) handleAddDependency(newVal);
                  }}
                  options={depOptions}
                  getOptionLabel={(opt) => opt.name || ''}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Add dependency (blocked by)..." size="small" />
                  )}
                  sx={{ maxWidth: 320 }}
                  noOptionsText="No items available"
                />
              </Stack>
            )}
          </Stack>

          {/* Links */}
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
              <Typography variant="caption" color="text.secondary">Links</Typography>
              <Button
                size="small"
                startIcon={<IconPlus size={12} />}
                onClick={() => setShowLinkForm(!showLinkForm)}
                sx={{ fontSize: '0.7rem', textTransform: 'none', minWidth: 0, py: 0 }}
              >
                Add
              </Button>
            </Stack>
            {linksLoading ? (
              <Stack spacing={0.5} role="status" aria-live="polite" aria-busy="true" aria-label="Loading links">
                <Skeleton variant="rounded" width="80%" height={22} />
                <Skeleton variant="rounded" width="65%" height={22} />
              </Stack>
            ) : (
              <Stack spacing={0.5}>
                {links.length === 0 && !showLinkForm && (
                  <Typography variant="caption" color="text.disabled">No links</Typography>
                )}
                {links.map((link) => {
                  const linkedName = link.linked_item?.name || 'Unknown';
                  const linkedBoard = link.linked_item?.board_name || '';
                  const linkTypeLabel = LINK_TYPE_LABELS[link.link_type] || link.link_type;
                  return (
                    <Stack key={link.id} direction="row" spacing={0.5} alignItems="center">
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60, fontSize: '0.65rem' }}>
                        {linkTypeLabel}:
                      </Typography>
                      <Chip
                        label={`${linkedName} (${linkedBoard})`}
                        size="small"
                        onDelete={() =>
                          setPendingConfirm({
                            title: 'Remove link?',
                            message: <>Remove the &ldquo;{linkTypeLabel}&rdquo; link to <strong>{linkedName}</strong>?</>,
                            secondaryText: 'Both items remain; only the relationship is removed.',
                            confirmLabel: 'Remove',
                            loadingLabel: 'Removing…',
                            action: () => handleRemoveLink(link.id)
                          })
                        }
                        deleteIcon={<IconX size={14} />}
                        sx={{ height: 22, fontSize: '0.7rem', maxWidth: 200 }}
                      />
                    </Stack>
                  );
                })}
                {showLinkForm && (
                  <Stack spacing={0.75} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Select
                      size="small"
                      value={linkType}
                      onChange={(e) => setLinkType(e.target.value)}
                      sx={{ fontSize: '0.75rem', height: 32 }}
                    >
                      <MenuItem value="related">Related to</MenuItem>
                      <MenuItem value="blocks">Blocks</MenuItem>
                      <MenuItem value="blocked_by">Blocked by</MenuItem>
                      <MenuItem value="duplicate">Duplicate of</MenuItem>
                    </Select>
                    <Autocomplete
                      size="small"
                      options={linkSearchResults}
                      getOptionLabel={(opt) => `${opt.name} (${opt.board_name})`}
                      loading={linkSearching}
                      onInputChange={(_e, val) => handleLinkSearch(val)}
                      onChange={(_e, val) => { if (val) handleAddLink(val); }}
                      renderInput={(params) => (
                        <TextField {...params} placeholder="Search items..." size="small" />
                      )}
                      noOptionsText={linkSearchQuery.length < 2 ? 'Type to search...' : 'No items found'}
                      filterOptions={(x) => x}
                    />
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>

          {/* Recurrence */}
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              <Stack direction="row" spacing={0.5} alignItems="center" component="span">
                <IconRepeat size={14} />
                <span>Repeat</span>
              </Stack>
            </Typography>
            {recurrenceLoading ? (
              <Skeleton
                variant="rounded"
                width={120}
                height={26}
                role="status"
                aria-live="polite"
                aria-busy="true"
                aria-label="Loading recurrence"
              />
            ) : recurrence ? (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip
                  icon={<IconRepeat size={14} />}
                  label={recurrence.pattern ? recurrence.pattern.charAt(0).toUpperCase() + recurrence.pattern.slice(1) : 'Recurring'}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ height: 26 }}
                />
                <Button size="small" onClick={(e) => setRecurrenceMenuAnchor(e.currentTarget)}>Change</Button>
                <IconButton
                  size="small"
                  onClick={() =>
                    setPendingConfirm({
                      title: 'Remove recurrence?',
                      message: 'Stop automatically creating future copies of this item?',
                      secondaryText: 'Existing items that were already generated by this schedule will not be deleted.',
                      confirmLabel: 'Remove',
                      loadingLabel: 'Removing…',
                      action: () => handleRemoveRecurrence()
                    })
                  }
                  title="Remove recurrence"
                  aria-label="Remove recurrence"
                >
                  <IconTrash size={14} />
                </IconButton>
              </Stack>
            ) : (
              <Button
                size="small"
                variant="outlined"
                startIcon={<IconRepeat size={14} />}
                onClick={(e) => setRecurrenceMenuAnchor(e.currentTarget)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Set recurring
              </Button>
            )}
            <Menu
              anchorEl={recurrenceMenuAnchor}
              open={Boolean(recurrenceMenuAnchor)}
              onClose={() => setRecurrenceMenuAnchor(null)}
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.value}
                  selected={recurrence?.pattern === opt.value}
                  onClick={() => handleSetRecurrence(opt.value)}
                >
                  {opt.label}
                </MenuItem>
              ))}
            </Menu>
          </Stack>

          <Divider />

          <Tabs value={drawerTab} onChange={(_e, v) => onChangeTab(v)}>
            <Tab value="updates" label="Updates" />
            <Tab value="files" label="Files" />
            <Tab value="time" label="Time Tracking" />
          </Tabs>

          {drawerTab === 'updates' && <UpdatesTab {...updatesProps} aiProps={aiProps} activeItem={activeItem} />}
          {drawerTab === 'files' && <FilesTab {...filesProps} activeItem={activeItem} />}
          {drawerTab === 'time' && <TimeTab {...timeProps} activeItem={activeItem} />}
        </Stack>
      </Box>

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        onClose={closeConfirm}
        onConfirm={handleConfirm}
        title={pendingConfirm?.title || ''}
        message={pendingConfirm?.message}
        secondaryText={pendingConfirm?.secondaryText}
        confirmLabel={pendingConfirm?.confirmLabel || 'Remove'}
        confirmColor="error"
        loading={confirming}
        loadingLabel={pendingConfirm?.loadingLabel || 'Removing…'}
      />
    </Drawer>
  );
}

/* ─── Updates Tab ─── */
function UpdatesTab({
  itemUpdates, itemUpdatesLoading, newUpdateText, onChangeUpdateText,
  postingUpdate, updateInputRef, mentionOpen, mentionOptions, mentionLoading,
  onPostUpdate, getMentionStateFromText, onSetMentionOpen, onSetMentionQuery,
  insertMention, updateViews,
  aiProps, activeItem
}) {
  return (
    <Stack spacing={1}>
      <Stack spacing={1}>
        <TextField
          multiline
          minRows={3}
          label="Post an update"
          helperText="Tip: mention a teammate with @email (e.g. @alex@anchorcorps.com) to notify them."
          value={newUpdateText}
          inputRef={updateInputRef}
          onChange={(e) => {
            const next = e.target.value;
            onChangeUpdateText(next);
            const caret = e.target.selectionStart ?? next.length;
            const state = getMentionStateFromText(next, caret);
            if (state.active) {
              onSetMentionOpen(true);
              onSetMentionQuery(state.query || '');
            } else {
              onSetMentionOpen(false);
              onSetMentionQuery('');
            }
          }}
          onBlur={() => {
            setTimeout(() => onSetMentionOpen(false), 150);
          }}
        />
        <Popper
          open={mentionOpen}
          anchorEl={updateInputRef.current}
          placement="bottom-start"
          sx={{ zIndex: 1500, width: updateInputRef.current?.clientWidth || 360 }}
        >
          <Paper sx={{ mt: 0.5, maxHeight: 220, overflow: 'auto' }}>
            {mentionLoading ? (
              <Box sx={{ p: 1.25 }}>
                <CircularProgress size={18} />
              </Box>
            ) : (
              <List dense disablePadding>
                {mentionOptions.length === 0 && (
                  <ListItemText
                    primary={
                      <Typography variant="body2" color="text.secondary">
                        No matches
                      </Typography>
                    }
                    sx={{ px: 1.5, py: 1 }}
                  />
                )}
                {mentionOptions.slice(0, 10).map((m) => {
                  const name = clientLabel(m);
                  const primary = m.email || m.user_id;
                  const secondary = name ? `${name}${m.user_role ? ` • ${m.user_role}` : ''}` : m.user_role || '';
                  return (
                    <ListItemButton
                      key={m.user_id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertMention(primary)}
                    >
                      <ListItemText primary={primary} secondary={secondary} />
                    </ListItemButton>
                  );
                })}
              </List>
            )}
          </Paper>
        </Popper>
        <LoadingButton
          variant="contained"
          onClick={onPostUpdate}
          loading={postingUpdate}
          loadingLabel="Posting…"
          disabled={!newUpdateText.trim() || !activeItem?.id}
        >
          Post update
        </LoadingButton>
      </Stack>

      <Typography variant="subtitle2">Feed</Typography>
      {itemUpdatesLoading ? (
        <Stack spacing={1} role="status" aria-live="polite" aria-busy="true" aria-label="Loading updates">
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Skeleton variant="text" width="40%" height={14} />
              <Skeleton variant="text" width="90%" />
              <Skeleton variant="text" width="70%" />
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={1}>
          {itemUpdates.length === 0 && (
            <EmptyState title="No updates yet." sx={{ py: 2 }} />
          )}
          {itemUpdates.map((u) => {
            const viewers = updateViews[u.id] || [];
            return (
              <Box key={u.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Stack>
                    <Typography variant="caption" color="text.secondary">
                      {u.author_name || 'Unknown'}
                      {u.created_at && (
                        <span style={{ marginLeft: 8, opacity: 0.7 }}>
                          {new Date(u.created_at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </span>
                      )}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {u.content}
                    </Typography>
                  </Stack>
                  {viewers.length > 0 && (
                    <Tooltip
                      title={
                        <Stack spacing={0.5} sx={{ p: 0.5 }}>
                          <Typography variant="caption" fontWeight={600}>
                            Seen by {viewers.length}
                          </Typography>
                          {viewers.map((v) => (
                            <Stack key={v.user_id} direction="row" spacing={1} alignItems="center">
                              <Avatar src={v.avatar_url} sx={{ width: 20, height: 20, fontSize: 10 }}>
                                {(v.user_name || '?')[0]}
                              </Avatar>
                              <Typography variant="caption">{v.user_name}</Typography>
                            </Stack>
                          ))}
                        </Stack>
                      }
                      placement="left"
                      arrow
                    >
                      <IconButton size="small" sx={{ p: 0.25 }} aria-label={`${viewers.length} ${viewers.length === 1 ? 'viewer' : 'viewers'}`}>
                        <IconEye size={14} />
                        <Typography variant="caption" sx={{ ml: 0.5, fontSize: '0.7rem' }}>
                          {viewers.length}
                        </Typography>
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

/* ─── Files Tab ─── */
function FilesTab({ itemFiles, itemFilesLoading, uploadingFile, onUploadFile, activeItem }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Files</Typography>
      {itemFilesLoading ? (
        <Stack spacing={1} role="status" aria-live="polite" aria-busy="true" aria-label="Loading files">
          {[0, 1].map((i) => (
            <Box key={i} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="35%" height={12} />
              <Skeleton variant="rounded" width={64} height={28} sx={{ mt: 0.5 }} />
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={1}>
          {!itemFiles.length && (
            <EmptyState title="No files yet." sx={{ py: 2 }} />
          )}
          {itemFiles.map((f) => (
            <Box key={f.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="body2">{f.file_name || 'File'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {f.uploaded_by_name || 'Unknown'}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Button size="small" variant="outlined" component="a" href={f.file_url} target="_blank" rel="noreferrer">
                  Open
                </Button>
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      <Button variant="outlined" component="label" disabled={!activeItem?.id || uploadingFile}>
        {uploadingFile ? 'Uploading…' : 'Upload file'}
        <input
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUploadFile(file);
          }}
        />
      </Button>
    </Stack>
  );
}

/* ─── Time Tab ─── */
function TimeTab({
  timeEntries, timeEntriesLoading, loggingTime,
  timeBillable, setTimeBillable, timeCategory, setTimeCategory,
  timeDescription, setTimeDescription,
  timeHours, setTimeHours, timeMins, setTimeMins,
  billableHours, setBillableHours, billableMins, setBillableMins,
  billableTouched, setBillableTouched,
  onLogTime, activeItem
}) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Time entries</Typography>
      {timeEntriesLoading ? (
        <Stack spacing={1} role="status" aria-live="polite" aria-busy="true" aria-label="Loading time entries">
          {[0, 1].map((i) => (
            <Box key={i} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Skeleton variant="text" width="55%" />
              <Skeleton variant="text" width="35%" height={12} />
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={1}>
          {!timeEntries.length && (
            <EmptyState
              icon={IconClock}
              title="No time entries yet."
              message="Log time below to start tracking work on this item."
              sx={{ py: 2 }}
            />
          )}
          {timeEntries.map((t) => (
            <Box key={t.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="body2">
                {t.time_spent_minutes}m{t.is_billable ? ` (billable ${t.billable_minutes}m)` : ' (non-billable)'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t.user_name || 'Unknown'}
                {t.work_category ? ` • ${t.work_category}` : ''}
              </Typography>
              {t.description ? (
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {t.description}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Stack>
      )}

      <Stack spacing={1}>
        <Select size="small" value={timeCategory} onChange={(e) => setTimeCategory(e.target.value)}>
          <MenuItem value="Graphics">Graphics</MenuItem>
          <MenuItem value="Web">Web</MenuItem>
          <MenuItem value="Project Management">Project Management</MenuItem>
          <MenuItem value="Other">Other</MenuItem>
        </Select>
        <Select
          size="small"
          value={timeBillable ? 'billable' : 'non_billable'}
          onChange={(e) => setTimeBillable(e.target.value === 'billable')}
        >
          <MenuItem value="billable">Billable</MenuItem>
          <MenuItem value="non_billable">Non-billable</MenuItem>
        </Select>

        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            Duration
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Hours"
              type="number"
              value={timeHours}
              onChange={(e) => {
                const next = normalizeHm({ hours: e.target.value, minutes: timeMins });
                setTimeHours(next.hours);
                setTimeMins(next.minutes);
              }}
              inputProps={{ min: 0 }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Minutes"
              type="number"
              value={timeMins}
              onChange={(e) => {
                const next = normalizeHm({ hours: timeHours, minutes: e.target.value });
                setTimeHours(next.hours);
                setTimeMins(next.minutes);
              }}
              inputProps={{ min: 0, step: 15 }}
              sx={{ flex: 1 }}
            />
          </Stack>
        </Stack>

        {timeBillable && (
          <Stack spacing={0.75}>
            <Typography variant="caption" color="text.secondary">
              Billable hours
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Hours"
                type="number"
                value={billableHours}
                onChange={(e) => {
                  setBillableTouched(true);
                  setBillableHours(clampNonNegInt(e.target.value));
                }}
                inputProps={{ min: 0 }}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Minutes"
                type="number"
                value={billableMins}
                onChange={(e) => {
                  setBillableTouched(true);
                  const next = normalizeHm({ hours: billableHours, minutes: e.target.value });
                  setBillableHours(next.hours);
                  setBillableMins(next.minutes);
                }}
                inputProps={{ min: 0, step: 15 }}
                sx={{ flex: 1 }}
              />
            </Stack>
          </Stack>
        )}

        <TextField
          multiline
          minRows={2}
          label="Description (optional)"
          value={timeDescription}
          onChange={(e) => setTimeDescription(e.target.value)}
        />
        <LoadingButton
          variant="contained"
          onClick={onLogTime}
          loading={loggingTime}
          loadingLabel="Logging…"
          disabled={!activeItem?.id || Number(timeHours) * 60 + Number(timeMins) <= 0}
        >
          Log time
        </LoadingButton>
      </Stack>
    </Stack>
  );
}
