/**
 * Twilio Webhook Routes
 *
 * Handles incoming webhooks from Twilio for call tracking.
 * These endpoints are PUBLIC (no auth) as they're called by Twilio.
 *
 * SECURITY:
 * - Webhook signature validation in production
 * - No PHI in logs (only call IDs)
 * - All sensitive data handled by twilio.js service
 */

import { Router } from 'express';
import { query } from '../db.js';
import {
  handleIncomingCall,
  handleCallStatus,
  handleRecordingReady,
  handleTranscription,
  storeAttribution,
  validateWebhookSignature
} from '../services/twilio.js';

const router = Router();

// Content-Type for TwiML responses
const TWIML_CONTENT_TYPE = 'application/xml';

/**
 * Middleware to validate Twilio webhook signatures
 * Only enforced in production mode.
 *
 * Uses agency-level TWILIO_AUTH_TOKEN for signature validation since all
 * tracking numbers are provisioned under the single agency Twilio account.
 */
async function validateTwilioWebhook(req, res, next) {
  const NODE_ENV = process.env.NODE_ENV || 'development';

  // Skip validation in development
  if (NODE_ENV !== 'production') {
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    console.warn('[twilio:webhook] Missing X-Twilio-Signature header');
    return res.status(401).send('Missing signature');
  }

  // Get the tracking number to find client
  const toNumber = req.body.To || req.body.Called;
  if (!toNumber) {
    console.warn('[twilio:webhook] No To/Called number in request');
    return res.status(400).send('Missing phone number');
  }

  try {
    // Find client for this tracking number (agency-mode: no JOIN on twilio_client_configs)
    const { rows } = await query(
      `SELECT client_user_id
       FROM twilio_tracking_numbers
       WHERE phone_number = $1 AND is_active = TRUE
       LIMIT 1`,
      [toNumber]
    );

    if (!rows.length) {
      console.warn(`[twilio:webhook] No tracking number found for: ${toNumber}`);
      return res.status(404).send('Unknown number');
    }

    // Validate using agency auth token (all numbers share the same Twilio account)
    // Use same base URL source as provisioning (APP_BASE_URL || API_BASE_URL)
    const fullUrl = `${process.env.APP_BASE_URL || process.env.API_BASE_URL}${req.originalUrl}`;
    if (!(await validateWebhookSignature(signature, fullUrl, req.body))) {
      console.warn('[twilio:webhook] Invalid signature');
      return res.status(401).send('Invalid signature');
    }

    // Attach client info to request
    req.twilioClientUserId = rows[0].client_user_id;
    next();
  } catch (err) {
    console.error('[twilio:webhook] Validation error:', err.message);
    return res.status(500).send('Validation error');
  }
}

/**
 * Lightweight signature-only validation for Twilio callbacks that lack To/Called
 * (e.g. recording and transcription webhooks). Only checks the X-Twilio-Signature
 * against the agency TWILIO_AUTH_TOKEN — no phone number lookup required.
 */
async function validateTwilioSignatureOnly(req, res, next) {
  const NODE_ENV = process.env.NODE_ENV || 'development';
  if (NODE_ENV !== 'production') return next();

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    console.warn('[twilio:webhook] Missing X-Twilio-Signature header');
    return res.status(401).send('Missing signature');
  }

  try {
    const fullUrl = `${process.env.APP_BASE_URL || process.env.API_BASE_URL}${req.originalUrl}`;
    if (!(await validateWebhookSignature(signature, fullUrl, req.body))) {
      console.warn('[twilio:webhook] Invalid signature on callback');
      return res.status(401).send('Invalid signature');
    }
    next();
  } catch (err) {
    console.error('[twilio:webhook] Signature validation error:', err.message);
    return res.status(500).send('Validation error');
  }
}

/**
 * POST /api/twilio/voice
 * Handle incoming call - returns TwiML for call routing
 *
 * Twilio sends: CallSid, From, To, Direction, etc.
 */
// Mask phone numbers for logging (HIPAA: avoid PII in logs)
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + '****' + phone.slice(-2);
}

