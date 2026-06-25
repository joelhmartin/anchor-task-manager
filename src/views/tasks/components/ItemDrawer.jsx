import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Autocomplete, Avatar, AvatarGroup, Box, Button, Chip, CircularProgress, Dialog, DialogContent,
  DialogTitle, Divider, Drawer, IconButton, List, ListItemButton, ListItemText, Menu, MenuItem,
  Paper, Popper, Select, Skeleton, Stack, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  IconClock, IconEye, IconFile, IconFileTypePdf, IconPencil, IconPhoto, IconPlus, IconRepeat,
  IconTrash, IconX
} from '@tabler/icons-react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getStatusColor } from 'constants/taskDefaults';
import {
  fetchItemDependencies, addItemDependency, removeItemDependency,
  fetchItemRecurrence, setItemRecurrence, removeItemRecurrence,
  fetchItemLinks, createItemLink, deleteItemLink, searchItems,
  fetchTaskFileContent
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
          {drawerTab === 'files' && (
            <FilesTab
              {...filesProps}
              activeItem={activeItem}
              setPendingConfirm={setPendingConfirm}
            />
          )}
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
// Matches the picker token `@[Display Name](uuid)` produced by the mention
// picker. The split capture lets us walk text + tokens in order.
const MENTION_TOKEN_PATTERN = /@\[([^\]]+)\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

function renderUpdateContent(content, membersById) {
  const text = String(content || '');
  const segments = [];
  let lastIndex = 0;
  let match;
  let segmentKey = 0;
  MENTION_TOKEN_PATTERN.lastIndex = 0;
  while ((match = MENTION_TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, match.index), key: `t${segmentKey++}` });
    }
    const userId = match[2].toLowerCase();
    const member = membersById?.[userId];
    const displayName = member ? clientLabel(member) || member.email || match[1] : match[1];
    segments.push({
      kind: 'mention',
      key: `m${segmentKey++}`,
      displayName,
      email: member?.email || null,
      resolved: Boolean(member)
    });
    lastIndex = MENTION_TOKEN_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex), key: `t${segmentKey++}` });
  }
  return segments;
}

function MentionSpan({ displayName, email, resolved }) {
  const span = (
    <Box
      component="span"
      sx={{
        color: 'primary.main',
        bgcolor: (theme) => alpha(theme.palette.primary.main, resolved ? 0.12 : 0.04),
        borderRadius: 0.75,
        px: 0.5,
        fontWeight: 500
      }}
    >
      @{displayName}
    </Box>
  );
  if (!email) return span;
  return (
    <Tooltip title={email} arrow>
      {span}
    </Tooltip>
  );
}

function UpdateBody({ content, membersById }) {
  const segments = renderUpdateContent(content, membersById);
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
      {segments.map((seg) =>
        seg.kind === 'text' ? (
          <span key={seg.key}>{seg.value}</span>
        ) : (
          <MentionSpan key={seg.key} displayName={seg.displayName} email={seg.email} resolved={seg.resolved} />
        )
      )}
    </Typography>
  );
}

function MentionPopperContent({ mentionLoading, mentionOptions, onPick }) {
  return (
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
            const primary = name || m.email || 'Teammate';
            const secondaryParts = [];
            if (name && m.email) secondaryParts.push(m.email);
            if (m.user_role) secondaryParts.push(m.user_role);
            return (
              <ListItemButton
                key={m.user_id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(m)}
              >
                <ListItemText primary={primary} secondary={secondaryParts.join(' • ') || undefined} />
              </ListItemButton>
            );
          })}
        </List>
      )}
    </Paper>
  );
}

