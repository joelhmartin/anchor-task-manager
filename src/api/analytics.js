import client from './client';

// Looker URL (stays in hub — client portal endpoint)
export function fetchAnalyticsUrl() {
  return client.get('/hub/analytics').then((res) => res.data.looker_url || null);
}

// Clients with tracking configs
export const fetchAnalyticsClients = () => client.get('/analytics/clients').then((res) => res.data.clients || []);

// Selection options (clients + groups for group analytics picker)
export const fetchSelectionOptions = () => client.get('/analytics/selection-options').then((r) => r.data);

// Per-client analytics
export const fetchAnalyticsOverview = (userId, params = {}) =>
  client.get(`/analytics/${userId}/overview`, { params }).then((res) => res.data);

// Group/selection-based analytics (POST)
export const fetchGroupOverview = (selection, params = {}) =>
  client.post('/analytics/overview', { selection, start: params.start, end: params.end }).then((r) => r.data);

export const fetchGroupTraffic = (selection, params = {}) =>
  client.post('/analytics/traffic', { selection, start: params.start, end: params.end }).then((r) => r.data);

export const fetchGroupCallsLeads = (selection, params = {}) =>
  client.post('/analytics/calls-leads', { selection, start: params.start, end: params.end }).then((r) => r.data);

export const fetchGroupCallHeatmap = (selection, params = {}) =>
  client.post('/analytics/calls-leads/heatmap', { selection, start: params.start, end: params.end, tz: params.tz }).then((r) => r.data);

export const fetchAnalyticsTestOverview = (params = {}) => client.get('/analytics/test/overview', { params }).then((res) => res.data);

// Facebook campaigns with creatives
export const fetchMetaCampaignsTest = (params = {}) => client.get('/analytics/test/meta-campaigns', { params }).then((res) => res.data);

export const fetchMetaCampaigns = (userId, params = {}) =>
  client.get(`/analytics/${userId}/meta-campaigns`, { params }).then((res) => res.data);

// Meta drill-down
export const fetchMetaAdSets = (userId, campaignId, params = {}) =>
  client.get(`/analytics/${userId}/meta/adsets/${campaignId}`, { params }).then((res) => res.data);
export const fetchMetaAdsForAdSet = (userId, adSetId, params = {}) =>
  client.get(`/analytics/${userId}/meta/ads/${adSetId}`, { params }).then((res) => res.data);
export const fetchMetaAdVideoSource = (userId, adId) =>
  client.get(`/analytics/${userId}/meta/ad-video/${adId}`).then((res) => res.data);

// Google Ads drill-down
export const fetchGoogleAdsCampaigns = (userId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/campaigns`, { params }).then((res) => res.data);
export const fetchGoogleAdsAdGroups = (userId, campaignId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/ad-groups/${campaignId}`, { params }).then((res) => res.data);
export const fetchGoogleAdsAds = (userId, adGroupId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/ads/${adGroupId}`, { params }).then((res) => res.data);
export const fetchGoogleAdsKeywords = (userId, adGroupId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/keywords/${adGroupId}`, { params }).then((res) => res.data);
export const fetchGoogleAdsSearchTerms = (userId, params = {}) =>
  client.get(`/analytics/${userId}/google-ads/search-terms`, { params }).then((res) => res.data);

// Insights (rule-based alerts + optional AI narrative)
export const fetchInsights = (userId, params = {}) => client.get(`/analytics/${userId}/insights`, { params }).then((r) => r.data);

// Platform connection status
export const fetchAnalyticsConnections = (userId) => client.get(`/analytics/${userId}/connections`).then((res) => res.data);

// Traffic & Attribution
export const fetchTrafficSources = (userId, params = {}) =>
  client.get(`/analytics/${userId}/traffic/sources`, { params }).then((r) => r.data);
export const fetchLandingPages = (userId, params = {}) =>
  client.get(`/analytics/${userId}/traffic/landing-pages`, { params }).then((r) => r.data);
export const fetchDeviceBreakdown = (userId, params = {}) =>
  client.get(`/analytics/${userId}/traffic/devices`, { params }).then((r) => r.data);
export const fetchTrafficSummary = (userId, params = {}) =>
  client.get(`/analytics/${userId}/traffic/summary`, { params }).then((r) => r.data);

// Funnel
export const fetchFunnelData = (userId, params = {}) => client.get(`/analytics/${userId}/funnel`, { params }).then((r) => r.data);

// Call heatmap
export const fetchCallHeatmap = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/heatmap`, { params }).then((r) => r.data);

// Calls & Leads
export const fetchCallsLeadsSummary = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/summary`, { params }).then((r) => r.data);
export const fetchCallsLeadsByRating = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/by-rating`, { params }).then((r) => r.data);
export const fetchCallsLeadsByCategory = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/by-category`, { params }).then((r) => r.data);
export const fetchCallsLeadsBySource = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/by-source`, { params }).then((r) => r.data);
export const fetchCallsLeadsVolume = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/volume`, { params }).then((r) => r.data);
export const fetchCallsLeadsDuration = (userId, params = {}) =>
  client.get(`/analytics/${userId}/calls-leads/duration`, { params }).then((r) => r.data);

// Admin audit schedules + runs
export const fetchAuditSchedules = (userId = null) =>
  client
    .get('/analytics/audits/schedules', {
      params: {
        ...(userId ? { userId } : {})
      }
    })
    .then((res) => res.data);
export const createAuditSchedule = (payload) => client.post('/analytics/audits/schedules', payload).then((res) => res.data);
export const createBulkAuditSchedules = (payload) => client.post('/analytics/audits/schedules/bulk', payload).then((res) => res.data);
export const updateAuditSchedule = (scheduleId, payload) =>
  client.patch(`/analytics/audits/schedules/${scheduleId}`, payload).then((res) => res.data);
export const deleteAuditSchedule = (scheduleId) => client.delete(`/analytics/audits/schedules/${scheduleId}`).then((res) => res.data);
export const runAuditScheduleNow = (scheduleId) => client.post(`/analytics/audits/schedules/${scheduleId}/run`).then((res) => res.data);
export const runAuditNow = (payload) => client.post('/analytics/audits/runs', payload).then((res) => res.data);
export const runBulkAudits = (payload) => client.post('/analytics/audits/runs/bulk', payload).then((res) => res.data);
export const chatAuditAssistant = (payload) => client.post('/analytics/audits/chat', payload).then((res) => res.data);
export const fetchAuditRuns = ({ userId = null, scheduleId = null, limit = 50 } = {}) =>
  client
    .get('/analytics/audits/runs', {
      params: {
        ...(userId ? { userId } : {}),
        ...(scheduleId ? { scheduleId } : {}),
        limit
      }
    })
    .then((res) => res.data);
export const fetchAuditRun = (runId) => client.get(`/analytics/audits/runs/${runId}`).then((res) => res.data);
