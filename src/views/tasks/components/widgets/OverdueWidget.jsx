import { useMemo } from 'react';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import DataTable from 'ui-component/extended/DataTable';

function daysOverdue(dueDate) {
  if (!dueDate) return null;
  const now = new Date();
  const due = new Date(dueDate);
  const diff = Math.floor((now - due) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export default function OverdueWidget({ data }) {
  const columns = useMemo(() => [
    {
      id: 'name',
      label: 'Item',
      render: (row) => (
        <Typography variant="body2" noWrap sx={{ maxWidth: 200 }} title={row.name}>
          {row.name}
        </Typography>
      )
    },
    {
      id: 'status',
      label: 'Status',
      render: (row) => <Chip label={row.status || 'N/A'} size="small" variant="outlined" />
    },
    {
      id: 'due_date',
      label: 'Due Date',
      render: (row) => (
        <Typography variant="caption">
          {row.due_date ? new Date(row.due_date).toLocaleDateString() : '—'}
        </Typography>
      )
    },
    {
      id: 'overdue',
      label: 'Days Overdue',
      sortable: true,
      sortValue: (row) => daysOverdue(row.due_date) || 0,
      render: (row) => {
        const days = daysOverdue(row.due_date);
        if (days === null) return '—';
        return (
          <Chip
            label={`${days}d`}
            size="small"
            color={days > 7 ? 'error' : days > 3 ? 'warning' : 'default'}
          />
        );
      }
    }
  ], []);

  if (!data?.length) {
    return <Typography variant="body2" color="text.secondary">No overdue items. Nice work!</Typography>;
  }

  return (
    <DataTable
      columns={columns}
      rows={data}
      rowKey="id"
      size="small"
      paginated={data.length > 5}
      pageSize={5}
      defaultSort={{ id: 'overdue', direction: 'desc' }}
    />
  );
}
