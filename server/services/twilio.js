/**
 * Twilio Service for Call Tracking
 *
 * Provides Twilio integration for call tracking with full attribution support.
 * Uses a single agency Twilio account (credentials from env vars) with
 * per-client tracking number management.
 *
 * COMPLIANCE NOTES:
 * - Transcripts stored encrypted in call_logs.meta
 * - IP addresses are hashed before storage
 * - No PHI in logs (only IDs, not transcript content)
 */

import { query } from '../db.js';
import { isDemoMode } from './demoMode.js';
import { resolveContact } from './contacts.js';
import {
  classifyContent,
  enrichCallerType,
  CATEGORY_DEFINITIONS,
  normalizePhoneNumber
} from './ctm.js';
import { encrypt } from './security/encryption.js';
import { logAiClassificationEvent } from './aiClassificationLog.js';
import { callLogsHasContactId } from './callLogUpsert.js';
import crypto from 'crypto';

// Twilio SDK - lazy loaded to avoid errors if not installed
let twilio = null;
let twilioClient = null;

/**
 * Lazily load Twilio SDK
 */
async function getTwilioSDK() {
  if (!twilio) {
    try {
      const twilioModule = await import('twilio');
      twilio = twilioModule.default;
    } catch (err) {
      console.error('[twilio] Twilio SDK not installed. Run: yarn add twilio');
      throw new Error('Twilio SDK not installed');
    }
  }
  return twilio;
}

/**
 * Check if Twilio is configured (env vars present)
 * @returns {boolean}
 */
export function isTwilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/**
 * Get the shared Twilio client (singleton)
 * Uses agency-level credentials from environment variables
 * @returns {Promise<TwilioClient>}
 */
