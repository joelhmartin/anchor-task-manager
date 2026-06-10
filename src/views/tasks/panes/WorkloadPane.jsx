import { useEffect, useState } from 'react';
import {
  Avatar, Box, Chip, LinearProgress, Stack, Tooltip, Typography
} from '@mui/material';
import { IconUsers } from '@tabler/icons-react';
import EmptyState from 'ui-component/extended/EmptyState';
import { useTaskContext } from 'contexts/TaskContext';
import { useToast } from 'contexts/ToastContext';
import { fetchWorkload } from 'api/tasks';
import { clientLabel } from 'hooks/useClientLabel';
import { WORKLOAD_STATUS_COLORS, STATUS_FALLBACK_COLOR } from 'constants/taskDefaults';

const WEEKLY_CAPACITY_HOURS = 40;

function getInitials(first, last) {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase() || '?';
}

function getColor(status) {
  return WORKLOAD_STATUS_COLORS[status] || STATUS_FALLBACK_COLOR;
}

export default function WorkloadPane() {
  const { activeWorkspaceId } = useTaskContext();
  const toast = useToast();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    setLoading(true);
    fetchWorkload(activeWorkspaceId)
      .then((data) => { if (!cancelled) setPeople(data); })
      .catch(() => { if (!cancelled) toast.error('Failed to load workload'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, toast]);

  if (!loading && !people.length) {
    return (
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
        <EmptyState icon={IconUsers} title="No assigned items" message="Assign items to team members to see workload" />
      </Box>
    );
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h5">Team Workload</Typography>
        <Typography variant="body2" color="text.secondary">
          Cross-board view of assigned work per team member.
        </Typography>

        {loading ? (
          <Stack spacing={1}>{[1, 2, 3].map((i) => <Box key={i} sx={{ height: 80, bgcolor: 'action.hover', borderRadius: 1.5 }} />)}</Stack>
        ) : (
          <Stack spacing={1.5}>
            {people.map((person) => {
              const hoursLogged = Math.round((person.minutes_this_week || 0) / 60 * 10) / 10;
              const utilPct = Math.min(100, Math.round((hoursLogged / WEEKLY_CAPACITY_HOURS) * 100));
              const utilColor = utilPct > 90 ? 'error' : utilPct > 60 ? 'warning' : 'primary';
              const allStatuses = Object.keys(person.status_counts || {});
              const allBoards = Object.entries(person.board_counts || {});

              return (
                <Box key={person.user_id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    {/* Avatar */}
                    <Avatar src={person.avatar_url} sx={{ width: 40, height: 40, fontSize: '0.85rem' }}>
                      {getInitials(person.first_name, person.last_name)}
                    </Avatar>

                    {/* Content */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {/* Name row */}
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {clientLabel(person)}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Chip label={`${person.total_items} items`} size="small" sx={{ height: 22, fontSize: '0.7rem' }} />
                          {person.overdue > 0 && (
                            <Chip label={`${person.overdue} overdue`} size="small" color="error" sx={{ height: 22, fontSize: '0.7rem' }} />
                          )}
                        </Stack>
                      </Stack>

                      {/* Status bar */}
                      <Box sx={{ display: 'flex', height: 20, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover', mb: 1 }}>
                        {allStatuses.map((st) => {
                          const count = person.status_counts[st] || 0;
                          const pct = (count / person.total_items) * 100;
                          return (
                            <Tooltip key={st} title={`${st}: ${count}`} arrow>
                              <Box sx={{ width: `${pct}%`, bgcolor: getColor(st), minWidth: count > 0 ? 4 : 0 }} />
                            </Tooltip>
                          );
                        })}
                      </Box>

                      {/* Hours + capacity */}
                      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 0.75 }}>
                        <Typography variant="caption" color="text.secondary">
                          {hoursLogged}h / {WEEKLY_CAPACITY_HOURS}h this week
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={utilPct}
                          color={utilColor}
                          sx={{ flex: 1, height: 6, borderRadius: 3, maxWidth: 200 }}
                        />
                        <Typography variant="caption" color={`${utilColor}.main`} fontWeight={600}>
                          {utilPct}%
                        </Typography>
                      </Stack>

                      {/* Board breakdown */}
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                        {allBoards.map(([boardName, count]) => (
                          <Chip
                            key={boardName}
                            label={`${boardName}: ${count}`}
                            size="small"
                            variant="outlined"
                            sx={{ height: 20, fontSize: '0.6rem' }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
