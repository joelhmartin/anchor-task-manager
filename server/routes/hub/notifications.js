// Hub notification routes: list the current user's notifications and mark
// individual / all notifications as read. Mounted by the hub.js aggregator
// AFTER `router.use(requireAuth)`, so no auth guard is needed here.
import express from 'express';

import {
  fetchUserNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from '../../services/notifications.js';

const router = express.Router();

router.get('/notifications', async (req, res) => {
  const effRole = req.user?.effective_role || req.user?.role;
  const isStaffRole = effRole === 'superadmin' || effRole === 'admin' || effRole === 'team';
  // Staff should always see their own notifications (even if a portal/impersonation context exists).
  const userId = isStaffRole ? req.user.id : req.portalUserId || req.user.id;
  try {
    const { notifications, unread } = await fetchUserNotifications(userId, Number(req.query.limit) || 25);
    res.json({ notifications, unread });
  } catch (err) {
    console.error('[notifications:list]', err);
    res.status(500).json({ message: 'Unable to load notifications' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  const effRole = req.user?.effective_role || req.user?.role;
  const isStaffRole = effRole === 'superadmin' || effRole === 'admin' || effRole === 'team';
  const userId = isStaffRole ? req.user.id : req.portalUserId || req.user.id;
  const notificationId = req.params.id;
  try {
    await markNotificationRead(userId, notificationId);
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('[notifications:read]', err);
    res.status(500).json({ message: 'Unable to mark notification as read' });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  const effRole = req.user?.effective_role || req.user?.role;
  const isStaffRole = effRole === 'superadmin' || effRole === 'admin' || effRole === 'team';
  const userId = isStaffRole ? req.user.id : req.portalUserId || req.user.id;
  try {
    await markAllNotificationsRead(userId);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('[notifications:read-all]', err);
    res.status(500).json({ message: 'Unable to mark notifications as read' });
  }
});

export default router;
