import { query } from '../db.js';
import { decrypt } from './security/encryption.js';
import crypto from 'crypto';
import { GoogleAdsApi } from 'google-ads-api';
import { isDemoMode } from './demoMode.js';

// -- Policy Constants --

const MEDICAL_ALLOWED_FIELDS = new Set([
  'event_name', 'event_time', 'event_source_url',
  'action_source', 'value', 'currency', 'event_id',
  '_gads_override_action_id',
  'gclid', 'gbraid', 'wbraid',
]);

const NON_MEDICAL_BLOCKED_FIELDS = new Set([
  'ssn', 'date_of_birth', 'dob', 'password',
]);

const GA4_EVENT_MAP = {
  lead_submitted: 'generate_lead',
  qualified_call: 'qualified_call',
  new_client: 'new_client',
  appointment_request: 'appointment_request',
};

const META_EVENT_MAP = {
  lead_submitted: 'Lead',
  qualified_call: 'Lead',
  new_client: 'Purchase',
  appointment_request: 'Schedule',
};

const GOOGLE_ADS_EVENT_ALIASES = {
  lead_submitted: ['lead_submitted', 'form_submitted'],
  form_submitted: ['form_submitted', 'lead_submitted'],
};

/**
 * Main entry point. Call this from form submission, call processing, or journey flows.
 *
 * @param {string} userId - The client's user_id (owner of the tracking config)
 * @param {string} eventName - Internal event name (lead_submitted, qualified_call, etc.)
 * @param {string} sourceType - 'form_submission', 'call_log', or 'journey'
 * @param {string} sourceId - UUID of the source record
 * @param {Object} eventData - Raw event data (will be scrubbed based on policy)
 */
export async function sendEvent(userId, eventName, sourceType, sourceId, eventData = {}) {
  if (isDemoMode()) {
    console.warn(`[demo] Tracking relay suppressed (DEMO_MODE) for event "${eventName}".`);
    return { suppressed: true, reason: 'demo_mode' };
  }
  const { rows } = await query(
    `SELECT * FROM tracking_configs WHERE user_id = $1`,
    [userId]
  );
  if (rows.length === 0) {
    console.warn(`[tracking:relay] No tracking_configs for user ${userId} — skipping ${eventName} (source: ${sourceType}/${sourceId})`);
    return;
  }
  const config = rows[0];

  if (!config.relay_enabled) {
    if (config.relay_enabled === null || config.relay_enabled === undefined) {
      console.warn(`[tracking:relay] relay_enabled is not configured for user ${userId} (config ${config.id}) — skipping ${eventName}. Set relay_enabled=true to activate.`);
    }
    return;
  }

  const allowedEvents = config.allowed_events || [];
  if (!allowedEvents.includes(eventName)) {
    console.warn(`[tracking:relay] Event '${eventName}' not in allowed_events for config ${config.id} — skipping`);
    return;
  }

  // HIPAA gate: only relay when client_type is a known value. Anything else
  // (null, or an unexpected/corrupt value) is blocked — the scrub policy below
  // treats every non-'medical' value as non-medical, so an unrecognized value
  // could leak PHI to Meta CAPI. Allowlist the valid values and block the rest.
  const VALID_CLIENT_TYPES = new Set(['medical', 'non_medical']);
  if (!VALID_CLIENT_TYPES.has(config.client_type)) {
    const reason = !config.client_type ? 'client_type_missing' : 'client_type_invalid';
    console.error(`[tracking:relay] BLOCKED: client_type is ${config.client_type ? `'${config.client_type}' (unrecognized)` : 'null/undefined'} for config ${config.id} (user ${userId}). Refusing to relay — set client_type to 'medical' or 'non_medical' in tracking_configs.`);
    await logTrackingAttempt({
      configId: config.id,
      eventName,
      destination: 'all',
      sourceType,
      sourceId,
      payload: { reason, client_type: config.client_type || null },
      responseStatus: null,
      responseBody: 'Blocked: client_type missing or unrecognized — cannot determine HIPAA scrubbing policy',
      success: false,
      retryCount: 0
    });
    return;
  }

  const scrubbedData = config.client_type === 'medical'
    ? scrubMedical(eventData, config)
    : scrubNonMedical(eventData, config);

  const destinations = [];

  if (config.ga4_measurement_id && config.ga4_api_secret) {
    destinations.push(
      sendToGA4(config, eventName, scrubbedData, sourceType, sourceId)
    );
  }

  if (config.meta_pixel_id && (config.meta_capi_token || process.env.FACEBOOK_SYSTEM_USER_TOKEN)) {
    if (config.client_type === 'medical') {
      // HIPAA: Meta does NOT sign BAAs. Log the block decision for compliance auditing.
      // Push into destinations so Promise.allSettled ensures it's reliably persisted.
      destinations.push(
        logTrackingAttempt({
          configId: config.id,
          eventName,
          destination: 'meta_capi',
          sourceType,
          sourceId,
          payload: { reason: 'medical_client_hipaa_block' },
          responseStatus: null,
          responseBody: 'Blocked: Meta CAPI relay disabled for medical clients (HIPAA — no BAA)',
          success: false,
          retryCount: 0
        })
      );
    } else {
      destinations.push(
        sendToMetaCAPI(config, eventName, scrubbedData, sourceType, sourceId)
      );
    }
  }

  // Send to Google Ads (offline conversion)
  if (config.google_ads_customer_id) {
    destinations.push(
      sendToGoogleAds(config, eventName, scrubbedData, sourceType, sourceId)
    );
  }

  await Promise.allSettled(destinations);
}

