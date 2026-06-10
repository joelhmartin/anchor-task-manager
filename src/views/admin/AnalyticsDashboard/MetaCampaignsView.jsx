import { useState, useEffect, useCallback } from 'react';
import { Stack, Typography, Skeleton, ToggleButton, ToggleButtonGroup } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import MainCard from 'ui-component/cards/MainCard';
import EmptyState from 'ui-component/extended/EmptyState';
import MetaCampaignCard from './MetaCampaignCard';
import { fetchMetaCampaigns } from 'api/analytics';
import { useToast } from 'contexts/ToastContext';

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Paused', value: 'PAUSED' }
];

export default function MetaCampaignsView({ userId, dateRange }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const { showToast } = useToast();

  const loadCampaigns = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const params = {};
      if (dateRange?.start) params.start = dateRange.start;
      if (dateRange?.end) params.end = dateRange.end;
      if (statusFilter) params.status = statusFilter;

      const data = await fetchMetaCampaigns(userId, params);
      setCampaigns(data.campaigns || []);
    } catch (err) {
      // 404 = no Meta ad account configured for this client — not an error, just no data
      if (err?.response?.status !== 404) {
        console.error('[MetaCampaignsView] load error:', err);
        showToast('Failed to load Facebook campaign data', 'error');
      }
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [userId, dateRange?.start, dateRange?.end, statusFilter, showToast]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  return (
    <MainCard
      title="Facebook Campaigns"
      secondary={
        <ToggleButtonGroup
          value={statusFilter}
          exclusive
          onChange={(_, val) => val !== null && setStatusFilter(val)}
          size="small"
        >
          {STATUS_FILTERS.map((f) => (
            <ToggleButton key={f.value} value={f.value}>{f.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      }
    >
      {loading ? (
        <Stack spacing={2}>
          {[1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" height={160} sx={{ borderRadius: 1 }} />
          ))}
        </Stack>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={CampaignIcon}
          title="No campaigns found"
          message={statusFilter ? `No ${statusFilter.toLowerCase()} campaigns in this date range` : 'No Meta ad account configured for this client, or no campaigns in this date range'}
        />
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} — sorted by spend
          </Typography>
          {campaigns.map((campaign) => (
            <MetaCampaignCard key={campaign.id} campaign={campaign} userId={userId} />
          ))}
        </Stack>
      )}
    </MainCard>
  );
}
