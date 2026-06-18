import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { IconAdjustments, IconRobot, IconSearch, IconSortAscending, IconInfoCircle, IconDotsVertical, IconArrowUp, IconArrowDown } from '@tabler/icons-react';

export default function BoardHeader({
  board,
  view = 'main',
  onChangeView,
  search,
  onChangeSearch,
  onOpenAutomations,
  onOpenBoardMenu,
  onUpdateBoard,
  // Filter / sort props
  filterBarVisible,
  onToggleFilterBar,
  activeFilterCount = 0,
  sortBy,
  sortDir,
  onOpenSortMenu,
  sortButtonRef
}) {
  const [editingName, setEditingName] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [draftName, setDraftName] = useState(board?.name || '');
  const [draftDesc, setDraftDesc] = useState(board?.description || '');

  useEffect(() => {
    setDraftName(board?.name || '');
    setDraftDesc(board?.description || '');
  }, [board?.id, board?.name, board?.description]);

  const canEdit = Boolean(board?.id);

  const commitName = async () => {
    if (!canEdit) return;
    const next = draftName.trim();
    if (!next) return;
    setEditingName(false);
    if (next !== (board?.name || '')) {
      await onUpdateBoard?.({ name: next });
    }
  };

  const commitDesc = async () => {
    if (!canEdit) return;
    const next = (draftDesc || '').trim();
    setEditingDesc(false);
    if (next !== (board?.description || '')) {
      await onUpdateBoard?.({ description: next });
    }
  };

  return (
    <Box
      sx={{
        p: 1.25,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        position: 'sticky',
        top: 0,
        zIndex: 5,
        bgcolor: 'background.default'
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        {/* Left */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          {editingName ? (
            <TextField
              size="small"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') {
                  setDraftName(board?.name || '');
                  setEditingName(false);
                }
              }}
              autoFocus
            />
          ) : (
            <Typography
              variant="h6"
              sx={{ cursor: canEdit ? 'pointer' : 'default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={board?.name || ''}
              onClick={() => canEdit && setEditingName(true)}
            >
              {board?.name || 'Board'}
            </Typography>
          )}

          {editingDesc ? (
            <TextField
              size="small"
              placeholder="Board description"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              onBlur={commitDesc}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDesc();
                if (e.key === 'Escape') {
                  setDraftDesc(board?.description || '');
                  setEditingDesc(false);
                }
              }}
              autoFocus
            />
          ) : (
            <IconButton
              size="small"
              onClick={() => canEdit && setEditingDesc(true)}
              disabled={!canEdit}
              title={board?.description || 'Add description'}
              aria-label={board?.description ? 'Edit board description' : 'Add board description'}
            >
              <IconInfoCircle size={18} />
            </IconButton>
          )}

          <Select size="small" value={view} onChange={(e) => onChangeView?.(e.target.value)}>
            <MenuItem value="main">Main Table</MenuItem>
            <MenuItem value="kanban">Kanban</MenuItem>
            <MenuItem value="timeline">Timeline</MenuItem>
            <MenuItem value="calendar">Calendar</MenuItem>
            <MenuItem value="chart">Chart</MenuItem>
            <MenuItem value="workload">Workload</MenuItem>
          </Select>
        </Stack>

        {/* Right */}
        <Stack direction="row" spacing={1} alignItems="center">
          <Badge badgeContent={activeFilterCount} color="primary" overlap="rectangular">
            <Button
              size="small"
              variant={filterBarVisible ? 'contained' : 'outlined'}
              startIcon={<IconAdjustments size={16} />}
              onClick={onToggleFilterBar}
            >
              Filter
            </Button>
          </Badge>
          <Button
            ref={sortButtonRef}
            size="small"
            variant={sortBy ? 'contained' : 'outlined'}
            startIcon={sortBy ? (sortDir === 'asc' ? <IconArrowUp size={16} /> : <IconArrowDown size={16} />) : <IconSortAscending size={16} />}
            onClick={onOpenSortMenu}
          >
            Sort
          </Button>
          <TextField
            size="small"
            placeholder="Search board"
            value={search}
            onChange={(e) => onChangeSearch?.(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <IconSearch size={16} />
                </InputAdornment>
              )
            }}
          />
          <Button size="small" variant="contained" startIcon={<IconRobot size={16} />} onClick={onOpenAutomations}>
            Automations
          </Button>
          <IconButton size="small" onClick={onOpenBoardMenu} aria-label="Open board menu">
            <IconDotsVertical size={18} />
          </IconButton>
        </Stack>
      </Stack>
    </Box>
  );
}


