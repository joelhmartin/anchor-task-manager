import { fetchUnifiedAnalytics } from './index.js';
import { resolveAnalyticsSelection } from './selectionResolver.js';
import { fetchGA4Analytics, fetchGA4Sources, fetchGA4LandingPages, fetchGA4DeviceBreakdown } from './ga4Adapter.js';
import {
  fetchCTMApiAnalytics,
  fetchApiByRating,
  fetchApiByCategory,
  fetchApiBySource,
  fetchApiVolumeTimeSeries,
  fetchApiDurationDistribution
} from './ctmApiAdapter.js';
import { getCached, setCached } from './groupCache.js';
import { query } from '../../db.js';
import { formatClientLabel, formatUserName } from '../userFormatters.js';

/**
 * Concurrency-limited Promise.allSettled
 */
async function withConcurrency(tasks, limit = 3) {
  const results = [];
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve()
      .then(task)
      .then(
        (v) => {
          executing.delete(p);
          return { status: 'fulfilled', value: v };
        },
        (e) => {
          executing.delete(p);
          return { status: 'rejected', reason: e };
        }
      );
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

/**
 * Fetch and aggregate analytics for a selection of clients.
 * @param {object} selection - { mode, userId, groupId, includedUserIds, excludedUserIds }
 * @param {string} startDate
 * @param {string} endDate
 * @returns {object} Aggregated analytics with coverage metadata
 */
export async function fetchGroupAnalytics(selection, startDate, endDate, options = {}) {
  const scopeKey = options.accessScope?.cacheKey || 'global';
  const cached = getCached('overview', selection, startDate, endDate, scopeKey);
  if (cached) return cached;

  // Resolve selection to user IDs
  const resolved = await resolveAnalyticsSelection(selection, options);
  const { userIds, label, clients, coverage } = resolved;
  const clientLookup = new Map(clients.map((client) => [client.user_id, client]));

  if (userIds.length === 0) {
    const emptyResult = { kpis: emptyKpis(), byPlatform: {}, timeSeries: [], coverage, label, perClient: [], errors: [] };
    setCached('overview', selection, startDate, endDate, emptyResult, scopeKey);
    return emptyResult;
  }

  // If single client, just fetch directly (no aggregation needed)
  if (userIds.length === 1) {
    const data = await fetchUnifiedAnalytics(userIds[0], startDate, endDate);
    const singleResult = {
      ...data,
      coverage,
      label,
      perClient: [buildPerClientSummary(userIds[0], data, clientLookup)]
    };
    setCached('overview', selection, startDate, endDate, singleResult, scopeKey);
    return singleResult;
  }

  // Fetch all clients with concurrency limit
  const tasks = userIds.map((uid) => () => fetchUnifiedAnalytics(uid, startDate, endDate));
  const results = await withConcurrency(tasks, 3);

  const errors = [];
  const clientResults = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      clientResults.push({ userId: userIds[i], data: r.value });
    } else {
      errors.push({
        scope: clientName(clients, userIds[i]),
        message: r.reason?.message || 'Failed to fetch analytics'
      });
    }
  });

  // Merge KPIs from raw totals (NEVER average percentages)
  const totalLeads = sum(clientResults, (c) => c.data.kpis?.totalLeads || 0);
  const totalSpend = sum(clientResults, (c) => c.data.kpis?.totalSpend || 0);
  const totalSessions = sum(clientResults, (c) => c.data.kpis?.totalSessions || 0);
  const totalEngagedSessions = sum(clientResults, (c) => c.data.kpis?.totalEngagedSessions || 0);

  const kpis = {
    totalLeads,
    totalSpend: round2(totalSpend),
    costPerLead: totalLeads > 0 ? round2(totalSpend / totalLeads) : 0,
    totalSessions,
    totalEngagedSessions,
    conversionRate: totalEngagedSessions > 0 ? round2((totalLeads / totalEngagedSessions) * 100) : 0
  };

  // Merge time series by date
  const dateMap = new Map();
  for (const { data } of clientResults) {
    for (const row of data.timeSeries || []) {
      const existing = dateMap.get(row.date) || { date: row.date, sessions: 0, leads: 0, spend: 0, calls: 0 };
      existing.sessions += row.sessions || 0;
      existing.leads += row.leads || 0;
      existing.spend += row.spend || 0;
      existing.calls += row.calls || 0;
      dateMap.set(row.date, existing);
    }
  }
  const timeSeries = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Merge byPlatform — aggregate CTM, GA4, Meta, Google Ads
  const byPlatform = {
    ctm: mergeCTM(clientResults),
    ga4: mergeGA4(clientResults),
    metaAds: mergeMetaAds(clientResults),
    googleAds: mergeGoogleAds(clientResults)
  };

  // Per-client contribution summary
  const perClient = clientResults.map(({ userId, data }) => buildPerClientSummary(userId, data, clientLookup));

  // Sort per-client by totalLeads descending
  perClient.sort((a, b) => (b.kpis?.totalLeads || 0) - (a.kpis?.totalLeads || 0));

  const result = {
    dateRange: { start: startDate, end: endDate },
    kpis,
    byPlatform,
    timeSeries,
    coverage: {
      ...coverage,
      failed: errors.length,
      succeeded: clientResults.length,
      metaMixedCurrency: byPlatform.metaAds?.mixedCurrency || false,
      metaCurrencies: byPlatform.metaAds?.currencies || []
    },
    label,
    perClient,
    errors
  };

  setCached('overview', selection, startDate, endDate, result, scopeKey);
  return result;
}

