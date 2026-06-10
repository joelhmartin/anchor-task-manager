// Hub analytics route: returns the client's configured Looker Studio URL.
// Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import { query } from '../../db.js';

const router = express.Router();

router.get('/analytics', async (req, res) => {
  const targetUserId = req.portalUserId || req.user.id;
  const profile = await query('SELECT looker_url FROM client_profiles WHERE user_id=$1', [targetUserId]);
  res.json({ looker_url: profile.rows[0]?.looker_url || null });
});

export default router;
