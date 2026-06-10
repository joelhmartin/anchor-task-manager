// Hub services routes: list/create/update/delete a user's own services catalog. Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';
import { logEvent } from '../../services/hubUtils.js';

const router = express.Router();

router.get('/services', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  try {
    // Deduplicate by name: per name, prefer active rows; among ties pick the newest.
    const { rows } = await query(
      `SELECT DISTINCT ON (LOWER(name)) *
       FROM services
       WHERE user_id = $1
       ORDER BY LOWER(name), active DESC, updated_at DESC`,
      [userId]
    );
    res.json({ services: rows });
  } catch (err) {
    logEvent('services:list', 'Error fetching services', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to fetch services' });
  }
});

// Create service for user
router.post('/services', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { name, description, base_price, active } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'Service name is required' });
  }
  try {
    // Upsert by name — if a service with this name exists, update it instead of creating a duplicate
    const { rows } = await query(
      `INSERT INTO services (user_id, name, description, base_price, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, LOWER(name)) DO UPDATE
         SET description = EXCLUDED.description,
             base_price  = EXCLUDED.base_price,
             active      = EXCLUDED.active,
             updated_at  = NOW()
       RETURNING *`,
      [userId, name, description || null, base_price || null, active !== false]
    );
    logEvent('services:create', 'Service created', { serviceId: rows[0].id, name, userId });
    res.json({ service: rows[0] });
  } catch (err) {
    // Fallback if unique constraint doesn't exist yet — plain insert
    if (err.code === '42P10' || err.message?.includes('there is no unique constraint')) {
      try {
        const { rows: dupCheck } = await query(
          'SELECT id FROM services WHERE user_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
          [userId, name]
        );
        if (dupCheck.length) {
          return res.status(409).json({ message: 'A service with this name already exists' });
        }
        const { rows } = await query(
          'INSERT INTO services (user_id, name, description, base_price, active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [userId, name, description || null, base_price || null, active !== false]
        );
        return res.json({ service: rows[0] });
      } catch (innerErr) {
        logEvent('services:create', 'Error creating service', { error: innerErr.message, userId });
        return res.status(500).json({ message: 'Unable to create service' });
      }
    }
    logEvent('services:create', 'Error creating service', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to create service' });
  }
});

// Update user's service
router.put('/services/:id', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { name, description, base_price, active } = req.body;
  try {
    const updates = [];
    const params = [];
    if (name !== undefined) {
      updates.push('name = $' + (params.length + 1));
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = $' + (params.length + 1));
      params.push(description);
    }
    if (base_price !== undefined) {
      updates.push('base_price = $' + (params.length + 1));
      params.push(base_price);
    }
    if (active !== undefined) {
      updates.push('active = $' + (params.length + 1));
      params.push(active);
    }
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }
    updates.push('updated_at = NOW()');
    params.push(userId);
    params.push(id);
    const { rows } = await query(
      `UPDATE services SET ${updates.join(', ')} WHERE user_id = $${params.length - 1} AND id = $${params.length} RETURNING *`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }
    logEvent('services:update', 'Service updated', { serviceId: id, userId });
    res.json({ service: rows[0] });
  } catch (err) {
    logEvent('services:update', 'Error updating service', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to update service' });
  }
});

// Delete user's service
router.delete('/services/:id', async (req, res) => {
  const userId = req.portalUserId || req.user.id;
  const { id } = req.params;
  try {
    const { rowCount } = await query('DELETE FROM services WHERE user_id = $1 AND id = $2', [userId, id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'Service not found' });
    }
    logEvent('services:delete', 'Service deleted', { serviceId: id, userId });
    res.json({ success: true });
  } catch (err) {
    logEvent('services:delete', 'Error deleting service', { error: err.message, userId });
    res.status(500).json({ message: 'Unable to delete service' });
  }
});

export default router;
