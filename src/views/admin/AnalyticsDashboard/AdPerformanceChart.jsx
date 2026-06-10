import { Paper, Typography, Stack, Skeleton, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { CARD_SHADOW } from './chartTheme';
import {
  computeDelta,
  formatDeltaPercent,
  getDeltaOutcome,
  getOutcomeColor
} from './analyticsComparison';
import { BRAND_COLORS } from 'constants/brandColors';

const GOOGLE_COLOR = '#34A853';

const LABEL_TO_METRIC = {
  Spend: 'spend',
  Clicks: 'clicks',
  CPC: 'cpc',
  Conversions: 'conversions',
  'Cost/Conv': 'costPerConversion'
};

function formatMetricValue(label, value) {
  if (value == null || value === 0) return '$0.00';
  if (label === 'Spend' || label === 'CPC' || label === 'Cost/Conv') {
    return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return Number(value).toLocaleString();
}

function PeriodDelta({ current, previous, upIsGood }) {
  const theme = useTheme();
  if (previous == null) return null;
  const delta = computeDelta(current, previous);
  const deltaStr = formatDeltaPercent(current, previous);
  if (!deltaStr) return null;
  const outcome = getDeltaOutcome(delta, upIsGood);
  const color = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
  const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';
  return (
    <Typography variant="caption" sx={{ color, fontWeight: 600, ml: 0.75, whiteSpace: 'nowrap' }}>
      {arrow} {deltaStr.replace(/^[+-]/, '')}
    </Typography>
  );
}

function MetricRow({ label, meta, google, metaPrev, googlePrev, upIsGood }) {
  const maxVal = Math.max(meta || 0, google || 0);
  const metaPct = maxVal > 0 ? ((meta || 0) / maxVal) * 100 : 0;
  const googlePct = maxVal > 0 ? ((google || 0) / maxVal) * 100 : 0;

  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      sx={{
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 'none' }
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ width: 90, flexShrink: 0, fontWeight: 500 }}>
        {label}
      </Typography>
      <Stack sx={{ flex: 1 }} spacing={0.75}>
        {/* Meta bar */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              width: `${Math.max(metaPct, 2)}%`,
              height: 8,
              borderRadius: 4,
              bgcolor: BRAND_COLORS.facebook,
              minWidth: 4,
              transition: 'width 0.4s ease'
            }}
          />
          <Typography variant="caption" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
            {formatMetricValue(label, meta)}
          </Typography>
          <PeriodDelta current={meta} previous={metaPrev} upIsGood={upIsGood} />
        </Stack>
        {/* Google bar */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              width: `${Math.max(googlePct, 2)}%`,
              height: 8,
              borderRadius: 4,
              bgcolor: GOOGLE_COLOR,
              minWidth: 4,
              transition: 'width 0.4s ease'
            }}
          />
          <Typography variant="caption" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
            {formatMetricValue(label, google)}
          </Typography>
          <PeriodDelta current={google} previous={googlePrev} upIsGood={upIsGood} />
        </Stack>
      </Stack>
    </Stack>
  );
}

export default function AdPerformanceChart({ metaAds, googleAds, comparisonMetaAds, comparisonGoogleAds, loading, metaConversionsEnabled = true }) {
  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton width={200} height={24} sx={{ mb: 2 }} />
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} height={52} sx={{ mb: 1 }} />
        ))}
      </Paper>
    );
  }

  if (!metaAds && !googleAds) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>Meta Ads vs Google Ads</Typography>
        <Typography color="text.secondary">No ad data available</Typography>
      </Paper>
    );
  }

  // up-is-good per metric: clicks/conversions yes; spend/CPC/Cost-per-conv no
  const metricPairs = [
    { label: 'Spend', meta: metaAds?.spend || 0, google: googleAds?.spend || 0, upIsGood: false },
    { label: 'Clicks', meta: metaAds?.clicks || 0, google: googleAds?.clicks || 0, upIsGood: true },
    { label: 'CPC', meta: metaAds?.cpc || 0, google: googleAds?.cpc || 0, upIsGood: false }
  ];

  if (metaConversionsEnabled) {
    metricPairs.push(
      { label: 'Conversions', meta: metaAds?.conversions || 0, google: googleAds?.conversions || 0, upIsGood: true },
      { label: 'Cost/Conv', meta: metaAds?.costPerConversion || 0, google: googleAds?.costPerConversion || 0, upIsGood: false }
    );
  }

  const previousFor = (label, source) => {
    const key = LABEL_TO_METRIC[label];
    if (!key || !source) return undefined;
    return source[key];
  };

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      {/* Header with legend dots */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4" fontWeight={600}>
          Meta Ads vs Google Ads
        </Typography>
        <Stack direction="row" spacing={2}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: BRAND_COLORS.facebook }} />
            <Typography variant="caption" color="text.secondary" fontWeight={500}>Meta</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: GOOGLE_COLOR }} />
            <Typography variant="caption" color="text.secondary" fontWeight={500}>Google</Typography>
          </Stack>
        </Stack>
      </Stack>

      {/* Metric rows */}
      {metricPairs.map((pair) => (
        <MetricRow
          key={pair.label}
          {...pair}
          metaPrev={previousFor(pair.label, comparisonMetaAds)}
          googlePrev={previousFor(pair.label, comparisonGoogleAds)}
        />
      ))}
    </Paper>
  );
}
