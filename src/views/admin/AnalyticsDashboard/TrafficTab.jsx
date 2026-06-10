import { useState, useEffect, useMemo } from 'react';
import { Alert, Button, Chip, Grid, Skeleton, Stack, Typography, Paper } from '@mui/material';
import Chart from 'react-apexcharts';
import MainCard from 'ui-component/cards/MainCard';
import DataTable from 'ui-component/extended/DataTable';
import EmptyState from 'ui-component/extended/EmptyState';
import { fetchTrafficSources, fetchLandingPages, fetchDeviceBreakdown, fetchGroupTraffic, fetchTrafficSummary } from 'api/analytics';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { IconUsers, IconUserPlus, IconClock, IconChartBar } from '@tabler/icons-react';
import ChartCard from './ChartCard';
import MetricDefinitionStrip from './MetricDefinitionStrip';
import ComparisonKpiCards from './ComparisonKpiCard';
import { getPremiumDonutDefaults, getPremiumChartDefaults, CARD_SHADOW, useChartTheme } from './chartTheme';
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

function formatDurationHMS(seconds) {
  if (!seconds) return '00:00:00';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const TRAFFIC_KPI_CONFIG = [
  { key: 'activeUsers', label: 'Active users', icon: IconUsers, format: (v) => v.toLocaleString(), color: 'primary', upIsGood: true },
  { key: 'newUsers', label: 'New users', icon: IconUserPlus, format: (v) => v.toLocaleString(), color: 'success', upIsGood: true },
  {
    key: 'avgSessionDuration',
    label: 'Average session duration',
    icon: IconClock,
    format: formatDurationHMS,
    color: 'info',
    upIsGood: true
  },
  {
    key: 'engagedSessions',
    label: 'Engaged sessions',
    icon: IconChartBar,
    format: (v) => v.toLocaleString(),
    color: 'warning',
    upIsGood: true
  }
];

const SOURCE_COLUMNS = [
  { id: 'source', label: 'Source', sortable: true },
  { id: 'medium', label: 'Medium', sortable: true },
  { id: 'sessions', label: 'Sessions', sortable: true, align: 'right' },
  { id: 'users', label: 'Users', sortable: true, align: 'right' },
  {
    id: 'engagedSessions',
    label: 'Engaged Sessions',
    sortable: true,
    align: 'right',
    render: (row) => (row.engagedSessions || 0).toLocaleString()
  },
  {
    id: 'engagementRate',
    label: 'Engagement Rate',
    sortable: true,
    align: 'right',
    render: (row) => formatPercent((row.engagementRate || 0) * 100)
  },
  {
    id: 'avgDuration',
    label: 'Avg Duration',
    sortable: true,
    align: 'right',
    render: (row) => formatDuration(row.avgDuration)
  }
];

const LANDING_PAGE_COLUMNS = [
  {
    id: 'page',
    label: 'Page',
    sortable: true,
    render: (row) => (
      <Typography variant="body2" noWrap sx={{ maxWidth: 280 }} title={row.page}>
        {row.page}
      </Typography>
    )
  },
  { id: 'sessions', label: 'Sessions', sortable: true, align: 'right' },
  {
    id: 'engagedSessions',
    label: 'Engaged Sessions',
    sortable: true,
    align: 'right',
    render: (row) => (row.engagedSessions || 0).toLocaleString()
  },
  {
    id: 'engagementRate',
    label: 'Engagement Rate',
    sortable: true,
    align: 'right',
    render: (row) => formatPercent((row.engagementRate || 0) * 100)
  }
];

// Device donut colors — curated subset
const DEVICE_COLORS = ['#6366f1', '#ec4899', '#f97316', '#22c55e'];

function formatPercent(value) {
  return `${(value || 0).toFixed(1)}%`;
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

function TrafficComparisonCharts({ rows, comparisonRows, onOpenClient }) {
  const theme = useChartTheme();
  const activeRows = rows.filter((row) => row.platformCoverage?.hasGA4);
  const comparisonActiveRows = (comparisonRows || []).filter((row) => row.platformCoverage?.hasGA4);
  const comparisonLookup = new Map((comparisonRows || []).map((row) => [row.userId, row]));
  const hasComparison = comparisonActiveRows.length > 0;

  if (!activeRows.length) {
    return (
      <EmptyState
        icon={TravelExploreIcon}
        title="No GA4 comparison data"
        message="None of the selected clients returned GA4 traffic data for this date range."
      />
    );
  }

  const benchmarkRow =
    activeRows.length > 1
      ? {
          userId: null,
          name: 'Group Average',
          sessions: averageOf(activeRows, (row) => row.sessions),
          engagedSessions: averageOf(activeRows, (row) => row.engagedSessions),
          engagementRate: averageOf(activeRows, (row) => row.engagementRate),
          avgDuration: averageOf(activeRows, (row) => row.avgDuration),
          isBenchmark: true
        }
      : null;
  const comparisonBenchmarkRow =
    (comparisonRows || []).length > 1
      ? {
          userId: null,
          name: 'Comparison Average',
          sessions: averageOf(comparisonRows, (row) => row.sessions),
          engagedSessions: averageOf(comparisonRows, (row) => row.engagedSessions),
          engagementRate: averageOf(comparisonRows, (row) => row.engagementRate),
          avgDuration: averageOf(comparisonRows, (row) => row.avgDuration),
          isBenchmark: true
        }
      : null;
  const displayRows = benchmarkRow ? [...activeRows, benchmarkRow] : activeRows;
  const labels = displayRows.map((row) => row.name);
  const shareLabels = activeRows.map((row) => row.name);
  const sessionsSeries = displayRows.map((row) => row.sessions || 0);
  const engagedSessionsSeries = displayRows.map((row) => row.engagedSessions || 0);
  const engagementRateSeries = displayRows.map((row) => Number(((row.engagementRate || 0) * 100).toFixed(1)));
  const durationSeries = displayRows.map((row) => row.avgDuration || 0);
  const getComparisonRow = (row) => (row.userId ? comparisonLookup.get(row.userId) : comparisonBenchmarkRow);
  const comparisonSessionsSeries = displayRows.map((row) => getComparisonRow(row)?.sessions || 0);
  const comparisonEngagedSessionsSeries = displayRows.map((row) => getComparisonRow(row)?.engagedSessions || 0);
  const comparisonEngagementRateSeries = displayRows.map((row) => Number((((getComparisonRow(row)?.engagementRate || 0) * 100)).toFixed(1)));
  const comparisonDurationSeries = displayRows.map((row) => getComparisonRow(row)?.avgDuration || 0);
  const totalSessions = activeRows.reduce((sum, row) => sum + (row.sessions || 0), 0);
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

  const sessionShareOptions = {
    ...getPremiumDonutDefaults(theme, DEVICE_COLORS),
    labels: shareLabels,
    chart: {
      ...getPremiumDonutDefaults(theme, DEVICE_COLORS).chart,
      width: '100%',
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
      events: chartEvents
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (value) => `${value.toLocaleString()} sessions`
      }
    }
  };

  return (
    <Stack spacing={3} sx={{ mb: 3 }}>
      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title="Sessions by Account" subtitle="GA4 sessions per account in the selected range.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Sessions',
              color: theme.palette.primary.main,
              formatter: (value) => `${value.toLocaleString()} sessions`,
              metric: 'sessions',
              currentValues: sessionsSeries,
              comparisonValues: hasComparison ? comparisonSessionsSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: sessionsSeries },
                    { name: 'Comparison', data: comparisonSessionsSeries }
                  ]
                : [{ name: 'Sessions', data: sessionsSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard title="Session Share" subtitle="How sessions are distributed across accounts in the selected range.">
          {totalSessions > 0 ? (
            <Stack spacing={1.5}>
              <Chart
                options={sessionShareOptions}
                series={activeRows.map((row) => row.sessions || 0)}
                type="donut"
                height={320}
                width="100%"
              />
              {hasComparison && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Current ${totalSessions.toLocaleString()} sessions`} color="primary" variant="outlined" />
                  <Chip
                    size="small"
                    label={`Comparison ${comparisonActiveRows.reduce((sum, row) => sum + (row.sessions || 0), 0).toLocaleString()} sessions`}
                    variant="outlined"
                  />
                </Stack>
              )}
            </Stack>
          ) : (
            <Typography color="text.secondary">No session share data available</Typography>
          )}
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard
          title="Engaged Sessions by Account"
          subtitle="Sessions over 10 seconds, with a conversion event, or 2+ pageviews — per account."
        >
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Engaged Sessions',
              color: theme.palette.success.main,
              formatter: (value) => `${value.toLocaleString()} engaged sessions`,
              metric: 'engagedSessions',
              currentValues: engagedSessionsSeries,
              comparisonValues: hasComparison ? comparisonEngagedSessionsSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: engagedSessionsSeries },
                    { name: 'Comparison', data: comparisonEngagedSessionsSeries }
                  ]
                : [{ name: 'Engaged Sessions', data: engagedSessionsSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard
          title="Engagement Rate by Account"
          subtitle="Engaged sessions divided by total sessions per account."
        >
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Engagement Rate',
              color: '#d97706',
              formatter: (value) => formatPercent(value),
              xaxisFormatter: (value) => `${value}%`,
              metric: 'engagementRate',
              currentValues: engagementRateSeries,
              comparisonValues: hasComparison ? comparisonEngagementRateSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: engagementRateSeries },
                    { name: 'Comparison', data: comparisonEngagementRateSeries }
                  ]
                : [{ name: 'Engagement Rate', data: engagementRateSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard
          title="Avg Session Duration by Account"
          subtitle="Average GA4 session length per account in the selected range."
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
        {/* Open Individual View panel hidden — inconsistent placement across tabs;
            users can switch accounts from the top selection controls instead. */}
        {/* <ChartCard
          title="Open Individual View"
          subtitle="Click any chart above or use these shortcuts to open the full single-account traffic view."
          paperSx={{ p: 2.5 }}
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {activeRows.map((row) => (
              <Button key={row.userId} variant="outlined" endIcon={<OpenInNewIcon />} onClick={() => onOpenClient(row.userId)}>
                {row.name}
              </Button>
            ))}
          </Stack>
        </ChartCard> */}
      </Grid>
    </Stack>
  );
}

export default function TrafficTab({ userId, dateRange, comparisonRange, selection, onSelectionChange }) {
  const theme = useChartTheme();
  const isMultiClient = selection && selection.mode !== 'single';
  const [sources, setSources] = useState([]);
  const [comparisonSources, setComparisonSources] = useState([]);
  const [comparisonPerClient, setComparisonPerClient] = useState([]);
  const [pages, setPages] = useState([]);
  const [comparisonPages, setComparisonPages] = useState([]);
  const [devices, setDevices] = useState([]);
  const [comparisonDevices, setComparisonDevices] = useState([]);
  const [perClient, setPerClient] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [groupLabel, setGroupLabel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trafficKpis, setTrafficKpis] = useState(null);
  const [comparisonTrafficKpis, setComparisonTrafficKpis] = useState(null);
  const definitionItems = [
    {
      label: 'Engaged Sessions',
      definition: 'GA4 sessions that lasted longer than 10 seconds, had a conversion event, or included at least 2 page or screen views.',
      color: 'success'
    },
    {
      label: 'Engagement Rate',
      definition: 'Engaged Sessions divided by total Sessions in GA4 for the selected range.',
      color: 'warning'
    }
  ];

  useEffect(() => {
    setLoading(true);
    setComparisonSources([]);
    setComparisonPages([]);
    setComparisonDevices([]);
    setTrafficKpis(null);
    setComparisonTrafficKpis(null);
    const params = { start: dateRange.start, end: dateRange.end };

    if (isMultiClient) {
      fetchGroupTraffic(selection, params)
        .then((data) => {
          setSources(data.sources || []);
          setPages(data.pages || []);
          setDevices(data.devices || []);
          setPerClient(data.perClient || []);
          setComparisonPerClient([]);
          setCoverage(data.coverage || null);
          setGroupLabel(data.label || null);
          setTrafficKpis(data.kpis || null);
        })
        .catch(() => {
          setSources([]);
          setPages([]);
          setDevices([]);
          setPerClient([]);
          setComparisonPerClient([]);
          setCoverage(null);
          setGroupLabel(null);
          setTrafficKpis(null);
        })
        .finally(() => setLoading(false));

      if (comparisonRange) {
        const compParams = { start: comparisonRange.start, end: comparisonRange.end };
        fetchGroupTraffic(selection, compParams)
          .then((data) => {
            setComparisonPerClient(data.perClient || []);
            setComparisonTrafficKpis(data.kpis || null);
          })
          .catch(() => {
            setComparisonPerClient([]);
            setComparisonTrafficKpis(null);
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
    setComparisonPerClient([]);
    Promise.all([
      fetchTrafficSources(userId, params).catch(() => ({ sources: [] })),
      fetchLandingPages(userId, params).catch(() => ({ pages: [] })),
      fetchDeviceBreakdown(userId, params).catch(() => ({ devices: [] })),
      fetchTrafficSummary(userId, params).catch(() => null)
    ])
      .then(([s, p, d, kpis]) => {
        setSources(s.sources || []);
        setPages(p.pages || []);
        setDevices(d.devices || []);
        setTrafficKpis(kpis);
      })
      .finally(() => setLoading(false));

    // Fetch comparison sources/pages/devices in parallel when comparison range is active
    if (comparisonRange) {
      const compParams = { start: comparisonRange.start, end: comparisonRange.end };
      Promise.all([
        fetchTrafficSources(userId, compParams).catch(() => ({ sources: [] })),
        fetchLandingPages(userId, compParams).catch(() => ({ pages: [] })),
        fetchDeviceBreakdown(userId, compParams).catch(() => ({ devices: [] })),
        fetchTrafficSummary(userId, compParams).catch(() => null)
      ]).then(([s, p, d, kpis]) => {
        setComparisonSources(s?.sources || []);
        setComparisonPages(p?.pages || []);
        setComparisonDevices(d?.devices || []);
        setComparisonTrafficKpis(kpis);
      });
    }
  }, [userId, dateRange, comparisonRange, isMultiClient, selection]);

  function buildSessionsDeltaCell(row, prev) {
    const delta = computeDelta(row.sessions, prev);
    const deltaStr = prev != null ? formatDeltaPercent(row.sessions, prev) : null;
    const outcome = getDeltaOutcome(delta, getMetricPolarity('sessions'));
    const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
    const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';
    return (
      <Stack direction="row" spacing={1} alignItems="baseline" justifyContent="flex-end">
        <Typography variant="body2">{(row.sessions || 0).toLocaleString()}</Typography>
        {deltaStr && (
          <Typography variant="caption" sx={{ color: deltaColor, fontWeight: 600 }}>
            {arrow} {deltaStr.replace(/^[+-]/, '')}
          </Typography>
        )}
      </Stack>
    );
  }

  const sourceColumns = useMemo(() => {
    const compMap = new Map(comparisonSources.map((row) => [`${row.source}|${row.medium}`, row]));
    if (isMultiClient || compMap.size === 0) return SOURCE_COLUMNS;
    return SOURCE_COLUMNS.map((col) => {
      if (col.id !== 'sessions') return col;
      return {
        ...col,
        render: (row) => buildSessionsDeltaCell(row, compMap.get(`${row.source}|${row.medium}`)?.sessions)
      };
    });
    // buildSessionsDeltaCell closes over theme, included in deps
  }, [comparisonSources, isMultiClient, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const landingPageColumns = useMemo(() => {
    const compMap = new Map(comparisonPages.map((row) => [row.page, row]));
    if (isMultiClient || compMap.size === 0) return LANDING_PAGE_COLUMNS;
    return LANDING_PAGE_COLUMNS.map((col) => {
      if (col.id !== 'sessions') return col;
      return {
        ...col,
        render: (row) => buildSessionsDeltaCell(row, compMap.get(row.page)?.sessions)
      };
    });
  }, [comparisonPages, isMultiClient, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <Paper sx={{ p: 3, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
      </Paper>
    );
  }

  const noData = !sources.length && !pages.length && !devices.length;
  if (noData) {
    return (
      <EmptyState
        icon={TravelExploreIcon}
        title="No traffic data yet"
        message={
          isMultiClient
            ? 'Traffic data will appear here once at least one selected client has GA4 sessions for this date range.'
            : 'Traffic data will appear here once GA4 starts collecting sessions for this client.'
        }
      />
    );
  }

  // Device donut chart — premium styling
  const deviceLabels = devices.map((d) => d.device || 'Unknown');
  const deviceSessions = devices.map((d) => d.sessions);
  const deviceTotal = deviceSessions.reduce((a, b) => a + b, 0);

  const donutDefaults = getPremiumDonutDefaults(theme, DEVICE_COLORS);
  const deviceChartOptions = {
    ...donutDefaults,
    labels: deviceLabels,
    chart: { ...donutDefaults.chart, width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true },
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px' },
      y: {
        formatter: (val) => {
          const pct = deviceTotal > 0 ? ((val / deviceTotal) * 100).toFixed(1) : '0.0';
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
              formatter: () => deviceTotal.toLocaleString()
            },
            total: {
              show: true,
              showAlways: true,
              label: 'Total Sessions',
              fontSize: '13px',
              fontFamily: theme.typography.fontFamily,
              color: theme.palette.text.secondary,
              formatter: () => deviceTotal.toLocaleString()
            }
          }
        },
        expandOnClick: true
      }
    }
  };

  const currentSessions = sources.reduce((s, r) => s + (r.sessions || 0), 0);
  const previousSessions = comparisonSources.reduce((s, r) => s + (r.sessions || 0), 0);
  const currentEngagedSessions = sources.reduce((s, r) => s + (r.engagedSessions || 0), 0);
  const previousEngagedSessions = comparisonSources.reduce((s, r) => s + (r.engagedSessions || 0), 0);
  const currentEngagementRate = currentSessions > 0 ? (currentEngagedSessions / currentSessions) * 100 : 0;
  const previousEngagementRate = previousSessions > 0 ? (previousEngagedSessions / previousSessions) * 100 : 0;

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
      <ComparisonKpiCards
        kpis={trafficKpis || {}}
        comparisonKpis={comparisonTrafficKpis}
        loading={loading}
        config={TRAFFIC_KPI_CONFIG}
        sx={{ mb: 2 }}
      />
      <MetricDefinitionStrip items={definitionItems} sx={{ mb: 2, mt: 2 }} />

{isMultiClient && <TrafficComparisonCharts rows={perClient} comparisonRows={comparisonPerClient} onOpenClient={handleOpenClient} />}

      {!isMultiClient && comparisonRange && comparisonSources.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Comparing {dateRange.start} &ndash; {dateRange.end} vs {comparisonRange.start} &ndash; {comparisonRange.end} &mdash; Sessions:{' '}
          {currentSessions.toLocaleString()} vs {previousSessions.toLocaleString()} | Engaged Sessions:{' '}
          {currentEngagedSessions.toLocaleString()} vs {previousEngagedSessions.toLocaleString()} | Engagement Rate:{' '}
          {currentEngagementRate.toFixed(1)}% vs {previousEngagementRate.toFixed(1)}%
        </Alert>
      )}
      <MainCard title={isMultiClient ? 'Source / Medium Rollup' : 'Source / Medium'} sx={{ mb: 3, boxShadow: CARD_SHADOW }}>
        <DataTable
          columns={sourceColumns}
          rows={sources}
          rowKey={(row, i) => `${row.source}-${row.medium}-${i}`}
          searchable
          searchFields={['source', 'medium']}
          searchPlaceholder="Search sources..."
          paginated
          pageSize={10}
          defaultSort={{ id: 'sessions', direction: 'desc' }}
          loading={loading}
          emptyTitle="No source data"
          size="small"
        />
      </MainCard>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <MainCard title={isMultiClient ? 'Landing Pages Rollup' : 'Landing Pages'} sx={{ boxShadow: CARD_SHADOW }}>
            <DataTable
              columns={landingPageColumns}
              rows={pages}
              rowKey={(row, i) => `${row.page}-${i}`}
              searchable
              searchFields={['page']}
              searchPlaceholder="Search pages..."
              paginated
              pageSize={10}
              defaultSort={{ id: 'sessions', direction: 'desc' }}
              loading={loading}
              emptyTitle="No landing page data"
              size="small"
            />
          </MainCard>
        </Grid>
        <ChartCard
          title={isMultiClient ? 'Device Breakdown Rollup' : 'Device Breakdown'}
          subtitle="How sessions split across desktop, mobile, and tablet visitors."
          span={{ xs: 12, md: 5 }}
        >
          {devices.length > 0 ? (
            <Stack spacing={1.5}>
              <Chart options={deviceChartOptions} series={deviceSessions} type="donut" height={300} width="100%" />
              {!isMultiClient && comparisonDevices.length > 0 && (() => {
                const comparisonDeviceTotal = comparisonDevices.reduce((sum, d) => sum + (d.sessions || 0), 0);
                return (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" color="primary" variant="outlined" label={`Current ${deviceTotal.toLocaleString()} sessions`} />
                    <Chip size="small" variant="outlined" label={`Previous ${comparisonDeviceTotal.toLocaleString()} sessions`} />
                  </Stack>
                );
              })()}
            </Stack>
          ) : (
            <Typography color="text.secondary">No device data available</Typography>
          )}
        </ChartCard>
      </Grid>
    </>
  );
}
