import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import CircularProgress from '@mui/material/CircularProgress';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { fetchLeadDetail, fetchLeadRecordingBlob } from 'api/calls';
import LeadActivityRow from './LeadActivityRow';

// Read-only activity viewer reused wherever an activity row is clickable (contacts timeline,
// and ready for the leads board). Shows the full call transcript + recording, or the parsed
// form-fill fields for forms, plus the AI summary and prior activity. The transcript/form
// rendering mirrors the Leads detail drawer (LeadsTab.jsx) so behavior stays consistent.

// Parse form-submission transcripts (label:/value:/id: blocks). Order-agnostic: dashboard
// forms emit label → value → id; CTM FormReactor emits value → id → label. Start a new block
// whenever a key we've already seen reappears.
const parseFormTranscript = (text) => {
  if (!text || !text.includes('label:') || !text.includes('value:')) return null;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  let current = {};
  const flush = () => {
    if (current.label && current.value !== undefined) rows.push(current);
    current = {};
  };
  for (const line of lines) {
    const m = line.match(/^(label|value|id):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (current[key] !== undefined) flush();
    current[key] = val.trim();
  }
  flush();
  return rows.length ? rows : null;
};

// Only humanize machine-style values (snake_case tokens); free text shows verbatim.
const formatValue = (val) => {
  if (typeof val !== 'string' || !val) return val;
  const isToken = !/\s/.test(val) && /_/.test(val) && val === val.toLowerCase();
  if (!isToken) return val;
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Parse dialogue lines: "SPEAKER: text" (phone-number speakers → Agent).
const parseTranscriptLines = (text) => {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const turns = [];
  for (const line of lines) {
    const idx = line.indexOf(': ');
    if (idx > 0) {
      const rawSpeaker = line.slice(0, idx).trim();
      const body = line.slice(idx + 2).trim();
      const isPhone = /^[+\d][\d\s\-().]{6,}$/.test(rawSpeaker);
      turns.push({ speaker: isPhone ? 'Agent' : rawSpeaker, text: body, isAgent: isPhone });
    }
  }
  return turns;
};

const formatPhoneLite = (raw) => {
  if (!raw) return '';
  const d = String(raw).replace(/[^0-9]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
};

const FormTable = ({ rows }) => (
  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380, overflowY: 'auto' }}>
    <Table size="small">
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i} sx={{ '&:last-child td': { border: 0 } }}>
            <TableCell sx={{ color: 'text.secondary', width: '60%', verticalAlign: 'top', py: 1 }}>{row.label}</TableCell>
            <TableCell sx={{ fontWeight: 500, verticalAlign: 'top', py: 1 }}>{formatValue(row.value)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableContainer>
);

// The transcript / form / message body — the same precedence the Leads drawer uses.
function ActivityBody({ lead }) {
  const transcriptContent =
    lead.transcript || lead.transcription_text || lead.transcription?.text || lead.meta?.transcript || null;

  const formRows = parseFormTranscript(transcriptContent);
  if (formRows) return <FormTable rows={formRows} />;

  if (transcriptContent) {
    const turns = parseTranscriptLines(transcriptContent);
    if (turns.length > 1) {
      return (
        <Box sx={{ maxHeight: 380, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {turns.map((turn, i) => (
            <Box
              key={i}
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: turn.isAgent ? 'primary.lighter' : 'grey.100',
                borderLeft: turn.isAgent ? '3px solid' : 'none',
                borderColor: 'primary.main'
              }}
            >
              <Typography
                variant="caption"
                fontWeight={700}
                color={turn.isAgent ? 'primary.dark' : 'text.secondary'}
                display="block"
                gutterBottom
              >
                {turn.speaker}
              </Typography>
              <Typography variant="body2">{turn.text}</Typography>
            </Box>
          ))}
        </Box>
      );
    }
    return (
      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', maxHeight: 380, overflow: 'auto' }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          {transcriptContent}
        </Typography>
      </Paper>
    );
  }

  // No transcript but a message (form submission or voicemail)
  if (lead.message && !lead.message.includes('Call from') && lead.message.length > 20) {
    const messageFormRows = parseFormTranscript(lead.message);
    if (messageFormRows) return <FormTable rows={messageFormRows} />;
    return (
      <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', maxHeight: 380, overflowY: 'auto' }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {lead.message}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        {lead.is_voicemail
          ? 'This was a voicemail. No transcript available.'
          : lead.duration_sec && lead.duration_sec < 10
            ? 'Call was too short to generate a transcript.'
            : 'No transcript available for this activity.'}
      </Typography>
    </Paper>
  );
}

export default function ActivityDetailDrawer({ open, call, onClose }) {
  const toast = useToast();
  const callId = call?.call_id || call?.id || null;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState({ loading: false, src: null, error: null });
  const objectUrlRef = useRef(null);
  // Monotonic id to discard recording responses that resolve after the user switched activities.
  const recordingReqRef = useRef(0);

  const cleanupRecording = useCallback(() => {
    recordingReqRef.current += 1; // invalidate any in-flight recording fetch
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setRecording({ loading: false, src: null, error: null });
  }, []);

  // Fetch the authoritative detail (transcript lives on detail.lead) whenever a new activity opens.
  useEffect(() => {
    if (!open || !callId) return undefined;
    let active = true;
    setDetail(null);
    setLoading(true);
    cleanupRecording();
    fetchLeadDetail(callId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((err) => {
        if (active) toast.error(err?.message || 'Unable to load activity details');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, callId, toast, cleanupRecording]);

  // Revoke any blob URL on unmount.
  useEffect(() => () => cleanupRecording(), [cleanupRecording]);

  const handleLoadRecording = useCallback(async () => {
    if (!callId) return;
    const reqId = ++recordingReqRef.current;
    setRecording((p) => ({ ...p, loading: true, error: null }));
    try {
      const blob = await fetchLeadRecordingBlob(callId);
      if (reqId !== recordingReqRef.current) return; // a newer activity/cleanup superseded this
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setRecording({ loading: false, src: url, error: null });
    } catch (err) {
      if (reqId !== recordingReqRef.current) return;
      setRecording({ loading: false, src: null, error: err?.response?.data?.message || err?.message || 'No recording available' });
    }
  }, [callId]);

  // detail.lead is the authoritative record for the BODY (it carries the transcript), but the
  // builder (buildCallsFromCache) doesn't set activity_type / form_name / time_ago — those live
  // on the timeline row. Merge: detail.lead wins for content, the timeline row fills the gaps.
  // While the fetch is in flight, fall back to the timeline row so the header renders instantly.
  const lead = detail?.lead
    ? {
        ...call,
        ...detail.lead,
        activity_type: call?.activity_type || detail.lead.activity_type,
        form_name: detail.lead.form_name || call?.form_name,
        time_ago: detail.lead.time_ago || call?.time_ago,
        caller_number: detail.lead.caller_number || call?.caller_number,
        caller_email: detail.lead.caller_email || call?.caller_email,
        contact_display_name: detail.lead.contact_display_name || call?.contact_display_name,
        contact_name_source: detail.lead.contact_name_source || call?.contact_name_source
      }
    : call || null;
  const isCall = (lead?.activity_type || 'call') === 'call';
  const callHistory = detail?.callHistory || [];

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: '46vw' }, p: 0 } }}>
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Typography variant="h5" fontWeight={600}>
            {isCall ? 'Call detail' : 'Activity detail'}
          </Typography>
          <IconButton onClick={onClose} aria-label="Close activity detail">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
          {lead && <LeadActivityRow call={lead} />}

          <Stack spacing={0.5} sx={{ mt: 1.5 }}>
            {lead?.caller_number && (
              <Typography variant="body2" color="text.secondary">
                <PhoneIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
                {formatPhoneLite(lead.caller_number)}
              </Typography>
            )}
            {lead?.caller_email && (
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                <EmailIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
                {lead.caller_email}
              </Typography>
            )}
            {lead?.id && (
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                ID - {lead.id}
              </Typography>
            )}
          </Stack>

          {loading && !detail && (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          )}

          {lead && (
            <>
              {isCall && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Call Recording
                  </Typography>
                  {recording.src ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio controls src={recording.src} style={{ width: '100%' }} />
                  ) : (
                    <LoadingButton
                      size="small"
                      variant="outlined"
                      loading={recording.loading}
                      loadingLabel="Loading…"
                      onClick={handleLoadRecording}
                    >
                      Load recording
                    </LoadingButton>
                  )}
                  {recording.error && (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                      {recording.error}
                    </Typography>
                  )}
                </Box>
              )}

              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {isCall ? 'Call Transcript' : 'Form Submission'}
                </Typography>
                <ActivityBody lead={lead} />
              </Box>

              {lead.classification_summary && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    AI Summary
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography variant="body2">{lead.classification_summary}</Typography>
                  </Paper>
                </Box>
              )}

              {callHistory.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Previous activity from this contact ({callHistory.length})
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
                    {callHistory.map((h, i) => (
                      <Box
                        key={h.call_id || i}
                        sx={{
                          p: 1.25,
                          borderBottom: i < callHistory.length - 1 ? '1px solid' : 'none',
                          borderColor: 'divider'
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                          <Typography variant="body2" sx={{ minWidth: 0 }}>
                            {h.summary || h.category || (h.activity_type === 'form' ? 'Form submission' : 'Call')}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                            {h.started_at ? new Date(h.started_at).toLocaleDateString() : ''}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                  </Paper>
                </Box>
              )}
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