export async function getTwilioClient() {
  if (!isTwilioConfigured()) {
    console.error('[twilio] Not configured - TWILIO_ACCOUNT_SID:', !!process.env.TWILIO_ACCOUNT_SID, 'TWILIO_AUTH_TOKEN:', !!process.env.TWILIO_AUTH_TOKEN);
    throw new Error('Twilio not configured - set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
  }

  if (!twilioClient) {
    console.log('[twilio] Initializing client with account:', process.env.TWILIO_ACCOUNT_SID?.slice(0, 6) + '...' + process.env.TWILIO_ACCOUNT_SID?.slice(-4));
    const Twilio = await getTwilioSDK();
    twilioClient = new Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  return twilioClient;
}

/**
 * Get Twilio config status (for admin UI)
 * @returns {Object}
 */
export function getTwilioConfigStatus() {
  const configured = isTwilioConfigured();
  return {
    configured,
    accountSidLast4: configured ? process.env.TWILIO_ACCOUNT_SID.slice(-4) : null
  };
}

/**
 * Purchase a phone number from Twilio
 * @param {string} clientUserId - The client's user ID
 * @param {Object} options - { areaCode?, contains?, friendlyName, forwardTo, sourceType? }
 * @returns {Promise<Object>} - The purchased number record
 */
export async function purchasePhoneNumber(clientUserId, options) {
  if (isDemoMode()) { throw new Error('Twilio number purchase is disabled in the demo environment.'); }
  console.log('[twilio:purchase] Starting purchase for client:', clientUserId, 'options:', JSON.stringify(options));

  const {
    areaCode,
    contains,
    friendlyName,
    forwardTo,
    sourceType,
    recordingEnabled = true,
    transcriptionEnabled = true
  } = options;

  if (!forwardTo) {
    console.error('[twilio:purchase] Missing forwardTo');
    throw new Error('forwardTo number is required');
  }

  const client = await getTwilioClient();
  const baseUrl = process.env.APP_BASE_URL || process.env.API_BASE_URL || '';
  console.log('[twilio:purchase] Using base URL:', baseUrl || '(none - webhooks will be configured after deployment)');

  // Search for available numbers
  const searchParams = {
    voiceEnabled: true,
    limit: 20
  };

  if (areaCode) {
    searchParams.areaCode = areaCode;
  }
  if (contains) {
    searchParams.contains = contains;
  }

  console.log('[twilio:purchase] Searching with params:', JSON.stringify(searchParams));

  try {
    const available = await client.availablePhoneNumbers('US').local.list(searchParams);
    console.log('[twilio:purchase] Twilio returned', available.length, 'numbers');

    if (!available.length) {
      // If area code search failed, try toll-free as fallback info
      console.warn('[twilio:purchase] No local numbers found. Area code:', areaCode || 'none');
      throw new Error(`No available phone numbers found matching criteria (areaCode: ${areaCode || 'any'})`);
    }

    // Purchase the first available number
    const numberToPurchase = available[0].phoneNumber;
    console.log('[twilio:purchase] Purchasing number:', numberToPurchase);

    const purchaseParams = {
      phoneNumber: numberToPurchase,
      friendlyName: friendlyName || `Anchor Tracking - ${sourceType || 'General'}`
    };

    // Only set webhook URLs if base URL is publicly accessible (not localhost)
    const isPublicUrl = baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
    if (isPublicUrl) {
      Object.assign(purchaseParams, buildWebhookConfig(baseUrl));
      console.log('[twilio:purchase] Setting webhook URLs (public base URL)');
    } else {
      console.log('[twilio:purchase] Skipping webhook URLs (localhost) - run "Reconfigure Webhooks" after deployment');
    }

    const purchasedNumber = await client.incomingPhoneNumbers.create(purchaseParams);
    console.log('[twilio:purchase] Purchased successfully. SID:', purchasedNumber.sid, 'Number:', purchasedNumber.phoneNumber);

    // Save to database (no twilio_config_id needed anymore)
    const { rows } = await query(
      `INSERT INTO twilio_tracking_numbers
         (client_user_id, phone_number, phone_number_sid,
          friendly_name, forward_to_number, source_type,
          recording_enabled, transcription_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        clientUserId,
        purchasedNumber.phoneNumber,
        purchasedNumber.sid,
        friendlyName || purchasedNumber.friendlyName,
        normalizePhoneNumber(forwardTo),
        sourceType || null,
        recordingEnabled,
        transcriptionEnabled
      ]
    );
    console.log('[twilio:purchase] Saved to DB. ID:', rows[0]?.id);

    // Check if this is the client's first number → auto-generate tracking script
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS cnt FROM twilio_tracking_numbers
       WHERE client_user_id = $1 AND is_active = TRUE`,
      [clientUserId]
    );
    const isFirstNumber = parseInt(countRows[0]?.cnt, 10) === 1;

    const result = rows[0];
    if (isFirstNumber) {
      console.log('[twilio:purchase] First number for client — generating tracking script');
      result._trackingScript = await generateTrackingScript(clientUserId).catch(() => null);
    }

    return result;
  } catch (err) {
    console.error('[twilio:purchase] Error during purchase flow:', err.message);
    console.error('[twilio:purchase] Error details:', err.status || '', err.code || '', err.moreInfo || '');
    throw err;
  }
}

/**
 * Release a phone number back to Twilio
 * @param {string} trackingNumberId - The tracking number's database ID
 * @returns {Promise<boolean>}
 */
export async function releasePhoneNumber(trackingNumberId) {
  if (isDemoMode()) {
    console.warn('[demo] Twilio mutation suppressed (DEMO_MODE).');
    return { suppressed: true, reason: 'demo_mode' };
  }
  console.log('[twilio:release] Releasing number ID:', trackingNumberId);

  const { rows } = await query(
    `SELECT * FROM twilio_tracking_numbers WHERE id = $1`,
    [trackingNumberId]
  );

  if (!rows.length) {
    console.error('[twilio:release] Number not found:', trackingNumberId);
    throw new Error('Tracking number not found');
  }

  const trackingNumber = rows[0];
  console.log('[twilio:release] Found number:', trackingNumber.phone_number, 'SID:', trackingNumber.phone_number_sid);

  const client = await getTwilioClient();

  // Release from Twilio
  await client.incomingPhoneNumbers(trackingNumber.phone_number_sid).remove();
  console.log('[twilio:release] Released from Twilio');

  // Mark as inactive in database
  await query(
    `UPDATE twilio_tracking_numbers SET is_active = FALSE WHERE id = $1`,
    [trackingNumberId]
  );
  console.log('[twilio:release] Marked inactive in DB');

  return true;
}

/**
 * Update tracking number configuration
 * @param {string} trackingNumberId - The tracking number's database ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
export async function updateTrackingNumber(trackingNumberId, updates) {
  if (isDemoMode()) {
    throw new Error('Twilio number changes are disabled in the demo environment.');
  }
  console.log('[twilio:update] Updating number:', trackingNumberId, 'fields:', Object.keys(updates).join(', '));

  const allowedFields = [
    'friendly_name',
    'forward_to_number',
    'source_type',
    'recording_enabled',
    'transcription_enabled',
    'is_active'
  ];

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(snakeKey)) {
      setClauses.push(`${snakeKey} = $${paramIndex}`);
      values.push(snakeKey === 'forward_to_number' ? normalizePhoneNumber(value) : value);
      paramIndex++;
    }
  }

  if (!setClauses.length) {
    throw new Error('No valid fields to update');
  }

  values.push(trackingNumberId);
  const { rows } = await query(
    `UPDATE twilio_tracking_numbers
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return rows[0];
}

/**
 * List tracking numbers for a client
 * @param {string} clientUserId - The client's user ID
 * @param {Object} options - { includeInactive? }
 * @returns {Promise<Array>}
 */
export async function listTrackingNumbers(clientUserId, options = {}) {
  const { includeInactive = false } = options;

  let sql = `
    SELECT * FROM twilio_tracking_numbers
    WHERE client_user_id = $1
  `;

  if (!includeInactive) {
    sql += ' AND is_active = TRUE';
  }

  sql += ' ORDER BY created_at DESC';

  const { rows } = await query(sql, [clientUserId]);
  return rows;
}

/**
 * Build the standard webhook configuration for a Twilio number
 * @param {string} baseUrl - The application base URL
 * @returns {Object} - Twilio number update params
 */
function buildWebhookConfig(baseUrl) {
  return {
    voiceUrl: `${baseUrl}/api/twilio/voice`,
    voiceMethod: 'POST',
    statusCallback: `${baseUrl}/api/twilio/status`,
    statusCallbackMethod: 'POST',
    smsUrl: '',              // Disable SMS handling (call tracking only)
    voiceFallbackUrl: '',    // Clear fallback
  };
}

/**
 * Configure call tracking (update Twilio webhooks)
 * @param {string} trackingNumberId - The tracking number's database ID
 * @param {Object} config - { forwardTo, recordingEnabled, transcriptionEnabled }
 * @returns {Promise<Object>}
 */
export async function configureTracking(trackingNumberId, config) {
  if (isDemoMode()) {
    throw new Error('Twilio number changes are disabled in the demo environment.');
  }
  const { rows } = await query(
    `SELECT * FROM twilio_tracking_numbers WHERE id = $1`,
    [trackingNumberId]
  );

  if (!rows.length) {
    throw new Error('Tracking number not found');
  }

  const trackingNumber = rows[0];
  const client = await getTwilioClient();
  const baseUrl = process.env.APP_BASE_URL || process.env.API_BASE_URL;

  if (!baseUrl) {
    throw new Error('APP_BASE_URL not configured');
  }

  // Update Twilio configuration
  await client.incomingPhoneNumbers(trackingNumber.phone_number_sid).update(
    buildWebhookConfig(baseUrl)
  );

  // Update database
  return updateTrackingNumber(trackingNumberId, config);
}

/**
 * Reconfigure webhooks for ALL active tracking numbers.
 * Use after deployment or when APP_BASE_URL changes.
 * @returns {Promise<{ updated: number, failed: number, errors: Array }>}
 */
export async function reconfigureAllWebhooks() {
  if (isDemoMode()) { console.warn('[demo] reconfigureAllWebhooks skipped (DEMO_MODE).'); return { updated: 0, skipped: true }; }
  const baseUrl = process.env.APP_BASE_URL || process.env.API_BASE_URL;
  if (!baseUrl) {
    throw new Error('APP_BASE_URL not configured');
  }

  const isPublic = !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
  if (!isPublic) {
    throw new Error('Cannot configure webhooks with a localhost URL. Set APP_BASE_URL to your public domain.');
  }

  console.log('[twilio:reconfigure] Reconfiguring all numbers with base URL:', baseUrl);

  const { rows: numbers } = await query(
    `SELECT id, phone_number, phone_number_sid, friendly_name
     FROM twilio_tracking_numbers WHERE is_active = TRUE`
  );

  if (!numbers.length) {
    return { updated: 0, failed: 0, errors: [] };
  }

  const client = await getTwilioClient();
  const webhookConfig = buildWebhookConfig(baseUrl);
  let updated = 0;
  let failed = 0;
  const errors = [];

  for (const num of numbers) {
    try {
      await client.incomingPhoneNumbers(num.phone_number_sid).update(webhookConfig);
      updated++;
      console.log(`[twilio:reconfigure] ✓ ${num.phone_number} (${num.friendly_name || num.id})`);
    } catch (err) {
      failed++;
      errors.push({ id: num.id, phone: num.phone_number, error: err.message });
      console.error(`[twilio:reconfigure] ✗ ${num.phone_number}: ${err.message}`);
    }
  }

  console.log(`[twilio:reconfigure] Done. Updated: ${updated}, Failed: ${failed}`);
  return { updated, failed, errors };
}

/**
 * Generate TwiML response for incoming call
 * @param {string} trackingNumberId - The tracking number's database ID
 * @param {Object} callData - Call data from Twilio webhook
 * @returns {Promise<string>} - TwiML response
 */
export async function handleIncomingCall(trackingNumberId, callData) {
  const { rows } = await query(
    `SELECT * FROM twilio_tracking_numbers WHERE id = $1`,
    [trackingNumberId]
  );

  if (!rows.length) {
    // Return error TwiML
    return `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>We're sorry, this number is no longer in service.</Say>
        <Hangup/>
      </Response>`;
  }

  const trackingNumber = rows[0];
  const baseUrl = process.env.APP_BASE_URL || process.env.API_BASE_URL;

  // Build TwiML response
  let twiml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';

  // Start recording if enabled
  if (trackingNumber.recording_enabled) {
    twiml += `  <Record
    recordingStatusCallback="${baseUrl}/api/twilio/recording"
    recordingStatusCallbackMethod="POST"
    maxLength="3600"
    transcribe="${trackingNumber.transcription_enabled}"
    transcribeCallback="${baseUrl}/api/twilio/transcription"
  />\n`;
  }

  // Forward to destination number
  twiml += `  <Dial callerId="${trackingNumber.phone_number}" timeout="30">\n`;
  twiml += `    <Number statusCallbackEvent="initiated ringing answered completed"
      statusCallback="${baseUrl}/api/twilio/status"
      statusCallbackMethod="POST">${trackingNumber.forward_to_number}</Number>\n`;
  twiml += `  </Dial>\n`;
  twiml += '</Response>';

  return twiml;
}

/**
 * Process call status webhook from Twilio
 * @param {string} callSid - Twilio call SID
 * @param {Object} statusData - Status data from webhook
 * @returns {Promise<Object>}
 */
export async function handleCallStatus(callSid, statusData) {
  console.log('[twilio:status] Processing call status. SID:', callSid, 'Status:', statusData.CallStatus, 'From:', statusData.From, 'To:', statusData.To);

  const {
    CallStatus,
    CallDuration,
    From,
    To,
    Direction,
    RecordingUrl,
    RecordingSid
  } = statusData;

  // Find or create call log entry
  const { rows: existing } = await query(
    `SELECT * FROM call_logs WHERE provider_call_sid = $1`,
    [callSid]
  );

  if (existing.length) {
    // Update existing record
    const updates = {
      duration_sec: CallDuration ? parseInt(CallDuration, 10) : null
    };

    if (RecordingUrl) {
      updates.recording_url = RecordingUrl;
    }

    await query(
      `UPDATE call_logs
       SET duration_sec = COALESCE($1, duration_sec),
           recording_url = COALESCE($2, recording_url),
           meta = jsonb_set(
             COALESCE(meta, '{}'),
             '{call_status}',
             to_jsonb($3::text)
           )
       WHERE provider_call_sid = $4`,
      [updates.duration_sec, updates.recording_url || null, CallStatus, callSid]
    );

    console.log('[twilio:status] Updated existing call log for SID:', callSid);
    return { updated: true, callSid };
  }

  // Find tracking number
  const { rows: trackingNumbers } = await query(
    `SELECT * FROM twilio_tracking_numbers
     WHERE phone_number = $1 AND is_active = TRUE
     LIMIT 1`,
    [To]
  );

  if (!trackingNumbers.length) {
    console.warn(`[twilio:status] No tracking number found for: ${To}`);
    return { created: false, reason: 'no_tracking_number' };
  }

  const trackingNumber = trackingNumbers[0];
  const clientUserId = trackingNumber.client_user_id;

  // Contact Entity Phase 1: resolve contact first so we can pass contactId into
  // enrichCallerType for contact-aware repeat-caller detection.
  // Live inbound call → reactivate the contact if it was archived (genuinely returning lead).
  const contactId = await resolveContact({ ownerUserId: clientUserId, phone: From, reactivateArchived: true });

  // Enrich with caller type information
  const callerInfo = await enrichCallerType(query, clientUserId, From, null, contactId);

  // Look up the most recent attribution session for this tracking number
  const { rows: attrSessions } = await query(
    `SELECT utm_campaign, utm_source, utm_medium, gclid, fbclid
     FROM attribution_sessions
     WHERE tracking_number_id = $1 AND client_user_id = $2 AND call_log_id IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [trackingNumber.id, clientUserId]
  );
  const attribution = attrSessions[0] || {};
  console.log('[twilio:status] Attribution session found:', !!attrSessions.length, attribution.utm_campaign ? `campaign: ${attribution.utm_campaign}` : 'no campaign');

  // Create call log entry
  const callId = `twilio_${callSid}`;
  const startedAt = new Date().toISOString();

  // Gate contact_id column — may not exist pre-migration during the startup window
  // before ensureContactIdColumnsExist runs.
  const hasContactId = await callLogsHasContactId(query);
  const twilioMeta = JSON.stringify({
    source: trackingNumber.friendly_name || trackingNumber.source_type || 'Twilio',
    source_key: trackingNumber.source_type || 'twilio',
    campaign_name: attribution.utm_campaign || null,
    utm_source: attribution.utm_source || null,
    utm_medium: attribution.utm_medium || null,
    gclid: attribution.gclid || null,
    fbclid: attribution.fbclid || null,
    call_status: CallStatus,
    caller_type: callerInfo.callerType,
    previous_calls: callerInfo.previousCalls?.slice(0, 5) || []
  });
  // WITH contact_id: 18 cols, $1..$15 (15 params, $1 reused for user_id)
  // WITHOUT contact_id: 17 cols, $1..$14 (14 params)
  const twilioParams = [
    clientUserId,                                        // $1 → owner_user_id + user_id
    callId,                                              // $2 → call_id
    callSid,                                             // $3 → provider_call_sid
    Direction === 'inbound' ? 'inbound' : 'outbound',   // $4 → direction
    From,                                                // $5 → from_number
    To,                                                  // $6 → to_number
    startedAt,                                           // $7 → started_at
    CallDuration ? parseInt(CallDuration, 10) : 0,       // $8 → duration_sec
    trackingNumber.id,                                   // $9 → tracking_number_id
    callerInfo.callerType,                               // $10 → caller_type
    callerInfo.activeClientId,                           // $11 → active_client_id
    callerInfo.callSequence,                             // $12 → call_sequence
    RecordingUrl || null,                                // $13 → recording_url
    twilioMeta                                           // $14 → meta
  ];
  if (hasContactId) twilioParams.push(contactId);       // $15 → contact_id (conditional)
  const { rows: newCall } = await query(
    `INSERT INTO call_logs
       (owner_user_id, user_id, call_id, provider, provider_call_sid,
        direction, from_number, to_number, started_at, duration_sec,
        tracking_number_id, caller_type, active_client_id, call_sequence,
        activity_type, recording_url, meta${hasContactId ? ', contact_id' : ''})
     VALUES ($1, $1, $2, 'twilio', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'call', $13, $14${hasContactId ? ', $15' : ''})
     RETURNING *`,
    twilioParams
  );

  // Link the attribution session to this call
  if (attrSessions.length) {
    await query(
      `UPDATE attribution_sessions SET call_log_id = $1
       WHERE tracking_number_id = $2 AND client_user_id = $3 AND call_log_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [newCall[0]?.id, trackingNumber.id, clientUserId]
    ).catch(() => { /* best-effort link */ });
  }

  console.log('[twilio:status] Created call log:', newCall[0]?.id, 'for client:', clientUserId);
  return { created: true, callLog: newCall[0] };
}

/**
 * Handle recording ready webhook
 * @param {string} callSid - Twilio call SID
 * @param {string} recordingUrl - URL of the recording
 * @returns {Promise<Object>}
 */
export async function handleRecordingReady(callSid, recordingUrl) {
  console.log('[twilio:recording] Recording ready for SID:', callSid);
  const { rows } = await query(
    `UPDATE call_logs
     SET recording_url = $1,
         meta = jsonb_set(COALESCE(meta, '{}'), '{recording_ready_at}', to_jsonb(NOW()::text))
     WHERE provider_call_sid = $2
     RETURNING *`,
    [recordingUrl, callSid]
  );

  if (!rows.length) {
    console.warn(`[twilio:recording] No call log found for SID: ${callSid}`);
    return { updated: false };
  }

  return { updated: true, callLog: rows[0] };
}

/**
 * Handle transcription webhook (from Twilio or Twilio Intelligence)
 * @param {string} callSid - Twilio call SID
 * @param {Object} transcriptionData - Transcription data
 * @returns {Promise<Object>}
 */
export async function handleTranscription(callSid, transcriptionData) {
  console.log('[twilio:transcription] Transcription received for SID:', callSid, 'Status:', transcriptionData.TranscriptionStatus);
  const { TranscriptionText, TranscriptionStatus } = transcriptionData;

  if (TranscriptionStatus !== 'completed' || !TranscriptionText) {
    return { processed: false, reason: 'incomplete_transcription' };
  }

  // Get call log and client info
  const { rows: callLogs } = await query(
    `SELECT cl.*, cp.ai_prompt
     FROM call_logs cl
     LEFT JOIN client_profiles cp ON cl.owner_user_id = cp.user_id
     WHERE cl.provider_call_sid = $1`,
    [callSid]
  );

  if (!callLogs.length) {
    console.warn(`[twilio:transcription] No call log found for SID: ${callSid}`);
    return { processed: false, reason: 'call_not_found' };
  }

  const callLog = callLogs[0];
  const aiPrompt = callLog.ai_prompt;

  // Run AI classification
  const classification = await classifyTwilioCall(aiPrompt, TranscriptionText, null);

  // Update call log with transcript and classification
  // HIPAA: Encrypt transcript before storage (may contain PHI from calls)
  const meta = callLog.meta || {};
  const encryptedTranscript = encrypt(TranscriptionText);
  if (!encryptedTranscript) {
    console.error('[twilio:transcription] Failed to encrypt transcript - skipping storage');
    return { processed: false, reason: 'encryption_failed' };
  }
  meta.transcript_encrypted = encryptedTranscript;
  meta.classification = classification.classification;
  meta.classification_summary = classification.summary;
  meta.classification_reasoning = classification.reasoning || classification.summary;
  meta.category = classification.category;
  meta.transcription_processed_at = new Date().toISOString();

  await query(
    `UPDATE call_logs
     SET meta = $1
     WHERE id = $2`,
    [JSON.stringify(meta), callLog.id]
  );

  await logAiClassificationEvent({
    ownerUserId: callLog.owner_user_id || callLog.user_id,
    callId: callLog.call_id,
    stage: 'twilio_transcription',
    sourceType: 'call',
    activityType: 'call',
    provider: 'twilio',
    model: classification.debug?.model || process.env.VERTEX_CLASSIFIER_MODEL || process.env.VERTEX_MODEL || null,
    finalCategory: classification.category,
    classification: classification.classification,
    score: Number(callLog.score || 0),
    isReferral: false,
    requiresCallback: false,
    systemTags: [],
    adjustments: classification.debug?.adjustments || [],
    input: TranscriptionText,
    prompt: classification.debug?.prompt || aiPrompt || '',
    rawResponse: classification.debug?.rawResponse || '',
    summary: classification.summary,
    reasoning: classification.reasoning || classification.summary,
    metadata: {
      callLogId: callLog.id,
      providerCallSid: callSid,
      inputLength: classification.debug?.inputLength || TranscriptionText.length,
      parsedCategory: classification.debug?.parsedCategory || classification.classification,
      debugSource: classification.debug?.source || 'call'
    }
  });

  return {
    processed: true,
    classification: classification.category,
    summary: classification.summary
  };
}

/**
 * Classify a Twilio call transcript using AI
 * Reuses the classification logic from CTM service
 * @param {string} prompt - Custom AI prompt (optional)
 * @param {string} transcript - Call transcript
 * @param {string} message - Alternative message content
 * @returns {Promise<Object>}
 */
export async function classifyTwilioCall(prompt, transcript, message) {
  return classifyContent(prompt, transcript, message);
}

/**
 * Generate tracking script for client website
 * @param {string} clientUserId - The client's user ID
 * @returns {Promise<string>} - JavaScript tracking script
 */
export async function generateTrackingScript(clientUserId) {
  const baseUrl = process.env.APP_BASE_URL || process.env.API_BASE_URL || '';

  // Use placeholder if no public URL set yet
  const url = baseUrl || 'https://YOUR_DOMAIN';

  return `<!-- Anchor Universal Tracking Script -->
<!-- Captures: Google Ads (gclid), Facebook (fbclid), Bing (msclkid), TikTok (ttclid), LinkedIn, UTMs, organic referrers -->
<script src="${url}/tracking/anchor-tracking.js"
        data-client-id="${clientUserId}"
        data-api-base="${url}/api"
        async></script>`;
}

/**
 * Store attribution data from website visitor
 * @param {string} clientUserId - The client's user ID
 * @param {Object} attributionData - Attribution data from tracking script
 * @returns {Promise<Object>}
 */
export async function storeAttribution(clientUserId, attributionData) {
  console.log('[twilio:attribution] Storing attribution for client:', clientUserId, 'session:', attributionData.sessionId, 'event:', attributionData.event || 'pageview');
  const {
    sessionId,
    // Google
    gclid, gbraid, wbraid, dclid,
    // Facebook/Meta
    fbclid, fbc, fbp,
    // Microsoft / TikTok / LinkedIn
    msclkid, ttclid, li_fat_id,
    // UTMs
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    // Context
    landing_page, referrer, timestamp,
    user_agent, ip_address,
    event, phone
  } = attributionData;

  if (!sessionId) {
    throw new Error('Session ID is required');
  }

  // Hash IP address for privacy
  const ipHash = ip_address ? hashIp(ip_address) : null;

  // Calculate session expiry (30 minutes from now)
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // Check if this is a phone click event
  if (event === 'phone_click' && phone) {
    // Find tracking number for this phone
    const { rows: trackingNumbers } = await query(
      `SELECT id FROM twilio_tracking_numbers
       WHERE client_user_id = $1
         AND phone_number = $2
         AND is_active = TRUE
       LIMIT 1`,
      [clientUserId, normalizePhoneNumber(phone)]
    );

    const trackingNumberId = trackingNumbers[0]?.id || null;

    // Update or insert session with tracking number
    await query(
      `INSERT INTO attribution_sessions
         (session_id, client_user_id, tracking_number_id, gclid, fbclid,
          utm_source, utm_medium, utm_campaign, landing_page, referrer,
          visitor_data, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (session_id, client_user_id)
       DO UPDATE SET
         tracking_number_id = COALESCE(EXCLUDED.tracking_number_id, attribution_sessions.tracking_number_id),
         expires_at = EXCLUDED.expires_at`,
      [
        sessionId,
        clientUserId,
        trackingNumberId,
        gclid || null,
        fbclid || null,
        utm_source || null,
        utm_medium || null,
        utm_campaign || null,
        landing_page || null,
        referrer || null,
        JSON.stringify({ user_agent, ip_hash: ipHash, event, phone, msclkid, ttclid, li_fat_id, dclid }),
        expiresAt
      ]
    );

    return { stored: true, event: 'phone_click' };
  }

  // Standard attribution storage
  const { rows } = await query(
    `INSERT INTO attribution_sessions
       (session_id, client_user_id, gclid, fbclid, utm_source, utm_medium,
        utm_campaign, landing_page, referrer, visitor_data, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (session_id, client_user_id)
     DO UPDATE SET
       gclid = COALESCE(EXCLUDED.gclid, attribution_sessions.gclid),
       fbclid = COALESCE(EXCLUDED.fbclid, attribution_sessions.fbclid),
       utm_source = COALESCE(EXCLUDED.utm_source, attribution_sessions.utm_source),
       utm_medium = COALESCE(EXCLUDED.utm_medium, attribution_sessions.utm_medium),
       utm_campaign = COALESCE(EXCLUDED.utm_campaign, attribution_sessions.utm_campaign),
       landing_page = COALESCE(EXCLUDED.landing_page, attribution_sessions.landing_page),
       referrer = COALESCE(EXCLUDED.referrer, attribution_sessions.referrer),
       expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [
      sessionId,
      clientUserId,
      gclid || null,
      fbclid || null,
      utm_source || null,
      utm_medium || null,
      utm_campaign || null,
      landing_page || null,
      referrer || null,
      JSON.stringify({
        user_agent,
        ip_hash: ipHash,
        gbraid, wbraid, dclid,
        fbc, fbp,
        msclkid, ttclid, li_fat_id,
        utm_content, utm_term,
        timestamp
      }),
      expiresAt
    ]
  );

  return { stored: true, session: rows[0] };
}

/**
 * Link attribution session to a call
 * @param {string} sessionId - Session ID from tracking script
 * @param {string} callLogId - Call log ID
 * @returns {Promise<Object>}
 */
export async function linkAttributionToCall(sessionId, callLogId) {
  // Get session data
  const { rows: sessions } = await query(
    `SELECT * FROM attribution_sessions WHERE session_id = $1`,
    [sessionId]
  );

  if (!sessions.length) {
    return { linked: false, reason: 'session_not_found' };
  }

  const session = sessions[0];

  // Update session with call link
  await query(
    `UPDATE attribution_sessions SET call_log_id = $1 WHERE id = $2`,
    [callLogId, session.id]
  );

  // Create call_attribution record for detailed storage
  await query(
    `INSERT INTO call_attribution
       (call_log_id, session_id, client_user_id, gclid, gbraid, wbraid,
        fbclid, fbc, fbp, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        landing_page_url, referrer_url, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      callLogId,
      sessionId,
      session.client_user_id,
      session.gclid,
      session.visitor_data?.gbraid || null,
      session.visitor_data?.wbraid || null,
      session.fbclid,
      session.visitor_data?.fbc || null,
      session.visitor_data?.fbp || null,
      session.utm_source,
      session.utm_medium,
      session.utm_campaign,
      session.visitor_data?.utm_content || null,
      session.visitor_data?.utm_term || null,
      session.landing_page,
      session.referrer,
      session.visitor_data?.user_agent || null,
      session.visitor_data?.ip_hash || null
    ]
  );

  return { linked: true };
}

/**
 * Validate Twilio webhook signature using the agency auth token.
 * @param {string} signature - X-Twilio-Signature header
 * @param {string} url - Full webhook URL
 * @param {Object} params - Request body params
 * @returns {boolean}
 */
export async function validateWebhookSignature(signature, url, params) {
  if (!isTwilioConfigured()) {
    return false;
  }

  try {
    const Twilio = await getTwilioSDK();
    return Twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      params
    );
  } catch {
    // In development, skip validation if Twilio SDK not available
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[twilio] Skipping webhook validation in development');
      return true;
    }
    return false;
  }
}

/**
 * Hash an IP address for privacy-compliant storage
 * @param {string} ip - IP address
 * @returns {string}
 */
function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT || 'anchor-ip-salt';
  return crypto.createHash('sha256').update(ip + salt).digest('hex').slice(0, 16);
}

// Re-export useful functions from CTM service
export { CATEGORY_DEFINITIONS, normalizePhoneNumber, enrichCallerType };
