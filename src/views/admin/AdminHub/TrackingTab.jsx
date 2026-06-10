import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import TrackingWizard from './TrackingWizard';

export default function TrackingTab({ clientId, editing, onAnalyticsChange }) {
  return (
    <Stack spacing={4}>
      <Alert severity="info" variant="outlined">
        Connected accounts are managed under Client Details. This tab now focuses on tracking mode, relay behavior, conversion mapping, and advanced defaults.
      </Alert>

      <TrackingWizard clientId={clientId} />

      {editing && (
        <Stack spacing={2}>
          <Box>
            <Typography variant="h6" gutterBottom>Advanced Event Defaults</Typography>
            <Typography variant="body2" color="text.secondary">
              These fallback browser-side event names are used by CTM form submissions when a form does not override them.
            </Typography>
          </Box>

          <TextField
            label="GA4 Default Event"
            value={editing.analytics_defaults?.ga4_event || ''}
            onChange={onAnalyticsChange('ga4_event')}
            placeholder="form_submit (default)"
            size="small"
            fullWidth
            helperText="Fires gtag('event', ...) — defaults to 'form_submit' if blank"
          />
          <TextField
            label="Google Ads Conversion"
            value={editing.analytics_defaults?.gads_conversion || ''}
            onChange={onAnalyticsChange('gads_conversion')}
            placeholder="AW-XXXXXXXXX/CONVERSION_LABEL"
            size="small"
            fullWidth
            helperText="Full send_to string from your Google Ads conversion action"
          />
          <TextField
            label="Facebook Default Event"
            value={editing.analytics_defaults?.fb_event || ''}
            onChange={onAnalyticsChange('fb_event')}
            placeholder="Lead"
            size="small"
            fullWidth
            helperText="Fires fbq('track', ...) — requires Meta Pixel on site"
          />
          <TextField
            label="TikTok Default Event"
            value={editing.analytics_defaults?.tiktok_event || ''}
            onChange={onAnalyticsChange('tiktok_event')}
            placeholder="SubmitForm"
            size="small"
            fullWidth
            helperText="Fires ttq.track(...) — requires TikTok Pixel on site"
          />
          <TextField
            label="Bing Default Event"
            value={editing.analytics_defaults?.bing_event || ''}
            onChange={onAnalyticsChange('bing_event')}
            placeholder="submit"
            size="small"
            fullWidth
            helperText="Fires uetq.push('event', ...) — requires Bing UET tag on site"
          />
        </Stack>
      )}
    </Stack>
  );
}
