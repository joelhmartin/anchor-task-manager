import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';

import SelectField from 'ui-component/extended/SelectField';
import StatusChip from 'ui-component/extended/StatusChip';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import ReportIcon from '@mui/icons-material/Report';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SecurityIcon from '@mui/icons-material/Security';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import VerifiedIcon from '@mui/icons-material/Verified';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';

import { fetchEmailLogs, fetchEmailLogDetail, fetchEmailStats, EMAIL_TYPE_LABELS, getEffectiveStatus } from 'api/emailLogs';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

const formatEmailDate = (dateStr) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

export default function EmailLogsSection({ active, canAccessHub }) {
  const toast = useToast();

  const [emailLogs, setEmailLogs] = useState([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [emailLogsPagination, setEmailLogsPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [emailLogsFilters, setEmailLogsFilters] = useState({ emailType: 'all', status: 'all', search: '' });
  const [emailLogDetail, setEmailLogDetail] = useState({ open: false, log: null, loading: false });
  const [emailStats, setEmailStats] = useState(null);

  const reportError = useCallback(
    (err, fallback) => {
      const msg = getErrorMessage(err, fallback);
      toast.error(msg);
    },
    [toast]
  );

  const loadEmailLogs = useCallback(async () => {
    if (!canAccessHub) return;
    setEmailLogsLoading(true);
    try {
      const result = await fetchEmailLogs({
        page: emailLogsPagination.page,
        limit: emailLogsPagination.limit,
        emailType: emailLogsFilters.emailType,
        status: emailLogsFilters.status,
        search: emailLogsFilters.search
      });
      setEmailLogs(result.logs || []);
      setEmailLogsPagination((prev) => ({ ...prev, ...result.pagination }));
    } catch (err) {
      reportError(err, 'Unable to load email logs');
    } finally {
      setEmailLogsLoading(false);
    }
  }, [canAccessHub, emailLogsPagination.page, emailLogsPagination.limit, emailLogsFilters, reportError]);

  const loadEmailStats = useCallback(async () => {
    try {
      const result = await fetchEmailStats(30);
      setEmailStats(result.stats || []);
    } catch (err) {
      console.error('Failed to load email stats', err);
      toast.error('Failed to load email statistics');
    }
  }, [toast]);

  useEffect(() => {
    if (active && canAccessHub) {
      loadEmailLogs();
      loadEmailStats();
    }
  }, [active, canAccessHub, loadEmailLogs, loadEmailStats]);

  // Reload email logs when filters/pagination change
  useEffect(() => {
    if (active && canAccessHub) {
      loadEmailLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailLogsFilters, emailLogsPagination.page, emailLogsPagination.limit]);

  const handleViewEmailLog = async (log) => {
    setEmailLogDetail({ open: true, log: null, loading: true });
    try {
      const detail = await fetchEmailLogDetail(log.id);
      setEmailLogDetail({ open: true, log: detail, loading: false });
    } catch (err) {
      reportError(err, 'Unable to load email detail');
      setEmailLogDetail({ open: false, log: null, loading: false });
    }
  };

  const handleEmailLogsFilterChange = (key, value) => {
    setEmailLogsFilters((prev) => ({ ...prev, [key]: value }));
    setEmailLogsPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleEmailLogsPageChange = (event, newPage) => {
    setEmailLogsPagination((prev) => ({ ...prev, page: newPage + 1 }));
  };

  const handleEmailLogsRowsPerPageChange = (event) => {
    setEmailLogsPagination((prev) => ({ ...prev, limit: parseInt(event.target.value, 10), page: 1 }));
  };

  const emailStatsSummary = useMemo(() => {
    if (!emailStats || !emailStats.length) return { sent: 0, failed: 0, pending: 0, byType: {} };
    const summary = { sent: 0, failed: 0, pending: 0, byType: {} };
    emailStats.forEach((row) => {
      const count = parseInt(row.count, 10);
      if (row.status === 'sent') summary.sent += count;
      else if (row.status === 'failed') summary.failed += count;
      else if (row.status === 'pending') summary.pending += count;
      if (!summary.byType[row.email_type]) summary.byType[row.email_type] = 0;
      summary.byType[row.email_type] += count;
    });
    return summary;
  }, [emailStats]);

  if (!active) return null;

  return (
    <>
      <Stack spacing={3}>
        {/* Stats Summary */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Card variant="outlined" sx={{ minWidth: 140, flex: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <CheckCircleIcon color="success" />
                <Box>
                  <Typography variant="h4" color="success.main">
                    {emailStatsSummary.sent}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Sent (30d)
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ minWidth: 140, flex: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <ErrorIcon color="error" />
                <Box>
                  <Typography variant="h4" color="error.main">
                    {emailStatsSummary.failed}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Failed (30d)
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ minWidth: 140, flex: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <ScheduleIcon color="warning" />
                <Box>
                  <Typography variant="h4" color="warning.main">
                    {emailStatsSummary.pending}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Pending
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Box>

        {/* Filters */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <TextField
            size="small"
            placeholder="Search emails..."
            value={emailLogsFilters.search}
            onChange={(e) => handleEmailLogsFilterChange('search', e.target.value)}
            sx={{ minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <MailOutlineIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
          <SelectField label="Type" value={emailLogsFilters.emailType} onChange={(e) => handleEmailLogsFilterChange('emailType', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 150 }}>
            <MenuItem value="all">All Types</MenuItem>
            {Object.entries(EMAIL_TYPE_LABELS).map(([key, label]) => (
              <MenuItem key={key} value={key}>
                {label}
              </MenuItem>
            ))}
          </SelectField>
          <SelectField label="Status" value={emailLogsFilters.status} onChange={(e) => handleEmailLogsFilterChange('status', e.target.value)} size="small" fullWidth={false} sx={{ minWidth: 120 }}
            options={[{ value: 'all', label: 'All Statuses' }, { value: 'sent', label: 'Sent' }, { value: 'failed', label: 'Failed' }, { value: 'pending', label: 'Pending' }]}
          />
          <Button variant="outlined" size="small" onClick={loadEmailLogs} disabled={emailLogsLoading}>
            {emailLogsLoading ? 'Loading...' : 'Refresh'}
          </Button>
        </Stack>

        {/* Email Logs Table */}
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          {emailLogsLoading && <LinearProgress />}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Recipient</TableCell>
                  <TableCell>Subject</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Tracking</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {emailLogs.map((log) => (
                  <TableRow key={log.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="body2">{formatEmailDate(log.created_at)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={EMAIL_TYPE_LABELS[log.email_type] || log.email_type} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {log.recipient_name || log.recipient_email}
                      </Typography>
                      {log.recipient_name && (
                        <Typography variant="caption" color="text.secondary">
                          {log.recipient_email}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography variant="body2" noWrap>
                        {log.subject}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const effectiveStatus = getEffectiveStatus(log);
                        const statusIcon =
                          effectiveStatus === 'delivered' ? (
                            <CheckCircleIcon />
                          ) : effectiveStatus === 'sent' ? (
                            <MarkEmailReadIcon />
                          ) : effectiveStatus === 'bounced' || effectiveStatus === 'failed' ? (
                            <ErrorIcon />
                          ) : effectiveStatus === 'complained' ? (
                            <ReportIcon />
                          ) : (
                            <ScheduleIcon />
                          );
                        return (
                          <StatusChip
                            status={effectiveStatus}
                            icon={statusIcon}
                            variant="outlined"
                          />
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Tooltip title={log.opened_at ? `Opened ${log.open_count || 1}x` : 'Not opened'}>
                          <VisibilityIcon fontSize="small" color={log.opened_at ? 'info' : 'disabled'} />
                        </Tooltip>
                        <Tooltip title={log.clicked_at ? `Clicked ${log.click_count || 1}x` : 'No clicks'}>
                          <TouchAppIcon fontSize="small" color={log.clicked_at ? 'primary' : 'disabled'} />
                        </Tooltip>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="View Details">
                        <IconButton size="small" onClick={() => handleViewEmailLog(log)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!emailLogs.length && !emailLogsLoading && (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Typography color="text.secondary" sx={{ py: 3 }}>
                        No email logs found
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={emailLogsPagination.total}
            page={emailLogsPagination.page - 1}
            onPageChange={handleEmailLogsPageChange}
            rowsPerPage={emailLogsPagination.limit}
            onRowsPerPageChange={handleEmailLogsRowsPerPageChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Box>
      </Stack>

      {/* Email Detail Dialog */}
      <Dialog
        open={emailLogDetail.open}
        onClose={() => setEmailLogDetail({ open: false, log: null, loading: false })}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h5">Email Details</Typography>
            {emailLogDetail.log && (
              <StatusChip
                status={emailLogDetail.log.status}
                icon={
                  emailLogDetail.log.status === 'sent' ? (
                    <CheckCircleIcon />
                  ) : emailLogDetail.log.status === 'failed' ? (
                    <ErrorIcon />
                  ) : (
                    <ScheduleIcon />
                  )
                }
              />
            )}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {emailLogDetail.loading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress />
              <Typography sx={{ mt: 2 }}>Loading email details...</Typography>
            </Stack>
          ) : emailLogDetail.log ? (
            <Stack spacing={3}>
              {/* Basic Info */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Email Type
                </Typography>
                <Chip
                  label={EMAIL_TYPE_LABELS[emailLogDetail.log.email_type] || emailLogDetail.log.email_type}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Divider />
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Recipient
                  </Typography>
                  <Typography>{emailLogDetail.log.recipient_name || '—'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {emailLogDetail.log.recipient_email}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Sent At
                  </Typography>
                  <Typography>{formatEmailDate(emailLogDetail.log.sent_at || emailLogDetail.log.created_at)}</Typography>
                </Grid>
              </Grid>
              {emailLogDetail.log.cc_emails?.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    CC
                  </Typography>
                  <Typography variant="body2">{emailLogDetail.log.cc_emails.join(', ')}</Typography>
                </Box>
              )}
              <Divider />
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Subject
                </Typography>
                <Typography>{emailLogDetail.log.subject}</Typography>
              </Box>

              {/* Error Message if failed */}
              {(emailLogDetail.log.status === 'failed' || emailLogDetail.log.bounced_at) && emailLogDetail.log.error_message && (
                <Alert severity="error">
                  <Typography variant="subtitle2">Error Message</Typography>
                  <Typography variant="body2">{emailLogDetail.log.error_message}</Typography>
                  {emailLogDetail.log.bounce_type && (
                    <Typography variant="caption" color="text.secondary">
                      Bounce type: {emailLogDetail.log.bounce_type}{' '}
                      {emailLogDetail.log.bounce_code && `(${emailLogDetail.log.bounce_code})`}
                    </Typography>
                  )}
                </Alert>
              )}

              {/* Delivery & Tracking Section */}
              <Divider />
              <Box>
                <Typography variant="subtitle1" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MarkEmailReadIcon fontSize="small" /> Delivery & Tracking
                </Typography>
                <Grid container spacing={2}>
                  {/* Delivery Status */}
                  <Grid item xs={6} sm={3}>
                    <Stack alignItems="center" spacing={0.5}>
                      {emailLogDetail.log.delivered_at ? (
                        <CheckCircleIcon color="success" />
                      ) : emailLogDetail.log.bounced_at ? (
                        <ErrorIcon color="error" />
                      ) : (
                        <ScheduleIcon color="disabled" />
                      )}
                      <Typography variant="caption" fontWeight="medium">
                        Delivered
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {emailLogDetail.log.delivered_at
                          ? new Date(emailLogDetail.log.delivered_at).toLocaleString()
                          : emailLogDetail.log.bounced_at
                            ? 'Bounced'
                            : 'Pending'}
                      </Typography>
                    </Stack>
                  </Grid>

                  {/* Opened */}
                  <Grid item xs={6} sm={3}>
                    <Stack alignItems="center" spacing={0.5}>
                      <VisibilityIcon color={emailLogDetail.log.opened_at ? 'info' : 'disabled'} />
                      <Typography variant="caption" fontWeight="medium">
                        Opened
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {emailLogDetail.log.opened_at
                          ? `${emailLogDetail.log.open_count || 1}x — ${new Date(emailLogDetail.log.opened_at).toLocaleString()}`
                          : '—'}
                      </Typography>
                    </Stack>
                  </Grid>

                  {/* Clicked */}
                  <Grid item xs={6} sm={3}>
                    <Stack alignItems="center" spacing={0.5}>
                      <TouchAppIcon color={emailLogDetail.log.clicked_at ? 'primary' : 'disabled'} />
                      <Typography variant="caption" fontWeight="medium">
                        Clicked
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {emailLogDetail.log.clicked_at
                          ? `${emailLogDetail.log.click_count || 1}x — ${new Date(emailLogDetail.log.clicked_at).toLocaleString()}`
                          : '—'}
                      </Typography>
                    </Stack>
                  </Grid>

                  {/* Spam / Complaints */}
                  <Grid item xs={6} sm={3}>
                    <Stack alignItems="center" spacing={0.5}>
                      <ReportIcon color={emailLogDetail.log.complained_at ? 'error' : 'disabled'} />
                      <Typography variant="caption" fontWeight="medium">
                        Spam Report
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {emailLogDetail.log.complained_at ? new Date(emailLogDetail.log.complained_at).toLocaleString() : '—'}
                      </Typography>
                    </Stack>
                  </Grid>
                </Grid>
              </Box>

              {/* Authentication / Security Status (DKIM, DMARC, SPF) */}
              {emailLogDetail.log.delivery_status && Object.keys(emailLogDetail.log.delivery_status).length > 0 && (
                <Box>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    gutterBottom
                    sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <SecurityIcon fontSize="small" /> Authentication & Delivery Details
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Grid container spacing={2}>
                      {/* TLS Encryption */}
                      {emailLogDetail.log.delivery_status.tls !== undefined && (
                        <Grid item xs={6} sm={4}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {emailLogDetail.log.delivery_status.tls ? (
                              <VerifiedIcon color="success" fontSize="small" />
                            ) : (
                              <CancelIcon color="warning" fontSize="small" />
                            )}
                            <Box>
                              <Typography variant="caption" fontWeight="medium">
                                TLS
                              </Typography>
                              <Typography variant="caption" display="block" color="text.secondary">
                                {emailLogDetail.log.delivery_status.tls ? 'Encrypted' : 'Not encrypted'}
                              </Typography>
                            </Box>
                          </Stack>
                        </Grid>
                      )}

                      {/* Certificate Verified */}
                      {emailLogDetail.log.delivery_status.certificate_verified !== undefined && (
                        <Grid item xs={6} sm={4}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {emailLogDetail.log.delivery_status.certificate_verified ? (
                              <VerifiedIcon color="success" fontSize="small" />
                            ) : (
                              <CancelIcon color="warning" fontSize="small" />
                            )}
                            <Box>
                              <Typography variant="caption" fontWeight="medium">
                                Certificate
                              </Typography>
                              <Typography variant="caption" display="block" color="text.secondary">
                                {emailLogDetail.log.delivery_status.certificate_verified ? 'Verified' : 'Not verified'}
                              </Typography>
                            </Box>
                          </Stack>
                        </Grid>
                      )}

                      {/* UTF-8 */}
                      {emailLogDetail.log.delivery_status.utf8 !== undefined && (
                        <Grid item xs={6} sm={4}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            {emailLogDetail.log.delivery_status.utf8 ? (
                              <VerifiedIcon color="success" fontSize="small" />
                            ) : (
                              <CancelIcon color="disabled" fontSize="small" />
                            )}
                            <Box>
                              <Typography variant="caption" fontWeight="medium">
                                UTF-8
                              </Typography>
                              <Typography variant="caption" display="block" color="text.secondary">
                                {emailLogDetail.log.delivery_status.utf8 ? 'Enabled' : 'Disabled'}
                              </Typography>
                            </Box>
                          </Stack>
                        </Grid>
                      )}

                      {/* MX Host */}
                      {emailLogDetail.log.delivery_status.mx_host && (
                        <Grid item xs={12} sm={6}>
                          <Typography variant="caption" fontWeight="medium">
                            MX Host
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {emailLogDetail.log.delivery_status.mx_host}
                          </Typography>
                        </Grid>
                      )}

                      {/* Session Seconds */}
                      {emailLogDetail.log.delivery_status.session_seconds !== undefined && (
                        <Grid item xs={6} sm={3}>
                          <Typography variant="caption" fontWeight="medium">
                            Session Time
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary">
                            {emailLogDetail.log.delivery_status.session_seconds}s
                          </Typography>
                        </Grid>
                      )}

                      {/* Attempt Number */}
                      {emailLogDetail.log.delivery_status.attempt_no !== undefined && (
                        <Grid item xs={6} sm={3}>
                          <Typography variant="caption" fontWeight="medium">
                            Attempt
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary">
                            #{emailLogDetail.log.delivery_status.attempt_no}
                          </Typography>
                        </Grid>
                      )}

                      {/* Delivery Code & Message */}
                      {emailLogDetail.log.delivery_status.code && (
                        <Grid item xs={12}>
                          <Typography variant="caption" fontWeight="medium">
                            Response Code
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {emailLogDetail.log.delivery_status.code}
                            {emailLogDetail.log.delivery_status.message && ` — ${emailLogDetail.log.delivery_status.message}`}
                          </Typography>
                        </Grid>
                      )}

                      {/* Envelope Info */}
                      {emailLogDetail.log.delivery_status.envelope && (
                        <Grid item xs={12}>
                          <Typography variant="caption" fontWeight="medium">
                            Envelope
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {emailLogDetail.log.delivery_status.envelope.sending_ip &&
                              `IP: ${emailLogDetail.log.delivery_status.envelope.sending_ip}`}
                            {emailLogDetail.log.delivery_status.envelope.transport &&
                              ` | Transport: ${emailLogDetail.log.delivery_status.envelope.transport}`}
                          </Typography>
                        </Grid>
                      )}

                      {/* Client Info (from open/click) */}
                      {emailLogDetail.log.delivery_status.client_info && (
                        <Grid item xs={12}>
                          <Typography variant="caption" fontWeight="medium">
                            Last Interaction
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary">
                            {emailLogDetail.log.delivery_status.device_type && `${emailLogDetail.log.delivery_status.device_type} — `}
                            {emailLogDetail.log.delivery_status.client_info?.['client-os'] || ''}{' '}
                            {emailLogDetail.log.delivery_status.client_info?.['client-name'] || ''}
                            {emailLogDetail.log.delivery_status.geolocation && (
                              <>
                                {' '}
                                ({emailLogDetail.log.delivery_status.geolocation.city},{' '}
                                {emailLogDetail.log.delivery_status.geolocation.country})
                              </>
                            )}
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </Paper>
                </Box>
              )}

              {/* Mailgun Info */}
              {emailLogDetail.log.mailgun_id && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Mailgun ID
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {emailLogDetail.log.mailgun_id}
                  </Typography>
                </Box>
              )}

              <Divider />

              {/* Email Content */}
              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Email Content
                </Typography>
                {emailLogDetail.log.html_body ? (
                  <Paper variant="outlined" sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(emailLogDetail.log.html_body) }} />
                  </Paper>
                ) : emailLogDetail.log.text_body ? (
                  <Paper variant="outlined" sx={{ p: 2, maxHeight: 400, overflow: 'auto' }}>
                    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', m: 0 }}>
                      {emailLogDetail.log.text_body}
                    </Typography>
                  </Paper>
                ) : (
                  <Typography color="text.secondary" fontStyle="italic">
                    No content available
                  </Typography>
                )}
              </Box>

              {/* Metadata */}
              {emailLogDetail.log.metadata && Object.keys(emailLogDetail.log.metadata).length > 0 && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Metadata
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography
                      variant="body2"
                      component="pre"
                      sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', m: 0, fontSize: '0.75rem' }}
                    >
                      {JSON.stringify(emailLogDetail.log.metadata, null, 2)}
                    </Typography>
                  </Paper>
                </Box>
              )}

              {/* Triggered By / Client Info */}
              <Divider />
              <Grid container spacing={2}>
                {emailLogDetail.log.triggered_by_email && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Triggered By
                    </Typography>
                    <Typography>
                      {emailLogDetail.log.triggered_by_first_name} {emailLogDetail.log.triggered_by_last_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {emailLogDetail.log.triggered_by_email}
                    </Typography>
                  </Grid>
                )}
                {emailLogDetail.log.client_email && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Related Client
                    </Typography>
                    <Typography>
                      {emailLogDetail.log.client_first_name} {emailLogDetail.log.client_last_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {emailLogDetail.log.client_email}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmailLogDetail({ open: false, log: null, loading: false })}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
