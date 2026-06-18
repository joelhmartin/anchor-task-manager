import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import BoardTable from '../components/BoardTable';
import EmptyState from 'ui-component/extended/EmptyState';
import { DEFAULT_STATUS_LABELS, getStatusColor } from 'constants/taskDefaults';

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = Math.round((d - now) / 86400000);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff < 0) return { label, color: 'error.main', hint: 'Overdue' };
  if (diff === 0) return { label: 'Today', color: 'warning.main', hint: 'Due today' };
  if (diff === 1) return { label: 'Tomorrow', color: 'warning.main', hint: 'Due tomorrow' };
  return { label, color: 'text.secondary', hint: null };
}

export default function MyWorkPane({
  loading,
  groups,
  itemsByGroup,
  assigneesByItem,
  updateCountsByItem,
  timeTotalsByItem,
  workspaceMembers,
  subitems = [],
  onUpdateItem,
  onToggleAssignee,
  onClickItem
}) {
  const [showOnlyActionable, setShowOnlyActionable] = useState(true);

  // Group subitems by parent item
  const { groupedSubitems, readyCount, blockedCount } = useMemo(() => {
    const subs = Array.isArray(subitems) ? subitems : [];
    let ready = 0;
    let blocked = 0;
    const byParent = {};

    for (const si of subs) {
      const parentId = si.parent_item_id;
      if (!byParent[parentId]) {
        byParent[parentId] = {
          parentName: si.parent_name,
          parentId,
          boardName: si.board_name,
          boardId: si.board_id,
          items: []
        };
      }
      const isBlocked = Number(si.blocker_count || 0) > 0;
      if (isBlocked) blocked++;
      else ready++;
      byParent[parentId].items.push({ ...si, isBlocked });
    }

    return { groupedSubitems: byParent, readyCount: ready, blockedCount: blocked };
  }, [subitems]);

  const parentIds = useMemo(() => Object.keys(groupedSubitems), [groupedSubitems]);

  const hasSubitems = parentIds.length > 0;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, minHeight: 420 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack spacing={0.25}>
            <Typography variant="h5">My Work</Typography>
            <Typography variant="caption" color="text.secondary">
              Items assigned to you across all boards
            </Typography>
          </Stack>
          {loading && <CircularProgress size={18} />}
        </Stack>

        {!loading && groups.length === 0 && !hasSubitems && (
          <EmptyState
            icon={AssignmentOutlinedIcon}
            title="No assigned items yet."
            message="Items and subitems assigned to you will appear here."
          />
        )}

        {!loading && groups.length > 0 && (
          <BoardTable
            groups={groups}
            itemsByGroup={itemsByGroup}
            assigneesByItem={assigneesByItem}
            workspaceMembers={workspaceMembers}
            updateCountsByItem={updateCountsByItem}
            timeTotalsByItem={timeTotalsByItem}
            statusLabels={DEFAULT_STATUS_LABELS}
            onUpdateItem={onUpdateItem}
            onToggleAssignee={onToggleAssignee}
            onClickItem={onClickItem}
            // disable creation in My Work
            onCreateItem={null}
            onChangeNewItemName={null}
            newItemNameByGroup={{}}
            creatingItemByGroup={{}}
          />
        )}

        {/* ── My Subitems Section ── */}
        {!loading && hasSubitems && (
          <>
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h5">My Subitems</Typography>
                <Typography variant="caption" color="text.secondary">
                  {readyCount} ready{blockedCount > 0 ? `, ${blockedCount} blocked` : ''}
                </Typography>
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showOnlyActionable}
                    onChange={(e) => setShowOnlyActionable(e.target.checked)}
                  />
                }
                label={
                  <Typography variant="caption" color="text.secondary">
                    Show only actionable
                  </Typography>
                }
                sx={{ mr: 0 }}
              />
            </Stack>

            <Stack spacing={1.5}>
              {parentIds.map((parentId) => {
                const group = groupedSubitems[parentId];
                const visibleItems = showOnlyActionable
                  ? group.items.filter((si) => !si.isBlocked)
                  : group.items;
                if (visibleItems.length === 0) return null;

                return (
                  <Box key={parentId}>
                    {/* Parent item header */}
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                      <SubdirectoryArrowRightIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                      <Typography
                        variant="subtitle2"
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { textDecoration: 'underline' }
                        }}
                        onClick={() => onClickItem?.({ id: parentId, name: group.parentName })}
                      >
                        {group.parentName}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        &middot; {group.boardName}
                      </Typography>
                    </Stack>

                    {/* Subitem rows */}
                    {/* custom table — DataTable cannot express subitems nested under grouped parent BoardTable rows */}
                    <TableContainer>
                      <Table size="small">
                        <TableBody>
                          {visibleItems.map((si) => {
                            const due = formatDueDate(si.due_date);
                            const statusColors = getStatusColor(si.status);
                            return (
                              <TableRow
                                key={si.id}
                                hover={!si.isBlocked}
                                sx={{
                                  cursor: si.isBlocked ? 'default' : 'pointer',
                                  opacity: si.isBlocked ? 0.5 : 1,
                                  '& td': { py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }
                                }}
                                onClick={() => {
                                  if (!si.isBlocked) {
                                    onClickItem?.({ id: parentId, name: group.parentName });
                                  }
                                }}
                              >
                                {/* Name */}
                                <TableCell sx={{ pl: 3.5 }}>
                                  <Stack direction="row" alignItems="center" spacing={1}>
                                    {si.isBlocked && (
                                      <LockOutlinedIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                                    )}
                                    {!si.isBlocked && (
                                      <CheckCircleOutlineIcon sx={{ fontSize: 14, color: 'success.main' }} />
                                    )}
                                    <Typography variant="body2" noWrap title={si.name}>
                                      {si.name}
                                    </Typography>
                                  </Stack>
                                </TableCell>

                                {/* Status chip */}
                                <TableCell sx={{ width: 120 }}>
                                  <Chip
                                    label={si.status || 'To Do'}
                                    size="small"
                                    sx={{
                                      bgcolor: statusColors.bg,
                                      color: statusColors.fg,
                                      fontWeight: 500,
                                      fontSize: '0.7rem',
                                      height: 22
                                    }}
                                  />
                                </TableCell>

                                {/* Due date */}
                                <TableCell sx={{ width: 100 }}>
                                  {due && (
                                    <Typography variant="caption" sx={{ color: due.color }}>
                                      {due.label}
                                    </Typography>
                                  )}
                                </TableCell>

                                {/* Blocker indicator */}
                                <TableCell sx={{ width: 140 }}>
                                  {si.isBlocked ? (
                                    <Chip
                                      icon={<LockOutlinedIcon sx={{ fontSize: '14px !important' }} />}
                                      label={`Waiting on ${si.blocker_count} task${si.blocker_count > 1 ? 's' : ''}`}
                                      size="small"
                                      color="warning"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: 22 }}
                                    />
                                  ) : (
                                    <Chip
                                      label="Ready"
                                      size="small"
                                      color="success"
                                      variant="outlined"
                                      sx={{ fontSize: '0.7rem', height: 22 }}
                                    />
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                );
              })}
            </Stack>

            {/* All filtered out */}
            {showOnlyActionable && readyCount === 0 && blockedCount > 0 && (
              <EmptyState
                icon={LockOutlinedIcon}
                title="All subitems are blocked"
                message="Turn off the actionable filter to see blocked subitems."
              />
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
