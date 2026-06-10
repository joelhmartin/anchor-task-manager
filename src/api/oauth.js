import client from './client';
import { BRAND_COLORS } from 'constants/brandColors';

// ============================================================================
// OAuth Providers (App-level, Admin-only)
// ============================================================================

export function fetchOAuthProviders() {
  return client.get('/hub/oauth-providers').then((res) => res.data.providers || []);
}

export function fetchOAuthProvider(id) {
  return client.get(`/hub/oauth-providers/${id}`).then((res) => res.data.provider);
}

export function createOAuthProvider(payload) {
  return client.post('/hub/oauth-providers', payload).then((res) => res.data.provider);
}

export function updateOAuthProvider(id, payload) {
  return client.put(`/hub/oauth-providers/${id}`, payload).then((res) => res.data.provider);
}

export function deleteOAuthProvider(id) {
  return client.delete(`/hub/oauth-providers/${id}`).then((res) => res.data);
}

// ============================================================================
// OAuth Connections (Per-client)
// ============================================================================

export function fetchOAuthConnections(clientId) {
  return client.get(`/hub/clients/${clientId}/oauth-connections`).then((res) => res.data.connections || []);
}

export function createOAuthConnection(clientId, payload) {
  return client.post(`/hub/clients/${clientId}/oauth-connections`, payload).then((res) => res.data.connection);
}

export function updateOAuthConnection(connectionId, payload) {
  return client.put(`/hub/oauth-connections/${connectionId}`, payload).then((res) => res.data.connection);
}

export function revokeOAuthConnection(connectionId) {
  return client.post(`/hub/oauth-connections/${connectionId}/revoke`).then((res) => res.data.connection);
}

export function deleteOAuthConnection(connectionId) {
  return client.delete(`/hub/oauth-connections/${connectionId}`).then((res) => res.data);
}

// ============================================================================
// OAuth Connect Flow - Google
// ============================================================================

/**
 * Initiate Google OAuth for a client
 * Returns { authUrl } - frontend should redirect to this URL
 */
export function initiateGoogleOAuth(clientId) {
  return client.post('/hub/oauth/google/connect', { clientId }).then((res) => res.data);
}

/**
 * Fetch Google Business accounts for an OAuth connection
 */
export function fetchGoogleBusinessAccounts(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/google-accounts`).then((res) => res.data.accounts || []);
}

/**
 * Fetch Google Business locations for a specific account
 */
export function fetchGoogleBusinessLocations(connectionId, accountName) {
  return client
    .get(`/hub/oauth-connections/${connectionId}/google-locations`, { params: { accountName } })
    .then((res) => res.data.locations || []);
}

// ============================================================================
// OAuth Connect Flow - Facebook/Instagram
// ============================================================================

/**
 * Initiate Facebook OAuth for a client
 * This covers both Facebook Pages and Instagram (via Facebook Graph API)
 * Returns { authUrl } - frontend should redirect to this URL
 */
export function initiateFacebookOAuth(clientId) {
  return client.post('/hub/oauth/facebook/connect', { clientId }).then((res) => res.data);
}

/**
 * Fetch Facebook Pages for an OAuth connection
 */
export function fetchFacebookPages(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/facebook-pages`).then((res) => res.data.pages || []);
}

/**
 * Fetch Instagram Business accounts linked to Facebook Pages
 */
export function fetchInstagramAccounts(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/instagram-accounts`).then((res) => res.data.accounts || []);
}

// ============================================================================
// Meta Insights — Display-ready data for CRM UI
// ============================================================================

/**
 * Fetch Meta insights for a Facebook connection (pages, engagement, lead forms, IG accounts).
 */
export function fetchMetaInsights(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/meta-insights`).then((res) => res.data.insights);
}

// ============================================================================
// Meta App Review — Permission Testing
// ============================================================================

/**
 * Test all Facebook/Instagram permissions for Meta App Review.
 * Superadmin only. Optionally pass a specific connectionId.
 */
export function testMetaPermissions({ connectionId, accessToken, pageId } = {}) {
  const body = {};
  if (connectionId) body.connectionId = connectionId;
  if (accessToken) body.accessToken = accessToken;
  if (pageId) body.pageId = pageId;
  return client.post('/hub/meta/test-permissions', body).then((res) => res.data);
}

// ============================================================================
// OAuth Connect Flow - TikTok
// ============================================================================

/**
 * Initiate TikTok OAuth for a client
 * Returns { authUrl } - frontend should redirect to this URL
 */
