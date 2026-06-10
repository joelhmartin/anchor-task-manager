import { useState, useEffect, useMemo } from 'react';
import { Alert, Button, Chip, Grid, Paper, Typography, Stack, Skeleton, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Chart from 'react-apexcharts';
import ChartCard from './ChartCard';
import FullWidthChartCard from './FullWidthChartCard';
import MainCard from 'ui-component/cards/MainCard';
import DataTable from 'ui-component/extended/DataTable';
import EmptyState from 'ui-component/extended/EmptyState';
import PhoneIcon from '@mui/icons-material/Phone';
import DescriptionIcon from '@mui/icons-material/Description';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PhoneMissedIcon from '@mui/icons-material/PhoneMissed';
import TimerIcon from '@mui/icons-material/Timer';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  fetchCallsLeadsSummary,
  fetchCallsLeadsByRating,
  fetchCallsLeadsByCategory,
  fetchCallsLeadsBySource,
  fetchCallsLeadsVolume,
  fetchCallsLeadsDuration,
  fetchGroupCallsLeads
} from 'api/analytics';
import CallHeatmap from './CallHeatmap';
import { getPremiumChartDefaults, getPremiumDonutDefaults, PREMIUM_COLORS, CARD_SHADOW, formatDate, useChartTheme } from './chartTheme';
import MetricDefinitionStrip from './MetricDefinitionStrip';
import {
  buildComparisonSeriesColors,
  buildComparisonTooltip,
  buildSimpleTooltip,
  computeDelta,
  formatDeltaPercent,
  getDeltaOutcome,
  getMetricPolarity,
  getOutcomeColor
} from './analyticsComparison';

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function getWeekdayLabel(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}

function isWeekendDate(date) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

const BUCKET_LABELS = {
  missed: 'Missed',
  under_30s: 'Under 30s',
  '30s_to_1m': '30s-1m',
  '1m_to_3m': '1-3m',
  '3m_to_5m': '3-5m',
  '5m_to_10m': '5-10m',
  over_10m: 'Over 10m'
};

const RATING_COLORS = {
  1: '#ef5350', // red
  2: '#ff9800', // orange
  3: '#fdd835', // yellow
  4: '#66bb6a', // green
  5: '#2e7d32' // dark green
};

