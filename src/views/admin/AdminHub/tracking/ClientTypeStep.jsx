import { useState } from 'react';
import {
  Box, Stack, Typography, RadioGroup, FormControlLabel,
  Radio, Alert
} from '@mui/material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';

export default function ClientTypeStep({ config, saveConfig, onNext }) {
  const { showToast } = useToast();
  const [clientType, setClientType] = useState(config?.client_type || 'medical');
  const [saving, setSaving] = useState(false);

  const handleNext = async () => {
    setSaving(true);
    try {
      await saveConfig({ client_type: clientType });
      showToast('Client type saved', 'success');
      onNext();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save client type'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" gutterBottom>Tracking Mode</Typography>
        <Typography variant="body2" color="text.secondary">
          Confirm whether this client should use HIPAA-strict medical tracking or standard non-medical tracking.
        </Typography>
      </Box>

      <RadioGroup
        value={clientType}
        onChange={(e) => setClientType(e.target.value)}
      >
        <FormControlLabel
          value="medical"
          control={<Radio />}
          label={
            <Box>
              <Typography variant="body1" fontWeight={500}>Medical (HIPAA strict mode)</Typography>
              <Typography variant="caption" color="text.secondary">
                Server-side events use allowlist-only scrubbing — only event name, timestamp, source domain, and conversion value are forwarded.
              </Typography>
            </Box>
          }
          sx={{ alignItems: 'flex-start', mb: 1 }}
        />
        <FormControlLabel
          value="non_medical"
          control={<Radio />}
          label={
            <Box>
              <Typography variant="body1" fontWeight={500}>Non-Medical (standard mode)</Typography>
              <Typography variant="caption" color="text.secondary">
                Standard event forwarding with full UTM and attribution data.
              </Typography>
            </Box>
          }
          sx={{ alignItems: 'flex-start' }}
        />
      </RadioGroup>

      {clientType === 'medical' && (
        <Alert severity="info" variant="outlined">
          Medical clients are subject to HIPAA strict mode. All server-side relay events will only include the event name, timestamp, source URL (domain only), and conversion value. All other fields — including names, phone numbers, email addresses, and IP addresses — are automatically scrubbed before forwarding.
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <LoadingButton
          variant="contained"
          loading={saving}
          loadingLabel="Saving..."
          onClick={handleNext}
        >
          Next
        </LoadingButton>
      </Box>
    </Stack>
  );
}
