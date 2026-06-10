import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import SearchIcon from '@mui/icons-material/Search';

import DataTable from 'ui-component/extended/DataTable';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import { fetchPortalEmailLogs, fetchPortalEmailDetail, exportPortalEmailCsv } from 'api/portalActivity';
import downloadBlob from 'utils/downloadBlob';
import { htmlToText } from 'utils/htmlToText';

const STATUS_OPTIONS = ['all', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'pending', 'complained', 'unsubscribed'];

const EXPORT_COLUMNS = [
  { key: 'type', label: 'Type', default: true },
  { key: 'recipient', label: 'Recipient', default: true },
  { key: 'subject', label: 'Subject', default: true },
  { key: 'status', label: 'Status', default: true },
  { key: 'sent_at', label: 'Sent', default: true },
  { key: 'delivered_at', label: 'Delivered', default: true },
  { key: 'opened_at', label: 'Opened', default: true },
  { key: 'open_count', label: 'Open count', default: true },
  { key: 'clicked_at', label: 'Clicked', default: true },
  { key: 'bounced_at', label: 'Bounced', default: true },
  { key: 'recipient_name', label: 'Recipient name', default: false },
  { key: 'text_body', label: 'Body (may contain sensitive info)', default: false }
];
const DEFAULT_EXPORT_COLUMNS = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, !!c.default]));

