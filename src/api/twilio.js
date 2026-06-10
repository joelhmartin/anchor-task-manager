/**
 * Twilio API Client
 *
 * Functions for managing Twilio call tracking configuration,
 * tracking numbers, and related settings.
 *
 * Note: Twilio credentials are configured globally via environment variables
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN). This client manages per-client
 * tracking numbers and provider preferences.
 */

import client from './client';

// ==========================
// Configuration
// ==========================

/**
 * Get Twilio configuration status
 * Returns global config status (from env vars) and client's provider preference
 * @param {string} [clientId] - Optional client ID (admin viewing another client)
 * @returns {Promise<Object>} Configuration status { configured, accountSidLast4, provider, numberCount }
 */
export function getTwilioConfig(clientId) {
  const params = clientId ? { clientId } : {};
  return client.get('/hub/twilio/config', { params }).then((res) => res.data);
}

/**
 * Switch call tracking provider for a client
 * @param {string} clientId - Client user ID
 * @param {string} provider - 'ctm' or 'twilio'
 * @returns {Promise<Object>}
 */
export function switchCallProvider(clientId, provider) {
  return client.post('/hub/twilio/switch-provider', { clientId, provider }).then((res) => res.data);
}

// ==========================
// Tracking Numbers
// ==========================

/**
 * List tracking numbers for a client
 * @param {string} [clientId] - Optional client ID
 * @param {Object} [options] - { includeInactive: boolean }
 * @returns {Promise<Array>}
 */
export function listTrackingNumbers(clientId, options = {}) {
  const params = { ...options };
  if (clientId) params.clientId = clientId;
  return client.get('/hub/twilio/numbers', { params }).then((res) => res.data.numbers || []);
}

/**
 * Purchase a new tracking number
 * @param {string} clientId - Client user ID
 * @param {Object} options - { areaCode?, contains?, friendlyName, forwardTo, sourceType?, campaignName? }
 * @returns {Promise<Object>}
 */
export function purchaseTrackingNumber(clientId, options) {
  return client.post('/hub/twilio/numbers/purchase', { clientId, ...options }).then((res) => res.data);
}

/**
 * Update a tracking number's configuration
 * @param {string} numberId - Tracking number ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
export function updateTrackingNumber(numberId, updates) {
  return client.put(`/hub/twilio/numbers/${numberId}`, updates).then((res) => res.data);
}

/**
 * Release a tracking number back to Twilio
 * @param {string} numberId - Tracking number ID
 * @returns {Promise<Object>}
 */
export function releaseTrackingNumber(numberId) {
  return client.delete(`/hub/twilio/numbers/${numberId}`).then((res) => res.data);
}

// ==========================
// Webhook Configuration
// ==========================

/**
 * Reconfigure webhook URLs on all active tracking numbers.
 * Use after deployment or when APP_BASE_URL changes.
 * @returns {Promise<{ updated: number, failed: number, errors: Array }>}
 */
export function reconfigureWebhooks() {
  return client.post('/hub/twilio/reconfigure-webhooks').then((res) => res.data);
}

// ==========================
// Tracking Script
// ==========================

/**
 * Generate tracking script snippet for client website
 * @param {string} [clientId] - Optional client ID
 * @returns {Promise<string>}
 */
export function getTrackingScript(clientId) {
  const params = clientId ? { clientId } : {};
  return client.get('/hub/twilio/tracking-script', { params }).then((res) => res.data.script);
}
