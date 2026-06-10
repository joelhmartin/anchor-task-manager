/**
 * Webhooks Router
 * Handles incoming webhooks from external services (Mailgun, etc.)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db.js';

const router = Router();

// Mailgun webhook signing key (set in Mailgun dashboard)
const MAILGUN_WEBHOOK_SIGNING_KEY = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;

/**
 * Verify Mailgun webhook signature
 * https://documentation.mailgun.com/en/latest/user_manual.html#webhooks-1
 *
 * Security: Fail-closed in production - rejects webhooks if signing key not configured.
 * In development, allows webhooks without verification for testing convenience.
 */
function verifyMailgunSignature(timestamp, token, signature) {
  const NODE_ENV = process.env.NODE_ENV || 'development';

  if (!MAILGUN_WEBHOOK_SIGNING_KEY) {
    if (NODE_ENV === 'production') {
      console.error('[webhooks:mailgun] MAILGUN_WEBHOOK_SIGNING_KEY not set in production - rejecting webhook');
      return false; // Fail-closed in production
    }
    console.warn('[webhooks:mailgun] MAILGUN_WEBHOOK_SIGNING_KEY not set - skipping verification (dev mode)');
    return true; // Allow in dev without key for testing
  }

  const encodedToken = crypto
    .createHmac('sha256', MAILGUN_WEBHOOK_SIGNING_KEY)
    .update(timestamp.concat(token))
    .digest('hex');

  return encodedToken === signature;
}

/**
 * POST /api/webhooks/mailgun
 * Receive events from Mailgun (delivered, opened, clicked, bounced, etc.)
 */
