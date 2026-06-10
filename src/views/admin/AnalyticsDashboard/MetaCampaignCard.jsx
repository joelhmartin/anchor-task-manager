import { useState } from 'react';
import { Box, Grid, Typography, Collapse, IconButton, Stack, Divider } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SubCard from 'ui-component/cards/SubCard';
import StatusChip from 'ui-component/extended/StatusChip';
import MetaAdCreativePreview from './MetaAdCreativePreview';


function formatNumber(val) {
  if (val == null) return '—';
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return val.toLocaleString();
}

function formatCurrency(val) {
  if (val == null) return '—';
  return `$${val.toFixed(2)}`;
}

function formatPercent(val) {
  if (val == null) return '—';
  return `${val.toFixed(2)}%`;
}

const METRICS = [
  { key: 'spend', label: 'Spend', format: formatCurrency },
  { key: 'clicks', label: 'Clicks', format: formatNumber },
  { key: 'impressions', label: 'Impressions', format: formatNumber },
  { key: 'ctr', label: 'CTR', format: formatPercent },
  { key: 'cpc', label: 'CPC', format: formatCurrency },
  { key: 'reach', label: 'Reach', format: formatNumber },
  { key: 'cpm', label: 'CPM', format: formatCurrency },
  { key: 'conversions', label: 'Conversions', format: formatNumber }
];

export default function MetaCampaignCard({ campaign, metaConversionsEnabled = true, userId }) {
  const [expanded, setExpanded] = useState(false);

  const { name, status, insights, ads } = campaign;
  const primaryAd = ads?.[0] || null;

  const visibleMetrics = metaConversionsEnabled ? METRICS : METRICS.filter((metric) => metric.key !== 'conversions');

  return (
    <SubCard
      sx={{ '&:hover': { borderColor: 'primary.light' }, transition: 'border-color 0.2s' }}
      title={
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
          <StatusChip status={status.toLowerCase()} size="small" />
          <Typography variant="subtitle1" noWrap sx={{ flex: 1 }} title={name}>
            {name}
          </Typography>
          {ads?.length > 1 && (
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
            >
              <ExpandMoreIcon />
            </IconButton>
          )}
        </Stack>
      }
    >
      <Grid container spacing={2}>
        {/* Creative Preview */}
        <Grid size={{ xs: 12, md: 5 }}>
          {primaryAd?.creative ? (
            <MetaAdCreativePreview creative={primaryAd.creative} userId={userId} />
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No creative available
            </Typography>
          )}
        </Grid>

        {/* Metrics Grid */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Grid container spacing={1}>
            {visibleMetrics.map((m) => (
              <Grid size={{ xs: 6, sm: 3 }} key={m.key}>
                <Typography variant="caption" color="text.secondary">{m.label}</Typography>
                <Typography variant="body2" fontWeight={600}>{m.format(insights?.[m.key])}</Typography>
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Grid>

      {/* Expanded: show all ads */}
      {ads?.length > 1 && (
        <Collapse in={expanded}>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            All Ads ({ads.length})
          </Typography>
          <Stack spacing={1.5}>
            {ads.slice(1).map((ad) => (
              <Box key={ad.id} sx={{ pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  {ad.name} — {ad.status}
                </Typography>
                {ad.creative && <MetaAdCreativePreview creative={ad.creative} compact userId={userId} />}
              </Box>
            ))}
          </Stack>
        </Collapse>
      )}
    </SubCard>
  );
}
