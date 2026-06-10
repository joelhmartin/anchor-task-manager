import { useCallback, useEffect, useRef, useState } from 'react';

import SelectField from 'ui-component/extended/SelectField';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import SearchIcon from '@mui/icons-material/Search';

import {
  fetchUserActivityLogs,
  getActionLabel,
  getCategoryLabel,
  getCategoryColor,
  formatActivityDetails,
  CATEGORY_LABELS
} from 'api/activityLogs';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

export default function ActivityLogsTab({ clientId, active }) {
  const toast = useToast();
  const clientIdRef = useRef(clientId);

  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLogsLoading, setActivityLogsLoading] = useState(false);
  const [activityLogsPagination, setActivityLogsPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [activityLogsFilters, setActivityLogsFilters] = useState({ category: 'all', search: '', startDate: '', endDate: '' });
  const [activityLogsLoaded, setActivityLogsLoaded] = useState(false);

  // Keep ref in sync so async callbacks can check for staleness
  useEffect(() => {
    clientIdRef.current = clientId;
  }, [clientId]);

  const reportError = useCallback(
    (err, fallback) => {
      const msg = getErrorMessage(err, fallback);
      toast.error(msg);
    },
    [toast]
  );

  const loadActivityLogs = useCallback(
    async (userId, page = 1, filters = {}) => {
      if (!userId) return;
      setActivityLogsLoading(true);
      try {
        const result = await fetchUserActivityLogs(userId, {
          page,
          limit: 50,
          category: filters.category !== 'all' ? filters.category : undefined,
          search: filters.search || undefined,
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
          scope: 'account'
        });
        // Discard response if clientId changed while the fetch was in flight
        if (clientIdRef.current !== userId) return;
        setActivityLogs(result.logs || []);
        setActivityLogsPagination(result.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
      } catch (err) {
        if (clientIdRef.current !== userId) return;
        setActivityLogs([]);
        setActivityLogsPagination({ page: 1, limit: 50, total: 0, totalPages: 1 });
        reportError(err, 'Unable to load activity logs');
      } finally {
        if (clientIdRef.current === userId) {
          setActivityLogsLoading(false);
          setActivityLogsLoaded(true);
        }
      }
    },
    [reportError]
  );

  // Load activity logs when tab is selected
  useEffect(() => {
    if (active && clientId && !activityLogsLoaded && !activityLogsLoading) {
      loadActivityLogs(clientId, 1, activityLogsFilters);
    }
  }, [active, clientId, activityLogsLoaded, activityLogsLoading, loadActivityLogs, activityLogsFilters]);

  // Reset activity logs when user changes
  useEffect(() => {
    setActivityLogsLoaded(false);
    setActivityLogs([]);
    setActivityLogsPagination({ page: 1, limit: 50, total: 0, totalPages: 1 });
  }, [clientId]);

  if (!active) return null;

  const handleActivitySearch = () => {
    loadActivityLogs(clientId, 1, activityLogsFilters);
  };

  const handleActivityFilterChange = (key, value) => {
    const newFilters = { ...activityLogsFilters, [key]: value };
    setActivityLogsFilters(newFilters);
  };

  const handleActivityPageChange = (newPage) => {
    loadActivityLogs(clientId, newPage, activityLogsFilters);
  };

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Typography variant="subtitle1">User Activity Log</Typography>
      <Typography variant="body2" color="text.secondary">
        View all activity from this account&apos;s team members. Logs are retained for 30 days.
      </Typography>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <TextField
          size="small"
          placeholder="Search actions..."
          value={activityLogsFilters.search}
          onChange={(e) => handleActivityFilterChange('search', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleActivitySearch()}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 200 }}
        />
        <SelectField label="Category" value={activityLogsFilters.category} onChange={(e) => handleActivityFilterChange('category', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 150 }}>
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
          value={activityLogsFilters.startDate}
          onChange={(e) => handleActivityFilterChange('startDate', e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 150 }}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          value={activityLogsFilters.endDate}
          onChange={(e) => handleActivityFilterChange('endDate', e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 150 }}
        />
        <Button variant="contained" size="small" onClick={handleActivitySearch} disabled={activityLogsLoading}>
          Search
        </Button>
      </Box>

      {/* Loading */}
      {activityLogsLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Results */}
      {!activityLogsLoading && activityLogs.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No activity logs found for this user.
        </Typography>
      )}

      {!activityLogsLoading && activityLogs.length > 0 && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date/Time</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>IP Address</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {activityLogs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      })}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {log.user_first_name || log.user_last_name
                        ? `${log.user_first_name || ''} ${log.user_last_name || ''}`.trim()
                        : log.user_email || '—'}
                    </TableCell>
                    <TableCell>{getActionLabel(log.action_type)}</TableCell>
                    <TableCell>
                      <Chip label={getCategoryLabel(log.action_category)} size="small" color={getCategoryColor(log.action_category)} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{log.ip_address || '—'}</TableCell>
                    <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Tooltip title={formatActivityDetails(log)} arrow>
                        <span>{formatActivityDetails(log)}</span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Pagination */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Showing {activityLogs.length} of {activityLogsPagination.total} entries
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                startIcon={<NavigateBeforeIcon />}
                disabled={activityLogsPagination.page <= 1}
                onClick={() => handleActivityPageChange(activityLogsPagination.page - 1)}
              >
                Previous
              </Button>
              <Typography variant="body2">
                Page {activityLogsPagination.page} of {activityLogsPagination.totalPages}
              </Typography>
              <Button
                size="small"
                endIcon={<NavigateNextIcon />}
                disabled={!activityLogsPagination.hasMore}
                onClick={() => handleActivityPageChange(activityLogsPagination.page + 1)}
              >
                Next
              </Button>
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}
