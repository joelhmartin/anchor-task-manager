import { Alert, Stack, Typography, Paper, Chip, Skeleton } from '@mui/material';
import { useState, useEffect } from 'react';
import MainCard from 'ui-component/cards/MainCard';
import { fetchAnalyticsConnections } from 'api/analytics';

const PLATFORMS = [
  { key: 'ga4', label: 'Google Analytics 4', detailKey: 'propertyId', detailLabel: 'Property ID' },
  { key: 'googleAds', label: 'Google Ads', detailKey: 'customerId', detailLabel: 'Customer ID' },
  { key: 'meta', label: 'Meta Ads', detailKey: 'adAccountId', detailLabel: 'Ad Account' },
  { key: 'ctm', label: 'Call Tracking (CTM)', detailKey: null, detailLabel: null }
];

export default function SettingsTab({ userId, selection }) {
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const isMultiClient = selection && selection.mode !== 'single';

  useEffect(() => {
    if (!userId || isMultiClient) return;
    setLoading(true);
    fetchAnalyticsConnections(userId)
      .then(setConnections)
      .catch(() => setConnections(null))
      .finally(() => setLoading(false));
  }, [userId, isMultiClient]);

  if (isMultiClient) {
    return (
      <Alert severity="info">
        Connection details are shown per client. Select a single client to view platform configuration.
      </Alert>
    );
  }

  return (
    <MainCard title="Connected Accounts">
      <Stack spacing={2}>
        {PLATFORMS.map(({ key, label, detailKey, detailLabel }) => (
          <Paper key={key} variant="outlined" sx={{ p: 2 }}>
            {loading ? (
              <Skeleton width={200} height={24} />
            ) : (
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {label}
                  </Typography>
                  {connections?.[key] && detailKey && (
                    <Typography variant="caption" color="text.secondary">
                      {detailLabel}: {typeof connections[key] === 'object' ? connections[key][detailKey] : 'Connected'}
                    </Typography>
                  )}
                </Stack>
                <Chip
                  label={connections?.[key] ? 'Connected' : 'Not Configured'}
                  color={connections?.[key] ? 'success' : 'default'}
                  size="small"
                  variant={connections?.[key] ? 'filled' : 'outlined'}
                />
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>
    </MainCard>
  );
}
