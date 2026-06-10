import { query } from '../db.js';
import { sendMailgunMessage, isMailgunConfigured } from './mailgun.js';

const ADMIN_FALLBACK_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL;

export async function createNotification({ userId, title, body, linkUrl, meta = {}, email = true }) {
  if (!userId || !title) return null;
  const { rows } = await query(
    `INSERT INTO notifications (user_id, title, body, link_url, meta)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, title, body || null, linkUrl || null, JSON.stringify(meta || {})]
  );
  const notification = rows[0];
  // In-app notification is always created; the email relay is opt-out per call
  // (set `email: false`) so noisy/low-value notifications can stay in-app only.
  // The relay is best-effort — a delivery failure must not fail (and retry) the
  // already-persisted in-app notification.
  if (email) {
    try {
      await emailNotificationToUser(userId, notification);
    } catch (err) {
      console.warn('[notifications] email relay failed', { userId, notificationId: notification?.id, error: err?.message });
    }
  }
  return notification;
}

export async function createNotificationsForAdmins(payload) {
  // Prefer superadmins; if none exist, fall back to admins.
  let { rows } = await query("SELECT id FROM users WHERE role = 'superadmin'");
  if (!rows.length) {
    ({ rows } = await query("SELECT id FROM users WHERE role = 'admin'"));
  }
  await Promise.all(rows.map((admin) => createNotification({ ...payload, userId: admin.id })));
  return rows;
}

export async function fetchUserNotifications(userId, limit = 25) {
  const { rows } = await query(
    `SELECT id, title, body, link_url, status, meta, created_at, read_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  const unreadCount = await getUnreadCount(userId);
  return { notifications: rows, unread: unreadCount };
}

export async function getUnreadCount(userId) {
  const { rows } = await query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND status = $2', [
    userId,
    'unread'
  ]);
  return Number(rows[0]?.count || 0);
}

export async function markNotificationRead(userId, notificationId) {
  await query(
    `UPDATE notifications
     SET status = 'read', read_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );
}

export async function markAllNotificationsRead(userId) {
  await query(
    `UPDATE notifications
     SET status = 'read', read_at = NOW()
     WHERE user_id = $1 AND status = 'unread'`,
    [userId]
  );
}

export async function notifyAdminsByEmail({ subject, text, html }) {
  if (!isMailgunConfigured()) return;
  // Prefer superadmins; if none exist, fall back to admins.
  let rows = (await query("SELECT email FROM users WHERE role = 'superadmin' AND email IS NOT NULL")).rows;
  if (!rows.length) {
    rows = (await query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL")).rows;
  }
  const recipients = rows.map((row) => row.email).filter(Boolean);
  if (!recipients.length && ADMIN_FALLBACK_EMAIL) {
    recipients.push(ADMIN_FALLBACK_EMAIL);
  }
  if (!recipients.length) return;
  await sendMailgunMessage({
    to: recipients,
    subject,
    text,
    html
  });
}

async function emailNotificationToUser(userId, notification) {
  if (!isMailgunConfigured()) return;
  const { rows } = await query('SELECT email, first_name, last_name FROM users WHERE id = $1 LIMIT 1', [userId]);
  const user = rows[0];
  if (!user?.email) return;
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.email.split('@')[0] || 'there';
  const subject = `Anchor Hub Notification: ${notification.title}`;
  const bodyText = `${name},\n\n${notification.body || notification.title}\n\n${
    notification.link_url ? `View: ${notification.link_url}\n\n` : ''
  }- Anchor Hub`;
  const bodyHtml = `<p>Hi ${name},</p>
<p>${notification.body || notification.title}</p>
${notification.link_url ? `<p><a href="${notification.link_url}" target="_blank" rel="noopener">View details</a></p>` : ''}
<p>- Anchor Hub</p>`;
  await sendMailgunMessage({
    to: [user.email],
    subject,
    text: bodyText,
    html: bodyHtml
  });
}
