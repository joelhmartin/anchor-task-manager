import { useEffect, useMemo, useState } from 'react';
import { Alert, ButtonBase, Chip, Grid, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography, Button } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Chart from 'react-apexcharts';
import EmptyState from 'ui-component/extended/EmptyState';
import BarChartIcon from '@mui/icons-material/BarChart';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  buildComparisonSeriesColors,
  buildComparisonTooltip,
  buildSimpleTooltip,
  getMetricPolarity
} from './analyticsComparison';
import MetaAdsView from './MetaAdsView';
import GoogleAdsView from './GoogleAdsView';
import ChartCard from './ChartCard';
import MetricDefinitionStrip from './MetricDefinitionStrip';
import MetaAdPreviewDialog from './MetaAdPreviewDialog';
import { fetchGroupOverview, fetchMetaCampaigns } from 'api/analytics';
import { CARD_SHADOW, getPremiumChartDefaults, getPremiumDonutDefaults, useChartTheme } from './chartTheme';

function formatCurrency(value) {
  return `$${(value || 0).toFixed(2)}`;
}

function formatWhole(value) {
  return (value || 0).toLocaleString();
}

function formatPercent(value) {
  return `${(value || 0).toFixed(2)}%`;
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

function KpiCard({ label, value, subtitle, comparisonCaption, color }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 2,
        boxShadow: CARD_SHADOW,
        borderBottom: `3px solid ${color}`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}
    >
      <Typography variant="h3" fontWeight={700}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary" fontWeight={600}>
        {label}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary">
          {subtitle}
        </Typography>
      )}
      {comparisonCaption && (
        <Typography variant="caption" color="text.secondary" display="block">
          {comparisonCaption}
        </Typography>
      )}
    </Paper>
  );
}

function buildPlatformRows(perClient, platform) {
  return (perClient || []).map((client) => {
    const platformData = platform === 'meta' ? client.metaAds : client.googleAds;
    const spend = platformData?.spend || 0;
    const conversions = platformData?.conversions || 0;
    const cpa = conversions > 0 ? spend / conversions : null;

    return {
      userId: client.userId,
      name: client.name,
      email: client.email,
      spend,
      conversions,
      cpa,
      qualifiedLeads: client.kpis?.totalLeads || 0,
      cpql: client.kpis?.costPerLead || 0,
      clicks: platformData?.clicks || 0,
      impressions: platformData?.impressions || 0,
      ctr: platformData?.ctr || 0,
      cpc: platformData?.cpc || 0,
      landingPageViews: platformData?.landingPageViews || 0,
      enabled: platform === 'meta' ? !!client.platformCoverage?.hasMeta : !!client.platformCoverage?.hasGoogleAds
    };
  });
}

