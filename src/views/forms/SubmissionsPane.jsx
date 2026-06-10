/**
 * SubmissionsPane — View form submissions with detail dialog.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Alert,
  Stack,
  Tooltip,
  Typography
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';

import DataTable from 'ui-component/extended/DataTable';
import SelectField from 'ui-component/extended/SelectField';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { listFormSubmissions, getSubmissionDetail } from 'api/forms';

export default function SubmissionsPane({ forms, initialFormId }) {
  const { showToast } = useToast();
  const [selectedFormId, setSelectedFormId] = useState(initialFormId || '');
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const activeForms = forms.filter((f) => f.status !== 'archived');

  const loadSubmissions = useCallback(async (formId) => {
    if (!formId) { setSubmissions([]); return; }
    try {
      setLoading(true);
      const subs = await listFormSubmissions(formId);
      setSubmissions(subs);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (selectedFormId) loadSubmissions(selectedFormId);
  }, [selectedFormId, loadSubmissions]);

  const openDetail = async (submissionId) => {
    try {
      setDetailLoading(true);
      setDetailOpen(true);
      const sub = await getSubmissionDetail(submissionId);
      setDetail(sub);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleFormChange = (formId) => {
    setSelectedFormId(formId);
    setSubmissions([]);
  };

  const submissionColumns = useMemo(() => [
    {
      id: 'created_at', label: 'Date',
      render: (row) => <Typography variant="body2">{new Date(row.created_at).toLocaleString()}</Typography>
    },
    {
      id: 'name_email', label: 'Name/Email',
      render: (row) => {
        const data = row.field_data || row.submission_data || {};
        const display = data.name || data.first_name || data.caller_name || data.email || 'Anonymous';
        return <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>{display}</Typography>;
      }
    },
    {
      id: 'submitted_from_domain', label: 'Domain',
      render: (row) => <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>{row.submitted_from_domain || '-'}</Typography>
    },
    {
      id: 'attribution_source', label: 'Source',
      render: (row) => row.attribution_source ? <Chip label={row.attribution_source} size="small" /> : '-'
    },
    {
      id: 'ctm_sent', label: 'CTM',
      render: (row) => row.ctm_sent ? <Chip label="Sent" size="small" color="success" variant="outlined" /> : null
    },
    {
      id: 'actions', label: 'Actions', align: 'right',
      render: (row) => (
        <Tooltip title="View Details">
          <IconButton size="small" onClick={() => openDetail(row.id)}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )
    }
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Form Submissions</Typography>

      <SelectField label="Select Form" value={selectedFormId} onChange={(e) => handleFormChange(e.target.value)} fullWidth={false} sx={{ maxWidth: 400 }}>
        <MenuItem value="">— Select a form —</MenuItem>
        {activeForms.map((f) => (
          <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
        ))}
      </SelectField>

      {!selectedFormId ? (
        <Alert severity="info">Select a form to view its submissions.</Alert>
      ) : (
        <DataTable
          columns={submissionColumns}
          rows={submissions}
          loading={loading}
          outlined
          paginated
          pageSize={25}
          emptyTitle="No submissions yet for this form."
        />
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onClose={() => { setDetailOpen(false); setDetail(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>Submission Details</DialogTitle>
        <DialogContent>
          {detailLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : detail ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="subtitle2">Field Values</Typography>
              {Object.entries(detail.field_data || detail.submission_data || {}).map(([key, value]) => (
                <Stack key={key} direction="row" spacing={2}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>
                    {key}:
                  </Typography>
                  <Typography variant="body2">{String(value)}</Typography>
                </Stack>
              ))}

              {(detail.attribution_data || detail.submitted_from_domain) && (
                <>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Attribution</Typography>
                  {detail.submitted_from_domain && (
                    <Stack direction="row" spacing={2}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>Domain:</Typography>
                      <Typography variant="body2">{detail.submitted_from_domain}</Typography>
                    </Stack>
                  )}
                  {detail.attribution_data && Object.entries(detail.attribution_data).map(([key, value]) => (
                    value ? (
                      <Stack key={key} direction="row" spacing={2}>
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>
                          {key}:
                        </Typography>
                        <Typography variant="body2">{String(value)}</Typography>
                      </Stack>
                    ) : null
                  ))}
                </>
              )}

              <Typography variant="caption" color="text.secondary">
                Submitted: {new Date(detail.created_at).toLocaleString()}
              </Typography>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDetailOpen(false); setDetail(null); }}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
