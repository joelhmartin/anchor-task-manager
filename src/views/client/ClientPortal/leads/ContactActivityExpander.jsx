import { useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EmailIcon from '@mui/icons-material/Email';

import { fetchCalls } from 'api/calls';
import LeadActivityRow from './LeadActivityRow';

export default function ContactActivityExpander({ phone, open, onOpenLeadDetail, limit = 50 }) {
  const [state, setState] = useState({ loaded: false, loading: false, calls: [], error: null, key: null });

  useEffect(() => {
    if (!open || !phone) return;
    // Re-fetch when the contact (phone/limit) changes OR after a prior failure,
    // so stale data and transient errors don't stick on remounted expanders.
    const key = `${phone}|${limit}`;
    if (state.loading) return;
    if (state.loaded && state.key === key && !state.error) return;
    let cancelled = false;
    setState({ loaded: false, loading: true, calls: [], error: null, key });
    fetchCalls({ contact_phone: phone, limit })
      .then((data) => {
        if (cancelled) return;
        setState({ loaded: true, loading: false, calls: data.calls || [], error: null, key });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loaded: false, loading: false, calls: [], error: err?.message || 'Unable to load activity', key });
      });
    return () => {
      cancelled = true;
    };
    // state guards are intentionally omitted from deps to avoid re-running on internal state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phone, limit]);

  return (
    <Collapse in={open} timeout="auto" unmountOnExit>
      <Box sx={{ p: 1 }}>
        {!phone ? (
          <Typography variant="caption" color="text.secondary">
            No phone on file — activity history unavailable.
          </Typography>
        ) : state.loading ? (
          <LinearProgress />
        ) : state.error ? (
          <Typography variant="caption" color="error">
            {state.error}
          </Typography>
        ) : state.calls.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No activity recorded yet.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {(() => {
              const contactEmail = state.calls.find((c) => c.caller_email && String(c.caller_email).trim())?.caller_email || null;
              if (!contactEmail) return null;
              return (
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 0.5, pb: 0.25 }}>
                  <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {contactEmail}
                  </Typography>
                </Stack>
              );
            })()}
            {state.calls.map((call) => (
              <LeadActivityRow key={call.id} call={call} onOpenLeadDetail={onOpenLeadDetail} />
            ))}
          </Stack>
        )}
      </Box>
    </Collapse>
  );
}
