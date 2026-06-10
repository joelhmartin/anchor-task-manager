import { useState, useEffect, useMemo } from 'react';
import { Stack, Typography, Breadcrumbs, Link, ToggleButton, ToggleButtonGroup, Skeleton, Paper, Grid } from '@mui/material';
import AdsClickIcon from '@mui/icons-material/AdsClick';
import Chart from 'react-apexcharts';
import DataTable from 'ui-component/extended/DataTable';
import StatusChip from 'ui-component/extended/StatusChip';
import EmptyState from 'ui-component/extended/EmptyState';
import { CARD_SHADOW, PREMIUM_COLORS, useChartTheme } from './chartTheme';
import AccountKpiCard from './AccountKpiCard';
import GoogleAdSearchPreview from './GoogleAdSearchPreview';
import {
  fetchGoogleAdsCampaigns,
  fetchGoogleAdsAdGroups,
  fetchGoogleAdsAds,
  fetchGoogleAdsKeywords,
  fetchGoogleAdsSearchTerms
} from 'api/analytics';
import { useToast } from 'contexts/ToastContext';

// Hidden 2026-04-20 — Spend by Campaign chart removed pending redesign.
// See plans/2026-04-20-analytics-comparison-ux-cleanup.md.
const SHOW_SPEND_BY_CAMPAIGN = false;

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

