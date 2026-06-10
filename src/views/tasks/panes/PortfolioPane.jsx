import { useEffect, useMemo, useState } from 'react';
import {
  Box, Chip, LinearProgress, Stack, Typography
} from '@mui/material';
import { IconBriefcase } from '@tabler/icons-react';
import DataTable from 'ui-component/extended/DataTable';
import EmptyState from 'ui-component/extended/EmptyState';
import { useTaskContext } from 'contexts/TaskContext';
import { useToast } from 'contexts/ToastContext';
import { fetchWidgetData } from 'api/tasks';

function ProgressBar({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const color = pct >= 80 ? 'success' : pct >= 40 ? 'primary' : 'warning';
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 120 }}>
      <LinearProgress variant="determinate" value={pct} color={color} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
      <Typography variant="caption" sx={{ minWidth: 30, textAlign: 'right' }}>{pct}%</Typography>
    </Stack>
  );
}

function HealthChip({ overdue, total }) {
  if (total === 0) return <Chip label="Empty" size="small" sx={{ height: 20, fontSize: '0.65rem' }} />;
  const ratio = total > 0 ? overdue / total : 0;
  if (ratio === 0) return <Chip label="On Track" size="small" color="success" sx={{ height: 20, fontSize: '0.65rem' }} />;
  if (ratio < 0.2) return <Chip label="At Risk" size="small" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />;
  return <Chip label="Behind" size="small" color="error" sx={{ height: 20, fontSize: '0.65rem' }} />;
}

export default function PortfolioPane() {
  const { allBoards, boardsLoading } = useTaskContext();
  const toast = useToast();
  const [boardMetrics, setBoardMetrics] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!allBoards?.length) return;
    let cancelled = false;
    setLoading(true);

    const loadMetrics = async () => {
      const metrics = {};
      await Promise.all(
        allBoards.map(async (board) => {
          try {
            const [statusData, overdueData] = await Promise.all([
              fetchWidgetData('battery', { board_ids: [board.id] }),
              fetchWidgetData('overdue', { board_ids: [board.id] })
            ]);
            metrics[board.id] = {
              total: statusData?.total || 0,
              done: statusData?.done || 0,
              percent: statusData?.percent || 0,
              overdue: Array.isArray(overdueData) ? overdueData.length : 0
            };
          } catch {
            metrics[board.id] = { total: 0, done: 0, percent: 0, overdue: 0 };
          }
        })
      );
      if (!cancelled) {
        setBoardMetrics(metrics);
        setLoading(false);
      }
    };

    loadMetrics();
    return () => { cancelled = true; };
  }, [allBoards]);

  const rows = useMemo(() => {
    if (!allBoards?.length) return [];
    return allBoards.map((board) => {
      const m = boardMetrics[board.id] || { total: 0, done: 0, percent: 0, overdue: 0 };
      return {
        id: board.id,
        name: board.name,
        description: board.description || '',
        total: m.total,
        done: m.done,
        open: m.total - m.done,
        percent: m.percent,
        overdue: m.overdue
      };
    });
  }, [allBoards, boardMetrics]);

  const columns = [
    {
      id: 'name',
      label: 'Board',
      sortable: true,
      width: 200,
      render: (row) => (
        <Stack>
          <Typography variant="subtitle2">{row.name}</Typography>
          {row.description && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 180 }}>
              {row.description}
            </Typography>
          )}
        </Stack>
      )
    },
    {
      id: 'health',
      label: 'Health',
      width: 100,
      render: (row) => <HealthChip overdue={row.overdue} total={row.total} />
    },
    {
      id: 'progress',
      label: 'Progress',
      width: 150,
      sortable: true,
      sortValue: (row) => row.percent,
      render: (row) => <ProgressBar done={row.done} total={row.total} />
    },
    {
      id: 'total',
      label: 'Total',
      width: 70,
      sortable: true,
      align: 'right',
      render: (row) => <Typography variant="body2">{row.total}</Typography>
    },
    {
      id: 'done',
      label: 'Done',
      width: 70,
      sortable: true,
      align: 'right',
      render: (row) => <Typography variant="body2" color="success.main">{row.done}</Typography>
    },
    {
      id: 'open',
      label: 'Open',
      width: 70,
      sortable: true,
      align: 'right',
      render: (row) => <Typography variant="body2">{row.open}</Typography>
    },
    {
      id: 'overdue',
      label: 'Overdue',
      width: 80,
      sortable: true,
      align: 'right',
      render: (row) => (
        <Typography variant="body2" color={row.overdue > 0 ? 'error.main' : 'text.secondary'}>
          {row.overdue}
        </Typography>
      )
    }
  ];

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h5">Portfolio</Typography>
        <Typography variant="body2" color="text.secondary">
          Overview of all boards with completion progress and health indicators.
        </Typography>

        {rows.length > 0 ? (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey="id"
            size="small"
            searchable
            searchFields={['name', 'description']}
            loading={loading || boardsLoading}
            emptyTitle="No boards"
            emptyMessage="Create boards to see portfolio metrics"
            emptyIcon={IconBriefcase}
          />
        ) : (
          <EmptyState icon={IconBriefcase} title="No boards" message="Create boards to see portfolio overview" />
        )}
      </Stack>
    </Box>
  );
}
