import client from './client';

/**
 * Fetch paginated user activity logs
 * @param {string} userId - User ID to fetch logs for
 * @param {Object} params - Query parameters
 * @param {number} params.page - Page number (default: 1)
 * @param {number} params.limit - Items per page (default: 50)
 * @param {string} params.search - Search in action type and details
 * @param {string} params.category - Filter by category
 * @param {string} params.actionType - Filter by action type
 * @param {string} params.startDate - Filter from date (ISO string)
 * @param {string} params.endDate - Filter to date (ISO string)
 * @returns {Promise<{logs: Array, pagination: Object}>}
 */
export function fetchUserActivityLogs(userId, params = {}) {
  const queryParams = new URLSearchParams();

  if (params.page) queryParams.append('page', params.page);
  if (params.limit) queryParams.append('limit', params.limit);
  if (params.search) queryParams.append('search', params.search);
  if (params.category && params.category !== 'all') queryParams.append('category', params.category);
  if (params.actionType && params.actionType !== 'all') queryParams.append('actionType', params.actionType);
  if (params.startDate) queryParams.append('startDate', params.startDate);
  if (params.endDate) queryParams.append('endDate', params.endDate);
  if (params.scope) queryParams.append('scope', params.scope);

  const queryString = queryParams.toString();
  const url = queryString
    ? `/hub/user-activity-logs/${userId}?${queryString}`
    : `/hub/user-activity-logs/${userId}`;

  return client.get(url).then((res) => res.data);
}

export function fetchAiClassificationLogs(userId, params = {}) {
  const queryParams = new URLSearchParams();

  if (params.page) queryParams.append('page', params.page);
  if (params.limit) queryParams.append('limit', params.limit);
  if (params.stage && params.stage !== 'all') queryParams.append('stage', params.stage);
  if (params.sourceType && params.sourceType !== 'all') queryParams.append('sourceType', params.sourceType);
  if (params.category && params.category !== 'all') queryParams.append('category', params.category);
  if (params.reviewStatus && params.reviewStatus !== 'all') queryParams.append('reviewStatus', params.reviewStatus);
  if (params.callId) queryParams.append('callId', params.callId);
  if (params.startDate) queryParams.append('startDate', params.startDate);
  if (params.endDate) queryParams.append('endDate', params.endDate);

  const queryString = queryParams.toString();
  const url = queryString
    ? `/hub/ai-classification-logs/${userId}?${queryString}`
    : `/hub/ai-classification-logs/${userId}`;

  return client.get(url).then((res) => res.data);
}

export function updateAiClassificationLogReview(id, payload = {}) {
  return client.patch(`/hub/ai-classification-logs/${id}/review`, payload).then((res) => res.data);
}

/**
 * Log a page view for the current user (fire-and-forget)
 * @param {string} page - The page path being viewed
 * @returns {Promise<void>}
 */
export function logPageView(page) {
  return client.post('/hub/activity/page-view', { page }).catch(() => {});
}

/**
 * Action type labels for display
 */
export const ACTION_TYPE_LABELS = {
  // Authentication
  login: 'Logged In',
  logout: 'Logged Out',

  // Client operations
  view_client: 'Viewed Client',
  edit_client: 'Edited Client',
  create_client: 'Created Client',
  delete_client: 'Deleted Client',
  activate_client: 'Activated Client',

  // Task operations
  view_task: 'Viewed Task',
  create_task: 'Created Task',
  update_task: 'Updated Task',
  complete_task: 'Completed Task',
  delete_task: 'Deleted Task',

  // Document operations
  upload_document: 'Uploaded Document',
  view_document: 'Viewed Document',
  delete_document: 'Deleted Document',

  // Form operations
  view_form: 'Viewed Form',
  submit_form: 'Submitted Form',
  create_form: 'Created Form',
  edit_form: 'Edited Form',
  delete_form: 'Deleted Form',

  // Review operations
  view_review: 'Viewed Review',
  respond_review: 'Responded to Review',

  // Admin operations
  impersonate_start: 'Started Impersonation',
  impersonate_end: 'Ended Impersonation',
  export_data: 'Exported Data',

  // Navigation
  page_view: 'Viewed Page',

  // Team operations
  invite_team_member: 'Invited Team Member',
  remove_team_member: 'Removed Team Member',
  leave_team: 'Left Team',

  // Settings
  update_notification_settings: 'Updated Notification Settings',

  // Additional form operations
  publish_form: 'Published Form',
  archive_form: 'Archived Form',
  duplicate_form: 'Duplicated Form'
};

/**
 * Category labels for display
 */
export const CATEGORY_LABELS = {
  authentication: 'Authentication',
  client: 'Client',
  task: 'Task',
  document: 'Document',
  form: 'Form',
  review: 'Review',
  admin: 'Admin',
  team: 'Team',
  navigation: 'Navigation'
};

