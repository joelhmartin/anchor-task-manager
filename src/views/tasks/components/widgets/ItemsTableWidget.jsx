import { Chip, Typography } from '@mui/material';
import DataTable from 'ui-component/extended/DataTable';

const columns = [
  {
    id: 'name',
    label: 'Name',
    sortable: true,
    render: (row) => (
      <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
        {row.name}
      </Typography>
    )
  },
  {
    id: 'status',
    label: 'Status',
    sortable: true,
    width: 100,
    render: (row) => (
      <Chip label={row.status} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
    )
  },
  {
    id: 'board_name',
    label: 'Board',
    sortable: true,
    width: 120,
    render: (row) => (
      <Typography variant="caption" color="text.secondary" noWrap>
        {row.board_name}
      </Typography>
    )
  },
  {
    id: 'due_date',
    label: 'Due',
    sortable: true,
    width: 90,
    sortValue: (row) => row.due_date || '',
    render: (row) => {
      if (!row.due_date) return <Typography variant="caption" color="text.disabled">—</Typography>;
      const d = new Date(row.due_date);
      const overdue = d < new Date();
      return (
        <Typography variant="caption" color={overdue ? 'error.main' : 'text.secondary'}>
          {d.toLocaleDateString()}
        </Typography>
      );
    }
  }
];

export default function ItemsTableWidget({ data }) {
  if (!data?.length) {
    return <Typography variant="caption" color="text.secondary">No items found</Typography>;
  }

  return (
    <DataTable
      columns={columns}
      rows={data}
      rowKey="id"
      size="small"
      paginated
      pageSize={8}
      searchable
      searchFields={['name', 'status', 'board_name']}
      emptyTitle="No items"
      emptyMessage="No matching items found"
      maxHeight={280}
    />
  );
}
