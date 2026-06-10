/**
 * Twilio Call Tracking Config Routes
 *
 * Extracted from server/routes/hub.js. Handles agency-level Twilio config:
 * tracking number management, provider switching, webhook reconfiguration.
 * Mounted at /api/hub by server/index.js.
 */

import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isAdminOrEditor } from '../middleware/roles.js';
import { logSecurityEvent, SecurityEventCategories } from '../services/security/index.js';
import {
  getTwilioConfigStatus,
  isTwilioConfigured,
  listTrackingNumbers,
  purchasePhoneNumber,
  updateTrackingNumber,
  releasePhoneNumber,
  generateTrackingScript,
  reconfigureAllWebhooks
} from '../services/twilio.js';

const router = express.Router();
router.use(requireAuth);

/**
 * GET /hub/twilio/config
 * Get Twilio configuration status (global agency config + client provider preference)
 */
router.get('/twilio/config', isAdminOrEditor, async (req, res) => {
  const { clientId } = req.query;
  const userId = clientId || req.user.id;

  try {
    // Get global Twilio config status (from env vars)
    const globalConfig = getTwilioConfigStatus();

    // Get client's provider preference
    const profile = await query(
      `SELECT call_provider FROM client_profiles WHERE user_id = $1`,
      [userId]
    );

    // Count tracking numbers for this client
    const numbersResult = await query(
      `SELECT COUNT(*) as count FROM twilio_tracking_numbers WHERE client_user_id = $1 AND is_active = TRUE`,
      [userId]
    );

    res.json({
      configured: globalConfig.configured,
      accountSidLast4: globalConfig.accountSidLast4,
      provider: profile.rows[0]?.call_provider || 'ctm',
      numberCount: parseInt(numbersResult.rows[0]?.count || 0, 10)
    });
  } catch (err) {
    console.error('[hub:twilio:config]', err);
    res.status(500).json({ message: err.message || 'Failed to get config' });
  }
});

/**
 * GET /hub/twilio/numbers
 * List tracking numbers for a client
 */
router.get('/twilio/numbers', isAdminOrEditor, async (req, res) => {
  const { clientId, includeInactive } = req.query;

  try {
    let numbers;
    if (clientId) {
      numbers = await listTrackingNumbers(clientId, {
        includeInactive: includeInactive === 'true'
      });
    } else {
      // Admin: list all tracking numbers across all clients
      let sql = 'SELECT * FROM twilio_tracking_numbers';
      if (includeInactive !== 'true') {
        sql += ' WHERE is_active = TRUE';
      }
      sql += ' ORDER BY created_at DESC';
      const result = await query(sql);
      numbers = result.rows;
    }

    res.json({ numbers });
  } catch (err) {
    console.error('[hub:twilio:numbers]', err);
    res.status(500).json({ message: err.message || 'Failed to list numbers' });
  }
});

/**
 * POST /hub/twilio/numbers/purchase
 * Purchase a new tracking number from Twilio
 */
router.post('/twilio/numbers/purchase', requireAdmin, async (req, res) => {
  console.log('[hub:twilio:purchase] Request body:', JSON.stringify(req.body));

  const {
    clientId,
    areaCode,
    contains,
    friendlyName,
    forwardTo,
    sourceType,
    recordingEnabled,
    transcriptionEnabled
  } = req.body;

  console.log('[hub:twilio:purchase] Parsed - clientId:', clientId, 'areaCode:', areaCode, 'forwardTo:', forwardTo);

  if (!clientId) {
    console.warn('[hub:twilio:purchase] Rejected: missing clientId');
    return res.status(400).json({ message: 'clientId is required' });
  }

  if (!forwardTo) {
    console.warn('[hub:twilio:purchase] Rejected: missing forwardTo');
    return res.status(400).json({ message: 'forwardTo number is required' });
  }

  try {
    const number = await purchasePhoneNumber(clientId, {
      areaCode,
      contains,
      friendlyName,
      forwardTo,
      sourceType,
      recordingEnabled: recordingEnabled !== false,
      transcriptionEnabled: transcriptionEnabled !== false
    });

    // Log security event
    logSecurityEvent({
      eventType: 'account_settings_changed',
      eventCategory: SecurityEventCategories.ACCOUNT,
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: {
        action: 'tracking_number_purchased',
        clientId,
        phoneNumber: number.phone_number,
        sourceType
      }
    }).catch(() => {});

    // If first number, include tracking script snippet in response
    const trackingScript = number._trackingScript || null;
    delete number._trackingScript;

    res.json({ success: true, number, trackingScript });
  } catch (err) {
    console.error('[hub:twilio:numbers:purchase]', err);
    res.status(400).json({ message: err.message || 'Failed to purchase number' });
  }
});

