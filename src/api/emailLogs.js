import client from './client';

/**
 * Fetch paginated email logs with optional filters
 * @param {Object} params - Query parameters
 * @param {number} params.page - Page number (default: 1)
 * @param {number} params.limit - Items per page (default: 50)
 * @param {string} params.emailType - Filter by email type
 * @param {string} params.status - Filter by status (pending, sent, failed)
 * @param {string} params.search - Search in recipient email/name/subject
 * @param {string} params.dateFrom - Filter from date (ISO string)
 * @param {string} params.dateTo - Filter to date (ISO string)
 * @returns {Promise<{logs: Array, pagination: Object}>}
 */
export function fetchEmailLogs(params = {}) {
  const queryParams = new URLSearchParams();
  
  if (params.page) queryParams.append('page', params.page);
  if (params.limit) queryParams.append('limit', params.limit);
  if (params.emailType && params.emailType !== 'all') queryParams.append('email_type', params.emailType);
  if (params.status && params.status !== 'all') queryParams.append('status', params.status);
  if (params.search) queryParams.append('search', params.search);
  if (params.dateFrom) queryParams.append('date_from', params.dateFrom);
  if (params.dateTo) queryParams.append('date_to', params.dateTo);
  
  const queryString = queryParams.toString();
  const url = queryString ? `/hub/email-logs?${queryString}` : '/hub/email-logs';
  
  return client.get(url).then((res) => res.data);
}

/**
 * Fetch a single email log with full details
 * @param {string} id - Email log ID
 * @returns {Promise<Object>}
 */
export function fetchEmailLogDetail(id) {
  return client.get(`/hub/email-logs/${id}`).then((res) => res.data);
}

/**
 * Fetch email statistics
 * @param {number} days - Number of days to include (default: 30)
 * @returns {Promise<{stats: Array}>}
 */
export function fetchEmailStats(days = 30) {
  return client.get(`/hub/email-logs/stats?days=${days}`).then((res) => res.data);
}

/**
 * Email type labels for display
 */
export const EMAIL_TYPE_LABELS = {
  test: 'Test Email',
  onboarding_invite: 'Onboarding Invite',
  onboarding_complete: 'Onboarding Complete',
  onboarding_reminder: 'Onboarding Reminder',
  password_reset: 'Password Reset',
  account_activated: 'Account Activated',
  document_review: 'Document Review',
  blog_notification: 'Blog Notification',
  rush_job: 'Rush Job',
  form_submission: 'Form Submission',
  unknown: 'Other'
};

/**
 * Status color mapping
 */
export const STATUS_COLORS = {
  pending: { color: 'warning', label: 'Pending' },
  sent: { color: 'info', label: 'Sent' },
  delivered: { color: 'success', label: 'Delivered' },
  failed: { color: 'error', label: 'Failed' },
  bounced: { color: 'error', label: 'Bounced' },
  complained: { color: 'error', label: 'Spam Complaint' }
};

/**
 * Get the best status for display (prioritize delivery over sent)
 */
export function getEffectiveStatus(log) {
  if (log.bounced_at) return 'bounced';
  if (log.complained_at) return 'complained';
  if (log.status === 'failed') return 'failed';
  if (log.delivered_at) return 'delivered';
  if (log.sent_at || log.status === 'sent') return 'sent';
  return log.status || 'pending';
}

/**
 * Tracking event icons and labels
 */
export const TRACKING_EVENTS = {
  delivered: { label: 'Delivered', icon: 'CheckCircle', color: 'success' },
  opened: { label: 'Opened', icon: 'Visibility', color: 'info' },
  clicked: { label: 'Clicked', icon: 'TouchApp', color: 'primary' },
  bounced: { label: 'Bounced', icon: 'Error', color: 'error' },
  complained: { label: 'Spam Report', icon: 'Report', color: 'error' },
  unsubscribed: { label: 'Unsubscribed', icon: 'Unsubscribe', color: 'warning' }
};

