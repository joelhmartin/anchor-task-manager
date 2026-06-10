import { useState, useEffect, useMemo } from 'react';
import { Stack, Grid, Typography, Breadcrumbs, Link, Paper, Skeleton, ButtonBase, ToggleButton, ToggleButtonGroup } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Chart from 'react-apexcharts';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { CARD_SHADOW, PREMIUM_COLORS, useChartTheme } from './chartTheme';
import MetaAdCreativePreview from './MetaAdCreativePreview';
import AccountKpiCard from './AccountKpiCard';
import { fetchMetaCampaigns, fetchMetaAdSets, fetchMetaAdsForAdSet } from 'api/analytics';
import { useToast } from 'contexts/ToastContext';

// Hidden 2026-04-20 — Spend by Campaign chart removed pending redesign.
// See plans/2026-04-20-analytics-comparison-ux-cleanup.md.
const SHOW_SPEND_BY_CAMPAIGN = false;

function formatNumber(val) {
  if (val == null) return '\u2014';
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return val.toLocaleString();
}

function formatCurrency(val) {
  if (val == null) return '\u2014';
  return `$${val.toFixed(2)}`;
}

function formatPercent(val) {
  if (val == null) return '\u2014';
  return `${val.toFixed(2)}%`;
}

const METRICS = [
  { key: 'spend', label: 'Spend', format: formatCurrency, upIsGood: false },
  { key: 'clicks', label: 'Clicks', format: formatNumber, upIsGood: true },
  { key: 'impressions', label: 'Impressions', format: formatNumber, upIsGood: true },
  { key: 'ctr', label: 'CTR', format: formatPercent, upIsGood: true },
  { key: 'cpc', label: 'CPC', format: formatCurrency, upIsGood: false },
  { key: 'reach', label: 'Reach', format: formatNumber, upIsGood: true },
  { key: 'landingPageViews', label: 'Landing Page Views', format: formatNumber, upIsGood: true }
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

const adSetColumns = [
  { id: 'name', label: 'Ad Set', sortable: true },
  {
    id: 'status',
    label: 'Status',
    render: (row) => <StatusChip status={row.status?.toLowerCase()} />,
    width: 100
  },
  {
    id: 'spend',
    label: 'Spend',
    render: (row) => `$${(row.insights?.spend || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.insights?.spend || 0
  },
  {
    id: 'impressions',
    label: 'Impr.',
    render: (row) => (row.insights?.impressions || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.insights?.impressions || 0
  },
  {
    id: 'clicks',
    label: 'Clicks',
    render: (row) => (row.insights?.clicks || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.insights?.clicks || 0
  },
  {
    id: 'ctr',
    label: 'CTR',
    render: (row) => `${(row.insights?.ctr || 0).toFixed(2)}%`,
    sortable: true,
    sortValue: (row) => row.insights?.ctr || 0
  },
  {
    id: 'cpc',
    label: 'CPC',
    render: (row) => `$${(row.insights?.cpc || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.insights?.cpc || 0
  },
  {
    id: 'landingPageViews',
    label: 'LPVs',
    render: (row) => (row.insights?.landingPageViews || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.insights?.landingPageViews || 0
  }
];

export default function MetaAdsView({ userId, dateRange, comparisonRange }) {
  const theme = useChartTheme();
  const [level, setLevel] = useState('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedAdSet, setSelectedAdSet] = useState(null);
  const [data, setData] = useState([]);
  const [comparisonData, setComparisonData] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setComparisonData(null);

    const params = { start: dateRange.start, end: dateRange.end };
    let request;

    if (level === 'campaigns') {
      request = fetchMetaCampaigns(userId, params).then((r) => r.campaigns || []);
    } else if (level === 'adsets' && selectedCampaign) {
      request = fetchMetaAdSets(userId, selectedCampaign.id, params).then((r) => r.adsets || []);
    } else if (level === 'ads' && selectedAdSet) {
      request = fetchMetaAdsForAdSet(userId, selectedAdSet.id, params).then((r) => r.ads || []);
    }

    if (!request) {
      setLoading(false);
      return;
    }

    request
      .then((rows) => {
        if (!cancelled) setData(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err.response?.data?.error || err.message;
          if (msg?.includes('token') || msg?.includes('Token') || err.response?.status === 401) {
            setError('Meta Ads token is not configured for this client.');
          } else {
            setError(msg || 'Failed to load Meta Ads data');
            showToast('Failed to load Meta Ads data', 'error');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Fetch comparison data in parallel when at campaign level
    if (level === 'campaigns' && comparisonRange) {
      const compParams = { start: comparisonRange.start, end: comparisonRange.end };
      fetchMetaCampaigns(userId, compParams)
        .then((r) => {
          if (!cancelled) setComparisonData(r.campaigns || []);
        })
        .catch(() => {
          if (!cancelled) setComparisonData(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [userId, level, selectedCampaign, selectedAdSet, dateRange, comparisonRange, showToast]);

  const handleCampaignClick = (row) => {
    setSelectedCampaign({ id: row.id, name: row.name });
    setLevel('adsets');
  };

  const handleAdSetClick = (row) => {
    setSelectedAdSet({ id: row.id, name: row.name });
    setLevel('ads');
  };

  const handleBreadcrumbCampaigns = () => {
    setLevel('campaigns');
    setSelectedCampaign(null);
    setSelectedAdSet(null);
  };

  const handleBreadcrumbAdSets = () => {
    setLevel('adsets');
    setSelectedAdSet(null);
  };

  function aggregateAccountMetrics(rows) {
    if (!rows?.length) return null;
    const spend = rows.reduce((s, c) => s + (c.insights?.spend || 0), 0);
    const clicks = rows.reduce((s, c) => s + (c.insights?.clicks || 0), 0);
    const impressions = rows.reduce((s, c) => s + (c.insights?.impressions || 0), 0);
    const reach = rows.reduce((s, c) => s + (c.insights?.reach || 0), 0);
    const landingPageViews = rows.reduce((s, c) => s + (c.insights?.landingPageViews || 0), 0);
    return {
      spend,
      clicks,
      impressions,
      reach,
      landingPageViews,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0
    };
  }

  // Account-level aggregate metrics from all campaigns (uses unfiltered data)
  const accountMetrics = useMemo(
    () => (level === 'campaigns' ? aggregateAccountMetrics(data) : null),
    [data, level]
  );

  // Same aggregation over the comparison period for KPI deltas
  const comparisonAccountMetrics = useMemo(
    () => (level === 'campaigns' && comparisonData?.length ? aggregateAccountMetrics(comparisonData) : null),
    [comparisonData, level]
  );

  // Status-filtered campaign list — used for the cards but NOT the account aggregates
  const filteredData = useMemo(() => {
    if (level !== 'campaigns' || statusFilter === 'all') return data;
    return data.filter((row) => row.status?.toUpperCase() === statusFilter.toUpperCase());
  }, [data, level, statusFilter]);

  if (error) {
    return <EmptyState icon={CampaignIcon} title="Meta Ads unavailable" message={error} />;
  }

  return (
    <Stack spacing={2}>
      {/* Breadcrumb navigation */}
      <Breadcrumbs>
        <Link
          component="button"
          variant="body2"
          underline="hover"
          onClick={handleBreadcrumbCampaigns}
          color={level === 'campaigns' ? 'text.primary' : 'inherit'}
          sx={{ cursor: 'pointer' }}
        >
          All Campaigns
        </Link>
        {selectedCampaign &&
          level !== 'campaigns' &&
          (level === 'adsets' ? (
            <Typography variant="body2" color="text.primary">
              {selectedCampaign.name}
            </Typography>
          ) : (
            <Link component="button" variant="body2" underline="hover" onClick={handleBreadcrumbAdSets} sx={{ cursor: 'pointer' }}>
              {selectedCampaign.name}
            </Link>
          ))}
        {selectedAdSet && level === 'ads' && (
          <Typography variant="body2" color="text.primary">
            {selectedAdSet.name}
          </Typography>
        )}
      </Breadcrumbs>

      {/* Account-level KPI cards + spend chart */}
      {level === 'campaigns' && accountMetrics && (
        <>
          <Grid container spacing={2} sx={{ mb: 0 }}>
            {[
              { label: 'Total Spend', value: `$${accountMetrics.spend.toFixed(2)}`, color: 'warning', metric: 'spend', current: accountMetrics.spend, previous: comparisonAccountMetrics?.spend },
              { label: 'Clicks', value: accountMetrics.clicks.toLocaleString(), color: 'primary', metric: 'clicks', current: accountMetrics.clicks, previous: comparisonAccountMetrics?.clicks },
              { label: 'Impressions', value: accountMetrics.impressions.toLocaleString(), color: 'info', metric: 'impressions', current: accountMetrics.impressions, previous: comparisonAccountMetrics?.impressions },
              { label: 'CTR', value: `${accountMetrics.ctr.toFixed(2)}%`, color: 'success', metric: 'ctr', current: accountMetrics.ctr, previous: comparisonAccountMetrics?.ctr },
              { label: 'Reach', value: formatNumber(accountMetrics.reach), color: 'secondary', metric: 'reach', current: accountMetrics.reach, previous: comparisonAccountMetrics?.reach },
              { label: 'Landing Page Views', value: formatNumber(accountMetrics.landingPageViews), color: 'error', metric: 'landingPageViews', current: accountMetrics.landingPageViews, previous: comparisonAccountMetrics?.landingPageViews }
            ].map((kpi) => (
              <Grid size={{ xs: 6, sm: 4, md: 2 }} key={kpi.label}>
                <AccountKpiCard {...kpi} />
              </Grid>
            ))}
          </Grid>

          {SHOW_SPEND_BY_CAMPAIGN && (
            <Paper sx={{ p: 2, borderRadius: 2, boxShadow: CARD_SHADOW }}>
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
                Spend by Campaign
              </Typography>
              <Chart
                type="bar"
                height={250}
                options={{
                  chart: { toolbar: { show: false }, fontFamily: theme.typography.fontFamily },
                  plotOptions: { bar: { borderRadius: 4, horizontal: true, barHeight: '60%', distributed: true } },
                  colors: PREMIUM_COLORS,
                  xaxis: {
                    categories: data.slice(0, 8).map((c) => c.name?.substring(0, 30) || 'Unknown'),
                    labels: { formatter: (v) => `$${v}` }
                  },
                  yaxis: { labels: { style: { fontSize: '11px' } } },
                  tooltip: { theme: 'dark', y: { formatter: (v) => `$${Number(v).toFixed(2)}` } },
                  grid: { strokeDashArray: 4, borderColor: theme.palette.divider },
                  legend: { show: false },
                  dataLabels: { enabled: false }
                }}
                series={[{ name: 'Spend', data: data.slice(0, 8).map((c) => c.insights?.spend || 0) }]}
              />
            </Paper>
          )}
        </>
      )}

      {/* Campaigns — status filter + card layout with creative preview */}
      {level === 'campaigns' && !loading && data.length > 0 && (
        <ToggleButtonGroup value={statusFilter} exclusive onChange={(_, v) => v && setStatusFilter(v)} size="small">
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="ACTIVE">Active</ToggleButton>
          <ToggleButton value="PAUSED">Paused</ToggleButton>
          <ToggleButton value="DELETED">Removed</ToggleButton>
        </ToggleButtonGroup>
      )}

      {level === 'campaigns' &&
        (loading ? (
          <Stack spacing={2}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={160} />
            ))}
          </Stack>
        ) : data.length === 0 ? (
          <EmptyState icon={CampaignIcon} title="No Meta campaigns found" message="No campaigns with data in the selected date range." />
        ) : filteredData.length === 0 ? (
          <EmptyState
            icon={CampaignIcon}
            title="No campaigns match this filter"
            message="Try a different status to see more campaigns."
          />
        ) : (
          <Stack spacing={2}>
            {filteredData.map((campaign) => {
              const primaryCreative = campaign.ads?.[0]?.creative;
              const compCampaign = comparisonData?.find((c) => c.id === campaign.id);
              return (
                <ButtonBase
                  key={campaign.id}
                  onClick={() => handleCampaignClick(campaign)}
                  sx={{ display: 'block', textAlign: 'left', width: '100%', borderRadius: 1 }}
                >
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      '&:hover': { borderColor: 'primary.light', bgcolor: 'action.hover' },
                      transition: 'border-color 0.2s, background-color 0.2s'
                    }}
                  >
                    {/* Campaign header */}
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                      <StatusChip status={campaign.status?.toLowerCase()} size="small" />
                      <Typography variant="subtitle1" noWrap sx={{ flex: 1 }} title={campaign.name}>
                        {campaign.name}
                      </Typography>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: 'text.secondary' }}>
                        <Typography variant="caption">View Ad Sets</Typography>
                        <ArrowForwardIcon sx={{ fontSize: 14 }} />
                      </Stack>
                    </Stack>

                    <Grid container spacing={2}>
                      {/* Creative Preview — compact for campaign cards */}
                      <Grid size={{ xs: 12, md: 3 }}>
                        {primaryCreative ? (
                          <MetaAdCreativePreview creative={primaryCreative} compact userId={userId} />
                        ) : (
                          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            No creative available
                          </Typography>
                        )}
                      </Grid>

                      {/* Metrics Grid */}
                      <Grid size={{ xs: 12, md: 9 }}>
                        <Grid container spacing={1}>
                          {METRICS.map((m) => (
                            <Grid size={{ xs: 6, sm: 3 }} key={m.key}>
                              <Typography variant="caption" color="text.secondary">
                                {m.label}
                              </Typography>
                              <Typography variant="body2" fontWeight={600}>
                                {m.format(campaign.insights?.[m.key])}
                              </Typography>
                              {compCampaign && (
                                <DeltaText
                                  current={campaign.insights?.[m.key]}
                                  previous={compCampaign.insights?.[m.key]}
                                  upIsGood={m.upIsGood}
                                />
                              )}
                            </Grid>
                          ))}
                        </Grid>
                      </Grid>
                    </Grid>
                  </Paper>
                </ButtonBase>
              );
            })}
          </Stack>
        ))}

      {/* Ad Sets — KPI summary + table */}
      {level === 'adsets' && (
        <>
          {/* Ad Set level KPIs aggregated from all ad sets */}
          {!loading &&
            data.length > 0 &&
            (() => {
              const agg = {
                spend: data.reduce((s, a) => s + (a.insights?.spend || 0), 0),
                clicks: data.reduce((s, a) => s + (a.insights?.clicks || 0), 0),
                impressions: data.reduce((s, a) => s + (a.insights?.impressions || 0), 0),
                reach: data.reduce((s, a) => s + (a.insights?.reach || 0), 0),
                landingPageViews: data.reduce((s, a) => s + (a.insights?.landingPageViews || 0), 0)
              };
              agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
              agg.cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
              return (
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  {[
                    { label: 'Campaign Spend', value: `$${agg.spend.toFixed(2)}`, color: 'warning' },
                    { label: 'Clicks', value: agg.clicks.toLocaleString(), color: 'primary' },
                    { label: 'Impressions', value: formatNumber(agg.impressions), color: 'info' },
                    { label: 'CTR', value: `${agg.ctr.toFixed(2)}%`, color: 'success' },
                    { label: 'Landing Page Views', value: formatNumber(agg.landingPageViews), color: 'secondary' },
                    { label: 'CPC', value: `$${agg.cpc.toFixed(2)}`, color: 'error' }
                  ].map((kpi) => (
                    <Grid size={{ xs: 6, sm: 4, md: 2 }} key={kpi.label}>
                      <AccountKpiCard {...kpi} />
                    </Grid>
                  ))}
                </Grid>
              );
            })()}

          <DataTable
            columns={adSetColumns}
            rows={data}
            rowKey="id"
            loading={loading}
            searchable
            searchFields={['name']}
            onRowClick={handleAdSetClick}
            emptyTitle="No ad sets found"
            emptyMessage="This campaign has no ad sets with data in the selected date range."
            emptyIcon={CampaignIcon}
            hover
            outlined
          />
        </>
      )}

      {/* Ads — ad set KPIs + ad mockup cards with analytics */}
      {level === 'ads' &&
        (loading ? (
          <Stack spacing={2}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={200} />
            ))}
          </Stack>
        ) : data.length === 0 ? (
          <EmptyState icon={CampaignIcon} title="No ads found" message="This ad set has no ads with data in the selected date range." />
        ) : (
          <Stack spacing={3}>
            {/* Ad Set aggregate KPIs */}
            {(() => {
              const agg = {
                spend: data.reduce((s, a) => s + (a.insights?.spend || 0), 0),
                clicks: data.reduce((s, a) => s + (a.insights?.clicks || 0), 0),
                impressions: data.reduce((s, a) => s + (a.insights?.impressions || 0), 0),
                landingPageViews: data.reduce((s, a) => s + (a.insights?.landingPageViews || 0), 0)
              };
              agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
              agg.cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
              return (
                <Grid container spacing={2}>
                  {[
                    { label: 'Ad Set Spend', value: `$${agg.spend.toFixed(2)}`, color: 'warning' },
                    { label: 'Clicks', value: agg.clicks.toLocaleString(), color: 'primary' },
                    { label: 'Impressions', value: formatNumber(agg.impressions), color: 'info' },
                    { label: 'CTR', value: `${agg.ctr.toFixed(2)}%`, color: 'success' },
                    { label: 'Landing Page Views', value: formatNumber(agg.landingPageViews), color: 'secondary' },
                    { label: 'CPC', value: `$${agg.cpc.toFixed(2)}`, color: 'error' }
                  ].map((kpi) => (
                    <Grid size={{ xs: 6, sm: 4, md: 2 }} key={kpi.label}>
                      <AccountKpiCard {...kpi} />
                    </Grid>
                  ))}
                </Grid>
              );
            })()}

            {/* Individual ad cards — mockup preview + metrics */}
            {data.map((ad) => (
              <Paper key={ad.id} variant="outlined" sx={{ p: 0, borderRadius: 2, overflow: 'hidden' }}>
                <Grid container>
                  {/* Left: Facebook ad mockup */}
                  <Grid size={{ xs: 12, md: 5 }} sx={{ borderRight: { md: '1px solid' }, borderColor: { md: 'divider' } }}>
                    <MetaAdCreativePreview creative={ad.creative} userId={userId} />
                  </Grid>
                  {/* Right: Ad analytics */}
                  <Grid size={{ xs: 12, md: 7 }}>
                    <Stack sx={{ p: 2, height: '100%' }} spacing={2}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <StatusChip status={ad.status?.toLowerCase()} size="small" />
                        <Typography variant="subtitle1" fontWeight={600} noWrap title={ad.name}>
                          {ad.name}
                        </Typography>
                      </Stack>
                      {/* Metrics grid */}
                      <Grid container spacing={1.5}>
                        {METRICS.map((m) => (
                          <Grid size={{ xs: 6, sm: 4 }} key={m.key}>
                            <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'grey.50', borderRadius: 1 }}>
                              <Typography variant="h5" fontWeight={700}>
                                {m.format(ad.insights?.[m.key])}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {m.label}
                              </Typography>
                            </Paper>
                          </Grid>
                        ))}
                      </Grid>
                    </Stack>
                  </Grid>
                </Grid>
              </Paper>
            ))}
          </Stack>
        ))}
    </Stack>
  );
}