/**
 * PUT /hub/twilio/numbers/:id
 * Update a tracking number's configuration
 */
router.put('/twilio/numbers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const number = await updateTrackingNumber(id, updates);
    res.json({ success: true, number });
  } catch (err) {
    console.error('[hub:twilio:numbers:update]', err);
    res.status(400).json({ message: err.message || 'Failed to update number' });
  }
});

/**
 * DELETE /hub/twilio/numbers/:id
 * Release a tracking number back to Twilio
 */
router.delete('/twilio/numbers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Get number details before release for logging
    const { rows } = await query(
      `SELECT phone_number, client_user_id FROM twilio_tracking_numbers WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Number not found' });
    }

    await releasePhoneNumber(id);

    // Log security event
    logSecurityEvent({
      eventType: 'account_settings_changed',
      eventCategory: SecurityEventCategories.ACCOUNT,
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: {
        action: 'tracking_number_released',
        phoneNumber: rows[0].phone_number,
        clientId: rows[0].client_user_id
      }
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('[hub:twilio:numbers:release]', err);
    res.status(400).json({ message: err.message || 'Failed to release number' });
  }
});

/**
 * GET /hub/twilio/tracking-script
 * Generate the tracking script snippet for client website
 */
router.get('/twilio/tracking-script', isAdminOrEditor, async (req, res) => {
  const { clientId } = req.query;
  const userId = clientId || req.user.id;

  try {
    const script = await generateTrackingScript(userId);
    res.json({ script });
  } catch (err) {
    console.error('[hub:twilio:tracking-script]', err);
    res.status(500).json({ message: err.message || 'Failed to generate script' });
  }
});

/**
 * POST /hub/twilio/switch-provider
 * Switch call tracking provider (CTM <-> Twilio)
 */
router.post('/twilio/switch-provider', requireAdmin, async (req, res) => {
  const { clientId, provider } = req.body;

  if (!clientId) {
    return res.status(400).json({ message: 'clientId is required' });
  }

  if (!['ctm', 'twilio'].includes(provider)) {
    return res.status(400).json({ message: 'provider must be "ctm" or "twilio"' });
  }

  try {
    // Check if Twilio is configured globally before switching to it
    if (provider === 'twilio' && !isTwilioConfigured()) {
      return res.status(400).json({
        message: 'Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.'
      });
    }

    await query(
      `UPDATE client_profiles SET call_provider = $1, updated_at = NOW() WHERE user_id = $2`,
      [provider, clientId]
    );

    // Log the switch
    logSecurityEvent({
      eventType: 'account_settings_changed',
      eventCategory: SecurityEventCategories.ACCOUNT,
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      success: true,
      details: {
        action: 'call_provider_switched',
        clientId,
        newProvider: provider
      }
    }).catch(() => {});

    res.json({ success: true, provider });
  } catch (err) {
    console.error('[hub:twilio:switch-provider]', err);
    res.status(500).json({ message: err.message || 'Failed to switch provider' });
  }
});

/**
 * POST /hub/twilio/reconfigure-webhooks
 * Reconfigure webhook URLs on ALL active Twilio numbers.
 * Use after deployment or when APP_BASE_URL changes.
 * Admin only.
 */
router.post('/twilio/reconfigure-webhooks', requireAdmin, async (req, res) => {
  try {
    const result = await reconfigureAllWebhooks();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[hub:twilio:reconfigure]', err.message);
    res.status(400).json({ message: err.message });
  }
});

export default router;
