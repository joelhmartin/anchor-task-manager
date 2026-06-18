import { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Chip, MenuItem, Stack, TextField, Typography
} from '@mui/material';
import { IconDownload, IconHistory } from '@tabler/icons-react';
import DataTable from 'ui-component/extended/DataTable';
import SelectField from 'ui-component/extended/SelectField';
import EmptyState from 'ui-component/extended/EmptyState';
import { useTaskContext } from 'contexts/TaskContext';
import { useToast } from 'contexts/ToastContext';
import { fetchAuditLog, fetchAuditEventTypes } from 'api/tasks';
import { AUDIT_EVENT_COLORS, STATUS_FALLBACK_COLOR } from 'constants/taskDefaults';

function formatEventType(type) {
  return (type || '').replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function getEventColor(eventType) {
  for (const [key, color] of Object.entries(AUDIT_EVENT_COLORS)) {
    if (eventType?.includes(key)) return color;
  }
  return STATUS_FALLBACK_COLOR;
}

const columns = [
  {
    id: 'created_at',
    label: 'When',
    width: 100,
    sortable: true,
    sortValue: (row) => row.created_at,
    render: (row) => (
      <Typography variant="caption" color="text.secondary" title={new Date(row.created_at).toLocaleString()}>
        {timeAgo(row.created_at)}
      </Typography>
    )
  },
  {
    id: 'event_type',
    label: 'Event',
    width: 160,
    sortable: true,
    render: (row) => {
      const color = getEventColor(row.event_type);
      return (
        <Chip
          label={formatEventType(row.event_type)}
          size="small"
          sx={{ height: 20, fontSize: '0.6rem', bgcolor: color + '22', borderLeft: `3px solid ${color}` }}
        />
      );
    }
  },
  {
    id: 'actor',
    label: 'By',
    width: 130,
    render: (row) => {
      const actor = row.first_name ? `${row.first_name} ${row.last_name || ''}`.trim() : row.actor_type || 'system';
      return (
        <Typography variant="caption" noWrap title={actor}>
          {actor}
        </Typography>
      );
    }
  },
  {
    id: 'item_name',
    label: 'Item',
    width: 180,
    sortable: true,
    render: (row) => (
      <Typography variant="caption" noWrap title={row.item_name}>
        {row.item_name || '—'}
      </Typography>
    )
  },
  {
    id: 'board_name',
    label: 'Board',
    width: 120,
    render: (row) => (
      <Typography variant="caption" color="text.secondary" noWrap title={row.board_name || ''}>
        {row.board_name || '—'}
      </Typography>
    )
  },
  {
    id: 'details',
    label: 'Details',
    width: 200,
    render: (row) => {
      const parts = [];
      if (row.old_value) parts.push(`from: ${JSON.stringify(row.old_value)}`);
      if (row.new_value) parts.push(`to: ${JSON.stringify(row.new_value)}`);
      const text = parts.join(' → ') || '—';
      return (
        <Typography variant="caption" color="text.secondary" noWrap title={text}>
          {text.length > 60 ? text.slice(0, 60) + '…' : text}
        </Typography>
      );
    }
  }
];

export default function AuditLogPane() {
  const { activeWorkspaceId } = useTaskContext();
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [eventTypes, setEventTypes] = useState([]);

  // Filters
  const [filterEventType, setFilterEventType] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const loadEvents = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const params = { workspace_id: activeWorkspaceId, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (filterEventType) params.event_type = filterEventType;
      const result = await fetchAuditLog(params);
      setEvents(result.events || []);
      setTotal(result.total || 0);
    } catch (err) {
      toast.error('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, filterEventType, page, toast]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetchAuditEventTypes(activeWorkspaceId).then(setEventTypes).catch(() => {});
  }, [activeWorkspaceId]);

  const handleExportCsv = () => {
    if (!events.length) return;
    const headers = ['Timestamp', 'Event', 'Actor', 'Item', 'Board', 'Old Value', 'New Value'];
    const rows = events.map((e) => [
      new Date(e.created_at).toISOString(),
      e.event_type,
      e.first_name ? `${e.first_name} ${e.last_name || ''}`.trim() : e.actor_type,
      e.item_name || '',
      e.board_name || '',
      e.old_value ? JSON.stringify(e.old_value) : '',
      e.new_value ? JSON.stringify(e.new_value) : ''
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Audit log exported');
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h5">Audit Log</Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<IconDownload size={14} />}
            onClick={handleExportCsv}
            disabled={!events.length}
          >
            Export CSV
          </Button>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Complete history of all task system changes. {total > 0 && `${total} events total.`}
        </Typography>

        {/* Filters */}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <SelectField
            label="Event Type"
            value={filterEventType}
            onChange={(e) => { setFilterEventType(e.target.value); setPage(0); }}
            size="small"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All Events</MenuItem>
            {eventTypes.map((et) => (
              <MenuItem key={et} value={et}>{formatEventType(et)}</MenuItem>
            ))}
          </SelectField>
          <Typography variant="caption" color="text.secondary">
            Showing {events.length} of {total}
          </Typography>
        </Stack>

        {/* Table */}
        {events.length > 0 ? (
          <>
            <DataTable
              columns={columns}
              rows={events}
              rowKey="id"
              size="small"
              maxHeight={500}
              stickyHeader
            />
            <Stack direction="row" spacing={1} justifyContent="center">
              <Button size="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Typography variant="caption" sx={{ lineHeight: '30px' }}>
                Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
              </Typography>
              <Button size="small" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </Stack>
          </>
        ) : !loading ? (
          <EmptyState icon={IconHistory} title="No events" message="Events will appear here as changes are made" />
        ) : null}
      </Stack>
    </Box>
  );
}