function formatCategory(cat) {
  if (!cat) return 'Unknown';
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const SOURCE_COLUMNS = [
  { id: 'source', label: 'Source', sortable: true },
  { id: 'total', label: 'Total', sortable: true, align: 'right' },
  { id: 'calls', label: 'Calls', sortable: true, align: 'right' },
  { id: 'forms', label: 'Forms', sortable: true, align: 'right' },
  { id: 'qualified', label: 'Qualified', sortable: true, align: 'right' },
  {
    id: 'qualifiedRate',
    label: 'Qualified Rate',
    sortable: true,
    align: 'right',
    render: (row) => `${(row.qualifiedRate || 0).toFixed(1)}%`
  }
];

const KPI_MAP = [
  { icon: PhoneIcon, key: 'totalLeads', label: 'Total Leads', color: 'primary' },
  { icon: PhoneIcon, key: 'totalCalls', label: 'Calls', color: 'info' },
  { icon: DescriptionIcon, key: 'totalForms', label: 'Forms', color: 'secondary' },
  { icon: CheckCircleIcon, key: 'qualifiedCalls', label: 'Qualified Leads', color: 'success' },
  { icon: PhoneMissedIcon, key: 'missedCalls', label: 'Missed', color: 'error' },
  { icon: TimerIcon, key: 'avgDuration', label: 'Avg Duration', color: 'info', format: formatDuration }
];

function DeltaText({ current, previous, upIsGood }) {
  if (!previous || previous === 0) return null;
  const delta = ((current - previous) / previous) * 100;
  if (!isFinite(delta) || Math.abs(delta) < 0.01) return null;
  const isUp = delta > 0;
  const isGood = isUp === upIsGood;
  const color = isGood ? 'success.main' : 'error.main';
  return (
    <Typography variant="caption" sx={{ color, fontWeight: 600 }}>
      {isUp ? '\u2191' : '\u2193'} {Math.abs(delta).toFixed(1)}%
    </Typography>
  );
}

function KpiCard({ icon: Icon, value, label, color, loading: isLoading, delta }) {
  const theme = useChartTheme();
  if (isLoading) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          borderRadius: 2,
          boxShadow: CARD_SHADOW,
          borderBottom: `3px solid ${theme.palette[color]?.main || color}`,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}
      >
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={{ xs: 1, lg: 2 }}
          alignItems="center"
          sx={{ textAlign: { xs: 'center', lg: 'left' } }}
        >
          <Skeleton variant="rounded" width={48} height={48} sx={{ borderRadius: '12px' }} />
          <Stack spacing={0.5} sx={{ flex: { lg: 1 }, width: '100%', alignItems: { xs: 'center', lg: 'flex-start' } }}>
            <Skeleton width={60} height={28} />
            <Skeleton width={80} height={18} />
          </Stack>
        </Stack>
      </Paper>
    );
  }
  const themeColor = theme.palette[color]?.main || color;
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        borderRadius: 2,
        boxShadow: CARD_SHADOW,
        borderBottom: `3px solid ${themeColor}`,
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}
    >
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={{ xs: 1, lg: 2 }}
        alignItems="center"
        sx={{ textAlign: { xs: 'center', lg: 'left' } }}
      >
        {/* Icon with gradient background */}
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(135deg, ${alpha(themeColor, 0.15)} 0%, ${alpha(themeColor, 0.05)} 100%)`,
            flexShrink: 0
          }}
        >
          <Icon sx={{ fontSize: 24, color: themeColor }} />
        </Box>
        {/* Value + label */}
        <Stack spacing={0.25} sx={{ flex: { lg: 1 }, minWidth: 0, width: '100%', alignItems: { xs: 'center', lg: 'flex-start' } }}>
          <Typography variant="h2" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography variant="body2" color="text.secondary" fontWeight={500}>
            {label}
          </Typography>
          {delta}
        </Stack>
      </Stack>
    </Paper>
  );
}

function averageOf(rows, getter) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + (getter(row) || 0), 0) / rows.length;
}

function getComparisonChartHeight(rowCount) {
  return Math.max(360, rowCount * 36 + 110);
}

function truncateLabel(label, max = 22) {
  if (!label) return '';
  return label.length > max ? `${label.slice(0, max - 1)}...` : label;
}

function getYAxisLabelWidth(labels, minimum = 92, maximum = 132) {
  if (!labels?.length) return minimum;
  const longest = labels.reduce((max, label) => Math.max(max, truncateLabel(label).length), 0);
  return Math.min(maximum, Math.max(minimum, longest * 7));
}

function CallsComparisonCharts({ rows, comparisonRows, onOpenClient }) {
  const theme = useChartTheme();
  const activeRows = rows.filter((row) => row.platformCoverage?.hasCTM);
  const comparisonActiveRows = (comparisonRows || []).filter((row) => row.platformCoverage?.hasCTM);
  const comparisonLookup = new Map(comparisonActiveRows.map((row) => [row.userId, row]));
  const hasComparison = comparisonActiveRows.length > 0;

  if (!activeRows.length) {
    return (
      <EmptyState
        icon={PhoneIcon}
        title="No CTM comparison data"
        message="None of the selected clients returned calls or forms data for this date range."
      />
    );
  }

  const benchmarkRow =
    activeRows.length > 1
      ? {
          userId: null,
          name: 'Group Average',
          totalLeads: averageOf(activeRows, (row) => row.totalLeads),
          qualifiedRate: averageOf(activeRows, (row) => row.qualifiedRate),
          missedRate: averageOf(activeRows, (row) => row.missedRate),
          avgDuration: averageOf(activeRows, (row) => row.avgDuration),
          totalCalls: averageOf(activeRows, (row) => row.totalCalls),
          totalForms: averageOf(activeRows, (row) => row.totalForms),
          isBenchmark: true
        }
      : null;
  const comparisonBenchmarkRow =
    comparisonActiveRows.length > 1
      ? {
          userId: null,
          name: 'Comparison Average',
          totalLeads: averageOf(comparisonActiveRows, (row) => row.totalLeads),
          qualifiedRate: averageOf(comparisonActiveRows, (row) => row.qualifiedRate),
          missedRate: averageOf(comparisonActiveRows, (row) => row.missedRate),
          avgDuration: averageOf(comparisonActiveRows, (row) => row.avgDuration),
          totalCalls: averageOf(comparisonActiveRows, (row) => row.totalCalls),
          totalForms: averageOf(comparisonActiveRows, (row) => row.totalForms),
          isBenchmark: true
        }
      : null;
  const displayRows = benchmarkRow ? [...activeRows, benchmarkRow] : activeRows;
  const labels = displayRows.map((row) => row.name);
  const shareLabels = activeRows.map((row) => row.name);
  const totalLeadsSeries = displayRows.map((row) => row.totalLeads || 0);
  const qualifiedRateSeries = displayRows.map((row) => Number((row.qualifiedRate || 0).toFixed(1)));
  const missedRateSeries = displayRows.map((row) => Number((row.missedRate || 0).toFixed(1)));
  const durationSeries = displayRows.map((row) => row.avgDuration || 0);
  const callsSeries = displayRows.map((row) => row.totalCalls || 0);
  const formsSeries = displayRows.map((row) => row.totalForms || 0);
  const getComparisonRow = (row) => (row.userId ? comparisonLookup.get(row.userId) : comparisonBenchmarkRow);
  const comparisonLeadsSeries = displayRows.map((row) => getComparisonRow(row)?.totalLeads || 0);
  const comparisonQualifiedRateSeries = displayRows.map((row) => Number((getComparisonRow(row)?.qualifiedRate || 0).toFixed(1)));
  const comparisonMissedRateSeries = displayRows.map((row) => Number((getComparisonRow(row)?.missedRate || 0).toFixed(1)));
  const comparisonDurationSeries = displayRows.map((row) => getComparisonRow(row)?.avgDuration || 0);
  const comparisonCallsSeries = displayRows.map((row) => getComparisonRow(row)?.totalCalls || 0);
  const comparisonFormsSeries = displayRows.map((row) => getComparisonRow(row)?.totalForms || 0);
  const totalLeads = activeRows.reduce((sum, row) => sum + (row.totalLeads || 0), 0);
  const chartHeight = getComparisonChartHeight(displayRows.length);
  const yAxisLabelWidth = getYAxisLabelWidth(labels);

  const chartEvents = {
    dataPointSelection: (_event, _ctx, config) => {
      const row = displayRows[config.dataPointIndex];
      if (row?.userId) onOpenClient(row.userId);
    }
  };

  const baseBar = getPremiumChartDefaults(theme);
  const makeHorizontalBarOptions = ({ title, color, formatter, labelFormatter, xaxisFormatter, metric, currentValues = [], comparisonValues = [] }) => {
    const upIsGood = metric ? getMetricPolarity(metric) : true;
    const seriesColors = buildComparisonSeriesColors(theme, currentValues, comparisonValues, upIsGood, color);
    const tooltip = comparisonValues?.length
      ? buildComparisonTooltip({ formatter, labels, upIsGood })
      : buildSimpleTooltip({ formatter, labels });
    return {
      ...baseBar,
      chart: { ...baseBar.chart, type: 'bar', width: '100%', events: chartEvents, redrawOnParentResize: true, redrawOnWindowResize: true },
      colors: seriesColors,
      stroke: { width: 0 },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 6,
          barHeight: '62%'
        }
      },
      dataLabels: {
        enabled: true,
        formatter: labelFormatter || formatter,
        style: { fontSize: '11px', fontWeight: 700, colors: ['#ffffff'] }
      },
      xaxis: {
        categories: labels,
        title: { text: title },
        ...(xaxisFormatter ? { labels: { formatter: xaxisFormatter } } : {})
      },
      yaxis: {
        labels: {
          minWidth: 0,
          maxWidth: yAxisLabelWidth,
          formatter: (value) => truncateLabel(value)
        }
      },
      grid: { ...baseBar.grid, padding: { left: 6, right: 6 } },
      tooltip,
      legend: {
        show: hasComparison,
        position: 'top',
        horizontalAlign: 'left'
      }
    };
  };

  const leadShareOptions = {
    ...getPremiumDonutDefaults(theme, PREMIUM_COLORS),
    labels: shareLabels,
    chart: {
      ...getPremiumDonutDefaults(theme, PREMIUM_COLORS).chart,
      width: '100%',
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
      events: chartEvents
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (value) => `${value.toLocaleString()} leads`
      }
    }
  };

  const callsFormsOptions = {
    ...getPremiumChartDefaults(theme),
    chart: {
      ...getPremiumChartDefaults(theme).chart,
      type: 'bar',
      stacked: false,
      width: '100%',
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
      events: chartEvents
    },
    colors: hasComparison
      ? [theme.palette.primary.main, theme.palette.grey[500], theme.palette.secondary.main, theme.palette.grey[300]]
      : [theme.palette.primary.main, theme.palette.secondary.main],
    plotOptions: {
      bar: {
        borderRadius: 4,
        columnWidth: '55%'
      }
    },
    xaxis: {
      categories: labels
    },
    yaxis: {
      title: { text: 'Count' }
    },
    tooltip: {
      theme: 'dark',
      shared: true,
      intersect: false
    },
    legend: {
      position: 'top',
      horizontalAlign: 'left'
    }
  };

  return (
    <Stack spacing={3} sx={{ mb: 3 }}>
      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title="Total Leads by Account" subtitle="All CTM-tracked calls and form submissions per account.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Total Leads',
              color: theme.palette.primary.main,
              formatter: (value) => `${value.toLocaleString()} leads`,
              metric: 'totalLeads',
              currentValues: totalLeadsSeries,
              comparisonValues: hasComparison ? comparisonLeadsSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: totalLeadsSeries },
                    { name: 'Comparison', data: comparisonLeadsSeries }
                  ]
                : [{ name: 'Total Leads', data: totalLeadsSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard title="Lead Share" subtitle="How total leads are distributed across accounts in this range.">
          {totalLeads > 0 ? (
            <Stack spacing={1.5}>
              <Chart
                options={leadShareOptions}
                series={activeRows.map((row) => row.totalLeads || 0)}
                type="donut"
                height={320}
                width="100%"
              />
              {hasComparison && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Current ${totalLeads.toLocaleString()} leads`} color="primary" variant="outlined" />
                    <Chip
                      size="small"
                      label={`Comparison ${comparisonActiveRows.reduce((sum, row) => sum + (row.totalLeads || 0), 0).toLocaleString()} leads`}
                      variant="outlined"
                    />
                  </Stack>
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">No lead share data available</Typography>
          )}
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title="Qualified Rate by Account" subtitle="Qualified leads divided by total leads per account.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Qualified Rate',
              color: theme.palette.success.main,
              formatter: (value) => `${value.toFixed(1)}%`,
              xaxisFormatter: (value) => `${value}%`,
              metric: 'qualifiedRate',
              currentValues: qualifiedRateSeries,
              comparisonValues: hasComparison ? comparisonQualifiedRateSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: qualifiedRateSeries },
                    { name: 'Comparison', data: comparisonQualifiedRateSeries }
                  ]
                : [{ name: 'Qualified Rate', data: qualifiedRateSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard title="Missed Call Rate by Account" subtitle="Share of inbound calls that went unanswered per account.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Missed Call Rate',
              color: theme.palette.error.main,
              formatter: (value) => `${value.toFixed(1)}%`,
              xaxisFormatter: (value) => `${value}%`,
              metric: 'missedRate',
              currentValues: missedRateSeries,
              comparisonValues: hasComparison ? comparisonMissedRateSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: missedRateSeries },
                    { name: 'Comparison', data: comparisonMissedRateSeries }
                  ]
                : [{ name: 'Missed Call Rate', data: missedRateSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard
          title="Calls vs Forms by Account"
          subtitle="Inbound call volume vs tracked form submissions per account."
          span={{ xs: 12, md: 7 }}
        >
          <Chart
            options={callsFormsOptions}
            series={[
              ...(hasComparison
                ? [
                    { name: 'Current Calls', data: callsSeries },
                    { name: 'Comparison Calls', data: comparisonCallsSeries },
                    { name: 'Current Forms', data: formsSeries },
                    { name: 'Comparison Forms', data: comparisonFormsSeries }
                  ]
                : [
                    { name: 'Calls', data: callsSeries },
                    { name: 'Forms', data: formsSeries }
                  ])
            ]}
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard
          title="Avg Call Duration by Account"
          subtitle="Average inbound call length per account in this date range."
          span={{ xs: 12, md: 5 }}
        >
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Avg Duration',
              color: theme.palette.info.main,
              formatter: (value) => formatDuration(value),
              labelFormatter: (value) => formatDuration(value),
              xaxisFormatter: (value) => formatDuration(value),
              metric: 'avgDuration',
              currentValues: durationSeries,
              comparisonValues: hasComparison ? comparisonDurationSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: durationSeries },
                    { name: 'Comparison', data: comparisonDurationSeries }
                  ]
                : [{ name: 'Avg Duration', data: durationSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
      </Grid>

      {/* Open Individual View panel hidden — inconsistent placement across tabs;
          users can switch accounts from the top selection controls instead. */}
      {/* <Paper sx={{ p: 2.5, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1.5 }}>
          Open Individual View
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Click any chart above or open an account directly to review its detailed intake, source attribution, and heatmap.
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {activeRows.map((row) => (
            <Button key={row.userId} variant="outlined" endIcon={<OpenInNewIcon />} onClick={() => onOpenClient(row.userId)}>
              {row.name}
            </Button>
          ))}
        </Stack>
      </Paper> */}
    </Stack>
  );
}