function UpdatesTab({
  itemUpdates, itemUpdatesLoading, newUpdateText, onChangeUpdateText,
  postingUpdate, updateInputRef, mentionOpen, mentionOptions, mentionLoading,
  mentionTarget, openMentionPicker,
  onPostUpdate, getMentionStateFromText, onSetMentionOpen, onSetMentionQuery,
  insertMention, updateViews,
  replyTo, replyText, onChangeReplyText, replyInputRef, postingReply,
  onBeginReply, onCancelReply, onPostReply, workspaceMembers,
  activeItem
}) {
  const membersById = useMemo(() => {
    const map = {};
    (workspaceMembers || []).forEach((m) => {
      if (m?.user_id) map[String(m.user_id).toLowerCase()] = m;
    });
    return map;
  }, [workspaceMembers]);

  // Group flat updates into top-level + replies threads.
  const threads = useMemo(() => {
    const tops = [];
    const repliesByParent = new Map();
    (itemUpdates || []).forEach((u) => {
      if (u.parent_update_id) {
        const list = repliesByParent.get(u.parent_update_id) || [];
        list.push(u);
        repliesByParent.set(u.parent_update_id, list);
      } else {
        tops.push(u);
      }
    });
    return tops.map((parent) => ({
      parent,
      replies: (repliesByParent.get(parent.id) || []).slice().sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    }));
  }, [itemUpdates]);

  const handleMainTextChange = (e) => {
    const next = e.target.value;
    onChangeUpdateText(next);
    const caret = e.target.selectionStart ?? next.length;
    const state = getMentionStateFromText(next, caret);
    if (state.active) {
      openMentionPicker('update', state.query || '');
    } else if (mentionTarget === 'update') {
      onSetMentionOpen(false);
      onSetMentionQuery('');
    }
  };

  const handleReplyTextChange = (e) => {
    const next = e.target.value;
    onChangeReplyText(next);
    const caret = e.target.selectionStart ?? next.length;
    const state = getMentionStateFromText(next, caret);
    if (state.active) {
      openMentionPicker('reply', state.query || '');
    } else if (mentionTarget === 'reply') {
      onSetMentionOpen(false);
      onSetMentionQuery('');
    }
  };

  const mentionAnchor = mentionTarget === 'reply' ? replyInputRef.current : updateInputRef.current;

  return (
    <Stack spacing={1}>
      <Stack spacing={1}>
        <TextField
          multiline
          minRows={3}
          label="Post an update"
          helperText="Tip: type @ to mention a teammate from the workspace member picker."
          value={newUpdateText}
          inputRef={updateInputRef}
          onChange={handleMainTextChange}
          onBlur={() => {
            if (mentionTarget !== 'update') return;
            setTimeout(() => onSetMentionOpen(false), 150);
          }}
        />
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

      <Popper
        open={mentionOpen && Boolean(mentionAnchor)}
        anchorEl={mentionAnchor}
        placement="bottom-start"
        sx={{ zIndex: 1500, width: mentionAnchor?.clientWidth || 360 }}
      >
        <MentionPopperContent
          mentionLoading={mentionLoading}
          mentionOptions={mentionOptions}
          onPick={insertMention}
        />
      </Popper>

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
          {threads.length === 0 && (
            <EmptyState title="No updates yet." sx={{ py: 2 }} />
          )}
          {threads.map(({ parent, replies }) => (
            <Box key={parent.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <UpdateRow
                update={parent}
                viewers={updateViews[parent.id] || []}
                membersById={membersById}
              />
              {replies.length > 0 && (
                <Stack spacing={1} sx={{ mt: 1, pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
                  {replies.map((reply) => (
                    <Box
                      key={reply.id}
                      sx={{ p: 0.75, bgcolor: (theme) => alpha(theme.palette.action.hover, 0.6), borderRadius: 1 }}
                    >
                      <UpdateRow
                        update={reply}
                        viewers={updateViews[reply.id] || []}
                        membersById={membersById}
                      />
                    </Box>
                  ))}
                </Stack>
              )}
              {replyTo === parent.id ? (
                <Stack spacing={0.75} sx={{ mt: 1, pl: 2 }}>
                  <TextField
                    multiline
                    minRows={2}
                    size="small"
                    label="Reply"
                    placeholder="Write a reply…"
                    value={replyText}
                    inputRef={replyInputRef}
                    onChange={handleReplyTextChange}
                    onBlur={() => {
                      if (mentionTarget !== 'reply') return;
                      setTimeout(() => onSetMentionOpen(false), 150);
                    }}
                    autoFocus
                  />
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" onClick={onCancelReply} disabled={postingReply}>
                      Cancel
                    </Button>
                    <LoadingButton
                      size="small"
                      variant="contained"
                      onClick={onPostReply}
                      loading={postingReply}
                      loadingLabel="Posting…"
                      disabled={!replyText.trim()}
                    >
                      Post reply
                    </LoadingButton>
                  </Stack>
                </Stack>
              ) : (
                <Box sx={{ mt: 0.5 }}>
                  <Button size="small" onClick={() => onBeginReply(parent.id)} sx={{ textTransform: 'none' }}>
                    Reply
                  </Button>
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function UpdateRow({ update, viewers, membersById }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
      <Stack sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {update.author_name || 'Unknown'}
          {update.created_at && (
            <span style={{ marginLeft: 8, opacity: 0.7 }}>
              {new Date(update.created_at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </span>
          )}
        </Typography>
        <UpdateBody content={update.content} membersById={membersById} />
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
  );
}

/* ─── Files Tab ─── */
const PREVIEWABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function isImageContentType(file) {
  return PREVIEWABLE_IMAGE_TYPES.has(file?.content_type);
}

function isPdfContentType(file) {
  return file?.content_type === 'application/pdf';
}

function canPreviewFile(file) {
  return isImageContentType(file) || isPdfContentType(file);
}

function isAuthenticatedFileUrl(file) {
  return typeof file?.file_url === 'string' && file.file_url.startsWith('/api/');
}

function fileTypeIcon(file) {
  if (isImageContentType(file)) return <IconPhoto size={18} />;
  if (isPdfContentType(file)) return <IconFileTypePdf size={18} />;
  return <IconFile size={18} />;
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FilesTab({
  itemFiles, itemFilesLoading, uploadingFile, onUploadFile, onDeleteFile,
  setPendingConfirm, activeItem
}) {
  const toast = useToast();
  const [previewFile, setPreviewFile] = useState(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  // Sequence guard: every openPreview/closePreview bumps the token; in-flight
  // fetches check their snapshot against the current token and revoke + bail if
  // the user has since closed or switched files. Without this, a slow fetch can
  // resolve after the dialog is closed and overwrite state with a stale blob.
  const previewTokenRef = useRef(0);

  // Revoke the object URL when it's replaced or the tab unmounts so the blob
  // doesn't linger in memory.
  useEffect(() => {
    return () => {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    };
  }, [previewBlobUrl]);

  const closePreview = () => {
    previewTokenRef.current += 1;
    if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    setPreviewBlobUrl(null);
    setPreviewFile(null);
    setPreviewError('');
    setPreviewLoading(false);
  };

  const openPreview = async (file) => {
    if (!isAuthenticatedFileUrl(file)) {
      // Legacy on-disk file — let the browser fetch via static serving.
      window.open(file.file_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const token = previewTokenRef.current + 1;
    previewTokenRef.current = token;
    setPreviewFile(file);
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const blob = await fetchTaskFileContent(file.id);
      const url = URL.createObjectURL(blob);
      if (previewTokenRef.current !== token) {
        URL.revokeObjectURL(url);
        return;
      }
      setPreviewBlobUrl(url);
    } catch (err) {
      if (previewTokenRef.current !== token) return;
      setPreviewError(err?.response?.data?.message || err?.message || 'Unable to load preview');
    } finally {
      if (previewTokenRef.current === token) setPreviewLoading(false);
    }
  };

  const openInNewTab = async (file) => {
    if (!isAuthenticatedFileUrl(file)) {
      window.open(file.file_url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const blob = await fetchTaskFileContent(file.id);
      const url = URL.createObjectURL(blob);
      if (canPreviewFile(file)) {
        // Image/PDF: open inline in a new tab so the user can view in the browser.
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        // Non-previewable types (docx/zip/csv/…): the server intended a download
        // with the original filename. Going through `window.open(blob)` would
        // hide both, so trigger a real download with the file_name preserved.
        const a = document.createElement('a');
        a.href = url;
        a.download = file.file_name || 'download';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Give the new tab / download time to start before we drop the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Unable to open file');
    }
  };

  const requestDelete = (file) => {
    if (!setPendingConfirm) {
      onDeleteFile?.(file.id);
      return;
    }
    setPendingConfirm({
      title: 'Delete file?',
      message: <>Permanently delete <strong>{file.file_name || 'this file'}</strong>?</>,
      secondaryText: 'This removes the file for everyone on this item.',
      confirmLabel: 'Delete',
      loadingLabel: 'Deleting…',
      action: () => onDeleteFile?.(file.id)
    });
  };

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
          {itemFiles.map((f) => {
            const fileName = f.file_name || 'File';
            const sizeLabel = formatFileSize(f.size_bytes);
            const meta = [f.uploaded_by_name || 'Unknown', sizeLabel].filter(Boolean).join(' • ');
            const showPreview = canPreviewFile(f) && isAuthenticatedFileUrl(f);
            return (
              <Box
                key={f.id}
                sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box
                    sx={{
                      mt: '2px', color: 'text.secondary', flex: '0 0 auto',
                      display: 'flex', alignItems: 'center'
                    }}
                    aria-hidden="true"
                  >
                    {fileTypeIcon(f)}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {fileName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {meta}
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                      {showPreview && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<IconEye size={14} />}
                          onClick={() => openPreview(f)}
                        >
                          Preview
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => openInNewTab(f)}
                      >
                        Open
                      </Button>
                      <Tooltip title="Delete file">
                        <IconButton
                          size="small"
                          onClick={() => requestDelete(f)}
                          aria-label={`Delete ${fileName}`}
                          color="error"
                        >
                          <IconTrash size={14} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            );
          })}
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

      <FilePreviewDialog
        file={previewFile}
        blobUrl={previewBlobUrl}
        loading={previewLoading}
        error={previewError}
        onClose={closePreview}
      />
    </Stack>
  );
}

function FilePreviewDialog({ file, blobUrl, loading, error, onClose }) {
  const open = Boolean(file);
  const isPdf = isPdfContentType(file);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      aria-labelledby="task-file-preview-title"
    >
      <DialogTitle
        id="task-file-preview-title"
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 1, pr: 1
        }}
      >
        <Typography variant="subtitle1" sx={{ wordBreak: 'break-word' }}>
          {file?.file_name || 'Preview'}
        </Typography>
        <IconButton onClick={onClose} aria-label="Close preview" size="small">
          <IconX size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          p: 0, minHeight: 360, bgcolor: 'background.default',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
      >
        {loading ? (
          <Box sx={{ p: 4 }} role="status" aria-live="polite" aria-busy="true">
            <CircularProgress size={32} aria-label="Loading preview" />
          </Box>
        ) : error ? (
          <Typography variant="body2" color="error" sx={{ p: 4 }}>
            {error}
          </Typography>
        ) : blobUrl ? (
          isPdf ? (
            <iframe
              src={blobUrl}
              title={file?.file_name || 'PDF preview'}
              style={{ width: '100%', height: '75vh', border: 0 }}
            />
          ) : (
            <img
              src={blobUrl}
              alt={file?.file_name || 'Image preview'}
              style={{ maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
            />
          )
        ) : null}
      </DialogContent>
    </Dialog>
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
