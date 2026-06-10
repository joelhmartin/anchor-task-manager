import { useState } from 'react';
import { Stack, TextField } from '@mui/material';
import FormDialog from 'ui-component/extended/FormDialog';
import { useToast } from 'contexts/ToastContext';
import { startRun } from 'api/aiReports';
import AiAudiencePicker from './AiAudiencePicker';

function toDateString(d) {
  return d.toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return toDateString(d);
}

function defaultTo() {
  return toDateString(new Date());
}

/**
 * AiRunDialog — starts a production run for an approved AI report template.
 *
 * Props:
 *   open        – boolean
 *   onClose     – fn()
 *   templateId  – string UUID
 *   onStarted   – fn(run) called after a successful run enqueue
 */
export default function AiRunDialog({ open, onClose, templateId, onStarted }) {
  const { showToast } = useToast();

  const [audience, setAudience] = useState({ mode: 'all' });
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!from || !to) {
      showToast('Select a from and to date', 'error');
      return;
    }
    if (new Date(from) > new Date(to)) {
      showToast('From date must be before the to date', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const run = await startRun({
        templateId,
        audienceFilter: audience,
        dateRange: { from, to }
      });
      const count = Array.isArray(run.selected_client_ids) ? run.selected_client_ids.length : 0;
      showToast(`Run started for ${count} client${count !== 1 ? 's' : ''}`, 'success');
      if (onStarted) onStarted(run);
      onClose();
    } catch (e) {
      showToast(e.response?.data?.error || e.message || 'Failed to start run', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Run AI Report"
      submitLabel="Run"
      loadingLabel="Starting…"
      loading={submitting}
      maxWidth="sm"
      dividers
    >
      <AiAudiencePicker value={audience} onChange={setAudience} />

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <TextField
          label="From"
          type="date"
          size="small"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          fullWidth
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label="To"
          type="date"
          size="small"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          fullWidth
          InputLabelProps={{ shrink: true }}
        />
      </Stack>
    </FormDialog>
  );
}
