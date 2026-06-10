import Chart from 'react-apexcharts';
import { Paper, Typography, Stack, Skeleton, Box, Chip } from '@mui/material';
import { getPremiumDonutDefaults, PREMIUM_COLORS, CARD_SHADOW, useChartTheme } from './chartTheme';
import {
  computeDelta,
  formatDeltaPercent,
  getDeltaOutcome,
  getMetricPolarity,
  getOutcomeColor
} from './analyticsComparison';
import useChartContainer from './useChartContainer';

export default function LeadSourcesChart({ ga4Data, comparisonGa4Data, loading }) {
  const theme = useChartTheme();
  const { ref: chartRef, sx: chartSx } = useChartContainer();

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton width={140} height={24} sx={{ mb: 1 }} />
        <Skeleton variant="circular" width={220} height={220} sx={{ mx: 'auto', my: 2 }} />
      </Paper>
    );
  }

  const sources = ga4Data?.topSources || [];
  if (!sources.length) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1 }}>Traffic Sources</Typography>
        <Typography color="text.secondary">No GA4 data available</Typography>
      </Paper>
    );
  }

  const labels = sources.map((s) => `${s.source} / ${s.medium}`);
  const series = sources.map((s) => s.sessions);
  const total = series.reduce((a, b) => a + b, 0);

  const donutDefaults = getPremiumDonutDefaults(theme, PREMIUM_COLORS);

  const options = {
    ...donutDefaults,
    labels,
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px' },
      y: {
        formatter: (val) => {
          const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
          return `${val.toLocaleString()} sessions (${pct}%)`;
        }
      }
    },
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: true,
            name: {
              show: true,
              fontSize: '13px',
              fontFamily: theme.typography.fontFamily,
              color: theme.palette.text.secondary,
              offsetY: 20
            },
            value: {
              show: true,
              fontSize: '28px',
              fontFamily: theme.typography.fontFamily,
              fontWeight: 700,
              color: theme.palette.text.primary,
              offsetY: -16,
              formatter: () => total.toLocaleString()
            },
            total: {
              show: true,
              showAlways: true,
              label: 'Total Sessions',
              fontSize: '13px',
              fontFamily: theme.typography.fontFamily,
              color: theme.palette.text.secondary,
              formatter: () => total.toLocaleString()
            }
          }
        },
        expandOnClick: true
      }
    }
  };

  const comparisonSources = comparisonGa4Data?.topSources || [];
  const comparisonTotal = comparisonSources.reduce((acc, s) => acc + (s.sessions || 0), 0);
  const delta = comparisonTotal > 0 ? computeDelta(total, comparisonTotal) : null;
  const deltaStr = comparisonTotal > 0 ? formatDeltaPercent(total, comparisonTotal) : null;
  const outcome = getDeltaOutcome(delta, getMetricPolarity('sessions'));
  const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
  const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
        <Typography variant="h4" fontWeight={600}>
          Traffic Sources
        </Typography>
        {deltaStr && (
          <Typography variant="caption" sx={{ color: deltaColor, fontWeight: 600 }}>
            {arrow} {deltaStr.replace(/^[+-]/, '')} vs prev
          </Typography>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Where sessions came from in this date range, with previous-period total for context.
      </Typography>
      <Box ref={chartRef} sx={chartSx}>
        <Chart options={options} series={series} type="donut" height={340} width="100%" />
      </Box>
      {comparisonTotal > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip size="small" label={`Current ${total.toLocaleString()} sessions`} color="primary" variant="outlined" />
          <Chip size="small" label={`Previous ${comparisonTotal.toLocaleString()} sessions`} variant="outlined" />
        </Stack>
      )}
    </Paper>
  );
}
