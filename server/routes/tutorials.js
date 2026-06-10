/**
 * Tutorial Completion Routes
 *
 * Tracks which tutorials each user has completed.
 * Completion state is per-user and persists across devices.
 */

import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/tutorials/completions — return tutorial IDs the current user has completed
router.get('/completions', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT tutorial_id FROM user_tutorial_completions WHERE user_id = $1 ORDER BY completed_at ASC',
      [req.user.id]
    );
    res.json({ completions: rows.map((r) => r.tutorial_id) });
  } catch (err) {
    console.error('[tutorials] error fetching completions:', err.message);
    res.status(500).json({ message: 'Unable to load tutorial progress' });
  }
});

// POST /api/tutorials/:id/complete — mark a tutorial complete for the current user
router.post('/:id/complete', requireAuth, async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.length > 100) {
    return res.status(400).json({ message: 'Invalid tutorial ID' });
  }

  try {
    await query(
      `INSERT INTO user_tutorial_completions (user_id, tutorial_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, tutorial_id) DO NOTHING`,
      [req.user.id, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[tutorials] error marking complete:', err.message);
    res.status(500).json({ message: 'Unable to save tutorial progress' });
  }
});

export default router;
