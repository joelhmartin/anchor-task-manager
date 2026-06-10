import { useMemo } from 'react';
import { Avatar, Box, Chip, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { IconUser } from '@tabler/icons-react';
import EmptyState from 'ui-component/extended/EmptyState';
import { getStatusColor } from 'constants/taskDefaults';
import { clientLabel } from 'hooks/useClientLabel';

const DEFAULT_WEEKLY_CAPACITY = 40; // hours

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function WorkloadView({ items = [], groups = [], statusLabels = [], assigneesByItem = {}, onItemClick }) {
  // Build per-person workload
  const workload = useMemo(() => {
    const people = {};

    items.forEach((item) => {
      const assignees = assigneesByItem[item.id] || [];
      if (!assignees.length) {
        // Unassigned bucket
        if (!people['__unassigned__']) {
          people['__unassigned__'] = { name: 'Unassigned', avatar: null, items: [], statusCounts: {} };
        }
        people['__unassigned__'].items.push(item);
        const st = item.status || 'To Do';
        people['__unassigned__'].statusCounts[st] = (people['__unassigned__'].statusCounts[st] || 0) + 1;
        return;
      }

      assignees.forEach((a) => {
        const key = a.user_id || a.id;
        if (!people[key]) {
          people[key] = {
            name: clientLabel(a) || 'Unknown',
            avatar: a.avatar_url || null,
            items: [],
            statusCounts: {}
          };
        }
        people[key].items.push(item);
        const st = item.status || 'To Do';
        people[key].statusCounts[st] = (people[key].statusCounts[st] || 0) + 1;
      });
    });

    // Sort by most items
    return Object.entries(people)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [items, assigneesByItem]);

  const maxItems = useMemo(() => Math.max(...workload.map((w) => w.items.length), 1), [workload]);

  const allStatuses = useMemo(() => {
    const set = new Set();
    workload.forEach((w) => Object.keys(w.statusCounts).forEach((s) => set.add(s)));
    return Array.from(set);
  }, [workload]);

  if (!items.length) {
    return <EmptyState icon={IconUser} title="No items" message="Create and assign items to see workload" />;
  }

  return (
    <Stack spacing={2}>
      {/* Legend */}
      <Stack direction="row" spacing={1} flexWrap="wrap">
        {allStatuses.map((st) => {
          const color = getStatusColor(st, statusLabels);
          return (
            <Chip
              key={st}
              label={st}
              size="small"
              sx={{ height: 20, fontSize: '0.65rem', bgcolor: color + '22', borderLeft: `3px solid ${color}` }}
            />
          );
        })}
      </Stack>

      {/* Person rows */}
      {workload.map((person) => {
        const utilization = Math.round((person.items.length / maxItems) * 100);
        const barColor = utilization > 80 ? 'error' : utilization > 50 ? 'warning' : 'primary';

        return (
          <Box
            key={person.id}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              {/* Avatar */}
              <Avatar
                src={person.avatar}
                sx={{ width: 32, height: 32, fontSize: '0.75rem' }}
              >
                {getInitials(person.name)}
              </Avatar>

              {/* Info + bar */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2" noWrap>{person.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {person.items.length} item{person.items.length !== 1 ? 's' : ''}
                  </Typography>
                </Stack>

                {/* Stacked status bar */}
                <Box sx={{ display: 'flex', height: 16, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
                  {allStatuses.map((st) => {
                    const count = person.statusCounts[st] || 0;
                    if (!count) return null;
                    const pct = (count / person.items.length) * 100;
                    const color = getStatusColor(st, statusLabels);
                    return (
                      <Tooltip key={st} title={`${st}: ${count}`} arrow>
                        <Box sx={{ width: `${pct}%`, bgcolor: color, minWidth: count > 0 ? 4 : 0 }} />
                      </Tooltip>
                    );
                  })}
                </Box>

                {/* Item chips */}
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}>
                  {person.items.slice(0, 8).map((item) => {
                    const color = getStatusColor(item.status, statusLabels);
                    return (
                      <Tooltip key={item.id} title={`${item.name} — ${item.status}`} arrow>
                        <Chip
                          label={item.name}
                          size="small"
                          onClick={() => onItemClick?.(item)}
                          sx={{
                            height: 20, fontSize: '0.6rem', maxWidth: 120, cursor: 'pointer',
                            bgcolor: color + '18', borderLeft: `2px solid ${color}`,
                            '& .MuiChip-label': { px: 0.5 }
                          }}
                        />
                      </Tooltip>
                    );
                  })}
                  {person.items.length > 8 && (
                    <Typography variant="caption" color="text.secondary" sx={{ lineHeight: '20px' }}>
                      +{person.items.length - 8} more
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
