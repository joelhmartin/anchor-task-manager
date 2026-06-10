import { useEffect, useRef, useState } from 'react';
import { Autocomplete, Box, Stack, TextField, Typography, Alert } from '@mui/material';
import apiClient from 'api/client';
import { useToast } from 'contexts/ToastContext';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { testRunAiTemplate, getRun, getRunItem } from 'api/aiReports';
import WebReportRenderer from 'views/admin/AdminHub/reports/ai/WebReportRenderer';

const todayStr = () => new Date().toISOString().slice(0, 10);
const oneMonthAgoStr = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export default function AiTestRunPanel({ templateId, draftFingerprint, onBeforeRun, onRunComplete }) {
  const { showToast } = useToast();
  const [clients, setClients] = useState([]);
  const [client, setClient] = useState(null);
  const [from, setFrom] = useState(oneMonthAgoStr());
  const [to, setTo] = useState(todayStr());
  const [running, setRunning] = useState(false);
  const [payload, setPayload] = useState(null);
  const [runError, setRunError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    apiClient.get('/hub/clients', { params: { role: 'client' } })
      .then((res) => {
        const list = res.data.clients || res.data;
        setClients(Array.isArray(list) ? list.filter((c) => c.role === 'client') : []);
      })
      .catch(() => {
        showToast('Failed to load clients', 'error');
      });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleRun = async () => {
    if (!client) {
      showToast('Select a client first', 'error');
      return;
    }
    if (!from || !to || new Date(from) > new Date(to)) {
      showToast('Select a valid date range', 'error');
      return;
    }
    setRunning(true);
    setPayload(null);
    setRunError(null);
    if (onRunComplete) onRunComplete(null);
    try {
      // Persist the editor's current form state before kicking off the test run.
      // The test-run endpoint reads the template's draft from the DB, so without
      // this auto-save the user would test against stale values.
      if (onBeforeRun) {
        try {
          await onBeforeRun();
        } catch (saveErr) {
          const msg = saveErr.response?.data?.error || saveErr.message || 'Failed to save before test run';
          setRunError(msg);
          showToast(msg, 'error');
          setRunning(false);
          return;
        }
      }
      const run = await testRunAiTemplate(templateId, {
        clientId: client.id,
        dateRange: { from, to }
      });

      // Bound the polling at 90 attempts (≈135s) so a stuck Vertex call
      // doesn't leak background HTTP traffic for the life of the editor.
      const MAX_POLL_ATTEMPTS = 90;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        if (attempts > MAX_POLL_ATTEMPTS) {
          stopPolling();
          const msg = 'Test run timed out after 135 seconds. Try again or check server logs.';
          setRunError(msg);
          showToast(msg, 'error');
          setRunning(false);
          return;
        }
        try {
          const updated = await getRun(run.id);
          const items = updated.items || [];
          const item = items[0];
          if (!item) return;

          if (item.status === 'complete') {
            stopPolling();
            const fullItem = await getRunItem(item.id);
            setPayload(fullItem.rendered_payload);
            if (onRunComplete) {
              onRunComplete({
                item: fullItem,
                payload: fullItem.rendered_payload,
                draftFingerprint
              });
            }
            setRunning(false);
            showToast('Test report generated', 'success');
          } else if (item.status === 'failed') {
            stopPolling();
            const msg = item.error_message || 'Test run failed';
            setRunError(msg);
            showToast(msg, 'error');
            setRunning(false);
          }
        } catch (pollErr) {
          stopPolling();
          const msg = pollErr.response?.data?.error || pollErr.message || 'Polling error';
          setRunError(msg);
          showToast(msg, 'error');
          setRunning(false);
        }
      }, 1500);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to start test run';
      setRunError(msg);
      showToast(msg, 'error');
      setRunning(false);
    }
  };

  const getClientLabel = (c) => {
    if (!c) return '';
    return (
      c.client_label ||
      c.client_identifier_value ||
      c.business_name ||
      [c.first_name, c.last_name].filter(Boolean).join(' ') ||
      c.email ||
      c.id
    );
  };

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" fontWeight={600}>
        Test Run Preview
      </Typography>
      <Autocomplete
        options={clients}
        value={client}
        onChange={(_, val) => setClient(val)}
        getOptionLabel={getClientLabel}
        isOptionEqualToValue={(opt, val) => opt.id === val?.id}
        renderInput={(params) => <TextField {...params} label="Client" size="small" />}
        noOptionsText="No clients found"
      />
      <Stack direction="row" spacing={2}>
        <TextField
          label="From"
          type="date"
          size="small"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          fullWidth
        />
        <TextField
          label="To"
          type="date"
          size="small"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          fullWidth
        />
      </Stack>
      <LoadingButton
        loading={running}
        loadingLabel="Generating…"
        onClick={handleRun}
        variant="contained"
        disabled={!client}
      >
        Generate Test Report
      </LoadingButton>
      {runError && (
        <Alert severity="error">{runError}</Alert>
      )}
      {payload && (
        <Box>
          <WebReportRenderer payload={payload} />
        </Box>
      )}
    </Stack>
  );
}
