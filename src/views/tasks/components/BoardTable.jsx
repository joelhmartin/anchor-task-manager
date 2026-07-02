import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  ClickAwayListener,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Popper,
  Select,
  Skeleton,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { IconChevronDown, IconChevronRight, IconMessageCircle, IconClock, IconLayoutGrid, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import EmptyState from 'ui-component/extended/EmptyState';
import FormDialog from 'ui-component/extended/FormDialog';
import { DEFAULT_STATUS_LABELS, getStatusColor, fmtMinutes, DEFAULT_LABEL_COLOR } from 'constants/taskDefaults';
import LabelPicker, { LabelChips } from './LabelPicker';
import { clientLabel } from 'hooks/useClientLabel';

// ── Memoized item row ──────────────────────────────────────────────────
const ItemRow = memo(function ItemRow({
  item, gridTemplateColumns, labels, assignees, updateCount, timeTotal,
  itemLabels,
  isHighlighted, isEditing, draftName,
  onDraftNameChange, onCommitEdit, onCancelEdit,
  onNameClick, onNameDoubleClick, onStartNameEdit,
  onStatusChange, onOpenPeoplePicker, onDueDateChange,
  onOpenLabelPicker,
  onClickItem, onArchiveClick, canArchive, boardId, canManageLabels,
  mirrorValues = {},
  isSelected, onToggleSelect
}) {
  const status = item.status || 'To Do';
  const sc = getStatusColor(status, labels);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns,
        alignItems: 'center',
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        ...(isHighlighted && { bgcolor: 'action.selected' }),
        ...(isSelected && { bgcolor: 'action.selected' }),
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      {/* select */}
      <Box
        sx={{
          p: 0.5,
          borderRight: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          left: 0,
          zIndex: 3,
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          size="small"
          checked={Boolean(isSelected)}
          onChange={(e) => onToggleSelect?.(item.id, e.target.checked, e.nativeEvent?.shiftKey)}
          inputProps={{ 'aria-label': `Select ${item.name}` }}
        />
      </Box>

      {/* name */}
      <Box
        sx={{
          p: 1,
          borderRight: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          left: 44,
          zIndex: 3,
          bgcolor: 'background.default'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {isEditing ? (
          <TextField
            size="small"
            fullWidth
            value={draftName}
            onChange={(e) => onDraftNameChange(e.target.value)}
            onBlur={() => onCommitEdit(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitEdit(item.id);
              if (e.key === 'Escape') onCancelEdit();
            }}
            inputProps={{ maxLength: 500, 'aria-label': 'Item name' }}
            autoFocus
          />
        ) : (
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="center"
            sx={{
              minWidth: 0,
              '&:hover .item-row-edit-affordance': { opacity: 1 }
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}
              noWrap
              title={item.name}
              onClick={() => onNameClick(item)}
              onDoubleClick={() => onNameDoubleClick(item)}
            >
              {item.name}
            </Typography>
            <IconButton
              size="small"
              className="item-row-edit-affordance"
              onClick={(e) => {
                e.stopPropagation();
                onStartNameEdit?.(item);
              }}
              title="Rename"
              aria-label={`Rename ${item.name}`}
              sx={{
                opacity: 0,
                transition: 'opacity 120ms',
                flexShrink: 0,
                // Keyboard users can't trigger hover; reveal on focus so the
                // affordance is visible and the focus ring is discoverable.
                '&:focus-visible': { opacity: 1 }
              }}
            >
              <IconPencil size={14} />
            </IconButton>
            {canArchive && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onArchiveClick(item);
                }}
                title="Delete (archive)"
                aria-label={`Archive ${item.name}`}
              >
                <IconTrash size={16} />
              </IconButton>
            )}
          </Stack>
        )}
      </Box>

      {/* status */}
      <Box sx={{ p: 1, borderRight: '1px solid', borderColor: 'divider' }} onClick={(e) => e.stopPropagation()}>
        <Select
          size="small"
          value={status}
          onChange={(e) => onStatusChange(item.id, e.target.value)}
          sx={{
            width: '100%',
            '& .MuiSelect-select': { py: 0.5, color: sc.fg },
            '& .MuiSvgIcon-root': { color: sc.fg },
            bgcolor: sc.bg,
            color: sc.fg,
            borderRadius: 999,
            '.MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' }
          }}
        >
          {labels.map((sl) => (
            <MenuItem key={sl.id} value={sl.label}>
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: sl.color,
                  mr: 1
                }}
              />
              {sl.label}
            </MenuItem>
          ))}
          {boardId && canManageLabels && (
            <>
              <Divider />
              <MenuItem value="__add_label__">
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                  Add Label…
                </Typography>
              </MenuItem>
            </>
          )}
        </Select>
      </Box>

      {/* labels */}
      <Box
        sx={{ p: 1, borderRight: '1px solid', borderColor: 'divider', cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onOpenLabelPicker?.(e, item.id);
        }}
      >
        <LabelChips labels={itemLabels} maxVisible={2} />
      </Box>

      {/* people */}
      <Box sx={{ p: 1, borderRight: '1px solid', borderColor: 'divider' }} onClick={(e) => onOpenPeoplePicker(e, item.id)}>
        <Stack direction="row" spacing={-0.5} alignItems="center">
          {assignees.slice(0, 3).map((a) => {
            const label = clientLabel(a) || a.user_id?.slice?.(0, 6) || 'U';
            return (
              <Avatar key={a.user_id} src={a.avatar_url || ''} sx={{ width: 26, height: 26, fontSize: 12 }} imgProps={{ loading: 'lazy' }}>
                {label.slice(0, 1).toUpperCase()}
              </Avatar>
            );
          })}
          {assignees.length > 3 && (
            <Avatar sx={{ width: 26, height: 26, fontSize: 12 }}>{`+${assignees.length - 3}`}</Avatar>
          )}
          {!assignees.length && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              —
            </Typography>
          )}
        </Stack>
      </Box>

      {/* due */}
      <Box sx={{ p: 1, borderRight: '1px solid', borderColor: 'divider' }} onClick={(e) => e.stopPropagation()}>
        <TextField
          size="small"
          type="date"
          value={item.due_date ? item.due_date.slice(0, 10) : ''}
          onChange={(e) => onDueDateChange(item.id, e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: '100%' }}
        />
      </Box>

      {/* updates */}
      <Box sx={{ p: 1, borderRight: '1px solid', borderColor: 'divider' }} onClick={(e) => e.stopPropagation()}>
        <Button
          size="small"
          variant="text"
          startIcon={<IconMessageCircle size={16} />}
          onClick={() => onClickItem?.(item, 'updates')}
        >
          {updateCount}
        </Button>
      </Box>

      {/* time */}
      <Box sx={{ p: 1 }} onClick={(e) => e.stopPropagation()}>
        <Button size="small" variant="text" startIcon={<IconClock size={16} />}>
          {fmtMinutes(timeTotal)}
        </Button>
      </Box>

      {/* mirror columns */}
      {Object.entries(mirrorValues).map(([colId, val]) => {
        const display = val == null ? '—' : Array.isArray(val) ? val.join(', ') : String(val);
        return (
          <Box key={colId} sx={{ p: 1, display: 'flex', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" noWrap title={display}>
              {display}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}, (prev, next) => {
  // Only re-render when data props change, not function refs
  return prev.item === next.item
    && prev.isHighlighted === next.isHighlighted
    && prev.isSelected === next.isSelected
    && prev.isEditing === next.isEditing
    && (!prev.isEditing || prev.draftName === next.draftName)
    && prev.assignees === next.assignees
    && prev.updateCount === next.updateCount
    && prev.timeTotal === next.timeTotal
    && prev.labels === next.labels
    && prev.itemLabels === next.itemLabels
    && prev.gridTemplateColumns === next.gridTemplateColumns
    && prev.canArchive === next.canArchive
    && prev.canManageLabels === next.canManageLabels
    && prev.boardId === next.boardId
    && prev.mirrorValues === next.mirrorValues;
});

// ── Empty array sentinel (stable ref for memo) ────────────────────────
const EMPTY_ASSIGNEES = [];

// ── Main component ────────────────────────────────────────────────────
export default function BoardTable({
  boardId,
  groups = [],
  itemsByGroup = {},
  assigneesByItem = {},
  workspaceMembers = [],
  updateCountsByItem = {},
  timeTotalsByItem = {},
  itemLabelsMap = {},
  workspaceLabels = [],
  statusLabels = [],
  canManageLabels = false,
  onCreateStatusLabel,
  onToggleItemLabel,
  highlightedItemId,
  onClickItem,
  onUpdateItem,
  onToggleAssignee,
  onArchiveItem,
  onDeleteGroup,
  newItemNameByGroup = {},
  creatingItemByGroup = {},
  onChangeNewItemName,
  onCreateItem,
  mirrorColumns = [],
  mirrorData = {},
  loading = false,
  onBulkStatus,
  onBulkAssignees,
  onBulkLabels,
  onBulkArchive
}) {
  const labels = statusLabels.length ? statusLabels : DEFAULT_STATUS_LABELS;
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [editingItemId, setEditingItemId] = useState('');
  const [draftName, setDraftName] = useState('');
  const clickTimerRef = useRef(null);

  // ── Bulk selection state ──
  // Empty Set → no bulk toolbar; non-empty → sticky toolbar visible. Shift-click
  // extends the selection between the last-toggled row and the newly clicked
  // one (like Gmail / Finder). Selection resets when the board switches.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const lastToggledIdRef = useRef(null);

  useEffect(() => {
    setSelectedIds(new Set());
    lastToggledIdRef.current = null;
  }, [boardId]);

  // Flat visible-item order (respects collapsed groups, group order, and item
  // order within each group). Used to compute shift-click ranges and to prune
  // selection when items disappear (archive, delete, filter).
  const visibleItemIds = useMemo(() => {
    const ids = [];
    for (const g of groups) {
      if (collapsedGroups[g.id]) continue;
      const items = itemsByGroup[g.id] || [];
      for (const item of items) ids.push(item.id);
    }
    return ids;
  }, [groups, itemsByGroup, collapsedGroups]);

  // Prune selection when items disappear (archive, delete, filter change) so
  // "3 selected" can't lie about untargetable rows.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const visible = new Set(visibleItemIds);
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleItemIds]);

  const toggleSelect = useCallback((itemId, isSelected, isShiftKey) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const anchor = lastToggledIdRef.current;
      if (isShiftKey && anchor && anchor !== itemId) {
        const anchorIdx = visibleItemIds.indexOf(anchor);
        const targetIdx = visibleItemIds.indexOf(itemId);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          for (let i = lo; i <= hi; i++) {
            if (isSelected) next.add(visibleItemIds[i]);
            else next.delete(visibleItemIds[i]);
          }
        }
      } else if (isSelected) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
    lastToggledIdRef.current = itemId;
  }, [visibleItemIds]);

  const toggleSelectGroup = useCallback((groupId, isSelected) => {
    const groupItemIds = (itemsByGroup[groupId] || []).map((it) => it.id);
    if (!groupItemIds.length) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of groupItemIds) {
        if (isSelected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, [itemsByGroup]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastToggledIdRef.current = null;
  }, []);

  // Escape clears selection when the toolbar is showing — the standard
  // keyboard-first "get me out of bulk mode" affordance.
  useEffect(() => {
    if (!selectedIds.size) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedIds.size, clearSelection]);

  const selectedIdsArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  // ── Bulk toolbar picker state ──
  const [bulkStatusAnchor, setBulkStatusAnchor] = useState(null);
  const [bulkAssigneeAnchor, setBulkAssigneeAnchor] = useState(null);
  const [bulkAssigneeQuery, setBulkAssigneeQuery] = useState('');
  const [bulkLabelAnchor, setBulkLabelAnchor] = useState(null);
  const [bulkLabelQuery, setBulkLabelQuery] = useState('');
  const [bulkArchiveConfirmOpen, setBulkArchiveConfirmOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  const bulkAssigneeMatches = useMemo(() => {
    const q = bulkAssigneeQuery.trim().toLowerCase();
    const list = Array.isArray(workspaceMembers) ? workspaceMembers : [];
    if (!q) return list;
    return list.filter((m) => {
      const email = String(m.email || '').toLowerCase();
      const name = clientLabel(m).toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  }, [workspaceMembers, bulkAssigneeQuery]);

  const bulkLabelMatches = useMemo(() => {
    const q = bulkLabelQuery.trim().toLowerCase();
    const list = Array.isArray(workspaceLabels) ? workspaceLabels : [];
    if (!q) return list;
    return list.filter((l) => String(l.label || '').toLowerCase().includes(q));
  }, [workspaceLabels, bulkLabelQuery]);

  const runBulk = useCallback(async (fn) => {
    if (bulkPending) return;
    setBulkPending(true);
    try {
      await fn();
    } finally {
      setBulkPending(false);
    }
  }, [bulkPending]);

  const handleBulkStatusPick = (statusValue) => {
    if (!onBulkStatus || !selectedIdsArray.length) return;
    setBulkStatusAnchor(null);
    runBulk(async () => {
      await onBulkStatus(selectedIdsArray, statusValue);
      clearSelection();
    });
  };

  const handleBulkAssigneePick = (userId, action) => {
    if (!onBulkAssignees || !selectedIdsArray.length || !userId) return;
    setBulkAssigneeAnchor(null);
    setBulkAssigneeQuery('');
    runBulk(async () => {
      await onBulkAssignees(selectedIdsArray, userId, action);
      clearSelection();
    });
  };

  const handleBulkLabelPick = (labelId, action) => {
    if (!onBulkLabels || !selectedIdsArray.length || !labelId) return;
    setBulkLabelAnchor(null);
    setBulkLabelQuery('');
    runBulk(async () => {
      await onBulkLabels(selectedIdsArray, labelId, action);
      clearSelection();
    });
  };

  const handleBulkArchiveConfirm = () => {
    if (!onBulkArchive || !selectedIdsArray.length) return;
    setBulkArchiveConfirmOpen(false);
    runBulk(async () => {
      await onBulkArchive(selectedIdsArray);
      clearSelection();
    });
  };

  // Status label creator dialog state
  const [addLabelOpen, setAddLabelOpen] = useState(false);
  const [addLabelForItemId, setAddLabelForItemId] = useState('');
  const [labelText, setLabelText] = useState('');
  const [labelHex, setLabelHex] = useState(DEFAULT_LABEL_COLOR);
  const [labelOpacity, setLabelOpacity] = useState(100);
  const [makeGlobal, setMakeGlobal] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);

  // Archive item confirm dialog state
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveTargetItem, setArchiveTargetItem] = useState(null);

  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState(null);

  const uniqueLabelColors = useMemo(() => {
    const seen = new Set();
    const colors = [];
    for (const l of labels) {
      const c = String(l.color || '').trim();
      if (!c) continue;
      const key = c.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      colors.push(c);
    }
    return colors;
  }, [labels]);

  const normalizeHex = (value) => {
    const v = String(value || '').trim();
    if (!v) return DEFAULT_LABEL_COLOR;
    if (v.startsWith('#')) return v;
    return `#${v}`;
  };

  const hexToRgbaHex = (hex, opacityPct) => {
    const base = normalizeHex(hex).replace(/[^#0-9A-Fa-f]/g, '');
    const clean = base.length === 7 ? base : DEFAULT_LABEL_COLOR;
    const a = Math.max(0, Math.min(100, Number(opacityPct)));
    const aa = Math.round((a / 100) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
    return `${clean}${aa}`;
  };

  const openAddLabel = (itemId) => {
    setAddLabelForItemId(itemId || '');
    setLabelText('');
    setLabelHex(DEFAULT_LABEL_COLOR);
    setLabelOpacity(100);
    setMakeGlobal(false);
    setAddLabelOpen(true);
  };

  const closeAddLabel = () => {
    setAddLabelOpen(false);
    setAddLabelForItemId('');
    setLabelText('');
    setMakeGlobal(false);
  };

  const handleCreateLabel = async () => {
    if (!boardId || !canManageLabels || !onCreateStatusLabel) return;
    const name = labelText.trim();
    if (!name) return;
    setCreatingLabel(true);
    try {
      const color = hexToRgbaHex(labelHex, labelOpacity);
      const created = await onCreateStatusLabel({ label: name, color, makeGlobal });
      if (created && addLabelForItemId) {
        await onUpdateItem?.(addLabelForItemId, { status: created.label || name });
      }
      closeAddLabel();
    } finally {
      setCreatingLabel(false);
    }
  };

  // Label picker state
  const [labelAnchor, setLabelAnchor] = useState(null);
  const [labelItemId, setLabelItemId] = useState('');
  const labelPickerOpen = Boolean(labelAnchor && labelItemId);

  const openLabelPicker = (e, itemId) => {
    e.stopPropagation();
    setLabelAnchor(e.currentTarget);
    setLabelItemId(itemId);
  };

  const closeLabelPicker = () => {
    setLabelAnchor(null);
    setLabelItemId('');
  };

  // People picker state
  const [peopleAnchor, setPeopleAnchor] = useState(null);
  const [peopleItemId, setPeopleItemId] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');

  const peopleOpen = Boolean(peopleAnchor && peopleItemId);
  const currentAssignees = assigneesByItem[peopleItemId] || [];
  const currentAssigneeIds = new Set(currentAssignees.map((a) => a.user_id));
  const filteredMembers = useMemo(() => {
    const q = peopleQuery.trim().toLowerCase();
    const list = Array.isArray(workspaceMembers) ? workspaceMembers : [];
    if (!q) return list;
    return list.filter((m) => {
      const email = String(m.email || '').toLowerCase();
      const name = clientLabel(m).toLowerCase();
      const userRole = String(m.user_role || '').toLowerCase();
      const membershipRole = String(m.membership_role || '').toLowerCase();
      return email.includes(q) || name.includes(q) || userRole.includes(q) || membershipRole.includes(q);
    });
  }, [workspaceMembers, peopleQuery]);

  const availableMembers = useMemo(() => {
    return (filteredMembers || []).filter((m) => !currentAssigneeIds.has(m.user_id));
  }, [filteredMembers, currentAssigneeIds]);

  const groupCounts = useMemo(() => {
    const map = {};
    for (const g of groups) {
      map[g.id] = (itemsByGroup[g.id] || []).length;
    }
    return map;
  }, [groups, itemsByGroup]);

  const startEditName = (item) => {
    setEditingItemId(item.id);
    setDraftName(item.name || '');
  };

  const commitEditName = async (itemId) => {
    const next = draftName.trim();
    setEditingItemId('');
    if (!next) return;
    await onUpdateItem?.(itemId, { name: next });
  };

  const handleNameClick = (item) => {
    if (editingItemId === item.id) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onClickItem?.(item, 'updates');
    }, 180);
  };

  const handleNameDoubleClick = (item) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    startEditName(item);
  };

  const openPeoplePicker = (e, itemId) => {
    e.stopPropagation();
    setPeopleAnchor(e.currentTarget);
    setPeopleItemId(itemId);
    setPeopleQuery('');
  };

  const closePeoplePicker = () => {
    setPeopleAnchor(null);
    setPeopleItemId('');
    setPeopleQuery('');
  };

  const handleStatusChange = (itemId, newStatus) => {
    if (newStatus === '__add_label__') {
      openAddLabel(itemId);
      return;
    }
    onUpdateItem?.(itemId, { status: newStatus });
  };

  const handleDueDateChange = (itemId, date) => {
    onUpdateItem?.(itemId, { due_date: date || null });
  };

  const handleArchiveClick = (item) => {
    setArchiveTargetItem(item);
    setArchiveConfirmOpen(true);
  };

  const baseColumns = [
    { key: 'select', label: '', width: 44, sticky: true },
    { key: 'name', label: '', width: 320, sticky: true },
    { key: 'status', label: 'Status', width: 160 },
    { key: 'labels', label: 'Labels', width: 160 },
    { key: 'people', label: 'People', width: 180 },
    { key: 'due', label: 'Date', width: 160 },
    { key: 'updates', label: '', width: 90 },
    { key: 'time', label: 'Time', width: 110 }
  ];

  const mirrorCols = mirrorColumns.map((mc) => ({
    key: `mirror_${mc.id}`,
    label: mc.name,
    width: 130,
    isMirror: true,
    mirrorId: mc.id
  }));

  const columns = [...baseColumns, ...mirrorCols];

  const gridTemplateColumns = columns.map((c) => `${c.width}px`).join(' ');

  // ── Flat list for virtualization ──
  const flatList = useMemo(() => {
    const list = [];
    for (const g of groups) {
      list.push({ type: 'group-header', group: g, key: `gh-${g.id}` });
      if (!collapsedGroups[g.id]) {
        const items = itemsByGroup[g.id] || [];
        for (const item of items) {
          list.push({ type: 'item', item, groupId: g.id, key: item.id });
        }
        if (onCreateItem) {
          list.push({ type: 'new-item', groupId: g.id, key: `ni-${g.id}` });
        }
      }
    }
    return list;
  }, [groups, itemsByGroup, collapsedGroups, onCreateItem]);

  const scrollRef = useRef(null);

  const virtualizer = useVirtualizer({
    count: flatList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const entry = flatList[i];
      if (entry.type === 'group-header') return 52;
      if (entry.type === 'new-item') return 52;
      return 44;
    },
    overscan: 10
  });

  if (loading && groups.length === 0) {
    return (
      <Box
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', p: 1.25 }}
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading board"
      >
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={36} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="rounded" height={44} />
          ))}
        </Stack>
      </Box>
    );
  }

  if (!loading && groups.length === 0) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', p: 1.25 }}>
        <EmptyState
          icon={IconLayoutGrid}
          title="No groups yet."
          message="Add a group above to start organizing items in this board."
          sx={{ py: 6 }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box ref={scrollRef} sx={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto', p: 1.25 }}>
        <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative', width: 'fit-content', minWidth: '100%' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = flatList[virtualRow.index];

            if (entry.type === 'group-header') {
              const g = entry.group;
              const collapsed = Boolean(collapsedGroups[g.id]);
              const groupItems = itemsByGroup[g.id] || [];
              const selectedInGroup = groupItems.reduce(
                (acc, it) => acc + (selectedIds.has(it.id) ? 1 : 0),
                0
              );
              const allInGroupSelected = groupItems.length > 0 && selectedInGroup === groupItems.length;
              const someInGroupSelected = selectedInGroup > 0 && !allInGroupSelected;
              return (
                <Box
                  key={entry.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns,
                      alignItems: 'center',
                      bgcolor: 'grey.100',
                      mt: virtualRow.index > 0 ? 1.25 : 0,
                      borderTopLeftRadius: 8,
                      borderTopRightRadius: 8,
                      ...(collapsed && { borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }),
                      border: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <Box
                      sx={{
                        p: 0.5,
                        borderRight: '1px solid',
                        borderColor: 'divider',
                        position: 'sticky',
                        left: 0,
                        zIndex: 6,
                        bgcolor: 'grey.100',
                        borderTopLeftRadius: 8,
                        ...(collapsed && { borderBottomLeftRadius: 8 }),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Checkbox
                        size="small"
                        checked={allInGroupSelected}
                        indeterminate={someInGroupSelected}
                        onChange={(e) => toggleSelectGroup(g.id, e.target.checked)}
                        disabled={!groupItems.length}
                        inputProps={{ 'aria-label': `Select all items in ${g.name}` }}
                      />
                    </Box>
                    <Box
                      sx={{
                        p: 1,
                        borderRight: '1px solid',
                        borderColor: 'divider',
                        position: 'sticky',
                        left: 44,
                        zIndex: 6,
                        bgcolor: 'grey.100'
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <IconButton
                          size="small"
                          onClick={() => setCollapsedGroups((p) => ({ ...p, [g.id]: !p[g.id] }))}
                          aria-label={collapsed ? `Expand group ${g.name}` : `Collapse group ${g.name}`}
                          aria-expanded={!collapsed}
                        >
                          {collapsed ? <IconChevronRight size={18} /> : <IconChevronDown size={18} />}
                        </IconButton>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          {g.name}
                        </Typography>
                        <Chip size="small" label={groupCounts[g.id] || 0} />
                        {onDeleteGroup && (
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteGroupTarget(g);
                              setDeleteGroupOpen(true);
                            }}
                            title="Delete group"
                            aria-label={`Delete group ${g.name}`}
                          >
                            <IconTrash size={16} />
                          </IconButton>
                        )}
                      </Stack>
                    </Box>
                    {columns.slice(2).map((c) => (
                      <Box
                        key={`${g.id}-${c.key}-hdr`}
                        sx={{
                          p: 1,
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          color: 'text.secondary',
                          borderRight: c.key === 'time' ? 'none' : '1px solid',
                          borderColor: 'divider',
                          textAlign: 'center'
                        }}
                      >
                        {c.label}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            }

            if (entry.type === 'new-item') {
              return (
                <Box
                  key={entry.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'stretch', sm: 'center' }}
                    sx={{ px: 1, py: 0.5 }}
                  >
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="New item"
                      value={newItemNameByGroup[entry.groupId] || ''}
                      onChange={(e) => onChangeNewItemName?.(entry.groupId, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onCreateItem?.(entry.groupId);
                      }}
                    />
                    <Button
                      variant="contained"
                      onClick={() => onCreateItem?.(entry.groupId)}
                      disabled={creatingItemByGroup[entry.groupId] || !(newItemNameByGroup[entry.groupId] || '').trim()}
                    >
                      {creatingItemByGroup[entry.groupId] ? 'Adding…' : 'Add item'}
                    </Button>
                  </Stack>
                </Box>
              );
            }

            // entry.type === 'item'
            const it = entry.item;
            return (
              <Box
                key={entry.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <ItemRow
                  item={it}
                  gridTemplateColumns={gridTemplateColumns}
                  labels={labels}
                  itemLabels={itemLabelsMap[it.id] || EMPTY_ASSIGNEES}
                  assignees={assigneesByItem[it.id] || EMPTY_ASSIGNEES}
                  updateCount={updateCountsByItem[it.id] || 0}
                  timeTotal={timeTotalsByItem[it.id] || 0}
                  isHighlighted={highlightedItemId === it.id}
                  isSelected={selectedIds.has(it.id)}
                  onToggleSelect={toggleSelect}
                  isEditing={editingItemId === it.id}
                  draftName={draftName}
                  onDraftNameChange={setDraftName}
                  onCommitEdit={commitEditName}
                  onCancelEdit={() => { setEditingItemId(''); setDraftName(''); }}
                  onNameClick={handleNameClick}
                  onNameDoubleClick={handleNameDoubleClick}
                  onStartNameEdit={startEditName}
                  onStatusChange={handleStatusChange}
                  onOpenPeoplePicker={openPeoplePicker}
                  onOpenLabelPicker={openLabelPicker}
                  onDueDateChange={handleDueDateChange}
                  onClickItem={onClickItem}
                  onArchiveClick={handleArchiveClick}
                  canArchive={Boolean(onArchiveItem)}
                  boardId={boardId}
                  canManageLabels={canManageLabels}
                  mirrorValues={mirrorData[it.id] || {}}
                />
              </Box>
            );
          })}
        </Box>
      </Box>

      {selectedIdsArray.length > 0 && (
        <Paper
          role="toolbar"
          aria-label={`Bulk actions for ${selectedIdsArray.length} selected items`}
          elevation={4}
          sx={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            m: 1,
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper'
          }}
        >
          <Chip
            label={`${selectedIdsArray.length} selected`}
            color="primary"
            variant="filled"
            size="small"
          />
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <Button
            size="small"
            variant="outlined"
            onClick={(e) => setBulkStatusAnchor(bulkStatusAnchor ? null : e.currentTarget)}
            disabled={bulkPending}
          >
            Status
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={(e) => setBulkAssigneeAnchor(bulkAssigneeAnchor ? null : e.currentTarget)}
            disabled={bulkPending}
          >
            Assignee
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={(e) => setBulkLabelAnchor(bulkLabelAnchor ? null : e.currentTarget)}
            disabled={bulkPending || !workspaceLabels?.length}
          >
            Label
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<IconTrash size={16} />}
            onClick={() => setBulkArchiveConfirmOpen(true)}
            disabled={bulkPending || !onBulkArchive}
          >
            Archive
          </Button>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Clear selection (Esc)">
            <IconButton size="small" onClick={clearSelection} aria-label="Clear selection">
              <IconX size={16} />
            </IconButton>
          </Tooltip>
        </Paper>
      )}

      {/* Bulk status picker */}
      <Popper
        open={Boolean(bulkStatusAnchor)}
        anchorEl={bulkStatusAnchor}
        placement="top-start"
        sx={{ zIndex: 2000 }}
      >
        <ClickAwayListener onClickAway={() => setBulkStatusAnchor(null)}>
          <Paper sx={{ p: 1, minWidth: 200 }}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                Set status for {selectedIdsArray.length} items
              </Typography>
              {labels.map((sl) => {
                const sc = getStatusColor(sl.label, labels);
                return (
                  <Button
                    key={sl.id || sl.label}
                    size="small"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleBulkStatusPick(sl.label)}
                    sx={{
                      justifyContent: 'flex-start',
                      textTransform: 'none',
                      color: sc.fg,
                      bgcolor: sc.bg,
                      '&:hover': { bgcolor: sc.bg, opacity: 0.9 }
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: sl.color,
                        mr: 1
                      }}
                    />
                    {sl.label}
                  </Button>
                );
              })}
            </Stack>
          </Paper>
        </ClickAwayListener>
      </Popper>

      {/* Bulk assignee picker */}
      <Popper
        open={Boolean(bulkAssigneeAnchor)}
        anchorEl={bulkAssigneeAnchor}
        placement="top-start"
        sx={{ zIndex: 2000 }}
      >
        <ClickAwayListener onClickAway={() => { setBulkAssigneeAnchor(null); setBulkAssigneeQuery(''); }}>
          <Paper sx={{ p: 1, width: 320 }}>
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                Assign / unassign a member on {selectedIdsArray.length} items
              </Typography>
              <TextField
                size="small"
                autoFocus
                placeholder="Search members"
                value={bulkAssigneeQuery}
                onChange={(e) => setBulkAssigneeQuery(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">@</InputAdornment> }}
              />
              <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
                <Stack spacing={0.5}>
                  {bulkAssigneeMatches.slice(0, 25).map((m) => {
                    const label = clientLabel(m);
                    return (
                      <Stack
                        key={m.user_id}
                        direction="row"
                        spacing={0.5}
                        alignItems="center"
                        sx={{ px: 0.5 }}
                      >
                        <Avatar src={m.avatar_url || ''} sx={{ width: 22, height: 22, fontSize: 11 }}>
                          {(label || 'U').slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={label}>
                          {label}
                        </Typography>
                        <Button size="small" onMouseDown={(e) => e.preventDefault()} onClick={() => handleBulkAssigneePick(m.user_id, 'add')}>
                          Add
                        </Button>
                        <Button size="small" color="error" onMouseDown={(e) => e.preventDefault()} onClick={() => handleBulkAssigneePick(m.user_id, 'remove')}>
                          Remove
                        </Button>
                      </Stack>
                    );
                  })}
                  {!bulkAssigneeMatches.length && (
                    <Typography variant="body2" color="text.secondary">
                      No matches.
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          </Paper>
        </ClickAwayListener>
      </Popper>

      {/* Bulk label picker */}
      <Popper
        open={Boolean(bulkLabelAnchor)}
        anchorEl={bulkLabelAnchor}
        placement="top-start"
        sx={{ zIndex: 2000 }}
      >
        <ClickAwayListener onClickAway={() => { setBulkLabelAnchor(null); setBulkLabelQuery(''); }}>
          <Paper sx={{ p: 1, width: 320 }}>
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                Add / remove a label on {selectedIdsArray.length} items
              </Typography>
              <TextField
                size="small"
                autoFocus
                placeholder="Search labels"
                value={bulkLabelQuery}
                onChange={(e) => setBulkLabelQuery(e.target.value)}
              />
              <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
                <Stack spacing={0.5}>
                  {bulkLabelMatches.slice(0, 40).map((l) => (
                    <Stack
                      key={l.id}
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      sx={{ px: 0.5 }}
                    >
                      <Box
                        component="span"
                        sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: l.color || DEFAULT_LABEL_COLOR }}
                      />
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={l.label}>
                        {l.label}
                      </Typography>
                      <Button size="small" onMouseDown={(e) => e.preventDefault()} onClick={() => handleBulkLabelPick(l.id, 'add')}>
                        Add
                      </Button>
                      <Button size="small" color="error" onMouseDown={(e) => e.preventDefault()} onClick={() => handleBulkLabelPick(l.id, 'remove')}>
                        Remove
                      </Button>
                    </Stack>
                  ))}
                  {!bulkLabelMatches.length && (
                    <Typography variant="body2" color="text.secondary">
                      No matches.
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          </Paper>
        </ClickAwayListener>
      </Popper>

      <ConfirmDialog
        open={bulkArchiveConfirmOpen}
        onClose={() => setBulkArchiveConfirmOpen(false)}
        onConfirm={handleBulkArchiveConfirm}
        title="Archive selected items?"
        message={`This will archive ${selectedIdsArray.length} item${selectedIdsArray.length === 1 ? '' : 's'} for 30 days, then they will be permanently deleted.`}
        confirmLabel="Archive"
        confirmColor="error"
      />

      <Popper open={peopleOpen} anchorEl={peopleAnchor} placement="bottom-start" sx={{ zIndex: 2000 }}>
        <ClickAwayListener onClickAway={closePeoplePicker}>
        <Paper sx={{ p: 1, width: 320 }}>
          <Stack spacing={1}>
            <TextField
              size="small"
              placeholder="Search names, roles or teams"
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              InputProps={{
                startAdornment: <InputAdornment position="start">@</InputAdornment>
              }}
            />
            {currentAssignees.length > 0 && (
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                {currentAssignees.map((a) => {
                  const label = clientLabel(a) || a.user_id?.slice?.(0, 6) || 'User';
                  return (
                    <Chip
                      key={a.user_id}
                      size="small"
                      label={label}
                      avatar={
                        <Avatar src={a.avatar_url || ''} sx={{ width: 22, height: 22, fontSize: 11 }}>
                          {label.slice(0, 1).toUpperCase()}
                        </Avatar>
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onDelete={() => onToggleAssignee?.(peopleItemId, a.user_id, true)}
                      sx={{ maxWidth: '100%' }}
                    />
                  );
                })}
              </Stack>
            )}
            <Divider />
            <Box sx={{ maxHeight: 260, overflow: 'auto' }}>
              <Stack spacing={0.5}>
                {availableMembers.slice(0, 25).map((m) => {
                  const label = clientLabel(m);
                  return (
                    <Button
                      key={m.user_id}
                      size="small"
                      variant="outlined"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggleAssignee?.(peopleItemId, m.user_id, false)}
                      sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Avatar src={m.avatar_url || ''} sx={{ width: 22, height: 22, fontSize: 11 }}>
                          {(label || 'U').slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Stack sx={{ minWidth: 0, flex: 1, alignItems: 'flex-start' }}>
                          <Typography variant="body2" noWrap sx={{ width: '100%', display: 'block', textAlign: 'left' }} title={label}>
                            {label}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Button>
                  );
                })}
                {!availableMembers.length && (
                  <Typography variant="body2" color="text.secondary">
                    No matches.
                  </Typography>
                )}
              </Stack>
            </Box>
            <Button size="small" variant="text" onClick={closePeoplePicker}>
              Close
            </Button>
          </Stack>
        </Paper>
        </ClickAwayListener>
      </Popper>

      <LabelPicker
        anchorEl={labelAnchor}
        open={labelPickerOpen}
        onClose={closeLabelPicker}
        workspaceLabels={workspaceLabels}
        appliedLabelIds={(itemLabelsMap[labelItemId] || []).map((l) => l.id)}
        onToggle={(lid, isApplied) => onToggleItemLabel?.(labelItemId, lid, isApplied)}
      />

      <FormDialog
        open={addLabelOpen}
        onClose={closeAddLabel}
        onSubmit={handleCreateLabel}
        title="Add Label"
        submitLabel="Create label"
        loading={creatingLabel}
        loadingLabel="Creating…"
        submitDisabled={!labelText.trim() || !boardId || !canManageLabels}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Create a new status label{boardId ? ' for this board' : ''}.
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={makeGlobal} onChange={(e) => setMakeGlobal(e.target.checked)} />}
            label="Make Global Label"
          />
        </Stack>
        <TextField
          label="Label text"
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          fullWidth
          autoFocus
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Box sx={{ minWidth: 220 }}>
            <TextField
              label="Hex"
              value={labelHex}
              onChange={(e) => setLabelHex(normalizeHex(e.target.value))}
              fullWidth
              inputProps={{ maxLength: 9 }}
              helperText="Use #RRGGBB (opacity applied below)"
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <input
              type="color"
              value={normalizeHex(labelHex).slice(0, 7)}
              onChange={(e) => setLabelHex(e.target.value)}
              style={{ width: 44, height: 44, border: 'none', background: 'transparent', padding: 0 }}
              aria-label="Label color"
            />
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                bgcolor: hexToRgbaHex(labelHex, labelOpacity),
                border: '1px solid',
                borderColor: 'divider'
              }}
              title={hexToRgbaHex(labelHex, labelOpacity)}
            />
          </Box>
        </Stack>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Opacity ({labelOpacity}%)
          </Typography>
          <Slider
            value={labelOpacity}
            onChange={(_e, v) => setLabelOpacity(Number(v))}
            min={0}
            max={100}
            step={1}
            valueLabelDisplay="auto"
          />
        </Box>

        {uniqueLabelColors.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Pick an existing color
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', pt: 1 }}>
              {uniqueLabelColors.map((c) => (
                <Box
                  key={c}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    const hex = String(c).trim();
                    const base = hex.slice(0, 7);
                    setLabelHex(base);
                    if (hex.length === 9) {
                      const aa = parseInt(hex.slice(7, 9), 16);
                      const pct = Math.round((aa / 255) * 100);
                      setLabelOpacity(pct);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const hex = String(c).trim();
                      const base = hex.slice(0, 7);
                      setLabelHex(base);
                    }
                  }}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    bgcolor: c,
                    border: '2px solid',
                    borderColor: hexToRgbaHex(labelHex, labelOpacity).toLowerCase() === String(c).toLowerCase() ? 'primary.main' : 'divider',
                    cursor: 'pointer'
                  }}
                  title={c}
                />
              ))}
            </Stack>
          </Box>
        )}
      </FormDialog>

      <ConfirmDialog
        open={archiveConfirmOpen}
        onClose={() => {
          setArchiveConfirmOpen(false);
          setArchiveTargetItem(null);
        }}
        onConfirm={async () => {
          const id = archiveTargetItem?.id;
          setArchiveConfirmOpen(false);
          setArchiveTargetItem(null);
          if (id) await onArchiveItem?.(id);
        }}
        title="Delete item?"
        message="This will archive the item for 30 days, then it will be permanently deleted."
        secondaryText={archiveTargetItem?.name}
        confirmLabel="Delete"
        confirmColor="error"
      />

      <ConfirmDialog
        open={deleteGroupOpen}
        onClose={() => {
          setDeleteGroupOpen(false);
          setDeleteGroupTarget(null);
        }}
        onConfirm={async () => {
          const id = deleteGroupTarget?.id;
          setDeleteGroupOpen(false);
          setDeleteGroupTarget(null);
          if (id) await onDeleteGroup?.(id);
        }}
        title="Delete group?"
        message="This will permanently delete the group and all items inside it."
        secondaryText={deleteGroupTarget?.name}
        confirmLabel="Delete"
        confirmColor="error"
      />
    </Box>
  );
}