// ── Merge helpers ──

function sum(arr, fn) {
  return arr.reduce((s, item) => s + fn(item), 0);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function clientName(clients, userId) {
  const c = clients.find((cl) => cl.user_id === userId);
  return formatUserName(c, 'Unknown');
}

function buildPerClientSummary(userId, data, clientLookup) {
  const client = clientLookup.get(userId) || null;
  const ctm = data.byPlatform?.ctm || null;
  const ga4 = data.byPlatform?.ga4 || null;
  const metaAds = data.byPlatform?.metaAds || null;
  const googleAds = data.byPlatform?.googleAds || null;

  return {
    userId,
    name: formatClientLabel(client, 'Unknown'),
    email: client?.email || null,
    clientType: client?.client_type || null,
    metaConversionsEnabled: client?.client_type !== 'medical',
    platformCoverage: buildPlatformCoverage(client),
    kpis: data.kpis || emptyKpis(),
    ctm: ctm
      ? {
          totalCalls: ctm.totalCalls || 0,
          qualifiedCalls: ctm.qualifiedCalls || 0,
          missedCalls: ctm.missedCalls || 0,
          avgDuration: ctm.avgDuration || 0,
          topSource: ctm.topSources?.[0]?.source || null
        }
      : null,
    ga4: ga4
      ? {
          sessions: ga4.sessions || 0,
          bounceRate: ga4.bounceRate || 0,
          topSource: ga4.topSources?.[0]?.source || null
        }
      : null,
    metaAds: metaAds
      ? {
          spend: metaAds.spend || 0,
          clicks: metaAds.clicks || 0,
          impressions: metaAds.impressions || 0,
          ctr: metaAds.ctr || 0,
          cpc: metaAds.cpc || 0,
          landingPageViews: metaAds.landingPageViews || 0,
          conversions: metaAds.conversions || 0
        }
      : null,
    googleAds: googleAds
      ? {
          spend: googleAds.spend || 0,
          conversions: googleAds.conversions || 0
        }
      : null,
    errors: data.errors || []
  };
}

function emptyKpis() {
  return { totalLeads: 0, totalSpend: 0, costPerLead: 0, totalSessions: 0, totalEngagedSessions: 0, conversionRate: 0 };
}

function buildPlatformCoverage(client) {
  return {
    hasGA4: !!client?.has_ga4,
    hasMeta: !!client?.has_meta,
    hasGoogleAds: !!client?.has_google_ads,
    hasCTM: !!client?.has_ctm
  };
}


function buildTrafficPerClientSummary(userId, data, clientLookup) {
  const client = clientLookup.get(userId) || null;
  const sources = data?.sources || [];
  const pages = data?.pages || [];
  const devices = data?.devices || [];
  const summary = data?.summary || null;
  const topSource = sources[0];
  const topPage = pages[0];
  const topDevice = [...devices].sort((a, b) => (b.sessions || 0) - (a.sessions || 0))[0];

  // Prefer account-level GA4 summary totals; fall back to summing sources if the
  // summary call failed so a single adapter hiccup doesn't blank out the chart.
  const fallbackSessions = sources.reduce((sum, row) => sum + (row.sessions || 0), 0);
  const fallbackEngagedSessions = sources.reduce((sum, row) => sum + (row.engagedSessions || 0), 0);
  const bounceWeighted = sources.reduce((sum, row) => sum + (row.bounceRate || 0) * (row.sessions || 0), 0);
  const durationWeighted = sources.reduce((sum, row) => sum + (row.avgDuration || 0) * (row.sessions || 0), 0);
  const engagementWeighted = sources.reduce((sum, row) => sum + (row.engagementRate || 0) * (row.sessions || 0), 0);

  const totalSessions = summary?.sessions ?? fallbackSessions;
  const engagedSessions = summary?.engagedSessions ?? fallbackEngagedSessions;
  const bounceRate = summary?.bounceRate ?? (fallbackSessions > 0 ? bounceWeighted / fallbackSessions : 0);
  const avgDuration = summary?.avgSessionDuration ?? (fallbackSessions > 0 ? Math.round(durationWeighted / fallbackSessions) : 0);
  const engagementRate = summary?.engagementRate ?? (fallbackSessions > 0 ? engagementWeighted / fallbackSessions : 0);
  const activeUsers = summary?.activeUsers ?? 0;
  const newUsers = summary?.newUsers ?? 0;

  return {
    userId,
    name: formatClientLabel(client, 'Unknown'),
    email: client?.email || null,
    platformCoverage: buildPlatformCoverage(client),
    sessions: totalSessions,
    engagedSessions,
    engagementRate,
    bounceRate,
    avgDuration,
    activeUsers,
    newUsers,
    topSource: topSource?.source ? `${topSource.source}${topSource.medium ? ` / ${topSource.medium}` : ''}` : null,
    topPage: topPage?.page || null,
    topDevice: topDevice?.device || null
  };
}

function emptyCallsLeadsClientSummary() {
  return {
    totalLeads: 0,
    totalCalls: 0,
    totalForms: 0,
    qualifiedCalls: 0,
    missedCalls: 0,
    avgDuration: 0,
    qualifiedRate: 0,
    missedRate: 0,
    topSource: null,
    topCategory: null
  };
}

function buildCallsLeadsPerClientSummary(userId, data, clientLookup) {
  const client = clientLookup.get(userId) || null;
  const summary = data?.summary || emptyCallsLeadsClientSummary();
  const totalLeads = summary.totalLeads || 0;
  const totalCalls = summary.totalCalls || 0;

  return {
    userId,
    name: formatClientLabel(client, 'Unknown'),
    email: client?.email || null,
    platformCoverage: buildPlatformCoverage(client),
    totalLeads,
    totalCalls,
    totalForms: summary.totalForms || 0,
    qualifiedCalls: summary.qualifiedCalls || 0,
    missedCalls: summary.missedCalls || 0,
    avgDuration: summary.avgDuration || 0,
    qualifiedRate: totalLeads > 0 ? Math.round(((summary.qualifiedCalls || 0) / totalLeads) * 1000) / 10 : 0,
    missedRate: totalCalls > 0 ? Math.round(((summary.missedCalls || 0) / totalCalls) * 1000) / 10 : 0,
    topSource: data?.sources?.[0]?.source || summary.topSources?.[0]?.source || null,
    topCategory: data?.categories?.[0]?.category || null
  };
}

function mergeCTM(clientResults) {
  const items = clientResults.map((c) => c.data.byPlatform?.ctm).filter(Boolean);
  if (items.length === 0) return null;

  const totalCalls = sum(items, (c) => c.totalCalls || 0);
  const totalForms = sum(items, (c) => c.totalForms || 0);
  const qualifiedCalls = sum(items, (c) => c.qualifiedCalls || 0);
  const missedCalls = sum(items, (c) => c.missedCalls || 0);
  const totalDuration = sum(items, (c) => (c.avgDuration || 0) * (c.totalCalls || 1));
  const answeredCalls = totalCalls - missedCalls;

  // Merge sources
  const sourceMap = {};
  for (const ctm of items) {
    for (const s of ctm.topSources || []) {
      sourceMap[s.source] = (sourceMap[s.source] || 0) + s.count;
    }
  }
  const topSources = Object.entries(sourceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  return {
    totalCalls,
    totalForms,
    qualifiedCalls,
    missedCalls,
    avgDuration: answeredCalls > 0 ? Math.round(totalDuration / answeredCalls) : 0,
    topSources,
    timeSeries: [] // time series is merged at top level
  };
}

function mergeGA4(clientResults) {
  const items = clientResults.map((c) => c.data.byPlatform?.ga4).filter(Boolean);
  if (items.length === 0) return null;

  const sessions = sum(items, (c) => c.sessions || 0);
  const users = sum(items, (c) => c.users || 0);
  const engagedSessions = sum(items, (c) => c.engagedSessions || 0);
  const conversions = sum(items, (c) => c.conversions || 0);
  // Weighted bounce rate
  const totalBounced = sum(items, (c) => (c.bounceRate || 0) * (c.sessions || 0));
  const bounceRate = sessions > 0 ? totalBounced / sessions : 0;
  const totalEngagement = sum(items, (c) => (c.engagementRate || 0) * (c.sessions || 0));
  const engagementRate = sessions > 0 ? totalEngagement / sessions : 0;
  // Weighted avg duration
  const totalDur = sum(items, (c) => (c.avgSessionDuration || 0) * (c.sessions || 0));
  const avgSessionDuration = sessions > 0 ? Math.round(totalDur / sessions) : 0;

  // Merge sources by (source, medium)
  const sourceMap = {};
  for (const ga4 of items) {
    for (const s of ga4.topSources || []) {
      const key = `${s.source}|||${s.medium}`;
      if (!sourceMap[key]) sourceMap[key] = { source: s.source, medium: s.medium, sessions: 0 };
      sourceMap[key].sessions += s.sessions || 0;
    }
  }
  const topSources = Object.values(sourceMap)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);

  // Merge pages by path
  const pageMap = {};
  for (const ga4 of items) {
    for (const p of ga4.topPages || []) {
      if (!pageMap[p.page]) pageMap[p.page] = { page: p.page, sessions: 0, totalBounce: 0 };
      pageMap[p.page].sessions += p.sessions || 0;
      pageMap[p.page].totalBounce += (p.bounceRate || 0) * (p.sessions || 0);
    }
  }
  const topPages = Object.values(pageMap)
    .map((p) => ({ page: p.page, sessions: p.sessions, bounceRate: p.sessions > 0 ? p.totalBounce / p.sessions : 0 }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);

  return {
    sessions,
    users,
    engagedSessions,
    engagementRate,
    bounceRate,
    avgSessionDuration,
    conversions,
    topSources,
    topPages,
    timeSeries: []
  };
}

function mergeMetaAds(clientResults) {
  const items = clientResults.map((c) => c.data.byPlatform?.metaAds).filter(Boolean);
  if (items.length === 0) return null;

  // Currency mix check — collect distinct non-null currencies
  const currencies = [...new Set(items.map((c) => c.currency).filter(Boolean))];
  const mixedCurrency = currencies.length > 1;

  const spend = sum(items, (c) => c.spend || 0);
  const clicks = sum(items, (c) => c.clicks || 0);
  const impressions = sum(items, (c) => c.impressions || 0);
  const reach = sum(items, (c) => c.reach || 0);
  const landingPageViews = sum(items, (c) => c.landingPageViews || 0);
  const conversions = sum(items, (c) => c.conversions || 0);

  return {
    currency: mixedCurrency ? 'MIXED' : currencies[0] || null,
    mixedCurrency,
    currencies,
    spend: round2(spend),
    clicks,
    impressions,
    reach,
    landingPageViews,
    conversions,
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? round2(spend / clicks) : 0,
    cpm: impressions > 0 ? round2((spend / impressions) * 1000) : 0,
    costPerConversion: conversions > 0 ? round2(spend / conversions) : 0,
    campaigns: [], // Don't merge campaigns across clients
    timeSeries: []
  };
}

function mergeGoogleAds(clientResults) {
  const items = clientResults.map((c) => c.data.byPlatform?.googleAds).filter(Boolean);
  if (items.length === 0) return null;

  const spend = sum(items, (c) => c.spend || 0);
  const clicks = sum(items, (c) => c.clicks || 0);
  const impressions = sum(items, (c) => c.impressions || 0);
  const conversions = sum(items, (c) => c.conversions || 0);

  return {
    spend: round2(spend),
    clicks,
    impressions,
    conversions,
    ctr: impressions > 0 ? round2((clicks / impressions) * 100) : 0,
    cpc: clicks > 0 ? round2(spend / clicks) : 0,
    costPerConversion: conversions > 0 ? round2(spend / conversions) : 0,
    campaigns: [],
    timeSeries: []
  };
}

// ── Group Traffic (GA4) ──────────────────────────────────────────

/**
 * Fetch and aggregate GA4 traffic data (sources / landing pages / devices) for
 * a selection of clients.
 * @param {object} selection
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<{ sources: object[], pages: object[], devices: object[], coverage: object, label: string, errors: object[] }>}
 */
export async function fetchGroupTraffic(selection, startDate, endDate, options = {}) {
  const scopeKey = options.accessScope?.cacheKey || 'global';
  const cached = getCached('traffic', selection, startDate, endDate, scopeKey);
  if (cached) return cached;

  const resolved = await resolveAnalyticsSelection(selection, options);
  const { userIds, label, clients, coverage } = resolved;
  const clientLookup = new Map(clients.map((client) => [client.user_id, client]));

  if (userIds.length === 0) {
    const emptyResult = { sources: [], pages: [], devices: [], coverage, label, perClient: [], errors: [] };
    setCached('traffic', selection, startDate, endDate, emptyResult, scopeKey);
    return emptyResult;
  }

  // Load GA4 property IDs for these clients
  const { rows: configRows } = await query(
    `SELECT user_id, ga4_property_id
     FROM tracking_configs
     WHERE user_id = ANY($1) AND ga4_property_id IS NOT NULL`,
    [userIds]
  );
  const propertyByUser = new Map(configRows.map((r) => [r.user_id, r.ga4_property_id]));

  const targets = userIds.filter((uid) => propertyByUser.has(uid));

  const tasks = targets.map((uid) => async () => {
    const propertyId = propertyByUser.get(uid);
    const [summary, src, pgs, devs] = await Promise.allSettled([
      fetchGA4Analytics(propertyId, startDate, endDate),
      fetchGA4Sources(propertyId, startDate, endDate, 100),
      fetchGA4LandingPages(propertyId, startDate, endDate, 100),
      fetchGA4DeviceBreakdown(propertyId, startDate, endDate)
    ]);

    const taskErrors = [];
    if (summary.status === 'rejected') taskErrors.push(summary.reason?.message || 'Failed to load GA4 summary');
    if (src.status === 'rejected') taskErrors.push(src.reason?.message || 'Failed to load traffic sources');
    if (pgs.status === 'rejected') taskErrors.push(pgs.reason?.message || 'Failed to load landing pages');
    if (devs.status === 'rejected') taskErrors.push(devs.reason?.message || 'Failed to load device breakdown');

    return {
      userId: uid,
      summary: summary.status === 'fulfilled' ? summary.value : null,
      sources: src.status === 'fulfilled' ? src.value : [],
      pages: pgs.status === 'fulfilled' ? pgs.value : [],
      devices: devs.status === 'fulfilled' ? devs.value : [],
      errors: taskErrors
    };
  });

  const results = await withConcurrency(tasks, 3);

  const errors = [];
  const clientResults = [];
  const clientResultByUser = new Map();
  const failedUsers = new Set();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      clientResults.push(r.value);
      clientResultByUser.set(r.value.userId, r.value);
      if (r.value.errors?.length) {
        failedUsers.add(r.value.userId);
        r.value.errors.forEach((message) => {
          errors.push({
            scope: clientName(clients, r.value.userId),
            message
          });
        });
      }
    } else {
      failedUsers.add(targets[i]);
      errors.push({
        scope: clientName(clients, targets[i]),
        message: r.reason?.message || 'Failed to fetch traffic'
      });
    }
  });

  // Merge sources by (source, medium)
  const sourceMap = new Map();
  for (const cr of clientResults) {
    for (const s of cr.sources || []) {
      const key = `${s.source}|||${s.medium}`;
      const existing = sourceMap.get(key) || {
        source: s.source,
        medium: s.medium,
        sessions: 0,
        users: 0,
        engagedSessions: 0,
        _engagementTotal: 0,
        conversions: 0,
        _bounceTotal: 0,
        _durationTotal: 0
      };
      existing.sessions += s.sessions || 0;
      existing.users += s.users || 0;
      existing.engagedSessions += s.engagedSessions || 0;
      existing._engagementTotal += (s.engagementRate || 0) * (s.sessions || 0);
      existing.conversions += s.conversions || 0;
      existing._bounceTotal += (s.bounceRate || 0) * (s.sessions || 0);
      existing._durationTotal += (s.avgDuration || 0) * (s.sessions || 0);
      sourceMap.set(key, existing);
    }
  }
  const sources = Array.from(sourceMap.values())
    .map((s) => ({
      source: s.source,
      medium: s.medium,
      sessions: s.sessions,
      users: s.users,
      engagedSessions: s.engagedSessions,
      engagementRate: s.sessions > 0 ? s._engagementTotal / s.sessions : 0,
      conversions: s.conversions,
      bounceRate: s.sessions > 0 ? s._bounceTotal / s.sessions : 0,
      avgDuration: s.sessions > 0 ? Math.round(s._durationTotal / s.sessions) : 0
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 50);

  // Merge landing pages by page path
  const pageMap = new Map();
  for (const cr of clientResults) {
    for (const p of cr.pages || []) {
      const existing = pageMap.get(p.page) || {
        page: p.page,
        sessions: 0,
        users: 0,
        engagedSessions: 0,
        _engagementTotal: 0,
        conversions: 0,
        _bounceTotal: 0,
        _durationTotal: 0
      };
      existing.sessions += p.sessions || 0;
      existing.users += p.users || 0;
      existing.engagedSessions += p.engagedSessions || 0;
      existing._engagementTotal += (p.engagementRate || 0) * (p.sessions || 0);
      existing.conversions += p.conversions || 0;
      existing._bounceTotal += (p.bounceRate || 0) * (p.sessions || 0);
      existing._durationTotal += (p.avgDuration || 0) * (p.sessions || 0);
      pageMap.set(p.page, existing);
    }
  }
  const pages = Array.from(pageMap.values())
    .map((p) => ({
      page: p.page,
      sessions: p.sessions,
      users: p.users,
      engagedSessions: p.engagedSessions,
      engagementRate: p.sessions > 0 ? p._engagementTotal / p.sessions : 0,
      conversions: p.conversions,
      bounceRate: p.sessions > 0 ? p._bounceTotal / p.sessions : 0,
      avgDuration: p.sessions > 0 ? Math.round(p._durationTotal / p.sessions) : 0
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 50);

  // Merge devices
  const deviceMap = new Map();
  for (const cr of clientResults) {
    for (const d of cr.devices || []) {
      const key = d.device || 'Unknown';
      const existing = deviceMap.get(key) || { device: key, sessions: 0, users: 0 };
      existing.sessions += d.sessions || 0;
      existing.users += d.users || 0;
      deviceMap.set(key, existing);
    }
  }
  const devices = Array.from(deviceMap.values()).sort((a, b) => b.sessions - a.sessions);

  const perClient = userIds
    .map((userId) => buildTrafficPerClientSummary(userId, clientResultByUser.get(userId), clientLookup))
    .sort((a, b) => (b.sessions || 0) - (a.sessions || 0));

  const totalSessions = perClient.reduce((s, r) => s + (r.sessions || 0), 0);
  const kpis = {
    activeUsers: perClient.reduce((s, r) => s + (r.activeUsers || 0), 0),
    newUsers: perClient.reduce((s, r) => s + (r.newUsers || 0), 0),
    engagedSessions: perClient.reduce((s, r) => s + (r.engagedSessions || 0), 0),
    avgSessionDuration:
      totalSessions > 0
        ? Math.round(perClient.reduce((s, r) => s + (r.avgDuration || 0) * (r.sessions || 0), 0) / totalSessions)
        : 0
  };

  const result = {
    sources,
    pages,
    devices,
    perClient,
    kpis,
    coverage: {
      ...coverage,
      failed: failedUsers.size,
      succeeded: Math.max(clientResults.length - failedUsers.size, 0)
    },
    label,
    errors
  };

  setCached('traffic', selection, startDate, endDate, result, scopeKey);
  return result;
}

// ── Group Calls & Leads (CTM hybrid) ─────────────────────────────

/**
 * Fetch and aggregate CTM calls/leads data for a selection of clients.
 * @param {object} selection
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<{ summary: object, ratings: object[], categories: object[], sources: object[], volume: object[], duration: object[], coverage: object, label: string, errors: object[] }>}
 */
export async function fetchGroupCallsLeads(selection, startDate, endDate, options = {}) {
  const scopeKey = options.accessScope?.cacheKey || 'global';
  const cached = getCached('callsleads', selection, startDate, endDate, scopeKey);
  if (cached) return cached;

  const resolved = await resolveAnalyticsSelection(selection, options);
  const { userIds, label, clients, coverage } = resolved;
  const clientLookup = new Map(clients.map((client) => [client.user_id, client]));

  if (userIds.length === 0) {
    const emptyResult = {
      summary: emptyCallsLeadsSummary(),
      ratings: [],
      categories: [],
      sources: [],
      volume: [],
      duration: [],
      perClient: [],
      coverage,
      label,
      errors: []
    };
    setCached('callsleads', selection, startDate, endDate, emptyResult, scopeKey);
    return emptyResult;
  }

  const tasks = userIds.map((uid) => async () => {
    const [summary, ratings, categories, sources, volume, duration] = await Promise.allSettled([
      fetchCTMApiAnalytics(uid, startDate, endDate),
      fetchApiByRating(uid, startDate, endDate),
      fetchApiByCategory(uid, startDate, endDate),
      fetchApiBySource(uid, startDate, endDate),
      fetchApiVolumeTimeSeries(uid, startDate, endDate),
      fetchApiDurationDistribution(uid, startDate, endDate)
    ]);

    const taskErrors = [];
    if (summary.status === 'rejected') taskErrors.push(summary.reason?.message || 'Failed to load calls/leads summary');
    if (ratings.status === 'rejected') taskErrors.push(ratings.reason?.message || 'Failed to load rating breakdown');
    if (categories.status === 'rejected') taskErrors.push(categories.reason?.message || 'Failed to load category breakdown');
    if (sources.status === 'rejected') taskErrors.push(sources.reason?.message || 'Failed to load source attribution');
    if (volume.status === 'rejected') taskErrors.push(volume.reason?.message || 'Failed to load volume time series');
    if (duration.status === 'rejected') taskErrors.push(duration.reason?.message || 'Failed to load duration distribution');

    return {
      userId: uid,
      summary: summary.status === 'fulfilled' ? summary.value : null,
      ratings: ratings.status === 'fulfilled' ? ratings.value : [],
      categories: categories.status === 'fulfilled' ? categories.value : [],
      sources: sources.status === 'fulfilled' ? sources.value : [],
      volume: volume.status === 'fulfilled' ? volume.value : [],
      duration: duration.status === 'fulfilled' ? duration.value : [],
      errors: taskErrors
    };
  });

  const results = await withConcurrency(tasks, 3);

  const errors = [];
  const clientResults = [];
  const clientResultByUser = new Map();
  const failedUsers = new Set();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      clientResults.push(r.value);
      clientResultByUser.set(r.value.userId, r.value);
      if (r.value.errors?.length) {
        failedUsers.add(r.value.userId);
        r.value.errors.forEach((message) => {
          errors.push({
            scope: clientName(clients, r.value.userId),
            message
          });
        });
      }
    } else {
      failedUsers.add(userIds[i]);
      errors.push({
        scope: clientName(clients, userIds[i]),
        message: r.reason?.message || 'Failed to fetch calls/leads'
      });
    }
  });

  // ── summary ──
  let totalLeads = 0;
  let totalCalls = 0;
  let totalForms = 0;
  let qualifiedCalls = 0;
  let missedCalls = 0;
  let durationWeightedSum = 0;
  let durationWeight = 0;
  const summarySourceMap = new Map();

  for (const cr of clientResults) {
    const s = cr.summary;
    if (!s) continue;
    totalLeads += s.totalLeads || 0;
    totalCalls += s.totalCalls || 0;
    totalForms += s.totalForms || 0;
    qualifiedCalls += s.qualifiedCalls || 0;
    missedCalls += s.missedCalls || 0;
    const answered = (s.totalCalls || 0) - (s.missedCalls || 0);
    if (answered > 0 && s.avgDuration) {
      durationWeightedSum += s.avgDuration * answered;
      durationWeight += answered;
    }
    for (const src of s.topSources || []) {
      summarySourceMap.set(src.source, (summarySourceMap.get(src.source) || 0) + (src.count || 0));
    }
  }

  const summaryTopSources = Array.from(summarySourceMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  const summary = {
    totalLeads,
    totalCalls,
    totalForms,
    qualifiedCalls,
    missedCalls,
    avgDuration: durationWeight > 0 ? Math.round(durationWeightedSum / durationWeight) : 0,
    topSources: summaryTopSources,
    timeSeries: []
  };

  // ── ratings ──
  const ratingMap = new Map();
  for (const cr of clientResults) {
    for (const r of cr.ratings || []) {
      ratingMap.set(r.rating, (ratingMap.get(r.rating) || 0) + (r.count || 0));
    }
  }
  const ratings = Array.from(ratingMap.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rating, count]) => ({ rating: Number(rating), count }));

  // ── categories ──
  const categoryMap = new Map();
  for (const cr of clientResults) {
    for (const c of cr.categories || []) {
      categoryMap.set(c.category, (categoryMap.get(c.category) || 0) + (c.count || 0));
    }
  }
  const categories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));

  // ── sources (by-source table) — recompute qualifiedRate from totals ──
  const sourceAggMap = new Map();
  for (const cr of clientResults) {
    for (const s of cr.sources || []) {
      const existing = sourceAggMap.get(s.source) || {
        source: s.source,
        total: 0,
        calls: 0,
        forms: 0,
        qualified: 0
      };
      existing.total += s.total || 0;
      existing.calls += s.calls || 0;
      existing.forms += s.forms || 0;
      existing.qualified += s.qualified || 0;
      sourceAggMap.set(s.source, existing);
    }
  }
  const sources = Array.from(sourceAggMap.values())
    .map((s) => ({
      ...s,
      qualifiedRate: s.total > 0 ? Math.round((s.qualified / s.total) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.total - a.total);

  // ── volume time series (sum calls/forms by date) ──
  const volumeMap = new Map();
  for (const cr of clientResults) {
    for (const v of cr.volume || []) {
      const existing = volumeMap.get(v.date) || { date: v.date, calls: 0, forms: 0 };
      existing.calls += v.calls || 0;
      existing.forms += v.forms || 0;
      volumeMap.set(v.date, existing);
    }
  }
  const volume = Array.from(volumeMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ── duration distribution ──
  const BUCKET_ORDER = ['missed', 'under_30s', '30s_to_1m', '1m_to_3m', '3m_to_5m', '5m_to_10m', 'over_10m'];
  const bucketMap = {};
  for (const b of BUCKET_ORDER) bucketMap[b] = 0;
  for (const cr of clientResults) {
    for (const d of cr.duration || []) {
      if (bucketMap[d.bucket] !== undefined) bucketMap[d.bucket] += d.count || 0;
    }
  }
  const duration = BUCKET_ORDER.map((bucket) => ({ bucket, count: bucketMap[bucket] }));

  const perClient = userIds
    .map((userId) => buildCallsLeadsPerClientSummary(userId, clientResultByUser.get(userId), clientLookup))
    .sort((a, b) => (b.totalLeads || 0) - (a.totalLeads || 0));

  const result = {
    summary,
    ratings,
    categories,
    sources,
    volume,
    duration,
    perClient,
    coverage: {
      ...coverage,
      failed: failedUsers.size,
      succeeded: Math.max(clientResults.length - failedUsers.size, 0)
    },
    label,
    errors
  };

  setCached('callsleads', selection, startDate, endDate, result, scopeKey);
  return result;
}

function emptyCallsLeadsSummary() {
  return {
    totalLeads: 0,
    totalCalls: 0,
    totalForms: 0,
    qualifiedCalls: 0,
    missedCalls: 0,
    avgDuration: 0,
    topSources: [],
    timeSeries: []
  };
}
