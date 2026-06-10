// Hub internal-users route: list internal staff users for pickers/assignment.
// Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';
import { isAdminOrEditor } from '../../middleware/roles.js';

const router = express.Router();

router.get('/internal-users', isAdminOrEditor, async (_req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, first_name, last_name, role, avatar_url
         FROM users
        WHERE role IN ('superadmin','admin','team','editor')
        ORDER BY COALESCE(first_name, email) ASC`
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[internal-users]', err);
    res.status(500).json({ message: err.message || 'Unable to load internal users' });
  }
});

export default router;
