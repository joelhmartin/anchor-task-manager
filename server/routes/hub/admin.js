// Hub admin client-services routes: list and bulk-upsert the services offered
// by a specific client (admin/editor only). Mounted by the hub.js aggregator
// AFTER `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';
import { logEvent } from '../../services/hubUtils.js';
import { isAdminOrEditor } from '../../middleware/roles.js';

const router = express.Router();

router.get('/admin/clients/:id/services', isAdminOrEditor, async (req, res) => {
  const targetClientId = req.params.id;
  try {
    const { rows: userRows } = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetClientId]);
    if (!userRows.length) {
      return res.status(404).json({ message: 'Client not found' });
    }
    const { rows } = await query('SELECT * FROM services WHERE user_id = $1 ORDER BY name ASC', [targetClientId]);
    res.json({ services: rows });
  } catch (err) {
    logEvent('clients:services:list', 'Error fetching client services', { clientId: targetClientId, error: err.message });
    res.status(500).json({ message: 'Unable to fetch client services' });
  }
});

router.put('/admin/clients/:id/services', isAdminOrEditor, async (req, res) => {
  const targetClientId = req.params.id;
  const { services } = req.body || {};
  if (!Array.isArray(services)) {
    return res.status(400).json({ message: 'Services payload must be an array' });
  }

  const formatName = (raw) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    return trimmed
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const sanitized = [];
  const seen = new Set();
  for (const rawService of services) {
    const name = formatName(rawService?.name);
    if (!name) continue;
    const description = rawService?.description ? String(rawService.description).trim() : '';
    const price =
      rawService?.base_price === '' || rawService?.base_price === null || rawService?.base_price === undefined
        ? null
        : Number.parseFloat(rawService.base_price);
    const safePrice = Number.isFinite(price) ? price : null;
    const id = rawService?.id || null;
    const key = id || name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push({
      id,
      name,
      description,
      base_price: safePrice,
      active: rawService?.active === false ? false : true
    });
  }

  try {
    const { rows: userRows } = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [targetClientId]);
    if (!userRows.length) {
      return res.status(404).json({ message: 'Client not found' });
    }
    const { rows: existingRows } = await query('SELECT id, name FROM services WHERE user_id = $1', [targetClientId]);
    const existingIds = new Set(existingRows.map((row) => row.id));
    const existingByName = new Map(existingRows.map((row) => [row.name.toLowerCase(), row.id]));
    const processedIds = new Set();

    await query('BEGIN');
    for (const service of sanitized) {
      // Resolve ID: use explicit id if valid, otherwise match by name to avoid duplicates
      const resolvedId = (service.id && existingIds.has(service.id))
        ? service.id
        : existingByName.get(service.name.toLowerCase()) || null;

      if (resolvedId) {
        await query(
          `UPDATE services
             SET name = $1,
                 description = $2,
                 base_price = $3,
                 active = $4,
                 updated_at = NOW()
           WHERE id = $5 AND user_id = $6`,
          [service.name, service.description || null, service.base_price, service.active !== false, resolvedId, targetClientId]
        );
        processedIds.add(resolvedId);
      } else {
        const { rows } = await query(
          `INSERT INTO services (user_id, name, description, base_price, active)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [targetClientId, service.name, service.description || null, service.base_price, service.active !== false]
        );
        processedIds.add(rows[0].id);
      }
    }

    const idsToDeactivate = existingRows.filter((row) => !processedIds.has(row.id)).map((row) => row.id);
    if (idsToDeactivate.length) {
      await query(
        `UPDATE services 
           SET active = FALSE,
               updated_at = NOW()
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [targetClientId, idsToDeactivate]
      );
    }
    await query('COMMIT');
    const refreshed = await query('SELECT * FROM services WHERE user_id = $1 ORDER BY name ASC', [targetClientId]);
    logEvent('clients:services:update', 'Client services updated', {
      clientId: targetClientId,
      updated: sanitized.length,
      deactivated: idsToDeactivate.length
    });
    res.json({ services: refreshed.rows });
  } catch (err) {
    try {
      await query('ROLLBACK');
    } catch (rollbackErr) {
      logEvent('clients:services:update', 'Rollback failed', { clientId: targetClientId, error: rollbackErr.message });
    }
    logEvent('clients:services:update', 'Error updating client services', { clientId: targetClientId, error: err.message });
    res.status(500).json({ message: 'Unable to update client services' });
  }
});

export default router;