/**
 * Medical scrubbing: ALLOWLIST only.
 * Only fields explicitly listed pass through. Everything else is dropped.
 */
function scrubMedical(eventData) {
  const scrubbed = {};
  for (const key of MEDICAL_ALLOWED_FIELDS) {
    if (eventData[key] !== undefined) {
      scrubbed[key] = eventData[key];
    }
  }
  if (scrubbed.event_source_url) {
    try {
      const url = new URL(scrubbed.event_source_url);
      scrubbed.event_source_url = url.origin;
    } catch {
      delete scrubbed.event_source_url;
    }
  }
  return scrubbed;
}

/**
 * Non-medical scrubbing: BLOCKLIST.
 * More permissive — allows hashed PII for Enhanced Conversions.
 */
function scrubNonMedical(eventData, config) {
  const scrubbed = { ...eventData };
  const customBlocked = config.blocked_fields || [];
  const allBlocked = new Set([...NON_MEDICAL_BLOCKED_FIELDS, ...customBlocked]);
  for (const field of allBlocked) {
    delete scrubbed[field];
  }
  if (scrubbed.email) {
    scrubbed.hashed_email = sha256(scrubbed.email.toLowerCase().trim());
    delete scrubbed.email;
  }
  if (scrubbed.phone) {
    scrubbed.hashed_phone = sha256(scrubbed.phone.replace(/\D/g, ''));
    delete scrubbed.phone;
  }
  if (scrubbed.first_name) {
    scrubbed.hashed_first_name = sha256(scrubbed.first_name.toLowerCase().trim());
    delete scrubbed.first_name;
  }
  if (scrubbed.last_name) {
    scrubbed.hashed_last_name = sha256(scrubbed.last_name.toLowerCase().trim());
    delete scrubbed.last_name;
  }
  return scrubbed;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function logTrackingAttempt({
  configId,
  eventName,
  destination,
  sourceType,
  sourceId,
  payload,
  responseStatus,
  responseBody,
  success,
  retryCount
}) {
  await query(
    `INSERT INTO tracking_event_log
      (tracking_config_id, event_name, destination, source_type, source_id,
       payload_sent, response_status, response_body, success, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      configId,
      eventName,
      destination,
      sourceType,
      sourceId,
      JSON.stringify(payload),
      responseStatus,
      responseBody,
      success,
      retryCount
    ]
  );
}

/**
 * Send event to GA4 Measurement Protocol.
 */
async function sendToGA4(config, eventName, scrubbedData, sourceType, sourceId) {
  const apiSecret = decrypt(config.ga4_api_secret);
  if (!apiSecret) {
    console.error(`[tracking:relay] GA4 API secret decryption failed for config ${config.id} (user ${config.user_id})`);
    await logTrackingAttempt({
      configId: config.id,
      eventName,
      destination: 'ga4',
      sourceType,
      sourceId,
      payload: { reason: 'api_secret_decryption_failed' },
      responseStatus: null,
      responseBody: 'GA4 API secret could not be decrypted — event dropped',
      success: false,
      retryCount: 0
    });
    return;
  }

  const ga4EventName = GA4_EVENT_MAP[eventName] || eventName;
  const payload = {
    client_id: `anchor_${config.user_id}`,
    events: [{
      name: ga4EventName,
      params: {
        value: scrubbedData.value || 1,
        currency: scrubbedData.currency || 'USD',
        event_source: 'anchor_dashboard',
      },
    }],
  };

  if (config.client_type === 'non_medical') {
    const userData = {};
    if (scrubbedData.hashed_email) userData.sha256_email_address = scrubbedData.hashed_email;
    if (scrubbedData.hashed_phone) userData.sha256_phone_number = scrubbedData.hashed_phone;
    if (Object.keys(userData).length > 0) {
      payload.user_data = userData;
    }
  }

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${config.ga4_measurement_id}&api_secret=${apiSecret}`;

  await sendWithRetry(
    url, payload, 'ga4', config.id, eventName, sourceType, sourceId
  );
}

/**
 * Send event to Meta Conversions API (CAPI).
 */
async function sendToMetaCAPI(config, eventName, scrubbedData, sourceType, sourceId) {
  const accessToken = process.env.FACEBOOK_SYSTEM_USER_TOKEN || decrypt(config.meta_capi_token);
  if (!accessToken) {
    console.error(`[tracking:relay] Meta CAPI access token missing for config ${config.id} (user ${config.user_id})`);
    await logTrackingAttempt({
      configId: config.id,
      eventName,
      destination: 'meta_capi',
      sourceType,
      sourceId,
      payload: { reason: 'access_token_missing' },
      responseStatus: null,
      responseBody: 'Meta CAPI access token unavailable — event dropped',
      success: false,
      retryCount: 0
    });
    return;
  }

  const metaEventName = META_EVENT_MAP[eventName] || eventName;
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = `anchor_${sourceType}_${sourceId}`;

  const eventPayload = {
    event_name: metaEventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: scrubbedData.event_source_url || config.website_domain,
    user_data: {},
    custom_data: {
      value: scrubbedData.value || 1,
      currency: scrubbedData.currency || 'USD',
    },
  };

  if (config.client_type === 'non_medical') {
    if (scrubbedData.hashed_email) eventPayload.user_data.em = [scrubbedData.hashed_email];
    if (scrubbedData.hashed_phone) eventPayload.user_data.ph = [scrubbedData.hashed_phone];
    if (scrubbedData.hashed_first_name) eventPayload.user_data.fn = [scrubbedData.hashed_first_name];
    if (scrubbedData.hashed_last_name) eventPayload.user_data.ln = [scrubbedData.hashed_last_name];
  }

  const body = { data: [eventPayload] };
  if (config.meta_test_event_code) {
    body.test_event_code = config.meta_test_event_code;
  }

  const url = `https://graph.facebook.com/v18.0/${config.meta_pixel_id}/events`;

  await sendWithRetry(
    url, body, 'meta_capi', config.id, eventName, sourceType, sourceId,
    { Authorization: `Bearer ${accessToken}` }
  );
}

/**
 * Send offline conversion to Google Ads via the Google Ads API.
 */
async function sendToGoogleAds(config, eventName, scrubbed, sourceType, sourceId) {
  if (!config.google_ads_customer_id) return;

  // Per-form override takes precedence over account-level mapping
  const overrideActionId = scrubbed._gads_override_action_id;
  const mappingKeys = GOOGLE_ADS_EVENT_ALIASES[eventName] || [eventName];
  const mapping = overrideActionId
    ? { conversion_action_id: overrideActionId }
    : mappingKeys
      .map((key) => config.conversion_mappings?.[key])
      .find((candidate) => candidate?.conversion_action_id);
  if (!mapping?.conversion_action_id) return;

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const managerId = process.env.GOOGLE_ADS_MANAGER_ID || '6996750299';
  if (!devToken || !refreshToken) return;

  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID || null,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || null,
    developer_token: devToken,
  });

  const customer = client.Customer({
    customer_id: config.google_ads_customer_id.replace(/-/g, ''),
    refresh_token: refreshToken,
    login_customer_id: managerId,
  });

  const conversionAction = `customers/${config.google_ads_customer_id.replace(/-/g, '')}/conversionActions/${mapping.conversion_action_id}`;
  const conversionDateTime = new Date().toISOString().replace('T', ' ').replace('Z', '+00:00');
  const conversion = {
    conversion_action: conversionAction,
    conversion_date_time: conversionDateTime,
    conversion_value: scrubbed.value || 1,
    currency_code: scrubbed.currency || 'USD',
  };

  if (!scrubbed.gclid && !scrubbed.gbraid && !scrubbed.wbraid) {
    await logTrackingAttempt({
      configId: config.id,
      eventName,
      destination: 'google_ads',
      sourceType,
      sourceId,
      payload: { conversion_action: conversionAction, reason: 'missing_click_identifier' },
      responseStatus: null,
      responseBody: 'Missing gclid, gbraid, or wbraid for Google Ads offline conversion upload',
      success: false,
      retryCount: 0
    });
    return;
  }

  if (scrubbed.gclid) conversion.gclid = scrubbed.gclid;
  else if (scrubbed.gbraid) conversion.gbraid = scrubbed.gbraid;
  else if (scrubbed.wbraid) conversion.wbraid = scrubbed.wbraid;

  const payload = {
    customer_id: config.google_ads_customer_id.replace(/-/g, ''),
    conversions: [conversion],
    partial_failure: true
  };

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await customer.conversionUploads.uploadClickConversions(payload);
      const responseBody = JSON.stringify(response ?? {});
      const partialFailure = response?.partial_failure_error || response?.partialFailureError || null;
      const success = !partialFailure;

      await logTrackingAttempt({
        configId: config.id,
        eventName,
        destination: 'google_ads',
        sourceType,
        sourceId,
        payload,
        responseStatus: success ? 200 : 400,
        responseBody,
        success,
        retryCount: attempt
      });

      if (success) return;
      return;
    } catch (err) {
      await logTrackingAttempt({
        configId: config.id,
        eventName,
        destination: 'google_ads',
        sourceType,
        sourceId,
        payload,
        responseStatus: null,
        responseBody: err.message,
        success: false,
        retryCount: attempt
      });

      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        continue;
      }
    }
  }

  console.error(`[tracking:relay] Failed after ${maxRetries} attempts to google_ads for ${eventName}`);
}

/**
 * Send HTTP request with retry logic (up to 3 attempts).
 * Logs each attempt to tracking_event_log.
 */
async function sendWithRetry(url, payload, destination, configId, eventName, sourceType, sourceId, extraHeaders = {}) {
  const maxRetries = 3;
  const timeoutMs = 10000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...extraHeaders },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseBody = await response.text();
      const success = response.ok;

      await logTrackingAttempt({
        configId,
        eventName,
        destination,
        sourceType,
        sourceId,
        payload,
        responseStatus: response.status,
        responseBody,
        success,
        retryCount: attempt
      });

      if (success) return;

      // Don't retry 4xx errors
      if (response.status >= 400 && response.status < 500) return;
    } catch (err) {
      await logTrackingAttempt({
        configId,
        eventName,
        destination,
        sourceType,
        sourceId,
        payload,
        responseStatus: null,
        responseBody: err.message,
        success: false,
        retryCount: attempt
      });
    }

    // Exponential backoff before retry
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }

  console.error(`[tracking:relay] Failed after ${maxRetries} attempts to ${destination} for ${eventName}`);
}
