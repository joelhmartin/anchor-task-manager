// Hub sub-router: lead pipeline stages, lead notes, lead tags, and saved views.
import express from 'express';

import { query } from '../../db.js';
import {
  logUserActivity,
  ActivityEventTypes,
  ActivityCategories
} from '../../services/activityLog.js';
import { logSecurityEvent } from '../../services/security/index.js';
import { isReservedTagName } from './_callHelpers.js';

const router = express.Router();

// server/index.js binds the port BEFORE the migration chain runs, so the notes endpoints can
// be hit before migrate_lead_notes_contact_unify adds lead_notes.contact_id — querying that
// column would 500 with undefined_column (42703). Memoize a one-time information_schema probe;
// once the column exists the flag latches true and costs nothing per request. A failed probe is
// treated as not-ready (re-checked next request). Mirrors ensureLeadRemovedCol() in calls.js.
let leadNotesContactColReady = false;
async function ensureLeadNotesContactCol() {
  if (leadNotesContactColReady) return;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'lead_notes' AND column_name = 'contact_id' LIMIT 1`
    );
    if (rows.length) leadNotesContactColReady = true;
  } catch {
    // Not-ready; leave the flag false so we re-probe on the next request.
  }
}

// =====================
// PIPELINE STAGES
// =====================

// GET /pipeline-stages - List all pipeline stages
router.get('/pipeline-stages', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const result = await query('SELECT * FROM lead_pipeline_stages WHERE owner_user_id = $1 ORDER BY position ASC', [targetUserId]);

    // If no stages exist, create default ones
    if (result.rows.length === 0) {
      const defaultStages = [
        { name: 'New Lead', color: '#6366f1', position: 0 },
        { name: 'Contacted', color: '#3b82f6', position: 1 },
        { name: 'Qualified', color: '#10b981', position: 2 },
        { name: 'Proposal Sent', color: '#f59e0b', position: 3 },
        { name: 'Won', color: '#22c55e', position: 4, is_won_stage: true },
        { name: 'Lost', color: '#ef4444', position: 5, is_lost_stage: true }
      ];

      for (const stage of defaultStages) {
        await query(
          `INSERT INTO lead_pipeline_stages (owner_user_id, name, color, position, is_won_stage, is_lost_stage)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [targetUserId, stage.name, stage.color, stage.position, stage.is_won_stage || false, stage.is_lost_stage || false]
        );
      }

      const newResult = await query('SELECT * FROM lead_pipeline_stages WHERE owner_user_id = $1 ORDER BY position ASC', [targetUserId]);
      return res.json({ stages: newResult.rows });
    }

    res.json({ stages: result.rows });
  } catch (err) {
    console.error('[pipeline-stages:list]', err);
    res.status(500).json({ message: 'Failed to fetch pipeline stages' });
  }
});

// POST /pipeline-stages - Create a new pipeline stage
router.post('/pipeline-stages', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { name, color, position, is_won_stage, is_lost_stage } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Stage name is required' });
  }

  try {
    // Get max position if not provided
    let pos = position;
    if (pos === undefined || pos === null) {
      const maxRes = await query('SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM lead_pipeline_stages WHERE owner_user_id = $1', [
        targetUserId
      ]);
      pos = maxRes.rows[0]?.next_pos || 0;
    }

    const result = await query(
      `INSERT INTO lead_pipeline_stages (owner_user_id, name, color, position, is_won_stage, is_lost_stage)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [targetUserId, name.trim(), color || '#6366f1', pos, is_won_stage || false, is_lost_stage || false]
    );

    res.json({ stage: result.rows[0] });
  } catch (err) {
    console.error('[pipeline-stages:create]', err);
    res.status(500).json({ message: 'Failed to create pipeline stage' });
  }
});

// PUT /pipeline-stages/:id - Update a pipeline stage
router.put('/pipeline-stages/:id', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id } = req.params;
  const { name, color, position, is_won_stage, is_lost_stage } = req.body;

  try {
    const fields = [];
    const params = [];
    let paramIndex = 1;

    if (name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      params.push(name.trim());
    }
    if (color !== undefined) {
      fields.push(`color = $${paramIndex++}`);
      params.push(color);
    }
    if (position !== undefined) {
      fields.push(`position = $${paramIndex++}`);
      params.push(position);
    }
    if (is_won_stage !== undefined) {
      fields.push(`is_won_stage = $${paramIndex++}`);
      params.push(is_won_stage);
    }
    if (is_lost_stage !== undefined) {
      fields.push(`is_lost_stage = $${paramIndex++}`);
      params.push(is_lost_stage);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    fields.push(`updated_at = NOW()`);
    params.push(id, targetUserId);

    const result = await query(
      `UPDATE lead_pipeline_stages SET ${fields.join(', ')} 
       WHERE id = $${paramIndex} AND owner_user_id = $${paramIndex + 1}
       RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Pipeline stage not found' });
    }

    res.json({ stage: result.rows[0] });
  } catch (err) {
    console.error('[pipeline-stages:update]', err);
    res.status(500).json({ message: 'Failed to update pipeline stage' });
  }
});