export default function CallsLeadsTab({ userId, dateRange, comparisonRange, selection, onSelectionChange }) {
  const theme = useChartTheme();
  const defaults = getPremiumChartDefaults(theme);
  const isMultiClient = selection && selection.mode !== 'single';
  const [summary, setSummary] = useState(null);
  const [comparisonSummary, setComparisonSummary] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [comparisonRatings, setComparisonRatings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [comparisonCategories, setComparisonCategories] = useState([]);
  const [sources, setSources] = useState([]);
  const [comparisonSources, setComparisonSources] = useState([]);
  const [volume, setVolume] = useState([]);
  const [comparisonVolume, setComparisonVolume] = useState([]);
  const [duration, setDuration] = useState([]);
  const [comparisonDuration, setComparisonDuration] = useState([]);
  const [perClient, setPerClient] = useState([]);
  const [, setComparisonGroupData] = useState(null);
  const [comparisonPerClient, setComparisonPerClient] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [groupLabel, setGroupLabel] = useState(null);
  const [loading, setLoading] = useState(true);
  const definitionItems = [
    {
      label: 'Lead',
      definition: 'A lead in this tab is any inbound CTM-tracked call or tracked form submission.',
      color: 'info'
    },
    {
      label: 'Qualified Lead',
      definition: 'A qualified lead is a call or form with a CTM score of 3 stars or higher.',
      color: 'success'
    },
    {
      label: 'Qualified Rate',
      definition: 'Qualified Leads divided by Total Leads for the selected range.',
      color: 'warning'
    }
  ];

  useEffect(() => {
    setLoading(true);
    setComparisonSummary(null);
    setComparisonRatings([]);
    setComparisonCategories([]);
    setComparisonSources([]);
    setComparisonVolume([]);
    setComparisonDuration([]);
    const params = { start: dateRange.start, end: dateRange.end };

    if (isMultiClient) {
      fetchGroupCallsLeads(selection, params)
        .then((data) => {
          setSummary(data.summary || null);
          setRatings(data.ratings || []);
          setCategories(data.categories || []);
          setSources(data.sources || []);
          setVolume(data.volume || []);
          setDuration(data.duration || []);
          setPerClient(data.perClient || []);
          setComparisonGroupData(null);
          setComparisonPerClient([]);
          setCoverage(data.coverage || null);
          setGroupLabel(data.label || null);
        })
        .catch(() => {
          setSummary(null);
          setRatings([]);
          setCategories([]);
          setSources([]);
          setVolume([]);
          setDuration([]);
          setPerClient([]);
          setComparisonGroupData(null);
          setComparisonPerClient([]);
          setCoverage(null);
          setGroupLabel(null);
        })
        .finally(() => setLoading(false));

      if (comparisonRange) {
        const compParams = { start: comparisonRange.start, end: comparisonRange.end };
        fetchGroupCallsLeads(selection, compParams)
          .then((data) => {
            setComparisonGroupData(data);
            setComparisonPerClient(data.perClient || []);
            setComparisonSummary(data.summary || null);
          })
          .catch(() => {
            setComparisonGroupData(null);
            setComparisonPerClient([]);
            setComparisonSummary(null);
          });
      }
      return;
    }

    if (!userId) {
      setLoading(false);
      return;
    }

    setCoverage(null);
    setGroupLabel(null);
    setPerClient([]);
    setComparisonGroupData(null);
    setComparisonPerClient([]);
    Promise.all([
      fetchCallsLeadsSummary(userId, params).catch(() => ({})),
      fetchCallsLeadsByRating(userId, params).catch(() => ({ ratings: [] })),
      fetchCallsLeadsByCategory(userId, params).catch(() => ({ categories: [] })),
      fetchCallsLeadsBySource(userId, params).catch(() => ({ sources: [] })),
      fetchCallsLeadsVolume(userId, params).catch(() => ({ timeSeries: [] })),
      fetchCallsLeadsDuration(userId, params).catch(() => ({ distribution: [] }))
    ])
      .then(([sum, rat, cat, src, vol, dur]) => {
        setSummary(sum);
        setRatings(rat.ratings || []);
        setCategories(cat.categories || []);
        setSources(src.sources || []);
        setVolume(vol.timeSeries || []);
        setDuration(dur.distribution || []);
      })
      .finally(() => setLoading(false));

    // Fetch all comparison datasets in parallel when comparison range is active
    if (comparisonRange) {
      const compParams = { start: comparisonRange.start, end: comparisonRange.end };
      Promise.all([
        fetchCallsLeadsSummary(userId, compParams).catch(() => null),
        fetchCallsLeadsByRating(userId, compParams).catch(() => ({ ratings: [] })),
        fetchCallsLeadsByCategory(userId, compParams).catch(() => ({ categories: [] })),
        fetchCallsLeadsBySource(userId, compParams).catch(() => ({ sources: [] })),
        fetchCallsLeadsVolume(userId, compParams).catch(() => ({ timeSeries: [] })),
        fetchCallsLeadsDuration(userId, compParams).catch(() => ({ distribution: [] }))
      ]).then(([sum, rat, cat, src, vol, dur]) => {
        setComparisonSummary(sum);
        setComparisonRatings(rat?.ratings || []);
        setComparisonCategories(cat?.categories || []);
        setComparisonSources(src?.sources || []);
        setComparisonVolume(vol?.timeSeries || []);
        setComparisonDuration(dur?.distribution || []);
      });
    }
  }, [userId, dateRange, comparisonRange, isMultiClient, selection]);

  const sourceColumns = useMemo(() => {
    const compMap = new Map(comparisonSources.map((row) => [row.source, row]));
    if (isMultiClient || compMap.size === 0) return SOURCE_COLUMNS;
    return SOURCE_COLUMNS.map((col) => {
      if (col.id !== 'total') return col;
      return {
        ...col,
        render: (row) => {
          const prev = compMap.get(row.source)?.total;
          const delta = computeDelta(row.total, prev);
          const deltaStr = prev != null ? formatDeltaPercent(row.total, prev) : null;
          const outcome = getDeltaOutcome(delta, getMetricPolarity('totalLeads'));
          const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
          const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';
          return (
            <Stack direction="row" spacing={1} alignItems="baseline" justifyContent="flex-end">
              <Typography variant="body2">{(row.total || 0).toLocaleString()}</Typography>
              {deltaStr && (
                <Typography variant="caption" sx={{ color: deltaColor, fontWeight: 600 }}>
                  {arrow} {deltaStr.replace(/^[+-]/, '')}
                </Typography>
              )}
            </Stack>
          );
        }
      };
    });
  }, [comparisonSources, isMultiClient, theme]);

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
      </Paper>
    );
  }

  const noData = !summary?.totalCalls && !ratings.length && !sources.length;
  if (noData) {
    return (
      <EmptyState
        icon={PhoneIcon}
        title="No calls or leads data yet"
        message={
          isMultiClient
            ? 'Call and lead data will appear here once at least one selected client has CTM interactions for this date range.'
            : 'Call and lead data will appear here once CTM starts tracking interactions for this client.'
        }
      />
    );
  }

  // --- KPI row ---
  const kpis = KPI_MAP.map(({ icon, key, label, color, format: fmt }) => ({
    icon,
    value: fmt ? fmt(summary?.[key]) : (summary?.[key] ?? 0).toLocaleString(),
    label,
    color,
    delta:
      comparisonSummary ? (
        <DeltaText current={summary?.[key]} previous={comparisonSummary?.[key]} upIsGood={key !== 'missedCalls'} />
      ) : null
  }));

  // --- Rating horizontal bar (premium) ---
  const ratingsSorted = [...ratings].sort((a, b) => a.rating - b.rating);
  const ratingLabels = ratingsSorted.map((r) => `${r.rating} Star${r.rating !== 1 ? 's' : ''}`);
  const ratingCurrent = ratingsSorted.map((r) => r.count);
  const ratingComparisonByRating = new Map(comparisonRatings.map((r) => [r.rating, r.count]));
  const ratingComparisonValues = ratingsSorted.map((r) => ratingComparisonByRating.get(r.rating) || 0);
  const hasRatingComparison = !isMultiClient && comparisonRatings.length > 0;

  const ratingBarOptions = hasRatingComparison
    ? {
        ...defaults,
        chart: { ...defaults.chart, type: 'bar', width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true },
        plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: '62%' } },
        stroke: { width: 0 },
        colors: buildComparisonSeriesColors(theme, ratingCurrent, ratingComparisonValues, getMetricPolarity('totalLeads'), theme.palette.primary.main),
        xaxis: { title: { text: 'Count' }, categories: ratingLabels },
        yaxis: {},
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 600 } },
        legend: { position: 'top', horizontalAlign: 'left' },
        tooltip: buildComparisonTooltip({
          formatter: (v) => `${v ?? 0} leads`,
          labels: ratingLabels,
          upIsGood: getMetricPolarity('totalLeads')
        })
      }
    : {
        ...defaults,
        chart: { ...defaults.chart, type: 'bar', width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true },
        plotOptions: { bar: { horizontal: true, borderRadius: 6, barHeight: '55%', distributed: true } },
        colors: ratingsSorted.map((r) => RATING_COLORS[r.rating] || theme.palette.grey[400]),
        xaxis: { title: { text: 'Count' } },
        yaxis: { categories: ratingLabels },
        tooltip: { theme: 'dark', style: { fontSize: '12px' }, y: { formatter: (val) => `${val} leads` } },
        legend: { show: false },
        dataLabels: { enabled: true, style: { fontSize: '12px', fontWeight: 600 } },
        fill: {
          type: 'gradient',
          gradient: {
            shade: 'light',
            type: 'horizontal',
            shadeIntensity: 0.2,
            gradientToColors: ratingsSorted.map((r) => RATING_COLORS[r.rating] || theme.palette.grey[400]),
            opacityFrom: 1,
            opacityTo: 0.85,
            stops: [0, 100]
          }
        }
      };

  const ratingBarSeries = hasRatingComparison
    ? [
        { name: 'Current', data: ratingCurrent },
        { name: 'Comparison', data: ratingComparisonValues }
      ]
    : [{ name: 'Leads', data: ratingCurrent }];

  // --- Category donut (premium) ---
  const categoryLabels = categories.map((c) => formatCategory(c.category));
  const categorySeries = categories.map((c) => c.count);
  const categoryTotal = categorySeries.reduce((a, b) => a + b, 0);
  const categoryDonutOptions = {
    ...getPremiumDonutDefaults(theme, PREMIUM_COLORS),
    labels: categoryLabels,
    chart: {
      ...getPremiumDonutDefaults(theme, PREMIUM_COLORS).chart,
      width: '100%',
      redrawOnParentResize: true,
      redrawOnWindowResize: true
    },
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px' },
      y: {
        formatter: (val) => {
          const pct = categoryTotal > 0 ? ((val / categoryTotal) * 100).toFixed(1) : '0.0';
          return `${val} leads (${pct}%)`;
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
              formatter: () => categoryTotal.toLocaleString()
            },
            total: {
              show: true,
              showAlways: true,
              label: 'Total Leads',
              fontSize: '13px',
              fontFamily: theme.typography.fontFamily,
              color: theme.palette.text.secondary,
              formatter: () => categoryTotal.toLocaleString()
            }
          }
        },
        expandOnClick: true
      }
    }
  };

  // --- Volume stacked bar chart (premium) ---
  const volumeDates = volume.map((v) => v.date);
  const volumeCategories = volumeDates.map((date) => `${getWeekdayLabel(date)} ${formatDate(date)}`);
  const volumeLabelColors = volumeDates.map((date) => (isWeekendDate(date) ? theme.palette.warning.main : theme.palette.text.secondary));
  // Group consecutive weekend days (Sat+Sun) into a single range annotation so each
  // weekend renders one label instead of two overlapping "Weekend" markers.
  const weekendRanges = [];
  for (let i = 0; i < volumeDates.length; i += 1) {
    const date = volumeDates[i];
    if (!isWeekendDate(date)) continue;
    const label = `${getWeekdayLabel(date)} ${formatDate(date)}`;
    const nextDate = volumeDates[i + 1];
    if (nextDate && isWeekendDate(nextDate)) {
      weekendRanges.push({ x: label, x2: `${getWeekdayLabel(nextDate)} ${formatDate(nextDate)}` });
      i += 1;
    } else {
      weekendRanges.push({ x: label, x2: label });
    }
  }
  const weekendAnnotations = weekendRanges.map(({ x, x2 }) => ({
    x,
    x2,
    fillColor: alpha(theme.palette.warning.main, 0.1),
    opacity: 1,
    label: {
      text: 'Weekend',
      orientation: 'horizontal',
      offsetY: -6,
      style: {
        fontSize: '11px',
        fontWeight: 600,
        color: theme.palette.warning.contrastText,
        background: theme.palette.warning.main,
        padding: { left: 8, right: 8, top: 3, bottom: 3 }
      }
    }
  }));
  const volumeCallsData = volume.map((v) => v.calls ?? 0);
  const volumeFormsData = volume.map((v) => v.forms ?? 0);
  const volumeOptions = {
    ...defaults,
    chart: { ...defaults.chart, type: 'bar', stacked: true, width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true },
    annotations: {
      xaxis: weekendAnnotations
    },
    colors: [theme.palette.primary.main, theme.palette.secondary.main],
    stroke: { width: 0 },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
    xaxis: {
      categories: volumeCategories,
      labels: {
        rotate: -45,
        style: {
          fontSize: '11px',
          colors: volumeLabelColors
        }
      },
      tickAmount: Math.min(volumeDates.length, 15),
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { title: { text: 'Count' } },
    tooltip: {
      theme: 'dark',
      shared: true,
      intersect: false,
      custom: function ({ series: seriesData, dataPointIndex, w }) {
        const date = volumeDates[dataPointIndex];
        const formatted = formatDate(date);
        let html = '<div style="padding: 12px 16px; min-width: 160px;">';
        html += `<div style="font-size: 12px; color: #999; margin-bottom: 8px;">${formatted}</div>`;
        w.config.series.forEach((s, i) => {
          const val = seriesData[i][dataPointIndex];
          const color = w.config.colors[i];
          html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">';
          html += `<span style="display: flex; align-items: center; gap: 6px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>${s.name}</span>`;
          html += `<span style="font-weight: 600;">${val}</span>`;
          html += '</div>';
        });
        html += '</div>';
        return html;
      }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'left',
      fontSize: '12px',
      fontFamily: theme.typography.fontFamily,
      labels: { colors: theme.palette.text.secondary }
    }
  };
  const volumeSeries = [
    { name: 'Calls', data: volumeCallsData },
    { name: 'Forms', data: volumeFormsData }
  ];

  // --- Duration bar (premium) ---
  const durationLabels = duration.map((d) => BUCKET_LABELS[d.bucket] || d.bucket);
  const durationCounts = duration.map((d) => d.count);
  const durationComparisonByBucket = new Map(comparisonDuration.map((d) => [d.bucket, d.count]));
  const durationComparisonValues = duration.map((d) => durationComparisonByBucket.get(d.bucket) || 0);
  const hasDurationComparison = !isMultiClient && comparisonDuration.length > 0;

  const durationOptions = hasDurationComparison
    ? {
        ...defaults,
        chart: { ...defaults.chart, type: 'bar', width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true },
        colors: buildComparisonSeriesColors(theme, durationCounts, durationComparisonValues, getMetricPolarity('totalCalls'), theme.palette.info.main),
        plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
        stroke: { width: 0 },
        xaxis: { categories: durationLabels },
        yaxis: { title: { text: 'Count' } },
        legend: { position: 'top', horizontalAlign: 'left' },
        tooltip: buildComparisonTooltip({
          formatter: (v) => `${v ?? 0} calls`,
          labels: durationLabels,
          upIsGood: getMetricPolarity('totalCalls')
        }),
        dataLabels: { enabled: true, style: { fontSize: '12px', fontWeight: 600 } }
      }
    : {
        ...defaults,
        chart: { ...defaults.chart, type: 'bar', width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true },
        colors: [theme.palette.info.main],
        plotOptions: { bar: { borderRadius: 6, columnWidth: '55%' } },
        fill: {
          type: 'gradient',
          gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.2, opacityFrom: 1, opacityTo: 0.85, stops: [0, 100] }
        },
        xaxis: { categories: durationLabels },
        yaxis: { title: { text: 'Count' } },
        tooltip: { theme: 'dark', style: { fontSize: '12px' }, y: { formatter: (val) => `${val} calls` } },
        dataLabels: { enabled: true, style: { fontSize: '12px', fontWeight: 600 } }
      };

  const durationSeries = hasDurationComparison
    ? [
        { name: 'Current', data: durationCounts },
        { name: 'Comparison', data: durationComparisonValues }
      ]
    : [{ name: 'Calls', data: durationCounts }];

  // --- Category / Volume comparison totals (for chip strips) ---
  const categoryComparisonTotal = comparisonCategories.reduce((sum, c) => sum + (c.count || 0), 0);
  const volumeCallsTotal = volume.reduce((sum, v) => sum + (v.calls || 0), 0);
  const volumeFormsTotal = volume.reduce((sum, v) => sum + (v.forms || 0), 0);
  const comparisonVolumeCallsTotal = comparisonVolume.reduce((sum, v) => sum + (v.calls || 0), 0);
  const comparisonVolumeFormsTotal = comparisonVolume.reduce((sum, v) => sum + (v.forms || 0), 0);
  const showVolumeComparison = !isMultiClient && comparisonVolume.length > 0;
  const showCategoryComparison = !isMultiClient && comparisonCategories.length > 0;

  const handleOpenClient = (nextUserId) => {
    if (!onSelectionChange) return;
    onSelectionChange(
      {
        mode: 'single',
        userId: nextUserId,
        groupId: null,
        includedUserIds: [],
        excludedUserIds: []
      },
      { preserveReturnSelection: true, clearReturnSelection: false }
    );
  };

  return (
    <>
      <MetricDefinitionStrip items={definitionItems} sx={{ mb: 2 }} />

{/* KPI cards */}
      <Grid container spacing={2} sx={{ mb: 3, width: '100%' }}>
        {kpis.map((kpi) => (
          <Grid size={{ xs: 6, sm: 4, md: 3, lg: 2 }} key={kpi.label}>
            <KpiCard {...kpi} loading={loading} />
          </Grid>
        ))}
      </Grid>

      {isMultiClient && <CallsComparisonCharts rows={perClient} comparisonRows={comparisonPerClient} onOpenClient={handleOpenClient} />}

      {/* Rating + Category charts */}
      <Grid container spacing={3} sx={{ mb: 3, width: '100%' }}>
        <ChartCard title="Rating Breakdown" subtitle="Number of leads at each CTM star rating in this date range.">
          {ratingsSorted.length > 0 ? (
            <Chart options={ratingBarOptions} series={ratingBarSeries} type="bar" height={280} width="100%" />
          ) : (
            <Typography color="text.secondary">No rating data available</Typography>
          )}
        </ChartCard>
        <ChartCard title="Lead Type Breakdown" subtitle="How leads break down across CTM categories (e.g. warm, applicant, spam).">
          {categories.length > 0 ? (
            <Stack spacing={1.5}>
              <Chart options={categoryDonutOptions} series={categorySeries} type="donut" height={280} width="100%" />
              {showCategoryComparison && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Current ${categoryTotal.toLocaleString()} leads`} color="primary" variant="outlined" />
                  <Chip size="small" label={`Previous ${categoryComparisonTotal.toLocaleString()} leads`} variant="outlined" />
                </Stack>
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">No category data available</Typography>
          )}
        </ChartCard>
      </Grid>

      {/* Volume over time */}
      {volume.length > 0 && (
        <FullWidthChartCard
          title="Calls vs Forms Over Time"
          subtitle="Daily intake of calls and form submissions, with weekend dates highlighted on the x-axis."
        >
          {showVolumeComparison && (
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Current ${volumeCallsTotal.toLocaleString()} calls / ${volumeFormsTotal.toLocaleString()} forms`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`Previous ${comparisonVolumeCallsTotal.toLocaleString()} calls / ${comparisonVolumeFormsTotal.toLocaleString()} forms`}
              />
            </Stack>
          )}
          <Chart options={volumeOptions} series={volumeSeries} type="bar" height={320} width="100%" />
        </FullWidthChartCard>
      )}

      {/* Source attribution table */}
      <MainCard title={isMultiClient ? 'Source Attribution Rollup' : 'Source Attribution'} sx={{ mb: 3 }}>
        <DataTable
          columns={sourceColumns}
          rows={sources}
          rowKey={(row, i) => `${row.source}-${i}`}
          searchable
          searchFields={['source']}
          searchPlaceholder="Search sources..."
          paginated
          pageSize={10}
          defaultSort={{ id: 'total', direction: 'desc' }}
          loading={loading}
          emptyTitle="No source data"
          size="small"
        />
      </MainCard>

      {/* Duration distribution */}
      {duration.length > 0 && (
        <FullWidthChartCard
          title="Call Duration Distribution"
          subtitle="How calls bucket out by length — short calls, conversations, and long calls."
        >
          <Chart options={durationOptions} series={durationSeries} type="bar" height={280} width="100%" />
        </FullWidthChartCard>
      )}

      {/* Call volume heatmap — aggregated across the selected clients in group/custom mode */}
      <CallHeatmap userId={userId} selection={selection} dateRange={dateRange} />
    </>
  );
}
