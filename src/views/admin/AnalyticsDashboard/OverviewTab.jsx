import { Alert, Button, Chip, Grid, Paper, Stack, Typography } from '@mui/material';
import Chart from 'react-apexcharts';
import MainCard from 'ui-component/cards/MainCard';
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
import ComparisonKpiCards from './ComparisonKpiCard';
import InsightsCard from './InsightsCard';
import FunnelChart from './FunnelChart';
import TimeSeriesChart from './TimeSeriesChart';
import PacingSummary from './PacingSummary';
import LeadSourcesChart from './LeadSourcesChart';
import AdPerformanceChart from './AdPerformanceChart';
import CallSummaryCard from './CallSummaryCard';
import ChartCard from './ChartCard';
import MetricDefinitionStrip from './MetricDefinitionStrip';
import { CARD_SHADOW, getPremiumChartDefaults, getPremiumDonutDefaults, useChartTheme } from './chartTheme';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

// Hidden 2026-04-20 pending redesign — see plans/2026-04-20-analytics-comparison-ux-cleanup.md
const SHOW_FUNNEL = false;
// Replaced by PacingSummary on Overview. Keep the import for the Paid view if needed later.
const SHOW_LEGACY_TIMESERIES = false;

function formatPercent(value) {
  return `${(value || 0).toFixed(2)}%`;
}

function formatCurrency(value) {
  return `$${(value || 0).toFixed(2)}`;
}

function formatWhole(value) {
  return (value || 0).toLocaleString();
}

function averageOf(rows, getter) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + (getter(row) || 0), 0) / rows.length;
}

function getComparisonChartHeight(rowCount) {
  return Math.max(340, rowCount * 34 + 90);
}

