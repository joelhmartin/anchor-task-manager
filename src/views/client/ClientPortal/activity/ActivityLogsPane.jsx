import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import DownloadIcon from '@mui/icons-material/Download';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import SearchIcon from '@mui/icons-material/Search';

import DataTable from 'ui-component/extended/DataTable';
import FormDialog from 'ui-component/extended/FormDialog';
import SelectField from 'ui-component/extended/SelectField';
import { getActionLabel, getCategoryLabel, getCategoryColor, formatActivityDetails, CATEGORY_LABELS } from 'api/activityLogs';
import { fetchPortalActivityLogs, exportPortalActivityCsv } from 'api/portalActivity';
import downloadBlob from 'utils/downloadBlob';

const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date', default: true },
  { key: 'actor', label: 'Team member', default: true },
  { key: 'action', label: 'Action', default: true },
  { key: 'category', label: 'Category', default: true },
  { key: 'entity', label: 'Entity', default: false },
  { key: 'details', label: 'Details', default: false }
];
const DEFAULT_EXPORT_COLUMNS = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.key, !!c.default]));

const actorLabel = (log) => {
  const name = `${log.user_first_name || ''} ${log.user_last_name || ''}`.trim();
  return name || log.user_email || '—';
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function ActivityLogsPane({ triggerMessage }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ category: 'all', search: '', from: '', to: '' });

  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState(DEFAULT_EXPORT_COLUMNS);

  const load = useCallback(
    async (page = 1, f = filters) => {
      setLoading(true);
      try {
        const result = await fetchPortalActivityLogs({
          page,
          limit: 50,
          category: f.category !== 'all' ? f.category : undefined,
          search: f.search || undefined,
          from: f.from || undefined,
          to: f.to || undefined
        });
        setLogs(result.logs || []);
        setPagination(result.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
      } catch (err) {
        setLogs([]);
        triggerMessage?.('error', err?.response?.data?.message || 'Unable to load activity logs');
      } finally {
        setLoading(false);
      }
    },
    [filters, triggerMessage]
  );

  useEffect(() => {
    load(1, { category: 'all', search: '', from: '', to: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const applyFilters = () => load(1, filters);
  const changePage = (delta) => load(pagination.page + delta, filters);

  const runExport = useCallback(async () => {
    const columns = EXPORT_COLUMNS.filter((c) => exportColumns[c.key]).map((c) => c.key);
    if (!columns.length) {
      triggerMessage?.('error', 'Pick at least one column to export');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportPortalActivityCsv({
        columns: columns.join(','),
        from: filters.from || undefined,
        to: filters.to || undefined
      });
      downloadBlob(blob, 'activity-logs.csv');
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
    { id: 'actor', label: 'Team member', render: (row) => actorLabel(row) },
    { id: 'action_type', label: 'Action', render: (row) => getActionLabel(row.action_type) },
    {
      id: 'action_category',
      label: 'Category',
      render: (row) => <Chip label={getCategoryLabel(row.action_category)} size="small" color={getCategoryColor(row.action_category)} />
    },
    { id: 'details', label: 'Details', render: (row) => formatActivityDetails(row) || '—' }
  ];

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Everything you and your team have done across the dashboard. Logs are retained for the last ~30 days.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <TextField
          size="small"
          placeholder="Search actions…"
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
          sx={{ minWidth: 200 }}
        />
        <SelectField
          label="Category"
          value={filters.category}
          onChange={(e) => handleFilterChange('category', e.target.value)}
          size="small"
          fullWidth={false}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="all">All Categories</MenuItem>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <MenuItem key={key} value={key}>
              {label}
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
        emptyTitle="No activity yet"
        emptyMessage="Actions you and your team take will show up here."
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

      <FormDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        onSubmit={runExport}
        title="Export activity to CSV"
        maxWidth="xs"
        loading={exporting}
        loadingLabel="Exporting…"
        submitLabel="Export"
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Exports activity matching the From/To dates above (all pages). Choose the columns to include.
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

ActivityLogsPane.propTypes = {
  triggerMessage: PropTypes.func
};
