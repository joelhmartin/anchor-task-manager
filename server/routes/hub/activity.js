// Hub activity routes: log client-side page views and fetch user activity logs
// (admin only). Mounted by the hub.js aggregator AFTER `router.use(requireAuth)`.
import express from 'express';

import {
  logUserActivity,
  fetchActivityLogs,
  ActivityEventTypes,
  ActivityCategories
} from '../../services/activityLog.js';
import { isAdminOrEditor } from '../../middleware/roles.js';

const router = express.Router();

// GET /hub/user-activity-logs/:userId - Fetch activity logs for a user (admin only)
router.get('/user-activity-logs/:userId', isAdminOrEditor, async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 50,
      search,
      category,
      actionType,
      startDate,
      endDate
    } = req.query;

    // Validate userId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const fetchOptions = {
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100), // Cap at 100
      search,
      category,
      actionType,
      startDate,
      endDate
    };

    if (req.query.scope === 'account') {
      fetchOptions.accountOwnerId = userId;
    } else {
      fetchOptions.userId = userId;
    }

    const result = await fetchActivityLogs(fetchOptions);

    res.json(result);
  } catch (err) {
    console.error('[user-activity-logs:get]', err);
    res.status(500).json({ message: 'Failed to fetch activity logs' });
  }
});

// POST /hub/activity/page-view — log client-side page navigation
router.post('/activity/page-view', async (req, res) => {
  const { page } = req.body;
  if (!page || typeof page !== 'string') return res.status(400).json({ error: 'Missing page' });

  // Truncate to prevent abuse
  const safePage = page.slice(0, 200);

  logUserActivity({
    userId: req.user.id,
    actionType: ActivityEventTypes.PAGE_VIEW,
    actionCategory: ActivityCategories.NAVIGATION,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: { page: safePage }
  }).catch(() => {});

  res.json({ ok: true });
});

export default router;
