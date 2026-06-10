import { Chip } from '@mui/material';
import { IconHistory } from '@tabler/icons-react';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import { getTriggerLabel } from 'constants/automationTypes';

// Map workflow run statuses to StatusChip-supported keys
const RUN_STATUS_MAP = {
  running: { status: 'in_progress', label: 'Running' },
  success: { status: 'completed', label: 'Success' },
  partial: { status: 'warning', label: 'Partial' },
  error: { status: 'failed', label: 'Error' },
  skipped: { status: 'inactive', label: 'Skipped' }
};

const columns = [
  {
    id: 'status',
    label: 'Status',
    width: 100,
    sortable: true,
    render: (row) => {
      const mapped = RUN_STATUS_MAP[row.status] || {};
      return <StatusChip status={mapped.status || row.status} label={mapped.label} size="small" />;
    }
  },
  {
    id: 'trigger_type',
    label: 'Trigger',
    width: 140,
    render: (row) => <Chip label={getTriggerLabel(row.trigger_type)} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
  },
  {
    id: 'steps_progress',
    label: 'Steps',
    width: 80,
    render: (row) => {
      const completed = row.steps_completed ?? 0;
      const total = row.steps_total ?? 0;
      return `${completed}/${total}`;
    }
  },
  {
    id: 'started_at',
    label: 'Started',
    sortable: true,
    sortValue: (row) => row.started_at ? new Date(row.started_at).getTime() : 0,
    render: (row) => row.started_at ? new Date(row.started_at).toLocaleString() : '-'
  },
  {
    id: 'duration_ms',
    label: 'Duration',
    width: 90,
    render: (row) => {
      if (!row.duration_ms && row.duration_ms !== 0) return '-';
      if (row.duration_ms < 1000) return `${row.duration_ms}ms`;
      return `${(row.duration_ms / 1000).toFixed(1)}s`;
    }
  },
  {
    id: 'error',
    label: 'Error',
    render: (row) => row.error || '-'
  }
];

export default function WorkflowRunsPanel({ runs = [], loading }) {
  return (
    <DataTable
      columns={columns}
      rows={runs}
      loading={loading}
      size="small"
      outlined
      searchable
      searchFields={['status', 'trigger_type', 'error']}
      paginated
      pageSize={10}
      emptyTitle="No workflow runs yet"
      emptyMessage="Runs will appear here when automations execute"
      emptyIcon={<IconHistory size={32} />}
      defaultSort={{ id: 'started_at', direction: 'desc' }}
    />
  );
}