const prettyType = (t) => (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : '—');

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function EmailLogsPane({ triggerMessage }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ status: 'all', search: '', from: '', to: '' });

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState(DEFAULT_EXPORT_COLUMNS);

  const load = useCallback(
    async (page = 1, f = filters) => {
      setLoading(true);
      try {
        const result = await fetchPortalEmailLogs({
          page,
          limit: 50,
          status: f.status !== 'all' ? f.status : undefined,
          search: f.search || undefined,
          from: f.from || undefined,
          to: f.to || undefined
        });
        setLogs(result.logs || []);
        setPagination(result.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
      } catch (err) {
        setLogs([]);
        triggerMessage?.('error', err?.response?.data?.message || 'Unable to load email logs');
      } finally {
        setLoading(false);
      }
    },
    [filters, triggerMessage]
  );

  useEffect(() => {
    load(1, { status: 'all', search: '', from: '', to: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const applyFilters = () => load(1, filters);
  const changePage = (delta) => load(pagination.page + delta, filters);

  const openDetail = useCallback(
    async (row) => {
      setDetailLoading(true);
      setDetail({ ...row }); // show metadata immediately while the body loads
      try {
        const full = await fetchPortalEmailDetail(row.id);
        setDetail(full);
      } catch (err) {
        triggerMessage?.('error', err?.response?.data?.message || 'Unable to load email');
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [triggerMessage]
  );

  const runExport = useCallback(async () => {
    const columns = EXPORT_COLUMNS.filter((c) => exportColumns[c.key]).map((c) => c.key);
    if (!columns.length) {
      triggerMessage?.('error', 'Pick at least one column to export');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportPortalEmailCsv({ columns: columns.join(','), from: filters.from || undefined, to: filters.to || undefined });
      downloadBlob(blob, 'email-logs.csv');
      setExportDialogOpen(false);
      triggerMessage?.('success', 'Export ready');
    } catch (err) {
      triggerMessage?.('error', err?.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [exportColumns, filters, triggerMessage]);

  const columns = [
    { id: 'created_at', label: 'When', render: (row) => formatDateTime(row.created_at) },
    { id: 'email_type', label: 'Type', render: (row) => prettyType(row.email_type) },
    { id: 'recipient_email', label: 'Recipient', render: (row) => row.recipient_email || '—' },
    { id: 'subject', label: 'Subject', render: (row) => row.subject || '—' },
    { id: 'status', label: 'Status', render: (row) => <StatusChip status={row.status} /> }
  ];

  const detailBody = detail ? detail.text_body || (detail.html_body ? htmlToText(detail.html_body) : '') : '';

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Emails we&apos;ve sent on your behalf, with delivery status. Click a row to see the full message.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <TextField
          size="small"
          placeholder="Search recipient or subject…"
          value={filters.search}
          onChange={(e) => handleFilterChange('search', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 220 }}
        />
        <SelectField
          label="Status"
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          size="small"
          fullWidth={false}
          sx={{ minWidth: 150 }}
        >
          {STATUS_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
            </MenuItem>
          ))}
        </SelectField>
        <TextField
          size="small"
          type="date"
          label="From"
          value={filters.from}
          onChange={(e) => handleFilterChange('from', e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 160 }}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          value={filters.to}
          onChange={(e) => handleFilterChange('to', e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 160 }}
        />
        <Button variant="outlined" size="small" onClick={applyFilters}>
          Apply
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={() => setExportDialogOpen(true)}>
          Export CSV
        </Button>
      </Box>

      <DataTable
        columns={columns}
        rows={logs}
        rowKey="id"
        loading={loading}
        onRowClick={openDetail}
        emptyTitle="No emails yet"
        emptyMessage="Emails sent on your behalf will show up here."
      />

      {pagination.totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
          <IconButton size="small" disabled={pagination.page <= 1 || loading} onClick={() => changePage(-1)}>
            <NavigateBeforeIcon />
          </IconButton>
          <Typography variant="body2">
            Page {pagination.page} of {pagination.totalPages}
          </Typography>
          <IconButton size="small" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => changePage(1)}>
            <NavigateNextIcon />
          </IconButton>
        </Box>
      )}

      <Drawer anchor="right" open={!!detail} onClose={() => setDetail(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, p: 3 } }}>
        {detail && (
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Typography variant="h4" sx={{ pr: 2 }}>
                {detail.subject || '(no subject)'}
              </Typography>
              <IconButton size="small" onClick={() => setDetail(null)}>
                <CloseIcon />
              </IconButton>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <StatusChip status={detail.status} />
              <Typography variant="body2" color="text.secondary">
                {prettyType(detail.email_type)}
              </Typography>
            </Stack>
            <Typography variant="body2">
              <strong>To:</strong> {detail.recipient_name ? `${detail.recipient_name} <${detail.recipient_email}>` : detail.recipient_email}
            </Typography>

            <Divider />
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">Delivery timeline</Typography>
              <Typography variant="body2" color="text.secondary">
                Created: {formatDateTime(detail.created_at)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Sent: {formatDateTime(detail.sent_at)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Delivered: {formatDateTime(detail.delivered_at)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Opened: {formatDateTime(detail.opened_at)}
                {detail.open_count ? ` (${detail.open_count}×)` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Clicked: {formatDateTime(detail.clicked_at)}
              </Typography>
              {detail.bounced_at && (
                <Typography variant="body2" color="error">
                  Bounced: {formatDateTime(detail.bounced_at)}
                </Typography>
              )}
            </Stack>

            <Divider />
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">Message</Typography>
              <Box
                sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 13 }}
              >
                {detailLoading ? 'Loading…' : detailBody || 'No message body was stored for this email.'}
              </Box>
            </Stack>
          </Stack>
        )}
      </Drawer>

      <FormDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onSubmit={runExport}
        title="Export emails to CSV"
        maxWidth="xs"
        loading={exporting}
        loadingLabel="Exporting…"
        submitLabel="Export"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Exports emails matching the From/To dates above (all pages). Choose the columns to include.
        </Typography>
        <FormGroup>
          {EXPORT_COLUMNS.map((col) => (
            <FormControlLabel
              key={col.key}
              control={
                <Checkbox
                  size="small"
                  checked={!!exportColumns[col.key]}
                  onChange={(e) => setExportColumns((prev) => ({ ...prev, [col.key]: e.target.checked }))}
                />
              }
              label={col.label}
            />
          ))}
        </FormGroup>
      </FormDialog>
    </Stack>
  );
}

EmailLogsPane.propTypes = {
  triggerMessage: PropTypes.func
};