// DELETE /pipeline-stages/:id - Delete a pipeline stage
router.delete('/pipeline-stages/:id', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id } = req.params;

  try {
    // Clear stage from any calls using it — scoped by owner so a caller cannot
    // null another owner's call_logs.pipeline_stage_id by passing a stage id
    // they don't own. (The DELETE below is owner-scoped and 404s for non-owners,
    // but the clear above must not run cross-tenant on its own.)
    await query('UPDATE call_logs SET pipeline_stage_id = NULL WHERE pipeline_stage_id = $1 AND owner_user_id = $2', [id, targetUserId]);

    const result = await query('DELETE FROM lead_pipeline_stages WHERE id = $1 AND owner_user_id = $2 RETURNING id', [id, targetUserId]);

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Pipeline stage not found' });
    }

    res.json({ message: 'Pipeline stage deleted' });
  } catch (err) {
    console.error('[pipeline-stages:delete]', err);
    res.status(500).json({ message: 'Failed to delete pipeline stage' });
  }
});


// =====================
// LEAD NOTES (Communication Log)
// =====================

// GET /leads/:callId/notes - Get all notes for a lead
router.get('/leads/:callId/notes', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { callId } = req.params;

  try {
    // Notes are contact-level: resolve this call's contact_id and return ALL of the contact's
    // notes (added from any activity or the contact surface). Falls back to call-scoped notes
    // when the call has no contact_id, preserving the original behavior.
    const callRes = await query(
      'SELECT contact_id FROM call_logs WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2) LIMIT 1',
      [callId, targetUserId]
    );
    const contactId = callRes.rows[0]?.contact_id || null;

    // Pre-migration window: the contact-wide branch needs lead_notes.contact_id. If it isn't
    // there yet, return an empty list (notes appear once the migration lands) instead of 500-ing.
    await ensureLeadNotesContactCol();
    if (contactId && !leadNotesContactColReady) return res.json({ notes: [] });

    const result = contactId
      ? await query(
          `SELECT ln.*, u.first_name, u.last_name, u.email as author_email
           FROM lead_notes ln
           LEFT JOIN users u ON ln.author_id = u.id
           WHERE ln.owner_user_id = $1 AND ln.contact_id = $2
           ORDER BY ln.created_at DESC`,
          [targetUserId, contactId]
        )
      : await query(
          `SELECT ln.*, u.first_name, u.last_name, u.email as author_email
           FROM lead_notes ln
           LEFT JOIN users u ON ln.author_id = u.id
           WHERE ln.owner_user_id = $1 AND ln.call_id = $2
           ORDER BY ln.created_at DESC`,
          [targetUserId, callId]
        );

    const notes = result.rows.map((row) => ({
      ...row,
      author_name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.author_email || 'Unknown'
    }));

    // Audit the PHI read (note bodies) to the immutable trail. IDs + count only — no note bodies.
    await logSecurityEvent({ userId: req.user.id, eventType: 'lead_notes_read', eventCategory: 'contacts', success: true, details: { callId, contactId, ownerUserId: targetUserId, count: notes.length } });

    res.json({ notes });
  } catch (err) {
    console.error('[lead-notes:list]', err);
    res.status(500).json({ message: 'Failed to fetch lead notes' });
  }
});

