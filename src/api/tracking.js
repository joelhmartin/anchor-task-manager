import client from './client';

// -- Config CRUD --

export function getTrackingConfig(userId) {
  return client.get(`/hub/tracking/${userId}`).then((res) => res.data);
}

export function createTrackingConfig(data) {
  return client.post('/hub/tracking', data).then((res) => res.data);
}

export function updateTrackingConfig(id, data) {
  return client.put(`/hub/tracking/${id}`, data).then((res) => res.data);
}

// -- Provisioning --

export function runProvisioning(configId) {
  return client.post(`/hub/tracking/${configId}/provision`).then((res) => res.data);
}

export function publishGtm(configId) {
  return client.post(`/hub/tracking/${configId}/publish`).then((res) => res.data);
}

export function getProvisioningJobs(configId) {
  return client.get(`/hub/tracking/${configId}/jobs`).then((res) => res.data);
}

// -- Event Relay --

export function getEventLog(configId, { limit = 50, offset = 0 } = {}) {
  return client.get(`/hub/tracking/${configId}/events`, { params: { limit, offset } }).then((res) => res.data);
}

export function toggleRelay(configId, enabled) {
  return client.post(`/hub/tracking/${configId}/relay-toggle`, { enabled }).then((res) => res.data);
}

// -- Templates --

export function getTemplates() {
  return client.get('/hub/tracking/templates/list').then((res) => res.data);
}

// -- Account Listing (for wizard dropdowns) --

export function getGA4Accounts() {
  return client.get('/hub/tracking/accounts/ga4').then((res) => res.data.properties || []);
}

export function getGoogleAdsAccounts() {
  return client.get('/hub/tracking/accounts/google-ads').then((res) => res.data.accounts || []);
}

export function getMetaAdAccounts() {
  return client.get('/hub/tracking/accounts/meta').then((res) => res.data.accounts || []);
}

export function getMetaPixels(adAccountId) {
  return client.get(`/hub/tracking/accounts/meta/${adAccountId}/pixels`).then((res) => res.data.pixels || []);
}

export function getCtmAccounts() {
  return client.get('/hub/tracking/accounts/ctm').then((res) => res.data.accounts || []);
}

export function getGtmContainers() {
  return client.get('/hub/tracking/accounts/gtm').then((res) => res.data.containers || []);
}

export function createGtmContainer(name) {
  return client.post('/hub/tracking/accounts/gtm', { name }).then((res) => res.data.container);
}

export function getConversionActions(customerId) {
  return client.get(`/hub/tracking/accounts/google-ads/${customerId}/conversions`).then((res) => res.data.actions || []);
}

export function createMPSecret(propertyId) {
  return client.post(`/hub/tracking/accounts/ga4/${propertyId}/mp-secret`).then((res) => res.data);
}

export function saveConversionMappings(configId, mappings) {
  return client.put(`/hub/tracking/${configId}/conversion-mappings`, { mappings }).then((res) => res.data);
}

export function getFormAnalyticsContext(userId) {
  return client.get(`/hub/tracking/form-analytics-context/${userId}`).then((res) => res.data);
}

export function deleteGtmContainer(containerId) {
  return client.delete(`/hub/tracking/accounts/gtm/${containerId}`).then((res) => res.data);
}

// -- Meta campaign allowlist --

export function listMetaCampaigns(userId, { status = 'active,paused' } = {}) {
  return client
    .get(`/hub/tracking/${userId}/meta-campaigns`, { params: { status } })
    .then((res) => res.data);
}

export function claimMetaCampaign(userId, { campaignId, campaignName }) {
  return client
    .post(`/hub/tracking/${userId}/meta-campaigns/claims`, {
      campaign_id: campaignId,
      campaign_name: campaignName
    })
    .then((res) => res.data);
}

export function unclaimMetaCampaign(userId, campaignId) {
  return client
    .delete(`/hub/tracking/${userId}/meta-campaigns/claims/${campaignId}`)
    .then((res) => res.data);
}
