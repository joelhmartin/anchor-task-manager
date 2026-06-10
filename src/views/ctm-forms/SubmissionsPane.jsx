/**
 * SubmissionsPane — View CTM form submissions for a client
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EmailIcon from '@mui/icons-material/Email';
import ReplayIcon from '@mui/icons-material/Replay';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LockOpenIcon from '@mui/icons-material/LockOpen';

import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import ConfirmDialog from 'ui-component/extended/ConfirmDialog';
import CircularProgress from '@mui/material/CircularProgress';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { listClientSubmissions, listCtmFormSubmissions, retryCtmSubmission, resendSubmissionEmail, releaseCtmSubmission } from 'api/ctmForms';

function formatPhone(raw) {
  if (!raw) return '—';
  const digits = String(raw).replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length === 10) return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return raw;
}

// Human-readable labels for block_reason (mirrors server BLOCK_REASON_LABELS).
const BLOCK_REASON_LABELS = {
  recaptcha_missing_token: 'reCAPTCHA: no token (privacy browser / blocker)',
  recaptcha_low_score: 'reCAPTCHA: low score (likely bot)',
  recaptcha_invalid_token: 'reCAPTCHA: invalid token',
  recaptcha_action_mismatch: 'reCAPTCHA: action mismatch',
  recaptcha_service_unavailable: 'reCAPTCHA: service unavailable',
  recaptcha_failed: 'reCAPTCHA: failed',
  ai_spam: 'AI spam filter',
  heuristic_spam: 'Heuristic spam filter'
};

function blockReasonLabel(r) {
  if (r.block_reason && BLOCK_REASON_LABELS[r.block_reason]) return BLOCK_REASON_LABELS[r.block_reason];
  if (r.block_reason) return r.block_reason;
  const rc = r.recaptcha_json;
  if (rc && rc.passed === false) return `reCAPTCHA: ${rc.reason || 'failed'}`;
  return 'Spam filter';
}

// Diagnostic info for a flagged submission. Distinguishes a *review* outcome (accepted +
// forwarded to CTM, just flagged for a human) from a *held* outcome (spam, not forwarded).
// Prefers the first-class block_reason; falls back to recaptcha_json for legacy rows.
function blockInfo(r) {
  const rc = r.recaptcha_json;
  const isRecaptcha = (r.block_reason && r.block_reason.startsWith('recaptcha')) || (rc && rc.passed === false);
  const score = rc && typeof rc.score === 'number' ? `, score ${rc.score.toFixed(2)}` : '';
  const isReview = r.status === 'review' && !r.spam;
  return {
    chip: isRecaptcha ? 'reCAPTCHA' : 'Spam',
    tip: isReview
      ? `Flagged for review — ${blockReasonLabel(r)}${score}. Forwarded to CTM; no action required unless it looks like spam.`
      : `Held — ${blockReasonLabel(r)}${score}. Stored; not forwarded to CTM. Release it to recover the lead.`
  };
}

export default function SubmissionsPane({ forms, initialFormId, onBack }) {
  const { showToast } = useToast();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showSpam, setShowSpam] = useState(false);
  const [retryingId, setRetryingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [releasingId, setReleasingId] = useState(null);
  const [confirmRelease, setConfirmRelease] = useState(null);

  // Derive the client ID from the forms list
  const clientId = forms[0]?.org_id || '';

  const load = useCallback(async () => {
    try {
      setLoading(true);
      let data;
      if (initialFormId) {
        // Single-form mode (linked from form actions)
        data = await listCtmFormSubmissions(initialFormId);
        // Attach form name
        const form = forms.find(f => f.id === initialFormId);
        if (form) data = data.map(r => ({ ...r, form_name: r.form_name || form.name }));
      } else if (clientId) {
        // Client-wide mode
        data = await listClientSubmissions(clientId);
      } else {
        data = [];
      }
      setSubmissions(data);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [clientId, initialFormId, forms, showToast]);

  useEffect(() => { load(); }, [load]);

  const handleRetryCtm = useCallback(async (submissionId) => {
    try {
      setRetryingId(submissionId);
      await retryCtmSubmission(submissionId);
      showToast('Submission sent to CTM', 'success');
      // Update the local row so UI reflects immediately
      setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, ctm_sent: true, ctm_error: null } : s));
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRetryingId(null);
    }
  }, [showToast]);

  const handleResendEmail = useCallback(async (submissionId) => {
    try {
      setResendingId(submissionId);
      await resendSubmissionEmail(submissionId);
      showToast('Notification emails resent', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setResendingId(null);
    }
  }, [showToast]);

  const handleRelease = useCallback(async (submissionId) => {
    try {
      setReleasingId(submissionId);
      const res = await releaseCtmSubmission(submissionId);
      setSubmissions(prev => prev.map(s => s.id === submissionId
        ? { ...s, spam: false, status: 'released', ctm_sent: res.ctmForwarded ? true : s.ctm_sent, ctm_error: res.ctmForwarded ? null : (res.ctmError || s.ctm_error || null) }
        : s));
      if (res.ctmForwarded) showToast('Lead released and sent to CTM', 'success');
      else showToast(`Lead released. CTM not sent${res.ctmError ? `: ${res.ctmError}` : ''}.`, 'info');
      setConfirmRelease(null);
      setDetail(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setReleasingId(null);
    }
  }, [showToast]);

  const visibleRows = useMemo(() => showSpam ? submissions : submissions.filter(r => !r.spam), [submissions, showSpam]);
  const spamCount = useMemo(() => submissions.filter(r => r.spam).length, [submissions]);

  const columns = useMemo(() => [
    {
      id: 'created_at', label: 'Date', sortable: true,
      sortValue: (r) => new Date(r.created_at).getTime(),
      render: (r) => <Typography variant="body2">{new Date(r.created_at).toLocaleString()}</Typography>
    },
    {
      id: 'form_name', label: 'Form', sortable: true,
      render: (r) => <Typography variant="body2">{r.form_name || '—'}</Typography>
    },
    {
      id: 'name', label: 'Name', sortable: true,
      sortValue: (r) => r.field_data?.caller_name || r.field_data?.name || '',
      render: (r) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2">{r.field_data?.caller_name || r.field_data?.name || '—'}</Typography>
          {r.spam && <Tooltip title={blockInfo(r).tip}><Chip label={blockInfo(r).chip} size="small" color="warning" /></Tooltip>}
        </Stack>
      )
    },
    {
      id: 'email', label: 'Email',
      render: (r) => <Typography variant="body2">{r.field_data?.email || '—'}</Typography>
    },
    {
      id: 'phone', label: 'Phone',
      render: (r) => <Typography variant="body2">{formatPhone(r.field_data?.phone_number)}</Typography>
    },
    {
      id: 'status', label: 'Status', sortable: true,
      sortValue: (r) => r.status || (r.spam ? 'held' : 'received'),
      render: (r) => {
        const key = r.status || (r.spam ? 'held' : 'received');
        const chip = <StatusChip status={key} size="small" variant="outlined" />;
        if (key === 'held' || key === 'review') {
          return <Tooltip title={blockInfo(r).tip}>{chip}</Tooltip>;
        }
        return chip;
      }
    },
    {
      id: 'ctm', label: 'CTM',
      render: (r) => {
        if (r.spam) {
          // Held — offer a one-click Release that marks it legitimate + forwards to CTM.
          return (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Tooltip title={blockInfo(r).tip}><Chip label="Held" size="small" color="warning" variant="outlined" /></Tooltip>
              <Tooltip title="Release lead (mark legitimate + send to CTM)">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); setConfirmRelease(r); }} disabled={releasingId === r.id}>
                  {releasingId === r.id ? <CircularProgress size={16} /> : <LockOpenIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Stack>
          );
        }
        if (r.ctm_sent) return <Chip label="Sent" size="small" color="success" variant="outlined" />;
        // Not sent — show retry button (with error tooltip if available)
        if (r.ctm_reactor_id) {
          return (
            <Stack direction="row" spacing={0.5} alignItems="center">
              {r.ctm_error
                ? <Tooltip title={r.ctm_error}><Chip label="Error" size="small" color="error" variant="outlined" /></Tooltip>
                : <Chip label="Pending" size="small" variant="outlined" />
              }
              <Tooltip title="Retry CTM">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleRetryCtm(r.id); }} disabled={retryingId === r.id}>
                  {retryingId === r.id ? <CircularProgress size={16} /> : <ReplayIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Stack>
          );
        }
        return <Chip label="—" size="small" variant="outlined" />;
      }
    },
    {
      id: 'email_sent', label: 'Notifications',
      render: (r) => {
        const emails = r.notification_emails || [];
        if (emails.length === 0) return '—';
        const delivered = emails.filter(e => e.delivered_at).length;
        const bounced = emails.filter(e => e.bounced_at).length;
        const chip = bounced > 0
          ? <Chip label={`${delivered}/${emails.length} delivered, ${bounced} bounced`} size="small" color="warning" variant="outlined" />
          : delivered === emails.length
            ? <Chip label={`${emails.length} sent`} size="small" color="success" variant="outlined" />
            : <Chip label={`${emails.length} sent`} size="small" color="info" variant="outlined" />;
        if (bounced > 0 || emails.some(e => e.status === 'failed')) {
          return (
            <Stack direction="row" spacing={0.5} alignItems="center">
              {chip}
              <Tooltip title="Resend Emails">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleResendEmail(r.id); }} disabled={resendingId === r.id}>
                  {resendingId === r.id ? <CircularProgress size={16} /> : <EmailIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Stack>
          );
        }
        return chip;
      }
    },
    {
      id: 'actions', label: '', align: 'right',
      render: (r) => (
        <Tooltip title="View Details">
          <IconButton size="small" onClick={() => setDetail(r)}><VisibilityIcon fontSize="small" /></IconButton>
        </Tooltip>
      )
    }
  ], [handleRetryCtm, retryingId, handleResendEmail, resendingId, releasingId]);

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} alignItems="center">
        {onBack && (
          <IconButton onClick={onBack} size="small"><ArrowBackIcon /></IconButton>
        )}
        <Typography variant="h5">Submissions</Typography>
        {initialFormId && forms.find(f => f.id === initialFormId) && (
          <Chip label={forms.find(f => f.id === initialFormId).name} size="small" variant="outlined" />
        )}
        <Box sx={{ flex: 1 }} />
        {spamCount > 0 && (
          <Button size="small" variant={showSpam ? 'contained' : 'outlined'} color="warning" onClick={() => setShowSpam(v => !v)}>
            {showSpam ? 'Hide Spam' : `Show Spam (${spamCount})`}
          </Button>
        )}
      </Stack>

      <DataTable
        columns={columns}
        rows={visibleRows}
        loading={loading}
        outlined
        paginated
        pageSize={25}
        searchable
        searchFields={['form_name', (r) => r.field_data?.caller_name || r.field_data?.name, (r) => r.field_data?.email, (r) => r.field_data?.phone_number]}
        emptyTitle="No submissions yet."
        emptyMessage="Submissions will appear here once forms receive entries."
      />

      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Submission Details</DialogTitle>
        <DialogContent>
          {detail && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Typography variant="subtitle2">Fields</Typography>
              {Object.entries(detail.field_data || {}).map(([k, v]) => {
                const isPhone = k === 'phone_number' || k === 'phone';
                const display = isPhone ? formatPhone(v) : (Array.isArray(v) ? v.join(', ') : String(v));
                return (
                  <Stack key={k} direction="row" spacing={2}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>{k}:</Typography>
                    <Typography variant="body2">{display}</Typography>
                  </Stack>
                );
              })}
              {detail.attribution_json && Object.keys(detail.attribution_json).length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Attribution</Typography>
                  {Object.entries(detail.attribution_json).filter(([, v]) => v).map(([k, v]) => (
                    <Stack key={k} direction="row" spacing={2}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>{k}:</Typography>
                      <Typography variant="body2">{String(v)}</Typography>
                    </Stack>
                  ))}
                </>
              )}
              {(detail.notification_emails || []).length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Notification Emails</Typography>
                  {detail.notification_emails.map((em) => (
                    <Stack key={em.id} direction="row" spacing={2} alignItems="center">
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>{em.recipient_email}</Typography>
                      <Chip
                        label={em.bounced_at ? 'Bounced' : em.delivered_at ? 'Delivered' : em.sent_at ? 'Sent' : em.status || 'Pending'}
                        size="small"
                        variant="outlined"
                        color={em.bounced_at ? 'error' : em.delivered_at ? 'success' : em.sent_at ? 'info' : 'default'}
                      />
                      {em.opened_at && <Chip label="Opened" size="small" variant="outlined" color="primary" />}
                    </Stack>
                  ))}
                </>
              )}
              {Array.isArray(detail.analytics_log) && detail.analytics_log.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Analytics Events</Typography>
                  {detail.analytics_log.map((entry, i) => (
                    <Stack key={i} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 60, fontWeight: 500 }}>{entry.type}</Typography>
                      <Chip
                        label={entry.status}
                        size="small"
                        variant="outlined"
                        color={entry.status === 'fired' ? 'success' : entry.status === 'skipped' ? 'warning' : entry.status === 'error' ? 'error' : 'default'}
                      />
                      {entry.send_to && <Typography variant="caption" color="text.secondary">{entry.send_to}</Typography>}
                      {entry.event && <Typography variant="caption" color="text.secondary">{entry.event}</Typography>}
                      {entry.reason && <Typography variant="caption" color="error.main">{entry.reason}</Typography>}
                      {entry.error && <Typography variant="caption" color="error.main">{entry.error}</Typography>}
                    </Stack>
                  ))}
                </>
              )}
              {(detail.recaptcha_json || detail.block_reason) && (
                <>
                  <Typography variant="subtitle2" sx={{ pt: 1 }}>Spam / reCAPTCHA</Typography>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>Outcome:</Typography>
                    <StatusChip status={detail.status || (detail.spam ? 'held' : 'received')} size="small" variant="outlined" />
                  </Stack>
                  {detail.block_reason && (
                    <Stack direction="row" spacing={2}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>Reason:</Typography>
                      <Typography variant="body2">{blockReasonLabel(detail)}</Typography>
                    </Stack>
                  )}
                  {detail.recaptcha_json && (
                    <Stack direction="row" spacing={2}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120, fontWeight: 500 }}>reCAPTCHA:</Typography>
                      <Typography variant="body2">
                        {detail.recaptcha_json.passed ? 'passed' : 'failed'}
                        {typeof detail.recaptcha_json.score === 'number' ? `, score ${detail.recaptcha_json.score.toFixed(2)}` : ''}
                        {detail.recaptcha_json.reason ? `, ${detail.recaptcha_json.reason}` : ''}
                        {detail.recaptcha_json.valid === false ? ', token invalid' : ''}
                      </Typography>
                    </Stack>
                  )}
                </>
              )}
              {detail.ctm_trackback_id && (
                <Typography variant="caption" color="text.secondary">CTM Trackback: {detail.ctm_trackback_id}</Typography>
              )}
              {detail.ctm_error && !detail.ctm_sent && (
                <Typography variant="caption" color="error.main">CTM error: {detail.ctm_error}</Typography>
              )}
              <Typography variant="caption" color="text.secondary">Submitted: {new Date(detail.created_at).toLocaleString()}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {detail && detail.spam && (
            <Button color="success" startIcon={<LockOpenIcon />} onClick={() => setConfirmRelease(detail)}>Release Lead</Button>
          )}
          <Button onClick={() => setDetail(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRelease}
        onClose={() => setConfirmRelease(null)}
        onConfirm={() => confirmRelease && handleRelease(confirmRelease.id)}
        title="Release this lead?"
        message="This marks the submission as legitimate, forwards it to CTM, and sends the team notification it never got while held."
        secondaryText={confirmRelease ? `Held by: ${blockReasonLabel(confirmRelease)}` : ''}
        confirmLabel="Release & Send"
        confirmColor="success"
        loading={!!releasingId}
        loadingLabel="Releasing…"
      />
    </Stack>
  );
}