const adGroupColumns = [
  { id: 'name', label: 'Ad Group', sortable: true },
  {
    id: 'spend',
    label: 'Spend',
    render: (row) => `$${(row.spend || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.spend || 0
  },
  {
    id: 'clicks',
    label: 'Clicks',
    render: (row) => (row.clicks || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.clicks || 0
  },
  {
    id: 'impressions',
    label: 'Impr.',
    render: (row) => (row.impressions || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.impressions || 0
  },
  {
    id: 'ctr',
    label: 'CTR',
    render: (row) => `${(row.ctr || 0).toFixed(2)}%`,
    sortable: true,
    sortValue: (row) => row.ctr || 0
  },
  {
    id: 'conversions',
    label: 'Conv.',
    render: (row) => row.conversions || 0,
    sortable: true,
    sortValue: (row) => row.conversions || 0
  }
];

const adsColumns = [
  {
    id: 'preview',
    label: 'Ad Preview',
    render: (row) => <GoogleAdSearchPreview ad={row} compact />
  },
  { id: 'type', label: 'Type', width: 100 },
  {
    id: 'spend',
    label: 'Spend',
    render: (row) => `$${(row.spend || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.spend || 0
  },
  {
    id: 'clicks',
    label: 'Clicks',
    render: (row) => (row.clicks || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.clicks || 0
  },
  {
    id: 'impressions',
    label: 'Impr.',
    render: (row) => (row.impressions || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.impressions || 0
  },
  {
    id: 'conversions',
    label: 'Conv.',
    render: (row) => row.conversions || 0,
    sortable: true,
    sortValue: (row) => row.conversions || 0
  }
];

const keywordColumns = [
  { id: 'keyword', label: 'Keyword', sortable: true },
  { id: 'matchType', label: 'Match', width: 100 },
  {
    id: 'qualityScore',
    label: 'QS',
    width: 60,
    render: (row) => row.qualityScore || '\u2014',
    sortable: true,
    sortValue: (row) => row.qualityScore || 0
  },
  {
    id: 'spend',
    label: 'Spend',
    render: (row) => `$${(row.spend || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.spend || 0
  },
  {
    id: 'clicks',
    label: 'Clicks',
    render: (row) => (row.clicks || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.clicks || 0
  },
  {
    id: 'impressions',
    label: 'Impr.',
    render: (row) => (row.impressions || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.impressions || 0
  },
  {
    id: 'ctr',
    label: 'CTR',
    render: (row) => `${(row.ctr || 0).toFixed(2)}%`,
    sortable: true,
    sortValue: (row) => row.ctr || 0
  },
  {
    id: 'conversions',
    label: 'Conv.',
    render: (row) => row.conversions || 0,
    sortable: true,
    sortValue: (row) => row.conversions || 0
  },
  {
    id: 'costPerConversion',
    label: 'Cost/Conv',
    render: (row) => `$${(row.costPerConversion || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.costPerConversion || 0
  }
];

const searchTermColumns = [
  { id: 'searchTerm', label: 'Search Term', sortable: true },
  { id: 'keyword', label: 'Matched Keyword', sortable: true },
  { id: 'matchType', label: 'Match', width: 100 },
  {
    id: 'spend',
    label: 'Spend',
    render: (row) => `$${(row.spend || 0).toFixed(2)}`,
    sortable: true,
    sortValue: (row) => row.spend || 0
  },
  {
    id: 'clicks',
    label: 'Clicks',
    render: (row) => (row.clicks || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.clicks || 0
  },
  {
    id: 'impressions',
    label: 'Impr.',
    render: (row) => (row.impressions || 0).toLocaleString(),
    sortable: true,
    sortValue: (row) => row.impressions || 0
  },
  {
    id: 'conversions',
    label: 'Conv.',
    render: (row) => row.conversions || 0,
    sortable: true,
    sortValue: (row) => row.conversions || 0
  }
];

export default function GoogleAdsView({ userId, dateRange, comparisonRange }) {
  const theme = useChartTheme();
  const [level, setLevel] = useState('campaigns');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [selectedAdGroup, setSelectedAdGroup] = useState(null);
  const [subView, setSubView] = useState('ads');
  const [statusFilter, setStatusFilter] = useState('all');
  const [data, setData] = useState([]);
  const [comparisonData, setComparisonData] = useState(null);
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
      request = fetchGoogleAdsCampaigns(userId, params).then((r) => {
        if (!r || !r.campaigns) {
          throw new Error('Google Ads is not configured for this client.');
        }
        return r.campaigns;
      });
    } else if (level === 'adgroups' && selectedCampaign) {
      request = fetchGoogleAdsAdGroups(userId, selectedCampaign.id, params).then((r) => r.adGroups || []);
    } else if (level === 'detail' && selectedAdGroup) {
      if (subView === 'ads') {
        request = fetchGoogleAdsAds(userId, selectedAdGroup.id, params).then((r) => r.ads || []);
      } else if (subView === 'keywords') {
        request = fetchGoogleAdsKeywords(userId, selectedAdGroup.id, params).then((r) => r.keywords || []);
      } else if (subView === 'search_terms') {
        request = fetchGoogleAdsSearchTerms(userId, {
          ...params,
          campaignId: selectedCampaign?.id
        }).then((r) => r.searchTerms || []);
      }
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
          if (
            msg?.includes('not configured') ||
            msg?.includes('token') ||
            msg?.includes('credentials') ||
            err.response?.status === 401
          ) {
            setError(msg || 'Google Ads is not configured for this client.');
          } else {
            setError(msg || 'Failed to load Google Ads data');
            showToast('Failed to load Google Ads data', 'error');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Fetch comparison data in parallel when at campaign level
    if (level === 'campaigns' && comparisonRange) {
      const compParams = { start: comparisonRange.start, end: comparisonRange.end };
      fetchGoogleAdsCampaigns(userId, compParams)
        .then((r) => {
          if (!cancelled) setComparisonData(r?.campaigns || []);
        })
        .catch(() => {
          if (!cancelled) setComparisonData(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [userId, level, selectedCampaign, selectedAdGroup, subView, dateRange, comparisonRange, showToast]);

  const handleCampaignClick = (row) => {
    setSelectedCampaign({ id: row.id, name: row.name });
    setLevel('adgroups');
  };

  const handleAdGroupClick = (row) => {
    setSelectedAdGroup({ id: row.id, name: row.name });
    setSubView('ads');
    setLevel('detail');
  };

  const handleBreadcrumbCampaigns = () => {
    setLevel('campaigns');
    setSelectedCampaign(null);
    setSelectedAdGroup(null);
  };

  const handleBreadcrumbAdGroups = () => {
    setLevel('adgroups');
    setSelectedAdGroup(null);
  };

  // Filter campaigns by status
  const filteredData = useMemo(() => {
    if (level !== 'campaigns' || statusFilter === 'all') return data;
    return data.filter((d) => d.status?.toUpperCase() === statusFilter.toUpperCase());
  }, [data, statusFilter, level]);

  function aggregateAccountMetrics(rows) {
    if (!rows?.length) return null;
    const spend = rows.reduce((s, c) => s + (c.spend || 0), 0);
    const clicks = rows.reduce((s, c) => s + (c.clicks || 0), 0);
    const impressions = rows.reduce((s, c) => s + (c.impressions || 0), 0);
    const conversions = rows.reduce((s, c) => s + (c.conversions || 0), 0);
    return {
      spend,
      clicks,
      impressions,
      conversions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      costPerConversion: conversions > 0 ? spend / conversions : 0
    };
  }

  // Account-level aggregate metrics from all campaigns (unfiltered)
  const accountMetrics = useMemo(
    () => (level === 'campaigns' ? aggregateAccountMetrics(data) : null),
    [data, level]
  );

  const comparisonAccountMetrics = useMemo(
    () => (level === 'campaigns' && comparisonData?.length ? aggregateAccountMetrics(comparisonData) : null),
    [comparisonData, level]
  );

  // Build comparison lookup map for campaign-level deltas
  const compMap = useMemo(() => {
    if (!comparisonData) return null;
    return new Map(comparisonData.map((c) => [c.id || c.name, c]));
  }, [comparisonData]);

  // Campaign columns with inline delta indicators
  const campaignColumnsWithDelta = useMemo(() => [
    { id: 'name', label: 'Campaign', sortable: true },
    {
      id: 'status',
      label: 'Status',
      render: (row) => <StatusChip status={row.status?.toLowerCase() === 'enabled' ? 'active' : row.status?.toLowerCase()} />,
      width: 100
    },
    {
      id: 'spend',
      label: 'Spend',
      render: (row) => {
        const comp = compMap?.get(row.id || row.name);
        return (
          <Stack>
            <Typography variant="body2">${(row.spend || 0).toFixed(2)}</Typography>
            {comp && <DeltaText current={row.spend} previous={comp.spend} upIsGood={false} />}
          </Stack>
        );
      },
      sortable: true,
      sortValue: (row) => row.spend || 0
    },
    {
      id: 'clicks',
      label: 'Clicks',
      render: (row) => {
        const comp = compMap?.get(row.id || row.name);
        return (
          <Stack>
            <Typography variant="body2">{(row.clicks || 0).toLocaleString()}</Typography>
            {comp && <DeltaText current={row.clicks} previous={comp.clicks} upIsGood={true} />}
          </Stack>
        );
      },
      sortable: true,
      sortValue: (row) => row.clicks || 0
    },
    {
      id: 'impressions',
      label: 'Impr.',
      render: (row) => {
        const comp = compMap?.get(row.id || row.name);
        return (
          <Stack>
            <Typography variant="body2">{(row.impressions || 0).toLocaleString()}</Typography>
            {comp && <DeltaText current={row.impressions} previous={comp.impressions} upIsGood={true} />}
          </Stack>
        );
      },
      sortable: true,
      sortValue: (row) => row.impressions || 0
    },
    {
      id: 'ctr',
      label: 'CTR',
      render: (row) => {
        const comp = compMap?.get(row.id || row.name);
        return (
          <Stack>
            <Typography variant="body2">{(row.ctr || 0).toFixed(2)}%</Typography>
            {comp && <DeltaText current={row.ctr} previous={comp.ctr} upIsGood={true} />}
          </Stack>
        );
      },
      sortable: true,
      sortValue: (row) => row.ctr || 0
    },
    {
      id: 'conversions',
      label: 'Conv.',
      render: (row) => {
        const comp = compMap?.get(row.id || row.name);
        return (
          <Stack>
            <Typography variant="body2">{row.conversions || 0}</Typography>
            {comp && <DeltaText current={row.conversions} previous={comp.conversions} upIsGood={true} />}
          </Stack>
        );
      },
      sortable: true,
      sortValue: (row) => row.conversions || 0
    }
  ], [compMap]);

  if (error) {
    return <EmptyState icon={AdsClickIcon} title="Google Ads unavailable" message={error} />;
  }

  const getDetailColumns = () => {
    if (subView === 'keywords') return keywordColumns;
    if (subView === 'search_terms') return searchTermColumns;
    return adsColumns;
  };

  const getDetailRowKey = () => {
    if (subView === 'keywords') return 'keyword';
    if (subView === 'search_terms') return 'searchTerm';
    return 'id';
  };

  const getDetailEmptyTitle = () => {
    if (subView === 'keywords') return 'No keywords found';
    if (subView === 'search_terms') return 'No search terms found';
    return 'No ads found';
  };

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
        {selectedCampaign && level !== 'campaigns' && (
          level === 'adgroups' ? (
            <Typography variant="body2" color="text.primary">
              {selectedCampaign.name}
            </Typography>
          ) : (
            <Link
              component="button"
              variant="body2"
              underline="hover"
              onClick={handleBreadcrumbAdGroups}
              sx={{ cursor: 'pointer' }}
            >
              {selectedCampaign.name}
            </Link>
          )
        )}
        {selectedAdGroup && level === 'detail' && (
          <Typography variant="body2" color="text.primary">
            {selectedAdGroup.name}
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
              { label: 'Qualified Leads', value: accountMetrics.conversions.toLocaleString(), color: 'primary', metric: 'qualifiedLeads', current: accountMetrics.conversions, previous: comparisonAccountMetrics?.conversions },
              { label: 'CPQL', value: `$${accountMetrics.costPerConversion.toFixed(2)}`, color: 'error', metric: 'cpql', current: accountMetrics.costPerConversion, previous: comparisonAccountMetrics?.costPerConversion }
            ].map((kpi) => (
              <Grid size={{ xs: 6, sm: 4, md: 2 }} key={kpi.label}>
                <AccountKpiCard {...kpi} />
              </Grid>
            ))}
          </Grid>

          {SHOW_SPEND_BY_CAMPAIGN && (
            <Paper sx={{ p: 2, borderRadius: 2, boxShadow: CARD_SHADOW }}>
              <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>Spend by Campaign</Typography>
              <Chart
                type="bar"
                height={250}
                options={{
                  chart: { toolbar: { show: false }, fontFamily: theme.typography.fontFamily },
                  plotOptions: { bar: { borderRadius: 4, horizontal: true, barHeight: '60%', distributed: true } },
                  colors: PREMIUM_COLORS,
                  xaxis: { categories: data.slice(0, 8).map((c) => c.name?.substring(0, 30) || 'Unknown'), labels: { formatter: (v) => `$${v}` } },
                  yaxis: { labels: { style: { fontSize: '11px' } } },
                  tooltip: { theme: 'dark', y: { formatter: (v) => `$${Number(v).toFixed(2)}` } },
                  grid: { strokeDashArray: 4, borderColor: theme.palette.divider },
                  legend: { show: false },
                  dataLabels: { enabled: false }
                }}
                series={[{ name: 'Spend', data: data.slice(0, 8).map((c) => c.spend || 0) }]}
              />
            </Paper>
          )}
        </>
      )}

      {/* Status filter + campaigns table */}
      {level === 'campaigns' && (
        <>
          <ToggleButtonGroup value={statusFilter} exclusive onChange={(_, v) => v && setStatusFilter(v)} size="small">
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="ENABLED">Active</ToggleButton>
            <ToggleButton value="PAUSED">Paused</ToggleButton>
            <ToggleButton value="REMOVED">Removed</ToggleButton>
          </ToggleButtonGroup>

          <DataTable
            columns={campaignColumnsWithDelta}
            rows={filteredData}
            rowKey="id"
            loading={loading}
            searchable
            searchFields={['name']}
            onRowClick={handleCampaignClick}
            emptyTitle="No Google Ads campaigns found"
            emptyMessage="No campaigns with data in the selected date range."
            emptyIcon={AdsClickIcon}
            hover
            outlined
          />
        </>
      )}

      {/* Ad Groups — KPI summary + table */}
      {level === 'adgroups' && (
        <>
          {!loading && data.length > 0 && (() => {
            const agg = {
              spend: data.reduce((s, a) => s + (a.spend || 0), 0),
              clicks: data.reduce((s, a) => s + (a.clicks || 0), 0),
              impressions: data.reduce((s, a) => s + (a.impressions || 0), 0),
              conversions: data.reduce((s, a) => s + (a.conversions || 0), 0)
            };
            agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
            agg.cpc = agg.clicks > 0 ? agg.spend / agg.clicks : 0;
            return (
              <Grid container spacing={2} sx={{ mb: 1 }}>
                {[
                  { label: 'Campaign Spend', value: `$${agg.spend.toFixed(2)}`, color: 'warning' },
                  { label: 'Clicks', value: agg.clicks.toLocaleString(), color: 'primary' },
                  { label: 'Impressions', value: agg.impressions.toLocaleString(), color: 'info' },
                  { label: 'CTR', value: `${agg.ctr.toFixed(2)}%`, color: 'success' },
                  { label: 'Qualified Leads', value: agg.conversions.toLocaleString(), color: 'primary' },
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
            columns={adGroupColumns}
            rows={data}
            rowKey="id"
            loading={loading}
            searchable
            searchFields={['name']}
            onRowClick={handleAdGroupClick}
            emptyTitle="No ad groups found"
            emptyMessage="This campaign has no ad groups with data in the selected date range."
            emptyIcon={AdsClickIcon}
            hover
            outlined
          />
        </>
      )}

      {/* Detail level — KPI summary + sub-view toggle + table */}
      {level === 'detail' && (
        <Stack spacing={2}>
          {/* Ad group aggregate KPIs */}
          {!loading && data.length > 0 && subView === 'ads' && (() => {
            const agg = {
              spend: data.reduce((s, a) => s + (a.spend || 0), 0),
              clicks: data.reduce((s, a) => s + (a.clicks || 0), 0),
              impressions: data.reduce((s, a) => s + (a.impressions || 0), 0),
              conversions: data.reduce((s, a) => s + (a.conversions || 0), 0)
            };
            agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
            return (
              <Grid container spacing={2}>
                {[
                  { label: 'Ad Group Spend', value: `$${agg.spend.toFixed(2)}`, color: 'warning' },
                  { label: 'Clicks', value: agg.clicks.toLocaleString(), color: 'primary' },
                  { label: 'Impressions', value: agg.impressions.toLocaleString(), color: 'info' },
                  { label: 'CTR', value: `${agg.ctr.toFixed(2)}%`, color: 'success' },
                  { label: 'Qualified Leads', value: agg.conversions.toLocaleString(), color: 'primary' }
                ].map((kpi) => (
                  <Grid size={{ xs: 6, sm: 4, md: 'grow' }} key={kpi.label}>
                    <AccountKpiCard {...kpi} />
                  </Grid>
                ))}
              </Grid>
            );
          })()}

          <ToggleButtonGroup
            value={subView}
            exclusive
            onChange={(_, v) => { if (v) setSubView(v); }}
            size="small"
          >
            <ToggleButton value="ads">Ads</ToggleButton>
            <ToggleButton value="keywords">Keywords</ToggleButton>
            <ToggleButton value="search_terms">Search Terms</ToggleButton>
          </ToggleButtonGroup>

          {loading ? (
            <Stack spacing={1}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="rounded" height={40} />
              ))}
            </Stack>
          ) : (
            <DataTable
              columns={getDetailColumns()}
              rows={data}
              rowKey={getDetailRowKey()}
              loading={loading}
              searchable
              searchFields={subView === 'keywords' ? ['keyword'] : subView === 'search_terms' ? ['searchTerm', 'keyword'] : ['name', 'headlines']}
              emptyTitle={getDetailEmptyTitle()}
              emptyMessage="No data found for the selected date range."
              emptyIcon={AdsClickIcon}
              hover
              outlined
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
