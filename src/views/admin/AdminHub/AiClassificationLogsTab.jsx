import { useCallback, useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
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

import SelectField from 'ui-component/extended/SelectField';
import {
  AI_CLASSIFICATION_REVIEW_STATUS_LABELS,
  AI_CLASSIFICATION_STAGE_LABELS,
  LEAD_CATEGORY_LABELS,
  fetchAiClassificationLogs,
  getAiClassificationReviewStatusLabel,
  getAiClassificationStageLabel,
  getLeadCategoryCanonical,
  getLeadCategoryLabel,
  updateAiClassificationLogReview
} from 'api/activityLogs';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

const SOURCE_TYPE_OPTIONS = {
  call: 'Call',
  form: 'Form'
};

const CATEGORY_COLOR_MAP = {
  lead: 'success',
  needs_attention: 'warning',
  unanswered: 'default',
  not_a_fit: 'warning',
  spam: 'error',
  pending_review: 'default'
};

const REVIEW_STATUS_COLOR_MAP = {
  new: 'default',
  flagged: 'error',
  reviewed: 'success',
  ignored: 'default'
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function truncate(value, max = 140) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '—';
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export default function AiClassificationLogsTab({ clientId, active }) {
  const toast = useToast();
  const clientIdRef = useRef(clientId);

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [filters, setFilters] = useState({
    callId: '',
    stage: 'all',
    sourceType: 'all',
    category: 'all',
    reviewStatus: 'all',
    startDate: '',
    endDate: ''
  });
  const [loaded, setLoaded] = useState(false);
  const [detailEntry, setDetailEntry] = useState(null);
  const [reviewDraft, setReviewDraft] = useState({ reviewStatus: 'new', reviewNotes: '' });
  const [savingReview, setSavingReview] = useState(false);

  useEffect(() => {
    clientIdRef.current = clientId;
  }, [clientId]);

  const reportError = useCallback(
    (err, fallback) => {
      toast.error(getErrorMessage(err, fallback));
    },
    [toast]
  );

  const loadLogs = useCallback(
    async (userId, page = 1, nextFilters = {}) => {
      if (!userId) return;
      setLoading(true);
      try {
        const result = await fetchAiClassificationLogs(userId, {
          page,
          limit: 50,
          callId: nextFilters.callId || undefined,
          stage: nextFilters.stage,
          sourceType: nextFilters.sourceType,
          category: nextFilters.category,
          reviewStatus: nextFilters.reviewStatus,
          startDate: nextFilters.startDate || undefined,
          endDate: nextFilters.endDate || undefined
        });
        if (clientIdRef.current !== userId) return;
        setLogs(result.logs || []);
        setPagination(result.pagination || { page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
      } catch (err) {
        if (clientIdRef.current !== userId) return;
        setLogs([]);
        setPagination({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
        reportError(err, 'Unable to load AI classification logs');
      } finally {
        if (clientIdRef.current === userId) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [reportError]
  );

  useEffect(() => {
    if (active && clientId && !loaded && !loading) {
      loadLogs(clientId, 1, filters);
    }
  }, [active, clientId, filters, loaded, loading, loadLogs]);

  useEffect(() => {
    setLoaded(false);
    setLogs([]);
    setPagination({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
    setDetailEntry(null);
  }, [clientId]);

  if (!active) return null;

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleSearch = () => {
    loadLogs(clientId, 1, filters);
  };

  const handlePageChange = (nextPage) => {
    loadLogs(clientId, nextPage, filters);
  };

  const openDetail = (entry) => {
    setDetailEntry(entry);
    setReviewDraft({
      reviewStatus: entry.review_status || 'new',
      reviewNotes: entry.review_notes || ''
    });
  };

  const handleSaveReview = async () => {
    if (!detailEntry?.id) return;
    setSavingReview(true);
    try {
      const result = await updateAiClassificationLogReview(detailEntry.id, reviewDraft);
      const nextStatus = result?.entry?.review_status || reviewDraft.reviewStatus;
      const nextNotes = result?.entry?.review_notes || reviewDraft.reviewNotes;
      const nextReviewedAt = result?.entry?.reviewed_at || detailEntry.reviewed_at;
      setLogs((prev) =>
        prev.map((item) =>
          item.id === detailEntry.id
            ? {
                ...item,
                review_status: nextStatus,
                review_notes: nextNotes,
                reviewed_at: nextReviewedAt
              }
            : item
        )
      );
      setDetailEntry((prev) =>
        prev
          ? {
              ...prev,
              review_status: nextStatus,
              review_notes: nextNotes,
              reviewed_at: nextReviewedAt
            }
          : prev
      );
      toast.success('AI classification review updated');
    } catch (err) {
      reportError(err, 'Unable to update AI classification review');
    } finally {
      setSavingReview(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Typography variant="subtitle1">AI Classification Review</Typography>
      <Typography variant="body2" color="text.secondary">
        Review recent AI decisions, flag bad examples, and inspect the exact input, reasoning, and output. Logs are retained for 30 days.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <TextField
          size="small"
          placeholder="Call ID"
          value={filters.callId}
          onChange={(e) => handleFilterChange('callId', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            )
          }}
          sx={{ minWidth: 180 }}
        />
        <SelectField label="Stage" value={filters.stage} onChange={(e) => handleFilterChange('stage', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 160 }}>
          <MenuItem value="all">All Stages</MenuItem>
          {Object.entries(AI_CLASSIFICATION_STAGE_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </SelectField>
        <SelectField label="Source" value={filters.sourceType} onChange={(e) => handleFilterChange('sourceType', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 140 }}>
          <MenuItem value="all">All Sources</MenuItem>
          {Object.entries(SOURCE_TYPE_OPTIONS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </SelectField>
        <SelectField label="Category" value={filters.category} onChange={(e) => handleFilterChange('category', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 170 }}>
          <MenuItem value="all">All Categories</MenuItem>
          {Object.entries(LEAD_CATEGORY_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </SelectField>
        <SelectField label="Review" value={filters.reviewStatus} onChange={(e) => handleFilterChange('reviewStatus', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 150 }}>
          <MenuItem value="all">All Statuses</MenuItem>
          {Object.entries(AI_CLASSIFICATION_REVIEW_STATUS_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>
              {label}
            </MenuItem>
          ))}
        </SelectField>
        <TextField
          size="small"
          type="date"
          label="From"
          value={filters.startDate}
          onChange={(e) => handleFilterChange('startDate', e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 150 }}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          value={filters.endDate}
          onChange={(e) => handleFilterChange('endDate', e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 150 }}
        />
        <Button variant="contained" size="small" onClick={handleSearch} disabled={loading}>
          Search
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!loading && logs.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No AI classification logs found for this account.
        </Typography>
      )}

      {!loading && logs.length > 0 && (
        <>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date/Time</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Score</TableCell>
                  <TableCell>Review</TableCell>
                  <TableCell>Summary</TableCell>
                  <TableCell>Reasoning</TableCell>
                  <TableCell>Input</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((entry) => (
                  <TableRow key={entry.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.created_at)}</TableCell>
                    <TableCell>
                      <Chip label={getAiClassificationStageLabel(entry.stage)} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>{SOURCE_TYPE_OPTIONS[entry.source_type] || entry.source_type || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={getLeadCategoryLabel(entry.final_category)}
                        size="small"
                        color={CATEGORY_COLOR_MAP[getLeadCategoryCanonical(entry.final_category)] || 'default'}
                      />
                    </TableCell>
                    <TableCell>{entry.score ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={getAiClassificationReviewStatusLabel(entry.review_status)}
                        size="small"
                        color={REVIEW_STATUS_COLOR_MAP[entry.review_status] || 'default'}
                        variant={entry.review_status === 'new' ? 'outlined' : 'filled'}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Tooltip title={entry.summary || '—'} arrow>
                        <span>{truncate(entry.summary, 100)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Tooltip title={entry.reasoning || '—'} arrow>
                        <span>{truncate(entry.reasoning, 110)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Tooltip title={entry.input || '—'} arrow>
                        <span>{truncate(entry.input, 120)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => openDetail(entry)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Showing {logs.length} of {pagination.total} entries
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" startIcon={<NavigateBeforeIcon />} disabled={pagination.page <= 1} onClick={() => handlePageChange(pagination.page - 1)}>
                Previous
              </Button>
              <Typography variant="body2">
                Page {pagination.page} of {pagination.totalPages}
              </Typography>
              <Button size="small" endIcon={<NavigateNextIcon />} disabled={!pagination.hasMore} onClick={() => handlePageChange(pagination.page + 1)}>
                Next
              </Button>
            </Stack>
          </Box>
        </>
      )}

      <Dialog open={Boolean(detailEntry)} onClose={() => setDetailEntry(null)} fullWidth maxWidth="lg">
        <DialogTitle>AI Classification Detail</DialogTitle>
        <DialogContent dividers>
          {detailEntry && (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={getAiClassificationStageLabel(detailEntry.stage)} variant="outlined" />
                <Chip label={getLeadCategoryLabel(detailEntry.final_category)} color={CATEGORY_COLOR_MAP[getLeadCategoryCanonical(detailEntry.final_category)] || 'default'} />
                <Chip
                  label={getAiClassificationReviewStatusLabel(reviewDraft.reviewStatus)}
                  color={REVIEW_STATUS_COLOR_MAP[reviewDraft.reviewStatus] || 'default'}
                  variant={reviewDraft.reviewStatus === 'new' ? 'outlined' : 'filled'}
                />
                {detailEntry.is_referral ? <Chip label="Referral" color="info" variant="outlined" /> : null}
                {detailEntry.requires_callback ? <Chip label="Needs Callback" color="warning" variant="outlined" /> : null}
                {detailEntry.score !== null && detailEntry.score !== undefined ? <Chip label={`Score ${detailEntry.score}`} variant="outlined" /> : null}
              </Box>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField label="Call ID" value={detailEntry.call_id || ''} fullWidth InputProps={{ readOnly: true }} />
                <TextField label="Created" value={formatDateTime(detailEntry.created_at)} fullWidth InputProps={{ readOnly: true }} />
                <TextField label="Model" value={detailEntry.model || ''} fullWidth InputProps={{ readOnly: true }} />
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField label="Source Type" value={SOURCE_TYPE_OPTIONS[detailEntry.source_type] || detailEntry.source_type || ''} fullWidth InputProps={{ readOnly: true }} />
                <TextField label="Activity Type" value={detailEntry.activity_type || ''} fullWidth InputProps={{ readOnly: true }} />
                <TextField label="Provider" value={detailEntry.provider || ''} fullWidth InputProps={{ readOnly: true }} />
              </Stack>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(detailEntry.system_tags || []).map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" />
                ))}
                {(detailEntry.adjustments || []).map((item) => (
                  <Chip key={item} label={item} size="small" color="warning" variant="outlined" />
                ))}
              </Box>

              <TextField label="Summary" value={detailEntry.summary || ''} fullWidth multiline minRows={2} InputProps={{ readOnly: true }} />
              <TextField label="Reasoning" value={detailEntry.reasoning || ''} fullWidth multiline minRows={3} InputProps={{ readOnly: true }} />
              <TextField label="Input" value={detailEntry.input || ''} fullWidth multiline minRows={6} InputProps={{ readOnly: true }} />
              <TextField label="Prompt" value={detailEntry.prompt || ''} fullWidth multiline minRows={4} InputProps={{ readOnly: true }} />
              <TextField label="Raw AI Response" value={detailEntry.raw_response || ''} fullWidth multiline minRows={4} InputProps={{ readOnly: true }} />
              <TextField
                label="Metadata"
                value={JSON.stringify(detailEntry.metadata || {}, null, 2)}
                fullWidth
                multiline
                minRows={5}
                InputProps={{ readOnly: true, sx: { fontFamily: 'monospace' } }}
              />

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <SelectField
                  label="Review Status"
                  value={reviewDraft.reviewStatus}
                  onChange={(e) => setReviewDraft((prev) => ({ ...prev, reviewStatus: e.target.value }))}
                  size="small"
                  fullWidth
                >
                  {Object.entries(AI_CLASSIFICATION_REVIEW_STATUS_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </SelectField>
                <TextField
                  label="Review Notes"
                  value={reviewDraft.reviewNotes}
                  onChange={(e) => setReviewDraft((prev) => ({ ...prev, reviewNotes: e.target.value }))}
                  fullWidth
                  multiline
                  minRows={2}
                />
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailEntry(null)} color="secondary">
            Close
          </Button>
          <Button onClick={handleSaveReview} variant="contained" disabled={savingReview || !detailEntry}>
            {savingReview ? 'Saving…' : 'Save Review'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
