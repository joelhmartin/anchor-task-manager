import {
  Box, Stack, Typography, Switch, FormControlLabel,
  IconButton, Tooltip, Divider, Alert
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import LoadingButton from 'ui-component/extended/LoadingButton';
import StatusChip from 'ui-component/extended/StatusChip';
import SubCard from 'ui-component/cards/SubCard';
import { useToast } from 'contexts/ToastContext';
import { getErrorMessage } from 'utils/errors';
import { toggleRelay } from 'api/tracking';
import CampaignClaimsPanel from './CampaignClaimsPanel';

export default function InstallStatusStep({ config, onBack, onReload }) {
  const { showToast } = useToast();

  if (!config) return null;

  const handleRelayToggle = async () => {
    try {
      const data = await toggleRelay(config.id, !config.relay_enabled);
      onReload();
      showToast(data.relay_enabled ? 'Event relay enabled' : 'Event relay disabled', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to toggle relay'), 'error');
    }
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(config.install_snippet);
    showToast('Snippet copied to clipboard', 'success');
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" gutterBottom>Install &amp; Status</Typography>
        <Typography variant="body2" color="text.secondary">
          Review the setup summary and manage the event relay. Connected ad and analytics accounts now live under Client Details.
        </Typography>
      </Box>

      {/* Status row */}
      <SubCard title="Provisioning Status">
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <StatusChip status={config.provisioning_status || 'draft'} />
            {config.provisioned_at && (
              <Typography variant="caption" color="text.secondary">
                Provisioned: {new Date(config.provisioned_at).toLocaleDateString()}
              </Typography>
            )}
            {config.published_at && (
              <Typography variant="caption" color="text.secondary">
                Published: {new Date(config.published_at).toLocaleDateString()}
              </Typography>
            )}
          </Box>
          <Alert severity="info" variant="outlined">
            Automated GTM provisioning and publishing are paused on `main` until the Tag Manager API quota issue is revisited.
            This branch is now just storing the tracking account configuration and relay settings.
          </Alert>
        </Stack>
      </SubCard>

      {/* Event relay toggle */}
      <SubCard title="Event Relay">
        <FormControlLabel
          control={
            <Switch
              checked={config.relay_enabled || false}
              onChange={handleRelayToggle}
            />
          }
          label={
            <Typography variant="body2">
              {config.relay_enabled ? 'Relay active — conversion events are being forwarded' : 'Relay inactive — enable to start forwarding conversion events'}
            </Typography>
          }
        />
      </SubCard>

      {/* Linked accounts summary */}
      <SubCard title="Linked Accounts">
        <Stack spacing={1} divider={<Divider flexItem />}>
          {[
            { label: 'GA4 Property', value: config.ga4_property_id },
            { label: 'GA4 Measurement ID', value: config.ga4_measurement_id },
            { label: 'Google Ads Customer ID', value: config.google_ads_customer_id },
            { label: 'Meta Ad Account', value: config.meta_ad_account_id },
            { label: 'Meta Pixel', value: config.meta_pixel_id },
            { label: 'GTM Container', value: config.gtm_container_public_id || config.gtm_container_id },
          ]
            .filter((row) => row.value)
            .map((row) => (
              <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                <Typography variant="body2" color="text.secondary">{row.label}</Typography>
                <Typography variant="body2" fontFamily="monospace">{row.value}</Typography>
              </Box>
            ))}
          {![
            config.ga4_property_id,
            config.google_ads_customer_id,
            config.meta_ad_account_id,
            config.meta_pixel_id,
            config.gtm_container_public_id || config.gtm_container_id
          ].some(Boolean) && (
            <Typography variant="body2" color="text.secondary">
              No linked accounts saved yet. Set them under Client Details and they will appear here automatically.
            </Typography>
          )}
        </Stack>
      </SubCard>

      {config.meta_ad_account_id && (
        <SubCard title="Meta Campaign Allowlist">
          <CampaignClaimsPanel userId={config.user_id} adAccountId={config.meta_ad_account_id} />
        </SubCard>
      )}

      {/* Install snippet */}
      {config.install_snippet && (
        <SubCard
          title="Install Snippet"
          secondary={
            <Tooltip title="Copy to clipboard">
              <IconButton size="small" onClick={handleCopySnippet}>
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Paste this single snippet into the WordPress site header. It replaces all separate GA4, Google Ads, and Meta Pixel scripts.
          </Typography>
          <Box
            component="pre"
            sx={{
              p: 2, bgcolor: '#121926', color: '#eef2f6', borderRadius: 1,
              overflow: 'auto', fontSize: '0.75rem', lineHeight: 1.5, m: 0,
            }}
          >
            {config.install_snippet}
          </Box>
        </SubCard>
      )}

      {!config.install_snippet && (
        <SubCard title="Install Snippet">
          <Typography variant="body2" color="text.secondary">
            No install snippet is being generated on `main` while GTM API provisioning is paused.
          </Typography>
        </SubCard>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
        <LoadingButton variant="outlined" onClick={onBack}>Back</LoadingButton>
      </Box>
    </Stack>
  );
}
