/**
 * Onboarding PDF regeneration routes
 *
 * Extracted from server/routes/hub.js. Handles admin-triggered bulk and
 * per-client PDF regeneration. Mounted at /api/hub by server/index.js.
 */

import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateClientOnboardingPdf } from '../services/onboardingPdf.js';
import { getOnboardingPayloadForUser } from './onboarding.js';
import { storeFile } from '../services/fileStorage.js';

const router = express.Router();
router.use(requireAuth);

/**
 * POST /clients/:id/regenerate-onboarding-pdf
 * Regenerate the onboarding PDF for a client from their current database data.
 * Replaces any existing onboarding document with a fresh DB-backed copy.
 */
router.post('/clients/:id/regenerate-onboarding-pdf', requireAdmin, async (req, res) => {
  try {
    const clientId = req.params.id;
    const payload = await getOnboardingPayloadForUser(clientId);
    if (!payload) return res.status(404).json({ message: 'Client not found' });

    const { buffer, filename } = await generateClientOnboardingPdf({ payload });

    // Store PDF in database-backed file storage
    const { url: docUrl } = await storeFile(
      { buffer, mimetype: 'application/pdf', originalname: filename },
      { category: 'onboarding-pdf', ownerId: clientId, ownerType: 'user' }
    );

    // Remove old onboarding document records for this user
    await query(
      `DELETE FROM documents WHERE user_id = $1 AND type = 'onboarding'`,
      [clientId]
    );

    // Insert fresh document record
    await query(
      `INSERT INTO documents (user_id, label, name, url, origin, type, review_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [clientId, 'Onboarding Summary', filename, docUrl, 'system', 'onboarding', 'none']
    );

    return res.json({ ok: true, url: docUrl, filename });
  } catch (err) {
    console.error('[hub:regenerate-onboarding-pdf]', err);
    return res.status(500).json({ message: 'Unable to regenerate onboarding PDF' });
  }
});

/**
 * POST /clients/regenerate-all-onboarding-pdfs
 * Regenerate onboarding PDFs for ALL clients who completed onboarding.
 * Admin-only bulk operation.
 */
router.post('/clients/regenerate-all-onboarding-pdfs', requireAdmin, async (req, res) => {
  try {
    const { rows: clients } = await query(
      `SELECT u.id, u.email FROM users u
       JOIN client_profiles cp ON cp.user_id = u.id
       WHERE cp.onboarding_completed_at IS NOT NULL`
    );

    if (!clients.length) return res.json({ ok: true, regenerated: 0, message: 'No completed onboarding clients found' });

    const results = [];
    for (const client of clients) {
      try {
        const payload = await getOnboardingPayloadForUser(client.id);
        if (!payload) { results.push({ id: client.id, email: client.email, status: 'skipped', reason: 'no payload' }); continue; }

        const { buffer, filename } = await generateClientOnboardingPdf({ payload });

        const { url: docUrl } = await storeFile(
          { buffer, mimetype: 'application/pdf', originalname: filename },
          { category: 'onboarding-pdf', ownerId: client.id, ownerType: 'user' }
        );

        // Remove old onboarding document records
        await query(`DELETE FROM documents WHERE user_id = $1 AND type = 'onboarding'`, [client.id]);

        // Insert fresh document record
        await query(
          `INSERT INTO documents (user_id, label, name, url, origin, type, review_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [client.id, 'Onboarding Summary', filename, docUrl, 'system', 'onboarding', 'none']
        );

        results.push({ id: client.id, email: client.email, status: 'ok', url: docUrl });
      } catch (err) {
        results.push({ id: client.id, email: client.email, status: 'error', error: err.message });
      }
    }

    const ok = results.filter(r => r.status === 'ok').length;
    const failed = results.filter(r => r.status === 'error').length;
    return res.json({ ok: true, regenerated: ok, failed, total: clients.length, results });
  } catch (err) {
    console.error('[hub:regenerate-all-onboarding-pdfs]', err);
    return res.status(500).json({ message: 'Unable to regenerate onboarding PDFs' });
  }
});

export default router;
