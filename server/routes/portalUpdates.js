/**
 * Client Portal Updates
 *
 * Agency-authored announcements broadcast to all client users, shown as a
 * dismissible banner at the top of the client portal. Dismissal is per user
 * account (a row in user_update_dismissals) and permanent.
 *
 * Client-facing endpoints use requireAuth and key dismissal to req.user.id.
 * Admin authoring endpoints additionally require requireAdmin.
 */

import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const VALID_TYPES = ['feature', 'improvement', 'notice', 'maintenance'];
const VALID_STATUSES = ['draft', 'published', 'archived'];

// Validate + normalize an update payload. Returns { value } or { error }.
function validateUpdatePayload(body, { partial = false } = {}) {
  const out = {};

  if (body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) return { error: `type must be one of: ${VALID_TYPES.join(', ')}` };
    out.type = body.type;
  } else if (!partial) {
    out.type = 'notice';
  }

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return { error: 'title is required' };
    if (title.length > 200) return { error: 'title must be 200 characters or fewer' };
    out.title = title;
  } else if (!partial) {
    return { error: 'title is required' };
  }

  if (body.body !== undefined) {
    if (body.body !== null && typeof body.body !== 'string') return { error: 'body must be a string' };
    const text = body.body || '';
    if (text.length > 2000) return { error: 'body must be 2000 characters or fewer' };
    out.body = text || null;
  }

  if (body.link_url !== undefined) {
    if (body.link_url !== null && typeof body.link_url !== 'string') return { error: 'link_url must be a string' };
    const raw = (body.link_url || '').trim();
    if (raw) {
      if (raw.length > 500) return { error: 'link_url must be 500 characters or fewer' };
      if (!/^https?:\/\//i.test(raw)) return { error: 'link_url must start with http:// or https://' };
    }
    out.link_url = raw || null;
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) return { error: `status must be one of: ${VALID_STATUSES.join(', ')}` };
    out.status = body.status;
  } else if (!partial) {
    out.status = 'draft';
  }

  return { value: out };
}

// ── Client-facing ──────────────────────────────────────────────────────────

// GET /api/portal-updates — published updates the current user hasn't dismissed.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      // Scoped to req.user.id (the authenticated human), NOT req.portalUserId.
      // Updates are a per-person preference; keying to portalUserId would let a
      // staff member impersonating a client dismiss/read on the client's behalf.
      // For a normal client login the two ids are identical, so this only differs
      // (correctly) under impersonation.
      `SELECT id, type, title, body, link_url, published_at
         FROM portal_updates
        WHERE status = 'published'
          AND id NOT IN (SELECT update_id FROM user_update_dismissals WHERE user_id = $1)
        ORDER BY published_at DESC NULLS LAST, created_at DESC`,
      [req.user.id]
    );
    res.json({ updates: rows });
  } catch (err) {
    console.error('[portal-updates] error fetching active updates:', err.message);
    res.status(500).json({ message: 'Unable to load updates' });
  }
});

// POST /api/portal-updates/:id/dismiss — dismiss for the current user (idempotent).
router.post('/:id/dismiss', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await query(`SELECT 1 FROM portal_updates WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ message: 'Update not found' });

    await query(
      `INSERT INTO user_update_dismissals (user_id, update_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, update_id) DO NOTHING`,
      [req.user.id, id]
    );
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ message: 'Invalid update id' });
    console.error('[portal-updates] error dismissing update:', err.message);
    res.status(500).json({ message: 'Unable to dismiss update' });
  }
});

// ── Admin authoring ────────────────────────────────────────────────────────

// GET /api/portal-updates/admin — all updates (any status) + dismissal counts.
router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.type, u.title, u.body, u.link_url, u.status,
              u.created_by, u.published_at, u.created_at, u.updated_at,
              (SELECT COUNT(*) FROM user_update_dismissals d WHERE d.update_id = u.id)::int AS dismiss_count
         FROM portal_updates u
        ORDER BY u.created_at DESC`
    );
    res.json({ updates: rows });
  } catch (err) {
    console.error('[portal-updates] error listing updates:', err.message);
    res.status(500).json({ message: 'Unable to load updates' });
  }
});

// POST /api/portal-updates/admin — create.
router.post('/admin', requireAuth, requireAdmin, async (req, res) => {
  const { value, error } = validateUpdatePayload(req.body || {});
  if (error) return res.status(400).json({ message: error });

  try {
    const publishedAt = value.status === 'published' ? new Date() : null;
    const { rows } = await query(
      `INSERT INTO portal_updates (type, title, body, link_url, status, created_by, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, type, title, body, link_url, status, created_by, published_at, created_at, updated_at`,
      [value.type, value.title, value.body ?? null, value.link_url ?? null, value.status, req.user.id, publishedAt]
    );
    res.status(201).json({ update: rows[0] });
  } catch (err) {
    console.error('[portal-updates] error creating update:', err.message);
    res.status(500).json({ message: 'Unable to create update' });
  }
});

// PUT /api/portal-updates/admin/:id — partial update.
router.put('/admin/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { value, error } = validateUpdatePayload(req.body || {}, { partial: true });
  if (error) return res.status(400).json({ message: error });
  if (!Object.keys(value).length) return res.status(400).json({ message: 'No fields to update' });

  try {
    const existing = await query(`SELECT status, published_at FROM portal_updates WHERE id = $1`, [id]);
    if (!existing.rowCount) return res.status(404).json({ message: 'Update not found' });

    const sets = [];
    const params = [];
    let i = 1;
    for (const key of ['type', 'title', 'body', 'link_url', 'status']) {
      if (value[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        params.push(value[key]);
      }
    }
    // Stamp published_at the first time it goes published.
    if (value.status === 'published' && !existing.rows[0].published_at) {
      sets.push(`published_at = $${i++}`);
      params.push(new Date());
    }
    sets.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await query(
      `UPDATE portal_updates SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, type, title, body, link_url, status, created_by, published_at, created_at, updated_at`,
      params
    );
    res.json({ update: rows[0] });
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ message: 'Invalid update id' });
    console.error('[portal-updates] error updating update:', err.message);
    res.status(500).json({ message: 'Unable to update update' });
  }
});

// DELETE /api/portal-updates/admin/:id — hard delete (cascades dismissals).
router.delete('/admin/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await query(`DELETE FROM portal_updates WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ message: 'Update not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '22P02') return res.status(400).json({ message: 'Invalid update id' });
    console.error('[portal-updates] error deleting update:', err.message);
    res.status(500).json({ message: 'Unable to delete update' });
  }
});

export default router;