function truncateLabel(label, max = 26) {
  if (!label) return '';
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function getYAxisLabelWidth(labels, minimum = 92, maximum = 138) {
  if (!labels?.length) return minimum;
  const longest = labels.reduce((max, label) => Math.max(max, truncateLabel(label).length), 0);
  return Math.min(maximum, Math.max(minimum, longest * 7));
}

function GroupComparisonCharts({ data, comparisonData, onOpenClient }) {
  const theme = useChartTheme();
  const perClient = data?.perClient || [];
  const comparisonClients = comparisonData?.perClient || [];
  const comparisonLookup = new Map(comparisonClients.map((row) => [row.userId, row]));
  const hasComparison = comparisonClients.length > 0;
  const benchmarkRow =
    perClient.length > 1
      ? {
          userId: null,
          name: 'Group Average',
          kpis: {
            totalLeads: averageOf(perClient, (row) => row.kpis?.totalLeads),
            costPerLead: averageOf(perClient, (row) => row.kpis?.costPerLead),
            totalSessions: averageOf(perClient, (row) => row.kpis?.totalSessions),
            conversionRate: averageOf(perClient, (row) => row.kpis?.conversionRate),
            totalSpend: averageOf(perClient, (row) => row.kpis?.totalSpend)
          },
          isBenchmark: true
        }
      : null;
  const comparisonBenchmarkRow =
    comparisonClients.length > 1
      ? {
          userId: null,
          name: 'Comparison Average',
          kpis: {
            totalLeads: averageOf(comparisonClients, (row) => row.kpis?.totalLeads),
            costPerLead: averageOf(comparisonClients, (row) => row.kpis?.costPerLead),
            totalSessions: averageOf(comparisonClients, (row) => row.kpis?.totalSessions),
            conversionRate: averageOf(comparisonClients, (row) => row.kpis?.conversionRate),
            totalSpend: averageOf(comparisonClients, (row) => row.kpis?.totalSpend)
          },
          isBenchmark: true
        }
      : null;
  const displayRows = benchmarkRow ? [...perClient, benchmarkRow] : perClient;
  const labels = displayRows.map((row) => row.name);
  const shareLabels = perClient.map((row) => row.name);
  const leadsSeries = displayRows.map((row) => row.kpis?.totalLeads || 0);
  const cplSeries = displayRows.map((row) => Number((row.kpis?.costPerLead || 0).toFixed(2)));
  const sessionsSeries = displayRows.map((row) => row.kpis?.totalSessions || 0);
  const conversionSeries = displayRows.map((row) => Number((row.kpis?.conversionRate || 0).toFixed(2)));
  const spendShareSeries = perClient.map((row) => Number((row.kpis?.totalSpend || 0).toFixed(2)));
  const leadShareSeries = perClient.map((row) => row.kpis?.totalLeads || 0);
  const getComparisonKpis = (row) => (row.userId ? comparisonLookup.get(row.userId)?.kpis || null : comparisonBenchmarkRow?.kpis || null);
  const comparisonLeadsSeries = displayRows.map((row) => getComparisonKpis(row)?.totalLeads || 0);
  const comparisonCplSeries = displayRows.map((row) => Number((getComparisonKpis(row)?.costPerLead || 0).toFixed(2)));
  const comparisonSessionsSeries = displayRows.map((row) => getComparisonKpis(row)?.totalSessions || 0);
  const comparisonConversionSeries = displayRows.map((row) => Number((getComparisonKpis(row)?.conversionRate || 0).toFixed(2)));
  const comparisonSpendShareSeries = perClient.map((row) => Number((comparisonLookup.get(row.userId)?.kpis?.totalSpend || 0).toFixed(2)));
  const comparisonLeadShareSeries = perClient.map((row) => comparisonLookup.get(row.userId)?.kpis?.totalLeads || 0);

  const events = {
    dataPointSelection: (_event, _ctx, config) => {
      const row = displayRows[config.dataPointIndex];
      if (row?.userId) onOpenClient(row.userId);
    }
  };

  const base = getPremiumChartDefaults(theme);
  const chartHeight = getComparisonChartHeight(displayRows.length);
  const yAxisLabelWidth = getYAxisLabelWidth(labels);
  const colors = [theme.palette.primary.main, theme.palette.info.main, '#d97706', theme.palette.success.main];

  const makeHorizontalBarOptions = ({ title, formatter, color, metric, currentValues = [], comparisonValues = [], categories = labels }) => {
    const upIsGood = metric ? getMetricPolarity(metric) : true;
    const seriesColors = buildComparisonSeriesColors(theme, currentValues, comparisonValues, upIsGood, color);
    const tooltip = comparisonValues?.length
      ? buildComparisonTooltip({ formatter, labels: categories, upIsGood })
      : buildSimpleTooltip({ formatter, labels: categories });
    return {
      ...base,
      chart: { ...base.chart, type: 'bar', width: '100%', redrawOnParentResize: true, redrawOnWindowResize: true, events },
      colors: seriesColors,
      stroke: { width: 0 },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 6,
          barHeight: '62%',
          distributed: false
        }
      },
      dataLabels: {
        enabled: true,
        formatter,
        style: { fontSize: '11px', fontWeight: 600 }
      },
      xaxis: {
        categories,
        title: { text: title }
      },
      yaxis: {
        labels: {
          minWidth: 0,
          maxWidth: yAxisLabelWidth,
          formatter: (value) => truncateLabel(value)
        }
      },
      grid: {
        ...base.grid,
        padding: { left: 6, right: 6 }
      },
      tooltip,
      legend: {
        show: hasComparison,
        position: 'top',
        horizontalAlign: 'left'
      }
    };
  };

  const spendShareOptions = {
    ...getPremiumDonutDefaults(theme, colors),
    labels: shareLabels,
    chart: {
      ...getPremiumDonutDefaults(theme, colors).chart,
      width: '100%',
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
      events
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (val) => formatCurrency(val)
      }
    }
  };

  const leadShareOptions = {
    ...getPremiumDonutDefaults(theme, colors),
    labels: shareLabels,
    chart: {
      ...getPremiumDonutDefaults(theme, colors).chart,
      width: '100%',
      redrawOnParentResize: true,
      redrawOnWindowResize: true,
      events
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (val) => `${formatWhole(val)} leads`
      }
    }
  };

  return (
    <Stack spacing={3}>
      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title="Qualified Leads by Client" subtitle="Total CTM-qualified leads (3+ stars) per client over the selected range.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Qualified Leads',
              formatter: (val) => formatWhole(val),
              color: colors[0],
              metric: 'totalLeads',
              currentValues: leadsSeries,
              comparisonValues: hasComparison ? comparisonLeadsSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: leadsSeries },
                    { name: 'Comparison', data: comparisonLeadsSeries }
                  ]
                : [{ name: 'Qualified Leads', data: leadsSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard title="Overall CPQL by Client" subtitle="Cost per qualified lead — total ad spend divided by CTM qualified leads.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Overall CPQL',
              formatter: (val) => formatCurrency(val),
              color: colors[2],
              metric: 'cpql',
              currentValues: cplSeries,
              comparisonValues: hasComparison ? comparisonCplSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: cplSeries },
                    { name: 'Comparison', data: comparisonCplSeries }
                  ]
                : [{ name: 'Overall CPQL', data: cplSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title="Sessions by Client" subtitle="GA4 sessions for each selected client during the date range.">
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Sessions',
              formatter: (val) => formatWhole(val),
              color: colors[1],
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
        <ChartCard
          title="Engaged Conversion Rate by Client"
          subtitle="Qualified leads divided by GA4 engaged sessions (≥10s, conversion event, or 2+ pageviews)."
        >
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Engaged Conversion Rate',
              formatter: (val) => formatPercent(val),
              color: colors[3],
              metric: 'conversionRate',
              currentValues: conversionSeries,
              comparisonValues: hasComparison ? comparisonConversionSeries : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: conversionSeries },
                    { name: 'Comparison', data: comparisonConversionSeries }
                  ]
                : [{ name: 'Engaged Conversion Rate', data: conversionSeries }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title="Spend Share" subtitle="How total ad spend is distributed across the selected clients.">
          <Stack spacing={1.5}>
            <Chart options={spendShareOptions} series={spendShareSeries} type="donut" height={320} width="100%" />
            {hasComparison && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`Current ${formatCurrency(spendShareSeries.reduce((sum, value) => sum + value, 0))}`} color="primary" variant="outlined" />
                <Chip
                  size="small"
                  label={`Comparison ${formatCurrency(comparisonSpendShareSeries.reduce((sum, value) => sum + value, 0))}`}
                  variant="outlined"
                />
              </Stack>
            )}
          </Stack>
        </ChartCard>
        <ChartCard title="Lead Share" subtitle="How qualified leads are distributed across the selected clients.">
          <Stack spacing={1.5}>
            <Chart options={leadShareOptions} series={leadShareSeries} type="donut" height={320} width="100%" />
            {hasComparison && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`Current ${formatWhole(leadShareSeries.reduce((sum, value) => sum + value, 0))} leads`}
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Comparison ${formatWhole(comparisonLeadShareSeries.reduce((sum, value) => sum + value, 0))} leads`}
                  variant="outlined"
                />
              </Stack>
            )}
          </Stack>
        </ChartCard>
      </Grid>

      <Paper sx={{ p: 2.5, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1.5 }}>
          Open Individual Dashboard
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {perClient.map((row) => (
            <Button key={row.userId} variant="outlined" endIcon={<OpenInNewIcon />} onClick={() => onOpenClient(row.userId)}>
              {row.name}
            </Button>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}

export default function OverviewTab({
  data,
  comparisonData,
  loading,
  userId,
  activeClient,
  dateRange,
  comparisonRange,
  selection,
  onSelectionChange
}) {
  const theme = useChartTheme();
  const isMultiClient = selection && selection.mode !== 'single';
  const definitionItems = [
    {
      label: 'Qualified Lead',
      definition: 'A call or form with a CTM score of 3 stars or higher. CTM remains the source of truth for qualified lead outcomes.',
      color: 'primary'
    },
    {
      label: 'CPQL',
      definition: 'Cost Per Qualified Lead. This is total ad spend across Meta and Google Ads divided by CTM-qualified leads.',
      color: 'error'
    },
    {
      label: 'Engaged Conversion Rate',
      definition:
        'Qualified Leads divided by GA4 Engaged Sessions for the selected date range. An engaged session is one that lasted at least 10 seconds, fired a conversion event, or had 2+ pageviews — this filters out instant bounces and bot traffic.',
      color: 'success'
    }
  ];

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
    <Stack spacing={3}>
      <ComparisonKpiCards kpis={data?.kpis} comparisonKpis={comparisonData?.kpis || null} loading={loading} />
      <MetricDefinitionStrip items={definitionItems} />

{isMultiClient ? (
        <>
          <GroupComparisonCharts data={data} comparisonData={comparisonData} onOpenClient={handleOpenClient} />
          <PacingSummary
            timeSeries={data?.timeSeries}
            comparisonTimeSeries={comparisonData?.timeSeries}
            dateRange={dateRange}
            comparisonRange={comparisonRange}
            loading={loading}
          />
          {SHOW_LEGACY_TIMESERIES && <TimeSeriesChart timeSeries={data?.timeSeries} loading={loading} />}
        </>
      ) : (
        <>
          {SHOW_FUNNEL && <FunnelChart userId={userId} dateRange={dateRange} />}
          <InsightsCard userId={userId} dateRange={dateRange} comparisonRange={comparisonRange} />
          <PacingSummary
            timeSeries={data?.timeSeries}
            comparisonTimeSeries={comparisonData?.timeSeries}
            dateRange={dateRange}
            comparisonRange={comparisonRange}
            loading={loading}
          />
          {SHOW_LEGACY_TIMESERIES && <TimeSeriesChart timeSeries={data?.timeSeries} loading={loading} />}

          <Grid container spacing={3} sx={{ width: '100%' }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <LeadSourcesChart
                ga4Data={data?.byPlatform?.ga4}
                comparisonGa4Data={comparisonData?.byPlatform?.ga4}
                loading={loading}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <AdPerformanceChart
                metaAds={data?.byPlatform?.metaAds}
                googleAds={data?.byPlatform?.googleAds}
                comparisonMetaAds={comparisonData?.byPlatform?.metaAds}
                comparisonGoogleAds={comparisonData?.byPlatform?.googleAds}
                loading={loading}
                metaConversionsEnabled={(data?.clientContext?.metaConversionsEnabled ?? activeClient?.client_type !== 'medical') !== false}
              />
            </Grid>
          </Grid>

          <Grid container spacing={3} sx={{ width: '100%' }}>
            <Grid size={{ xs: 12, md: 6 }}>
              {data?.byPlatform?.ga4?.topPages?.length > 0 && (() => {
                const prevByPage = new Map(
                  (comparisonData?.byPlatform?.ga4?.topPages || []).map((p) => [p.page, p.sessions])
                );
                return (
                  <MainCard title="Top Landing Pages" subheader="Pages that drove the most GA4 sessions in the selected range.">
                    <Stack spacing={1}>
                      {data.byPlatform.ga4.topPages.map((page) => {
                        const prev = prevByPage.get(page.page);
                        const delta = computeDelta(page.sessions, prev);
                        const deltaStr = prev != null ? formatDeltaPercent(page.sessions, prev) : null;
                        const outcome = getDeltaOutcome(delta, getMetricPolarity('sessions'));
                        const deltaColor = getOutcomeColor(theme, outcome, theme.palette.text.secondary);
                        const arrow = delta == null || Math.abs(delta) < 0.01 ? '' : delta > 0 ? '↑' : '↓';
                        return (
                          <Stack
                            key={page.page}
                            direction="row"
                            justifyContent="space-between"
                            sx={{ py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
                          >
                            <Typography variant="body2" noWrap sx={{ maxWidth: '55%' }}>
                              {page.page}
                            </Typography>
                            <Stack direction="row" spacing={1.5} alignItems="baseline">
                              <Typography variant="body2" color="text.secondary">
                                {page.sessions} sessions
                              </Typography>
                              {deltaStr && (
                                <Typography variant="caption" sx={{ fontWeight: 600, color: deltaColor }}>
                                  {arrow} {deltaStr.replace(/^[+-]/, '')}
                                </Typography>
                              )}
                            </Stack>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </MainCard>
                );
              })()}
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <CallSummaryCard
                ctmData={data?.byPlatform?.ctm}
                comparisonCtmData={comparisonData?.byPlatform?.ctm}
                loading={loading}
              />
            </Grid>
          </Grid>
        </>
      )}
    </Stack>
  );
}