export function initiateTikTokOAuth(clientId) {
  return client.post('/hub/oauth/tiktok/connect', { clientId }).then((res) => res.data);
}

/**
 * Fetch TikTok account info for an OAuth connection
 */
export function fetchTikTokAccount(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/tiktok-account`).then((res) => res.data.account || null);
}

// ============================================================================
// OAuth Connect Flow - WordPress
// ============================================================================

/**
 * Initiate WordPress OAuth for a client (WordPress.com hosted sites)
 * Returns { authUrl } - frontend should redirect to this URL
 */
export function initiateWordPressOAuth(clientId) {
  return client.post('/hub/oauth/wordpress/connect', { clientId }).then((res) => res.data);
}

/**
 * Connect WordPress using Application Passwords (self-hosted WordPress sites)
 * @param {string} clientId - The client ID
 * @param {string} siteUrl - The WordPress site URL (e.g., https://example.com)
 * @param {string} username - The WordPress username
 * @param {string} applicationPassword - The application password from WordPress
 * @returns {Promise} - Resolves to { connection, message }
 */
export function connectWordPress(clientId, siteUrl, username, applicationPassword) {
  return client.post('/hub/wordpress/connect', { 
    clientId, 
    siteUrl, 
    username, 
    applicationPassword 
  }).then((res) => res.data);
}

/**
 * Test an existing WordPress connection
 */
export function testWordPressConnection(connectionId) {
  return client.post('/hub/wordpress/test', { connectionId }).then((res) => res.data);
}

/**
 * Fetch WordPress sites for an OAuth connection
 */
export function fetchWordPressSites(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/wordpress-sites`).then((res) => res.data.sites || []);
}

// ============================================================================
// Generic OAuth Connect Helper
// ============================================================================

/**
 * Initiate OAuth for any supported provider
 * Returns a promise that resolves to { authUrl }
 * Frontend should redirect to the returned authUrl
 */
export function initiateOAuth(provider, clientId) {
  switch (provider) {
    case 'google':
      return initiateGoogleOAuth(clientId);
    case 'facebook':
    case 'instagram':
      return initiateFacebookOAuth(clientId);
    case 'tiktok':
      return initiateTikTokOAuth(clientId);
    case 'wordpress':
      return initiateWordPressOAuth(clientId);
    default:
      return Promise.reject(new Error(`Unsupported OAuth provider: ${provider}`));
  }
}

// ============================================================================
// OAuth Resources (Pages/Locations under a connection)
// ============================================================================

export function fetchOAuthResources(connectionId) {
  return client.get(`/hub/oauth-connections/${connectionId}/resources`).then((res) => res.data.resources || []);
}

export function fetchClientOAuthResources(clientId) {
  return client.get(`/hub/clients/${clientId}/oauth-resources`).then((res) => res.data.resources || []);
}

export function createOAuthResource(connectionId, payload) {
  return client.post(`/hub/oauth-connections/${connectionId}/resources`, payload).then((res) => res.data.resource);
}

export function updateOAuthResource(resourceId, payload) {
  return client.put(`/hub/oauth-resources/${resourceId}`, payload).then((res) => res.data.resource);
}

export function deleteOAuthResource(resourceId) {
  return client.delete(`/hub/oauth-resources/${resourceId}`).then((res) => res.data);
}

// ============================================================================
// Helper Constants
// ============================================================================

export const OAUTH_PROVIDERS = {
  google: { label: 'Google', color: BRAND_COLORS.google },
  facebook: { label: 'Facebook', color: BRAND_COLORS.facebook },
  instagram: { label: 'Instagram', color: BRAND_COLORS.instagram },
  tiktok: { label: 'TikTok', color: BRAND_COLORS.tiktok },
  wordpress: { label: 'WordPress', color: BRAND_COLORS.wordpress }
};

export const RESOURCE_TYPES = {
  google_location: { label: 'Google Business Location', provider: 'google' },
  facebook_page: { label: 'Facebook Page', provider: 'facebook' },
  instagram_account: { label: 'Instagram Account', provider: 'instagram' },
  tiktok_account: { label: 'TikTok Account', provider: 'tiktok' },
  wordpress_site: { label: 'WordPress Site', provider: 'wordpress' }
};

export function getResourceTypesForProvider(provider) {
  return Object.entries(RESOURCE_TYPES)
    .filter(([, config]) => config.provider === provider)
    .map(([value, config]) => ({ value, label: config.label }));
}