router.post('/voice', validateTwilioWebhook, async (req, res) => {
  const { CallSid, From, To, Direction, CallerName } = req.body;

  console.log(`[twilio:voice] Incoming call: ${CallSid} from ${maskPhone(From)} to ${maskPhone(To)}`);

  try {
    // Find tracking number
    const { rows } = await query(
      `SELECT id, client_user_id FROM twilio_tracking_numbers
       WHERE phone_number = $1 AND is_active = TRUE
       LIMIT 1`,
      [To]
    );

    if (!rows.length) {
      console.warn(`[twilio:voice] No tracking number for: ${maskPhone(To)}`);
      res.type(TWIML_CONTENT_TYPE).send(`<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>We're sorry, this number is not configured.</Say>
          <Hangup/>
        </Response>`);
      return;
    }

    const trackingNumber = rows[0];

    // Generate TwiML response
    const twiml = await handleIncomingCall(trackingNumber.id, {
      CallSid,
      From,
      To,
      Direction,
      CallerName
    });

    res.type(TWIML_CONTENT_TYPE).send(twiml);
  } catch (err) {
    console.error('[twilio:voice] Error handling call:', err.message);
    res.type(TWIML_CONTENT_TYPE).send(`<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>We're experiencing technical difficulties. Please try again later.</Say>
        <Hangup/>
      </Response>`);
  }
});

/**
 * POST /api/twilio/status
 * Handle call status updates (initiated, ringing, answered, completed)
 *
 * Twilio sends: CallSid, CallStatus, CallDuration, From, To, Direction, etc.
 */
router.post('/status', validateTwilioWebhook, async (req, res) => {
  const {
    CallSid,
    CallStatus,
    CallDuration,
    From,
    To,
    Direction,
    RecordingUrl,
    RecordingSid
  } = req.body;

  console.log(`[twilio:status] Call ${CallSid}: ${CallStatus} (${CallDuration}s)`);

  try {
    const result = await handleCallStatus(CallSid, {
      CallStatus,
      CallDuration,
      From,
      To,
      Direction,
      RecordingUrl,
      RecordingSid
    });

    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[twilio:status] Error processing status:', err.message);
    // Return 200 to prevent Twilio retries on non-transient errors
    res.status(200).json({ received: true, error: err.message });
  }
});

/**
 * POST /api/twilio/recording
 * Handle recording completed webhook
 *
 * Twilio sends: CallSid, RecordingSid, RecordingUrl, RecordingStatus, etc.
 */
router.post('/recording', validateTwilioSignatureOnly, async (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration } = req.body;

  console.log(`[twilio:recording] Recording ready for ${CallSid}: ${RecordingStatus}`);

  if (RecordingStatus !== 'completed') {
    return res.status(200).json({ received: true, skipped: 'not_completed' });
  }

  try {
    const result = await handleRecordingReady(CallSid, RecordingUrl);
    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[twilio:recording] Error processing recording:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

/**
 * POST /api/twilio/transcription
 * Handle transcription completed webhook (Twilio or Twilio Intelligence)
 *
 * Twilio sends: TranscriptionSid, TranscriptionText, TranscriptionStatus, etc.
 */
router.post('/transcription', validateTwilioSignatureOnly, async (req, res) => {
  const {
    CallSid,
    TranscriptionSid,
    TranscriptionText,
    TranscriptionStatus,
    RecordingSid
  } = req.body;

  console.log(`[twilio:transcription] Transcription for ${CallSid}: ${TranscriptionStatus}`);

  try {
    const result = await handleTranscription(CallSid, {
      TranscriptionSid,
      TranscriptionText,
      TranscriptionStatus,
      RecordingSid
    });

    res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[twilio:transcription] Error processing transcription:', err.message);
    res.status(200).json({ received: true, error: err.message });
  }
});

/**
 * POST /api/twilio/attribution
 * Store attribution data from website tracking script
 *
 * This endpoint is PUBLIC - called from client-side JavaScript
 * No sensitive data is stored - only marketing attribution parameters
 */
router.post('/attribution', async (req, res) => {
  const {
    clientId,
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
    event, phone
  } = req.body;

  if (!clientId || !sessionId) {
    return res.status(400).json({ error: 'clientId and sessionId are required' });
  }

  // Verify client exists
  const { rows } = await query(`SELECT id FROM users WHERE id = $1`, [clientId]);
  if (!rows.length) {
    return res.status(404).json({ error: 'Client not found' });
  }

  try {
    const result = await storeAttribution(clientId, {
      sessionId,
      gclid, gbraid, wbraid, dclid,
      fbclid, fbc, fbp,
      msclkid, ttclid, li_fat_id,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      landing_page, referrer, timestamp,
      user_agent: req.headers['user-agent'],
      ip_address: req.ip || req.headers['x-forwarded-for']?.split(',')[0],
      event, phone
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('[twilio:attribution] Error storing attribution:', err.message);
    res.status(500).json({ error: 'Failed to store attribution' });
  }
});

/**
 * GET /api/twilio/test
 * Test endpoint to verify Twilio webhooks are accessible
 */
router.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Twilio webhook endpoints are accessible',
    endpoints: [
      'POST /api/twilio/voice',
      'POST /api/twilio/status',
      'POST /api/twilio/recording',
      'POST /api/twilio/transcription',
      'POST /api/twilio/attribution'
    ]
  });
});

export default router;