// POST /leads/:callId/notes - Add a note to a lead
router.post('/leads/:callId/notes', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const authorId = req.user.id;
  const { callId } = req.params;
  const { body, note_type, metadata } = req.body;

  if (!body?.trim()) {
    return res.status(400).json({ message: 'Note body is required' });
  }

  try {
    // Verify the lead exists for this user, and grab its contact_id so the note is contact-linked
    // (so it surfaces on every activity for the same contact + the contact notes panel).
    const callRes = await query('SELECT call_id, contact_id FROM call_logs WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2)', [
      callId,
      targetUserId
    ]);

    if (!callRes.rows.length) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const contactId = callRes.rows[0].contact_id || null;

    const result = await query(
      `INSERT INTO lead_notes (owner_user_id, call_id, author_id, note_type, body, metadata, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [targetUserId, callId, authorId, note_type || 'note', body.trim(), metadata || {}, contactId]
    );

    // Get author info
    const userRes = await query('SELECT first_name, last_name, email FROM users WHERE id = $1', [authorId]);
    const user = userRes.rows[0] || {};

    logUserActivity({
      userId: req.user.id, actionType: ActivityEventTypes.ADD_LEAD_NOTE,
      actionCategory: ActivityCategories.LEAD, targetUserId,
      targetEntityType: 'lead', targetEntityId: req.params.callId,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], details: { callId: req.params.callId }
    }).catch(() => {});
    res.json({
      note: {
        ...result.rows[0],
        author_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unknown'
      }
    });
  } catch (err) {
    console.error('[lead-notes:create]', err);
    res.status(500).json({ message: 'Failed to add note' });
  }
});

// DELETE /leads/:callId/notes/:noteId - Delete a note
router.delete('/leads/:callId/notes/:noteId', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { callId, noteId } = req.params;

  try {
    // Scope the delete to THIS call's contact so a callId URL can't be used to delete an
    // unrelated tenant note. Resolve the call's contact_id first (owner-scoped), then delete
    // only when the note belongs to this call OR to the call's contact. contact_id may not
    // exist yet (pre-migration); ensureLeadNotesContactCol gates the contact_id predicate so
    // we never reference an undefined column.
    await ensureLeadNotesContactCol();
    const callRes = await query(
      'SELECT contact_id FROM call_logs WHERE call_id = $1 AND (owner_user_id = $2 OR user_id = $2) LIMIT 1',
      [callId, targetUserId]
    );
    const resolvedContactId = leadNotesContactColReady ? callRes.rows[0]?.contact_id || null : null;

    const result = leadNotesContactColReady
      ? await query(
          `DELETE FROM lead_notes
            WHERE id = $1 AND owner_user_id = $2
              AND (call_id = $3 OR ($4::uuid IS NOT NULL AND contact_id = $4))
            RETURNING id`,
          [noteId, targetUserId, callId, resolvedContactId]
        )
      : await query(
          'DELETE FROM lead_notes WHERE id = $1 AND owner_user_id = $2 AND call_id = $3 RETURNING id',
          [noteId, targetUserId, callId]
        );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Note not found' });
    }

    res.json({ message: 'Note deleted' });
  } catch (err) {
    console.error('[lead-notes:delete]', err);
    res.status(500).json({ message: 'Failed to delete note' });
  }
});

// =====================
// LEAD TAGS
// =====================

// GET /lead-tags - Get all tags for this user
router.get('/lead-tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const result = await query('SELECT * FROM lead_tags WHERE owner_user_id = $1 ORDER BY name ASC', [targetUserId]);
    res.json({ tags: result.rows });
  } catch (err) {
    console.error('[lead-tags:list]', err);
    res.status(500).json({ message: 'Failed to fetch tags' });
  }
});

// POST /lead-tags - Create a new tag
router.post('/lead-tags', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'Tag name is required' });
  }
  if (isReservedTagName(name)) {
    return res.status(400).json({ message: `“${name.trim()}” is a category, not a tag — pick a different name.` });
  }

  try {
    const result = await query(
      `INSERT INTO lead_tags (owner_user_id, name, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (owner_user_id, name) DO UPDATE SET color = EXCLUDED.color
       RETURNING *`,
      [targetUserId, name.trim(), color || '#6366f1']
    );
    res.json({ tag: result.rows[0] });
  } catch (err) {
    console.error('[lead-tags:create]', err);
    res.status(500).json({ message: 'Failed to create tag' });
  }
});

// DELETE /lead-tags/:id - Delete a tag
router.delete('/lead-tags/:id', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id } = req.params;

  try {
    await query('DELETE FROM lead_tags WHERE id = $1 AND owner_user_id = $2', [id, targetUserId]);
    res.json({ message: 'Tag deleted' });
  } catch (err) {
    console.error('[lead-tags:delete]', err);
    res.status(500).json({ message: 'Failed to delete tag' });
  }
});








// =====================
// SAVED VIEWS
// =====================

// GET /lead-views - Get saved views
router.get('/lead-views', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  try {
    const result = await query('SELECT * FROM lead_saved_views WHERE owner_user_id = $1 ORDER BY created_at DESC', [targetUserId]);
    res.json({ views: result.rows });
  } catch (err) {
    console.error('[lead-views:list]', err);
    res.status(500).json({ message: 'Failed to fetch saved views' });
  }
});

// POST /lead-views - Create a saved view
router.post('/lead-views', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { name, filters, is_default } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ message: 'View name is required' });
  }

  try {
    // If setting as default, clear other defaults
    if (is_default) {
      await query('UPDATE lead_saved_views SET is_default = FALSE WHERE owner_user_id = $1', [targetUserId]);
    }

    const result = await query(
      `INSERT INTO lead_saved_views (owner_user_id, name, filters, is_default)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [targetUserId, name.trim(), filters || {}, is_default || false]
    );

    res.json({ view: result.rows[0] });
  } catch (err) {
    console.error('[lead-views:create]', err);
    res.status(500).json({ message: 'Failed to create saved view' });
  }
});

// DELETE /lead-views/:id - Delete a saved view
router.delete('/lead-views/:id', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const { id } = req.params;

  try {
    const result = await query('DELETE FROM lead_saved_views WHERE id = $1 AND owner_user_id = $2 RETURNING id', [id, targetUserId]);

    if (!result.rows.length) {
      return res.status(404).json({ message: 'View not found' });
    }

    res.json({ message: 'View deleted' });
  } catch (err) {
    console.error('[lead-views:delete]', err);
    res.status(500).json({ message: 'Failed to delete view' });
  }
});


export default router;
