import PropTypes from 'prop-types';
import { Box, Grid, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Chart from 'react-apexcharts';
import { CARD_SHADOW, getPremiumChartDefaults, useChartTheme } from './chartTheme';
import {
  computeDelta,
  formatDeltaPercent,
  getDeltaOutcome,
  getMetricPolarity,
  getOutcomeColor
} from './analyticsComparison';

function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatWhole(value) {
  return Number(value || 0).toLocaleString();
}

function buildCumulative(rows, getter) {
  let running = 0;
  return (rows || []).map((row) => {
    running += Number(getter(row) || 0);
    return Math.round(running * 100) / 100;
  });
}

function sumOf(rows, getter) {
  return (rows || []).reduce((acc, row) => acc + Number(getter(row) || 0), 0);
}

function isMonthToDate(dateRange) {
  if (!dateRange?.start || !dateRange?.end) return false;
  const start = new Date(`${dateRange.start}T00:00:00`);
  const end = new Date(`${dateRange.end}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    start.getDate() === 1 &&
    start.getFullYear() === today.getFullYear() &&
    start.getMonth() === today.getMonth() &&
    end.toDateString() === today.toDateString()
  );
}

function PacingHeadline({ label, value, current, previous, metric, accent }) {
  const theme = useChartTheme();
  const upIsGood = getMetricPolarity(metric);
  const delta = computeDelta(current, previous);
  const outcome = getDeltaOutcome(delta, upIsGood);
  const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
  const deltaStr = previous != null ? formatDeltaPercent(current, previous) : null;
  const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';

  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 2,
        boxShadow: CARD_SHADOW,
        borderBottom: `3px solid ${accent}`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Typography>
      <Typography variant="h2" fontWeight={700} sx={{ lineHeight: 1.2, mt: 0.5 }}>
        {value}
      </Typography>
      {deltaStr && (
        <Typography variant="caption" sx={{ color: deltaColor, fontWeight: 600, mt: 0.5 }}>
          {arrow} {deltaStr.replace(/^[+-]/, '')} vs prev
        </Typography>
      )}
    </Paper>
  );
}

PacingHeadline.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  current: PropTypes.number,
  previous: PropTypes.number,
  metric: PropTypes.string.isRequired,
  accent: PropTypes.string.isRequired
};

export default function PacingSummary({ timeSeries, comparisonTimeSeries, dateRange, comparisonRange, loading }) {
  const theme = useChartTheme();

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton width={220} height={28} sx={{ mb: 2 }} />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {[1, 2, 3].map((i) => (
            <Grid size={{ xs: 12, sm: 4 }} key={i}>
              <Skeleton variant="rounded" height={92} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 1 }} />
      </Paper>
    );
  }

  const current = timeSeries || [];
  const comparison = comparisonTimeSeries || [];
  if (!current.length) return null;

  const mtdMode = isMonthToDate(dateRange);
  const headlineSuffix = mtdMode ? ' (MTD)' : '';

  const currentLeads = sumOf(current, (r) => r.leads);
  const currentSpend = sumOf(current, (r) => r.spend);
  const currentCpql = currentLeads > 0 ? currentSpend / currentLeads : 0;

  const comparisonLeads = comparison.length ? sumOf(comparison, (r) => r.leads) : null;
  const comparisonSpend = comparison.length ? sumOf(comparison, (r) => r.spend) : null;
  const comparisonCpql = comparisonLeads ? comparisonSpend / comparisonLeads : null;

  const cumulativeCurrentLeads = buildCumulative(current, (r) => r.leads);
  const cumulativeComparisonLeads = comparison.length ? buildCumulative(comparison, (r) => r.leads) : [];
  const maxLen = Math.max(cumulativeCurrentLeads.length, cumulativeComparisonLeads.length);
  const padTo = (arr) => {
    if (arr.length === maxLen) return arr;
    return [...arr, ...Array(maxLen - arr.length).fill(null)];
  };

  const categories = Array.from({ length: maxLen }, (_, i) => `Day ${i + 1}`);
  const defaults = getPremiumChartDefaults(theme);
  const currentColor = theme.palette.primary.main;
  const comparisonColor = alpha(theme.palette.text.primary, 0.35);

  const chartOptions = {
    ...defaults,
    chart: {
      ...defaults.chart,
      type: 'line',
      height: 280,
      toolbar: { show: false }
    },
    colors: [currentColor, comparisonColor],
    stroke: { width: [3, 2.5], curve: 'smooth', dashArray: [0, 4] },
    markers: { size: 0, hover: { sizeOffset: 4 } },
    xaxis: {
      categories,
      title: { text: mtdMode ? 'Day of month' : 'Day of selected range' },
      labels: { style: { fontSize: '11px' } }
    },
    yaxis: { title: { text: 'Cumulative qualified leads' } },
    legend: { position: 'top', horizontalAlign: 'left' },
    tooltip: {
      theme: 'dark',
      shared: true,
      intersect: false
    }
  };

  const chartSeries = [
    { name: 'Current period', type: 'line', data: padTo(cumulativeCurrentLeads) }
  ];
  if (cumulativeComparisonLeads.length) {
    chartSeries.push({ name: 'Comparison period', type: 'line', data: padTo(cumulativeComparisonLeads) });
  }

  return (
    <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={600}>
            Pacing Summary{headlineSuffix}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Cumulative qualified leads against the same elapsed window of the comparison period.
          </Typography>
        </Box>
        {comparisonRange && (
          <Typography variant="caption" color="text.secondary">
            {comparisonRange.start} – {comparisonRange.end}
          </Typography>
        )}
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <PacingHeadline
            label={`Qualified Leads${headlineSuffix}`}
            value={formatWhole(currentLeads)}
            current={currentLeads}
            previous={comparisonLeads}
            metric="qualifiedLeads"
            accent={theme.palette.primary.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <PacingHeadline
            label={`Ad Spend${headlineSuffix}`}
            value={formatCurrency(currentSpend)}
            current={currentSpend}
            previous={comparisonSpend}
            metric="spend"
            accent={theme.palette.warning.main}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <PacingHeadline
            label={`CPQL${headlineSuffix}`}
            value={currentLeads > 0 ? formatCurrency(currentCpql) : '—'}
            current={currentCpql}
            previous={comparisonCpql}
            metric="cpql"
            accent={theme.palette.error.main}
          />
        </Grid>
      </Grid>

      <Chart options={chartOptions} series={chartSeries} type="line" height={280} width="100%" />
    </Paper>
  );
}

PacingSummary.propTypes = {
  timeSeries: PropTypes.array,
  comparisonTimeSeries: PropTypes.array,
  dateRange: PropTypes.shape({ start: PropTypes.string, end: PropTypes.string }),
  comparisonRange: PropTypes.shape({ start: PropTypes.string, end: PropTypes.string }),
  loading: PropTypes.bool
};