export const AI_CLASSIFICATION_STAGE_LABELS = {
  ctm_sync: 'CTM Sync',
  form_submission: 'Form Submission',
  twilio_transcription: 'Twilio Transcription',
  reclassify: 'Reclassify'
};

export const AI_CLASSIFICATION_REVIEW_STATUS_LABELS = {
  new: 'New',
  flagged: 'Flagged',
  reviewed: 'Reviewed',
  ignored: 'Ignored'
};

/**
 * Map internal classifier labels (what the AI emits, what's stored in
 * call_logs.meta.category and ai_classification_logs.final_category) to
 * the canonical 5 user-facing categories plus pending_review.
 * Used by getLeadCategoryLabel so admin chips never expose internal labels.
 */
const INTERNAL_TO_CANONICAL_LEAD_CATEGORY = {
  warm: 'lead',
  very_good: 'lead',
  good: 'lead',
  hot: 'lead',
  very_hot: 'lead',
  'very-hot': 'lead',
  neutral: 'lead',
  converted: 'lead',
  active_client: 'lead',
  returning_customer: 'lead',
  needs_attention: 'needs_attention',
  unanswered: 'unanswered',
  voicemail: 'unanswered',
  not_a_fit: 'not_a_fit',
  applicant: 'not_a_fit',
  spam: 'spam',
  unreviewed: 'pending_review',
  pending_review: 'pending_review',
  lead: 'lead'
};

export const LEAD_CATEGORY_LABELS = {
  lead: 'New',
  needs_attention: 'Priority',
  unanswered: 'Unanswered',
  not_a_fit: 'Not a Fit',
  spam: 'Spam',
  pending_review: 'Pending Review'
};

/**
 * Category color mapping (MUI chip colors)
 */
export const CATEGORY_COLORS = {
  authentication: 'info',
  client: 'primary',
  task: 'success',
  document: 'secondary',
  form: 'warning',
  review: 'default',
  admin: 'error',
  team: 'primary',
  navigation: 'default'
};

/**
 * Get human-readable label for an action type
 * @param {string} actionType - The action type
 * @returns {string} Human-readable label
 */
export function getActionLabel(actionType) {
  return ACTION_TYPE_LABELS[actionType] || actionType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Get human-readable label for a category
 * @param {string} category - The category
 * @returns {string} Human-readable label
 */
export function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Get chip color for a category
 * @param {string} category - The category
 * @returns {string} MUI chip color
 */
export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || 'default';
}

export function getAiClassificationStageLabel(stage) {
  return AI_CLASSIFICATION_STAGE_LABELS[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function getAiClassificationReviewStatusLabel(status) {
  return AI_CLASSIFICATION_REVIEW_STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Get the user-facing label for a lead category. Internal classifier labels
 * (warm, very_good, neutral, applicant, unreviewed, ...) are normalized to
 * the canonical 5+pending set before lookup, so callers never need to know
 * which internal label is in play.
 */
export function getLeadCategoryLabel(category) {
  if (!category) return '';
  const normalized = String(category).toLowerCase();
  const canonical = INTERNAL_TO_CANONICAL_LEAD_CATEGORY[normalized] || normalized;
  if (LEAD_CATEGORY_LABELS[canonical]) return LEAD_CATEGORY_LABELS[canonical];
  return category.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Get the canonical lead category key (lead | needs_attention | unanswered |
 * not_a_fit | spam | pending_review) for any internal classifier label or
 * already-canonical value. Use this whenever you need to look up something
 * keyed by canonical category (e.g. chip color) starting from a row's
 * stored final_category, which may be either internal or canonical.
 */
export function getLeadCategoryCanonical(category) {
  if (!category) return '';
  const normalized = String(category).toLowerCase();
  return INTERNAL_TO_CANONICAL_LEAD_CATEGORY[normalized] || normalized;
}

/**
 * Format activity details for display
 * @param {Object} log - Activity log entry
 * @returns {string} Formatted details string
 */
export function formatActivityDetails(log) {
  const details = log.details || {};
  const parts = [];

  // Add target user info if present
  if (log.target_user_email) {
    parts.push(`Client: ${log.target_user_first_name || ''} ${log.target_user_last_name || ''} (${log.target_user_email})`.trim());
  }

  // Add entity info
  if (details.taskName) {
    parts.push(`Task: ${details.taskName}`);
  }
  if (details.formName) {
    parts.push(`Form: ${details.formName}`);
  }
  if (details.documentName) {
    parts.push(`Document: ${details.documentName}`);
  }

  // Add other non-sensitive details
  const skipKeys = ['taskName', 'formName', 'documentName', 'formId'];
  for (const [key, value] of Object.entries(details)) {
    if (!skipKeys.includes(key) && value && typeof value !== 'object') {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      parts.push(`${label}: ${value}`);
    }
  }

  return parts.join(' | ') || '-';
}
