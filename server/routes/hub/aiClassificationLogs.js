// Hub AI classification log routes: fetch recent classification logs for an
// account and update an individual log's review state (admin only). Mounted by
// the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import {
  fetchAiClassificationLogs,
  updateAiClassificationLogReview
} from '../../services/aiClassificationLog.js';
import { isAdminOrEditor } from '../../middleware/roles.js';

const router = express.Router();

// GET /hub/ai-classification-logs/:userId - Fetch recent AI classification logs for an account (admin only)
router.get('/ai-classification-logs/:userId', isAdminOrEditor, async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 50,
      stage,
      sourceType,
      category,
      reviewStatus,
      callId,
      startDate,
      endDate
    } = req.query;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const result = await fetchAiClassificationLogs({
      ownerUserId: userId,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
      stage,
      sourceType,
      category,
      reviewStatus,
      callId,
      startDate,
      endDate
    });

    res.json(result);
  } catch (err) {
    console.error('[ai-classification-logs:get]', err);
    res.status(500).json({ message: 'Failed to fetch AI classification logs' });
  }
});

// PATCH /hub/ai-classification-logs/:id/review - Update review state for a classification log (admin only)
router.patch('/ai-classification-logs/:id/review', isAdminOrEditor, async (req, res) => {
  try {
    const entry = await updateAiClassificationLogReview(req.params.id, {
      reviewStatus: req.body?.reviewStatus,
      reviewNotes: req.body?.reviewNotes
    });

    if (!entry) {
      return res.status(404).json({ message: 'AI classification log not found' });
    }

    res.json({ entry });
  } catch (err) {
    console.error('[ai-classification-logs:review]', err);
    res.status(500).json({ message: 'Failed to update AI classification log review state' });
  }
});

export default router;