router.post('/mailgun', async (req, res) => {
  try {
    const { signature, 'event-data': eventData } = req.body;

    // Verify signature (Mailgun sends timestamp, token, signature)
    // In production, signature is required — reject webhooks without it.
    const NODE_ENV = process.env.NODE_ENV || 'development';
    if (!signature || !signature.timestamp || !signature.token || !signature.signature) {
      if (NODE_ENV === 'production') {
        console.warn('[webhooks:mailgun] Missing signature in production — rejecting');
        return res.status(401).json({ error: 'Missing signature' });
      }
      console.warn('[webhooks:mailgun] Missing signature — allowing in dev mode');
    } else {
      const { timestamp: ts, token: tok, signature: sig } = signature;
      if (!verifyMailgunSignature(String(ts), tok, sig)) {
        console.warn('[webhooks:mailgun] Invalid signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    if (!eventData) {
      return res.status(400).json({ error: 'Missing event-data' });
    }

    const event = eventData.event;
    const messageId = eventData.message?.headers?.['message-id'];
    const timestamp = eventData.timestamp ? new Date(eventData.timestamp * 1000) : new Date();

    // Mailgun message ID format: <id@domain> - we store just the id part
    const mailgunId = messageId ? `<${messageId}>` : null;

    if (!mailgunId) {
      console.warn('[webhooks:mailgun] No message ID in event:', event);
      return res.status(200).json({ received: true, skipped: 'no-message-id' });
    }

    console.log(`[webhooks:mailgun] Event: ${event} for message: ${mailgunId}`);

    // Find the email log by mailgun_id
    const { rows } = await query(
      `SELECT id, status FROM email_logs WHERE mailgun_id = $1 LIMIT 1`,
      [mailgunId]
    );

    if (!rows.length) {
      // Try without angle brackets
      const cleanId = messageId.replace(/[<>]/g, '');
      const { rows: altRows } = await query(
        `SELECT id, status FROM email_logs WHERE mailgun_id LIKE $1 LIMIT 1`,
        [`%${cleanId}%`]
      );
      if (!altRows.length) {
        console.warn(`[webhooks:mailgun] No email log found for: ${mailgunId}`);
        return res.status(200).json({ received: true, skipped: 'no-matching-log' });
      }
      rows.push(...altRows);
    }

    const logId = rows[0].id;

    // Build delivery status from event data
    const deliveryStatus = {};
    if (eventData['delivery-status']) {
      const ds = eventData['delivery-status'];
      deliveryStatus.code = ds.code;
      deliveryStatus.message = ds.message;
      deliveryStatus.description = ds.description;
      deliveryStatus.mx_host = ds['mx-host'];
      deliveryStatus.session_seconds = ds['session-seconds'];
      deliveryStatus.utf8 = ds.utf8;
      deliveryStatus.attempt_no = ds['attempt-no'];
      deliveryStatus.certificate_verified = ds['certificate-verified'];
      deliveryStatus.tls = ds.tls;
    }

    // Add envelope info
    if (eventData.envelope) {
      deliveryStatus.envelope = {
        transport: eventData.envelope.transport,
        sender: eventData.envelope.sender,
        sending_ip: eventData.envelope['sending-ip'],
        targets: eventData.envelope.targets
      };
    }

    // Add flags (authentication results)
    if (eventData.flags) {
      deliveryStatus.flags = eventData.flags;
    }

    // Process based on event type
    switch (event) {
      case 'delivered':
        await query(
          `UPDATE email_logs SET 
            delivered_at = COALESCE(delivered_at, $2),
            status = 'delivered',
            delivery_status = delivery_status || $3::jsonb
          WHERE id = $1`,
          [logId, timestamp, JSON.stringify({ ...deliveryStatus, delivered: true })]
        );
        break;

      case 'opened':
        await query(
          `UPDATE email_logs SET 
            opened_at = COALESCE(opened_at, $2),
            open_count = open_count + 1,
            delivery_status = delivery_status || $3::jsonb
          WHERE id = $1`,
          [logId, timestamp, JSON.stringify({ 
            last_opened: timestamp.toISOString(),
            client_info: eventData['client-info'],
            geolocation: eventData.geolocation,
            ip: eventData.ip,
            device_type: eventData['device-type']
          })]
        );
        break;

      case 'clicked':
        await query(
          `UPDATE email_logs SET 
            clicked_at = COALESCE(clicked_at, $2),
            click_count = click_count + 1,
            delivery_status = delivery_status || $3::jsonb
          WHERE id = $1`,
          [logId, timestamp, JSON.stringify({ 
            last_clicked: timestamp.toISOString(),
            clicked_url: eventData.url,
            client_info: eventData['client-info'],
            geolocation: eventData.geolocation,
            ip: eventData.ip,
            device_type: eventData['device-type']
          })]
        );
        break;

      case 'bounced':
      case 'failed':
        const bounceType = eventData.severity === 'permanent' ? 'hard' : 'soft';
        const bounceCode = eventData['delivery-status']?.code || eventData.reason;
        await query(
          `UPDATE email_logs SET 
            bounced_at = $2,
            bounce_type = $3,
            bounce_code = $4,
            status = 'bounced',
            error_message = $5,
            delivery_status = delivery_status || $6::jsonb
          WHERE id = $1`,
          [
            logId, 
            timestamp, 
            bounceType, 
            String(bounceCode),
            eventData['delivery-status']?.message || eventData.reason || 'Bounce',
            JSON.stringify({ ...deliveryStatus, bounced: true, severity: eventData.severity })
          ]
        );
        break;

      case 'complained':
        await query(
          `UPDATE email_logs SET 
            complained_at = $2,
            status = 'complained',
            delivery_status = delivery_status || $3::jsonb
          WHERE id = $1`,
          [logId, timestamp, JSON.stringify({ complained: true })]
        );
        break;

      case 'unsubscribed':
        await query(
          `UPDATE email_logs SET 
            unsubscribed_at = $2,
            delivery_status = delivery_status || $3::jsonb
          WHERE id = $1`,
          [logId, timestamp, JSON.stringify({ unsubscribed: true })]
        );
        break;

      case 'accepted':
        // Email accepted by Mailgun for delivery
        await query(
          `UPDATE email_logs SET 
            delivery_status = delivery_status || $2::jsonb
          WHERE id = $1`,
          [logId, JSON.stringify({ accepted: true, accepted_at: timestamp.toISOString() })]
        );
        break;

      default:
        console.log(`[webhooks:mailgun] Unhandled event type: ${event}`);
    }

    res.status(200).json({ received: true, event, logId });
  } catch (err) {
    console.error('[webhooks:mailgun] Error processing webhook:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/webhooks/mailgun/test
 * Test endpoint to verify webhook is accessible
 */
router.get('/mailgun/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Mailgun webhook endpoint is accessible',
    signing_key_configured: Boolean(MAILGUN_WEBHOOK_SIGNING_KEY)
  });
});

export default router;