function ComparisonCharts({ rows, comparisonRows, platform, onOpenClient }) {
  const theme = useChartTheme();
  const activeRows = rows.filter((row) => row.enabled);
  const comparisonActiveRows = (comparisonRows || []).filter((row) => row.enabled);
  const comparisonLookup = new Map(comparisonActiveRows.map((row) => [row.userId, row]));
  const hasComparison = comparisonActiveRows.length > 0;
  const benchmarkRow =
    activeRows.length > 1
      ? platform === 'meta'
        ? {
            userId: null,
            name: 'Group Average',
            spend: averageOf(activeRows, (row) => row.spend),
            clicks: averageOf(activeRows, (row) => row.clicks),
            ctr: averageOf(activeRows, (row) => row.ctr),
            enabled: true,
            isBenchmark: true
          }
        : {
            userId: null,
            name: 'Group Average',
            spend: averageOf(activeRows, (row) => row.spend),
            qualifiedLeads: averageOf(activeRows, (row) => row.qualifiedLeads),
            cpql: averageOf(activeRows, (row) => row.cpql),
            enabled: true,
              isBenchmark: true
            }
      : null;
  const comparisonBenchmarkRow =
    comparisonActiveRows.length > 1
      ? platform === 'meta'
        ? {
            userId: null,
            name: 'Comparison Average',
            spend: averageOf(comparisonActiveRows, (row) => row.spend),
            clicks: averageOf(comparisonActiveRows, (row) => row.clicks),
            ctr: averageOf(comparisonActiveRows, (row) => row.ctr),
            enabled: true,
            isBenchmark: true
          }
        : {
            userId: null,
            name: 'Comparison Average',
            spend: averageOf(comparisonActiveRows, (row) => row.spend),
            qualifiedLeads: averageOf(comparisonActiveRows, (row) => row.qualifiedLeads),
            cpql: averageOf(comparisonActiveRows, (row) => row.cpql),
            enabled: true,
            isBenchmark: true
          }
      : null;

  const displayRows = benchmarkRow ? [...activeRows, benchmarkRow] : activeRows;
  const labels = displayRows.map((row) => row.name);
  const shareLabels = activeRows.map((row) => row.name);
  const chartHeight = getComparisonChartHeight(displayRows.length);
  const yAxisLabelWidth = getYAxisLabelWidth(labels);
  const palette =
    platform === 'meta' ? [theme.palette.info.main, '#0891b2', '#0284c7', '#38bdf8'] : ['#d97706', '#f59e0b', '#b45309', '#ea580c'];
  const baseBar = getPremiumChartDefaults(theme);
  const getComparisonRow = (row) => (row.userId ? comparisonLookup.get(row.userId) : comparisonBenchmarkRow);
  const chartEvents = {
    dataPointSelection: (_event, _ctx, config) => {
      const row = displayRows[config.dataPointIndex];
      if (row?.userId) onOpenClient(row.userId);
    }
  };

  const makeHorizontalBarOptions = ({ title, color, formatter, xaxisFormatter, metric, currentValues = [], comparisonValues = [] }) => {
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
        formatter,
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
      grid: {
        ...baseBar.grid,
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

  const donutOptions = {
    ...getPremiumDonutDefaults(theme, palette),
    labels: shareLabels,
    chart: {
      ...getPremiumDonutDefaults(theme, palette).chart,
      width: '100%',
      events: chartEvents,
      redrawOnParentResize: true,
      redrawOnWindowResize: true
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (val) => formatCurrency(val)
      }
    }
  };

  const spendCurrent = displayRows.map((row) => Number((row.spend || 0).toFixed(2)));
  const spendComparison = displayRows.map((row) => Number((getComparisonRow(row)?.spend || 0).toFixed(2)));
  const clicksCurrent = displayRows.map((row) => row.clicks || 0);
  const clicksComparison = displayRows.map((row) => getComparisonRow(row)?.clicks || 0);
  const qualifiedLeadsCurrent = displayRows.map((row) => row.qualifiedLeads || 0);
  const qualifiedLeadsComparison = displayRows.map((row) => getComparisonRow(row)?.qualifiedLeads || 0);
  const ctrCurrent = displayRows.map((row) => Number((row.ctr || 0).toFixed(2)));
  const ctrComparison = displayRows.map((row) => Number((getComparisonRow(row)?.ctr || 0).toFixed(2)));
  const cpqlCurrent = displayRows.map((row) => Number((row.cpql || 0).toFixed(2)));
  const cpqlComparison = displayRows.map((row) => Number((getComparisonRow(row)?.cpql || 0).toFixed(2)));

  const secondaryChart =
    platform === 'meta'
      ? {
          title: 'Clicks by Client',
          subtitle: 'Total link clicks per account from Meta during the selected range.',
          series: hasComparison
            ? [
                { name: 'Current', data: clicksCurrent },
                { name: 'Comparison', data: clicksComparison }
              ]
            : [{ name: 'Clicks', data: clicksCurrent }],
          options: makeHorizontalBarOptions({
            title: 'Clicks',
            color: palette[1],
            formatter: (val) => formatWhole(val),
            metric: 'clicks',
            currentValues: clicksCurrent,
            comparisonValues: hasComparison ? clicksComparison : []
          })
        }
      : {
          title: 'Qualified Leads by Client',
          subtitle: 'CTM-qualified leads (3+ stars) per account in the selected range.',
          series: hasComparison
            ? [
                { name: 'Current', data: qualifiedLeadsCurrent },
                { name: 'Comparison', data: qualifiedLeadsComparison }
              ]
            : [{ name: 'Qualified Leads', data: qualifiedLeadsCurrent }],
          options: makeHorizontalBarOptions({
            title: 'Qualified Leads',
            color: palette[1],
            formatter: (val) => formatWhole(val),
            metric: 'qualifiedLeads',
            currentValues: qualifiedLeadsCurrent,
            comparisonValues: hasComparison ? qualifiedLeadsComparison : []
          })
        };

  const tertiaryChart =
    platform === 'meta'
      ? {
          title: 'CTR by Client',
          subtitle: 'Click-through rate per account — clicks divided by impressions.',
          series: hasComparison
            ? [
                { name: 'Current', data: ctrCurrent },
                { name: 'Comparison', data: ctrComparison }
              ]
            : [{ name: 'CTR', data: ctrCurrent }],
          options: makeHorizontalBarOptions({
            title: 'CTR',
            color: palette[2],
            formatter: (val) => formatPercent(val),
            xaxisFormatter: (val) => `${val}%`,
            metric: 'ctr',
            currentValues: ctrCurrent,
            comparisonValues: hasComparison ? ctrComparison : []
          })
        }
      : {
          title: 'Overall CPQL',
          subtitle: 'Cost per qualified lead per account — total spend divided by CTM qualified leads.',
          series: hasComparison
            ? [
                { name: 'Current', data: cpqlCurrent },
                { name: 'Comparison', data: cpqlComparison }
              ]
            : [{ name: 'Overall CPQL', data: cpqlCurrent }],
          options: makeHorizontalBarOptions({
            title: 'Overall CPQL',
            color: palette[2],
            formatter: (val) => formatCurrency(val),
            xaxisFormatter: (val) => `$${Number(val).toLocaleString()}`,
            metric: 'cpql',
            currentValues: cpqlCurrent,
            comparisonValues: hasComparison ? cpqlComparison : []
          })
        };

  return (
    <Stack spacing={3}>
      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard
          title={platform === 'meta' ? 'Meta Spend by Client' : 'Google Spend by Client'}
          subtitle="Total ad spend per account in the selected range."
        >
          <Chart
            options={makeHorizontalBarOptions({
              title: 'Spend',
              color: palette[0],
              formatter: (val) => formatCurrency(val),
              xaxisFormatter: (val) => `$${Number(val).toLocaleString()}`,
              metric: 'spend',
              currentValues: spendCurrent,
              comparisonValues: hasComparison ? spendComparison : []
            })}
            series={
              hasComparison
                ? [
                    { name: 'Current', data: spendCurrent },
                    { name: 'Comparison', data: spendComparison }
                  ]
                : [{ name: 'Spend', data: spendCurrent }]
            }
            type="bar"
            height={chartHeight}
            width="100%"
          />
        </ChartCard>
        <ChartCard
          title="Spend Share"
          subtitle="How spend is distributed across accounts in the selected range."
        >
          <Stack spacing={1.5}>
            <Chart
              options={donutOptions}
              series={activeRows.map((row) => Number((row.spend || 0).toFixed(2)))}
              type="donut"
              height={320}
              width="100%"
            />
            {hasComparison && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={`Current ${formatCurrency(activeRows.reduce((sum, row) => sum + (row.spend || 0), 0))}`}
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Comparison ${formatCurrency(comparisonActiveRows.reduce((sum, row) => sum + (row.spend || 0), 0))}`}
                  variant="outlined"
                />
              </Stack>
            )}
          </Stack>
        </ChartCard>
      </Grid>

      <Grid container spacing={3} sx={{ width: '100%' }}>
        <ChartCard title={secondaryChart.title} subtitle={secondaryChart.subtitle}>
          <Chart options={secondaryChart.options} series={secondaryChart.series} type="bar" height={chartHeight} width="100%" />
        </ChartCard>
        <ChartCard title={tertiaryChart.title} subtitle={tertiaryChart.subtitle}>
          <Chart options={tertiaryChart.options} series={tertiaryChart.series} type="bar" height={chartHeight} width="100%" />
        </ChartCard>
      </Grid>

      {/* Open Individual View panel hidden — inconsistent placement across tabs;
          users can switch accounts from the top selection controls instead. */}
      {/* <Paper sx={{ p: 2.5, borderRadius: 2, boxShadow: CARD_SHADOW }}>
        <Typography variant="h4" fontWeight={600} sx={{ mb: 1.5 }}>
          Open Individual View
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

function TopCreativeHighlights({ items, onOpenClient }) {
  const [previewItem, setPreviewItem] = useState(null);
  if (!items.length) return null;

  const handleImageClick = (item) => (event) => {
    event.stopPropagation();
    event.preventDefault();
    setPreviewItem(item);
  };

  return (
    <ChartCard
      title="Top Performing Creatives"
      subtitle="Click any creative to see it as a Facebook post preview. Click elsewhere on the card to open that account's single-client view."
    >
      <Grid container spacing={2}>
        {items.map((item) => (
          <Grid key={`${item.userId}-${item.campaignId}-${item.creativeId || item.creativeImage}`} size={{ xs: 12, md: 6, xl: 4 }}>
            <ButtonBase
              onClick={() => onOpenClient?.(item.userId)}
              sx={{ display: 'block', textAlign: 'left', width: '100%', height: '100%', borderRadius: 2 }}
            >
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  height: '100%',
                  width: '100%',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s, background-color 0.2s',
                  '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' }
                }}
              >
                <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                  {item.creativeImage ? (
                    <Paper
                      variant="outlined"
                      onClick={handleImageClick(item)}
                      sx={{
                        height: 180,
                        borderRadius: 2,
                        overflow: 'hidden',
                        bgcolor: 'grey.100',
                        cursor: 'zoom-in',
                        transition: 'transform 0.2s',
                        '& img': { transition: 'transform 0.2s' },
                        '&:hover img': { transform: 'scale(1.02)' }
                      }}
                    >
                      <img
                        src={item.creativeImage}
                        alt={item.campaignName}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </Paper>
                  ) : (
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                      <Typography variant="body2" color="text.secondary">
                        Creative preview unavailable
                      </Typography>
                    </Paper>
                  )}
                  <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" fontWeight={700} noWrap title={item.clientName}>
                      {item.clientName}
                    </Typography>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      title={item.campaignName}
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word'
                      }}
                    >
                      {item.campaignName}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      title={item.headline || undefined}
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        overflowWrap: 'anywhere'
                      }}
                    >
                      {item.headline || 'Creative headline unavailable'}
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={`CTR ${formatPercent(item.ctr)}`} color="info" variant="outlined" />
                    <Chip size="small" label={`${formatWhole(item.clicks)} clicks`} variant="outlined" />
                    <Chip size="small" label={`${formatWhole(item.landingPageViews)} LPVs`} variant="outlined" />
                  </Stack>
                  {(item.previousCtr != null || item.previousClicks != null || item.previousLandingPageViews != null) && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`Prev CTR ${formatPercent(item.previousCtr)}`} variant="outlined" />
                      <Chip size="small" label={`Prev ${formatWhole(item.previousClicks)} clicks`} variant="outlined" />
                      <Chip size="small" label={`Prev ${formatWhole(item.previousLandingPageViews)} LPVs`} variant="outlined" />
                    </Stack>
                  )}
                </Stack>
              </Paper>
            </ButtonBase>
          </Grid>
        ))}
      </Grid>
      <MetaAdPreviewDialog
        open={!!previewItem}
        onClose={() => setPreviewItem(null)}
        creative={previewItem?.creative}
        userId={previewItem?.userId}
      />
    </ChartCard>
  );
}

export default function PaidAdsTab({ userId, dateRange, comparisonRange, selection, onSelectionChange }) {
  const theme = useChartTheme();
  const [platform, setPlatform] = useState('google');
  const [groupData, setGroupData] = useState(null);
  const [comparisonGroupData, setComparisonGroupData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creativeHighlights, setCreativeHighlights] = useState([]);
  const isMultiClient = selection && selection.mode !== 'single';

  useEffect(() => {
    if (!isMultiClient) {
      setGroupData(null);
      setComparisonGroupData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchGroupOverview(selection, { start: dateRange.start, end: dateRange.end })
      .then((data) => setGroupData(data))
      .catch(() => setGroupData(null))
      .finally(() => setLoading(false));

    if (comparisonRange) {
      fetchGroupOverview(selection, { start: comparisonRange.start, end: comparisonRange.end })
        .then((data) => setComparisonGroupData(data))
        .catch(() => setComparisonGroupData(null));
    } else {
      setComparisonGroupData(null);
    }
  }, [comparisonRange, dateRange, isMultiClient, selection]);

  const platformRows = useMemo(() => buildPlatformRows(groupData?.perClient || [], platform), [groupData, platform]);
  const comparisonPlatformRows = useMemo(
    () => buildPlatformRows(comparisonGroupData?.perClient || [], platform),
    [comparisonGroupData, platform]
  );
  const activeRows = useMemo(() => platformRows.filter((row) => row.enabled), [platformRows]);

  useEffect(() => {
    if (!isMultiClient || platform !== 'meta' || !activeRows.length) {
      setCreativeHighlights([]);
      return;
    }

    let cancelled = false;
    const metaRows = activeRows.slice(0, 8);

    Promise.allSettled(
      metaRows.map((row) =>
        Promise.all([
          fetchMetaCampaigns(row.userId, { start: dateRange.start, end: dateRange.end }).catch(() => ({ campaigns: [] })),
          comparisonRange
            ? fetchMetaCampaigns(row.userId, { start: comparisonRange.start, end: comparisonRange.end }).catch(() => ({ campaigns: [] }))
            : Promise.resolve({ campaigns: [] })
        ]).then(([current, comparison]) => ({
          row,
          campaigns: current.campaigns || [],
          comparisonCampaigns: comparison.campaigns || []
        }))
      )
    )
      .then((results) => {
        if (cancelled) return;

        const highlights = results
          .filter((result) => result.status === 'fulfilled')
          .flatMap((result) => {
            const { row, campaigns, comparisonCampaigns } = result.value;
            const comparisonByCampaignId = new Map((comparisonCampaigns || []).map((campaign) => [campaign.id, campaign]));
            // Let every claimed campaign enter the pool; the final slice(0, 6)
            // below caps the display. Previously sliced per-client to 3, which
            // suppressed the true group-wide ranking when one client had
            // several strong campaigns.
            return campaigns
              .filter((campaign) => campaign.ads?.length)
              .map((campaign) => {
                const creative = campaign.ads?.[0]?.creative || null;
                const comparisonCampaign = comparisonByCampaignId.get(campaign.id);
                return {
                  userId: row.userId,
                  clientName: row.name,
                  campaignId: campaign.id,
                  campaignName: campaign.name,
                  ctr: campaign.insights?.ctr || 0,
                  clicks: campaign.insights?.clicks || 0,
                  landingPageViews: campaign.insights?.landingPageViews || 0,
                  creative,
                  creativeId: creative?.id || null,
                  creativeImage: creative?.imageUrl || creative?.thumbnailUrl || null,
                  headline: creative?.headline || null,
                  previousCtr: comparisonCampaign?.insights?.ctr ?? null,
                  previousClicks: comparisonCampaign?.insights?.clicks ?? null,
                  previousLandingPageViews: comparisonCampaign?.insights?.landingPageViews ?? null
                };
              });
          })
          .sort((a, b) => b.ctr - a.ctr)
          .slice(0, 6);

        setCreativeHighlights(highlights);
      })
      .catch(() => {
        if (!cancelled) setCreativeHighlights([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRows, comparisonRange, dateRange.end, dateRange.start, isMultiClient, platform]);

  const totals = useMemo(() => {
    const spend = activeRows.reduce((sum, row) => sum + (row.spend || 0), 0);
    const conversions = activeRows.reduce((sum, row) => sum + (row.conversions || 0), 0);
    const qualifiedLeads = activeRows.reduce((sum, row) => sum + (row.qualifiedLeads || 0), 0);
    const clicks = activeRows.reduce((sum, row) => sum + (row.clicks || 0), 0);
    const impressions = activeRows.reduce((sum, row) => sum + (row.impressions || 0), 0);
    const landingPageViews = activeRows.reduce((sum, row) => sum + (row.landingPageViews || 0), 0);
    return {
      spend,
      conversions,
      qualifiedLeads,
      clicks,
      impressions,
      landingPageViews,
      cpa: conversions > 0 ? spend / conversions : null,
      cpql: qualifiedLeads > 0 ? spend / qualifiedLeads : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0
    };
  }, [activeRows]);
  const comparisonTotals = useMemo(() => {
    const comparisonActiveRows = comparisonPlatformRows.filter((row) => row.enabled);
    const spend = comparisonActiveRows.reduce((sum, row) => sum + (row.spend || 0), 0);
    const conversions = comparisonActiveRows.reduce((sum, row) => sum + (row.conversions || 0), 0);
    const qualifiedLeads = comparisonActiveRows.reduce((sum, row) => sum + (row.qualifiedLeads || 0), 0);
    const clicks = comparisonActiveRows.reduce((sum, row) => sum + (row.clicks || 0), 0);
    const impressions = comparisonActiveRows.reduce((sum, row) => sum + (row.impressions || 0), 0);
    const landingPageViews = comparisonActiveRows.reduce((sum, row) => sum + (row.landingPageViews || 0), 0);
    return {
      spend,
      conversions,
      qualifiedLeads,
      clicks,
      impressions,
      landingPageViews,
      cpa: conversions > 0 ? spend / conversions : null,
      cpql: qualifiedLeads > 0 ? spend / qualifiedLeads : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0
    };
  }, [comparisonPlatformRows]);

  const definitionItems = useMemo(
    () =>
      platform === 'meta'
        ? [
            {
              label: 'Spend',
              definition: 'Total amount spent on Meta ads in the selected date range.'
            },
            {
              label: 'Clicks',
              definition: 'Total link clicks on Meta ads — taps that sent someone to your site.'
            },
            {
              label: 'Impressions',
              definition: 'Total times Meta showed an ad on screen, including repeat views to the same person.'
            },
            {
              label: 'CTR',
              definition: 'Click-through rate — clicks divided by impressions, expressed as a percentage.'
            },
            {
              label: 'Reach',
              definition: 'Number of unique people who saw an ad at least once in the selected range.'
            },
            {
              label: 'Landing Page Views',
              definition: 'Number of times someone clicked an ad and the destination page actually loaded.'
            }
          ]
        : [
            {
              label: 'Spend',
              definition: 'Total amount spent on Google Ads in the selected date range.'
            },
            {
              label: 'Clicks',
              definition: 'Total clicks on Google Ads — taps that sent someone to your site.'
            },
            {
              label: 'Impressions',
              definition: 'Total times an ad appeared on a Google search or partner page.'
            },
            {
              label: 'CTR',
              definition: 'Click-through rate — clicks divided by impressions, expressed as a percentage.'
            },
            {
              label: 'Qualified Leads',
              definition: 'CTM-scored outcomes with 3 stars or higher — the source-of-truth business outcome metric.'
            },
            {
              label: 'CPQL',
              definition: 'Cost per qualified lead — total Google Ads spend divided by CTM-qualified leads.'
            }
          ],
    [platform]
  );

  const missingMetaCount = useMemo(() => {
    if (platform !== 'meta' || !groupData?.coverage) return 0;
    return Math.max((groupData.coverage.withMeta || 0) - activeRows.length, 0);
  }, [activeRows.length, groupData?.coverage, platform]);

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

  // Single brand-teal accent for both toggles — no per-platform color coding.
  const toggleAccent = theme.palette.primary.dark;
  const toggleBg = alpha(toggleAccent, 0.08);

  return (
    <Stack spacing={2.5}>
      <ToggleButtonGroup
        value={platform}
        exclusive
        onChange={(_, v) => v && setPlatform(v)}
        sx={{
          alignSelf: { xs: 'stretch', sm: 'flex-start' },
          bgcolor: toggleBg,
          borderRadius: 2,
          '& .MuiToggleButton-root': {
            fontSize: { xs: '0.95rem', md: '1rem' },
            fontWeight: 600,
            textTransform: 'none',
            letterSpacing: 0.1,
            px: { xs: 2.5, md: 3.5 },
            py: { xs: 1, md: 1.25 },
            flex: { xs: 1, sm: 'initial' }
          },
          '& .MuiToggleButton-root.Mui-selected': {
            bgcolor: alpha(toggleAccent, 0.18),
            color: toggleAccent,
            '&:hover': { bgcolor: alpha(toggleAccent, 0.24) }
          }
        }}
      >
        <ToggleButton value="google">Google Ads</ToggleButton>
        <ToggleButton value="meta">Meta Ads</ToggleButton>
      </ToggleButtonGroup>

      <MetricDefinitionStrip items={definitionItems} />

      {!isMultiClient ? (
        platform === 'meta' ? (
          <MetaAdsView userId={userId} dateRange={dateRange} comparisonRange={comparisonRange} />
        ) : (
          <GoogleAdsView userId={userId} dateRange={dateRange} comparisonRange={comparisonRange} />
        )
      ) : (
        <>
{platform === 'meta' && missingMetaCount > 0 && (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              Meta coverage says {groupData?.coverage?.withMeta || 0} selected clients have Meta configured, but only {activeRows.length}{' '}
              are currently rendering data in this group view. That usually means the missing accounts returned no data for the selected
              range or failed upstream fetches.
            </Alert>
          )}

          {activeRows.length === 0 && !loading ? (
            <EmptyState
              icon={BarChartIcon}
              title={`No ${platform === 'meta' ? 'Meta Ads' : 'Google Ads'} data`}
              message={`None of the selected clients returned ${platform === 'meta' ? 'Meta Ads' : 'Google Ads'} data for this range.`}
            />
          ) : (
            <>
              <Grid container spacing={2} sx={{ width: '100%' }}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <KpiCard
                    label={`${platform === 'meta' ? 'Meta' : 'Google'} spend`}
                    value={formatCurrency(totals.spend)}
                    comparisonCaption={comparisonRange ? `Comparison ${formatCurrency(comparisonTotals.spend)}` : null}
                    color={toggleAccent}
                  />
                </Grid>
                {platform === 'meta' ? (
                  <>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <KpiCard
                        label="Clicks"
                        value={formatWhole(totals.clicks)}
                        comparisonCaption={comparisonRange ? `Comparison ${formatWhole(comparisonTotals.clicks)}` : null}
                        color={theme.palette.info.light}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <KpiCard
                        label="CTR"
                        value={formatPercent(totals.ctr)}
                        comparisonCaption={comparisonRange ? `Comparison ${formatPercent(comparisonTotals.ctr)}` : null}
                        color={theme.palette.success.main}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <KpiCard
                        label="Landing Page Views"
                        value={formatWhole(totals.landingPageViews)}
                        comparisonCaption={comparisonRange ? `Comparison ${formatWhole(comparisonTotals.landingPageViews)}` : null}
                        color={theme.palette.secondary.main}
                      />
                    </Grid>
                  </>
                ) : (
                  <>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <KpiCard
                        label="Platform Conversions"
                        value={formatWhole(totals.conversions)}
                        comparisonCaption={comparisonRange ? `Comparison ${formatWhole(comparisonTotals.conversions)}` : null}
                        color={theme.palette.warning.light}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <KpiCard
                        label="Platform CPA"
                        value={totals.cpa == null ? '—' : formatCurrency(totals.cpa)}
                        comparisonCaption={
                          comparisonRange ? `Comparison ${comparisonTotals.cpa == null ? '—' : formatCurrency(comparisonTotals.cpa)}` : null
                        }
                        color={theme.palette.success.main}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <KpiCard
                        label="Qualified Leads"
                        value={formatWhole(totals.qualifiedLeads)}
                        subtitle={`CPQL ${totals.cpql == null ? '—' : formatCurrency(totals.cpql)}`}
                        comparisonCaption={
                          comparisonRange
                            ? `Comparison ${formatWhole(comparisonTotals.qualifiedLeads)} | CPQL ${comparisonTotals.cpql == null ? '—' : formatCurrency(comparisonTotals.cpql)}`
                            : null
                        }
                        color={theme.palette.secondary.main}
                      />
                    </Grid>
                  </>
                )}
              </Grid>

              {platform === 'meta' && <TopCreativeHighlights items={creativeHighlights} onOpenClient={handleOpenClient} />}

              <ComparisonCharts rows={platformRows} comparisonRows={comparisonPlatformRows} platform={platform} onOpenClient={handleOpenClient} />
            </>
          )}
        </>
      )}
    </Stack>
  );
}
