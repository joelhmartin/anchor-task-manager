/**
 * Production health checks — manual run + latest results. Superadmin only.
 */
import express from 'express';
import { query } from '../db.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { runAllHealthChecks } from '../services/health/runner.js';

const router = express.Router();

// Run all checks now (does NOT email — manual runs are interactive).
router.post('/run', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const summary = await runAllHealthChecks({ trigger: 'manual' });
    res.json(summary);
  } catch (err) {
    console.error('[health/run]', err?.message);
    res.status(500).json({ message: 'Health run failed' });
  }
});

// Latest run's results, grouped by run_id (most recent run).
router.get('/latest', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM system_health_checks
        WHERE run_id = (SELECT run_id FROM system_health_checks ORDER BY created_at DESC LIMIT 1)
        ORDER BY category, check_id`
    );
    res.json({ run_id: rows[0]?.run_id || null, results: rows });
  } catch (err) {
    console.error('[health/latest]', err?.message);
    res.status(500).json({ message: 'Failed to load latest health run' });
  }
});

export default router;
