import client from './client';

// ============================================================================
// Reviews CRUD
// ============================================================================

/**
 * Fetch reviews with filtering and pagination
 */
export function fetchReviews(params = {}) {
  return client.get('/reviews', { params }).then((res) => ({
    reviews: res.data.reviews || [],
    pagination: res.data.pagination || null
  }));
}

/**
 * Get review statistics
 */
export function fetchReviewStats(days = 30) {
  return client.get('/reviews/stats', { params: { days } }).then((res) => res.data);
}

/**
 * Get a single review with details
 */
export function fetchReview(reviewId) {
  return client.get(`/reviews/${reviewId}`).then((res) => res.data.review);
}

/**
 * Sync reviews from Google
 */
export function syncReviews(forceFullSync = false) {
  return client.post('/reviews/sync', { forceFullSync }).then((res) => res.data);
}

// ============================================================================
// Review Management
// ============================================================================

/**
 * Toggle flag status on a review
 */
export function toggleReviewFlag(reviewId, flagged, reason = null) {
  return client.put(`/reviews/${reviewId}/flag`, { flagged, reason }).then((res) => res.data.review);
}

/**
 * Update review priority
 */
export function updateReviewPriority(reviewId, priority) {
  return client.put(`/reviews/${reviewId}/priority`, { priority }).then((res) => res.data.review);
}

/**
 * Update internal notes on a review
 */
export function updateReviewNotes(reviewId, notes) {
  return client.put(`/reviews/${reviewId}/notes`, { notes }).then((res) => res.data.review);
}

// ============================================================================
// AI Response Generation
// ============================================================================

/**
 * Generate an AI-assisted response draft
 */
export function generateReviewResponse(reviewId, options = {}) {
  return client.post(`/reviews/${reviewId}/generate-response`, options).then((res) => res.data);
}

/**
 * Analyze sentiment of a review
 */
export function analyzeReviewSentiment(reviewId) {
  return client.post(`/reviews/${reviewId}/analyze-sentiment`).then((res) => res.data.sentiment);
}

// ============================================================================
// Response Management
// ============================================================================

/**
 * Send a response to a review
 */
export function sendReviewResponse(reviewId, responseText) {
  return client.post(`/reviews/${reviewId}/send-response`, { responseText }).then((res) => res.data);
}

/**
 * Update a draft's text
 */
export function updateDraft(draftId, text) {
  return client.put(`/reviews/drafts/${draftId}`, { text }).then((res) => res.data.draft);
}

/**
 * Approve a draft
 */
export function approveDraft(draftId) {
  return client.post(`/reviews/drafts/${draftId}/approve`).then((res) => res.data.draft);
}

/**
 * Discard a draft
 */
export function discardDraft(draftId, notes = null) {
  return client.post(`/reviews/drafts/${draftId}/discard`, { notes }).then((res) => res.data.draft);
}

/**
 * Send an approved draft
 */
export function sendDraft(draftId) {
  return client.post(`/reviews/drafts/${draftId}/send`).then((res) => res.data);
}

// ============================================================================
// Review Requests
// ============================================================================

/**
 * Fetch review requests
 */
export function fetchReviewRequests(params = {}) {
  return client.get('/reviews/requests', { params }).then((res) => ({
    requests: res.data.requests || [],
    pagination: res.data.pagination || null
  }));
}

/**
 * Create a review request
 */
export function createReviewRequest(data) {
  return client.post('/reviews/requests', data).then((res) => res.data.request);
}

/**
 * Get a single review request
 */
export function fetchReviewRequest(requestId) {
  return client.get(`/reviews/requests/${requestId}`).then((res) => res.data.request);
}

// ============================================================================
// OAuth Connection Status
// ============================================================================

/**
 * Get OAuth connection status for Google Business Profile
 * Returns whether the client has connected their account and their locations
 */
export function fetchConnectionStatus() {
  return client.get('/reviews/connection-status').then((res) => res.data);
}

// ============================================================================
// Locations
// ============================================================================

/**
 * Get Google Business locations from oauth_resources
 */
export function fetchReviewLocations() {
  return client.get('/reviews/locations').then((res) => res.data.locations || []);
}

/**
 * Refresh locations from Google API
 */
export function refreshReviewLocations() {
  return client.post('/reviews/locations/refresh').then((res) => res.data);
}

// ============================================================================
// Settings
// ============================================================================

/**
 * Get review settings
 */
export function fetchReviewSettings() {
  return client.get('/reviews/settings').then((res) => res.data.settings);
}

/**
 * Update review settings
 */
export function updateReviewSettings(settings) {
  return client.put('/reviews/settings', settings).then((res) => res.data.settings);
}

// ============================================================================
// Automation Rules
// ============================================================================

/**
 * Fetch automation rules
 */
export function fetchAutomationRules() {
  return client.get('/reviews/automation-rules').then((res) => res.data.rules || []);
}

/**
 * Create an automation rule
 */
export function createAutomationRule(data) {
  return client.post('/reviews/automation-rules', data).then((res) => res.data.rule);
}

/**
 * Update an automation rule
 */
export function updateAutomationRule(ruleId, data) {
  return client.put(`/reviews/automation-rules/${ruleId}`, data).then((res) => res.data.rule);
}

/**
 * Delete an automation rule
 */
export function deleteAutomationRule(ruleId) {
  return client.delete(`/reviews/automation-rules/${ruleId}`).then((res) => res.data);
}

// ============================================================================
// Automation Logs
// ============================================================================

/**
 * Fetch automation logs
 */
export function fetchAutomationLogs(params = {}) {
  return client.get('/reviews/automation-logs', { params }).then((res) => ({
    logs: res.data.logs || [],
    pagination: res.data.pagination || null
  }));
}

// ============================================================================
// Helper Constants
// ============================================================================

export const REVIEW_PRIORITIES = [
  { value: 'low', label: 'Low', color: '#9ca3af' },
  { value: 'normal', label: 'Normal', color: '#6b7280' },
  { value: 'high', label: 'High', color: '#f59e0b' },
  { value: 'urgent', label: 'Urgent', color: '#ef4444' }
];

export const SENTIMENT_LABELS = [
  { value: 'positive', label: 'Positive', color: '#22c55e' },
  { value: 'neutral', label: 'Neutral', color: '#6b7280' },
  { value: 'negative', label: 'Negative', color: '#ef4444' },
  { value: 'mixed', label: 'Mixed', color: '#f59e0b' }
];

export const RESPONSE_TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'empathetic', label: 'Empathetic' }
];

export const DELIVERY_METHODS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'link_only', label: 'Link Only (Copy)' }
];

export const REQUEST_STATUSES = [
  { value: 'pending', label: 'Pending', color: '#f59e0b' },
  { value: 'sent', label: 'Sent', color: '#3b82f6' },
  { value: 'delivered', label: 'Delivered', color: '#8b5cf6' },
  { value: 'opened', label: 'Opened', color: '#06b6d4' },
  { value: 'clicked', label: 'Clicked', color: '#22c55e' },
  { value: 'completed', label: 'Completed', color: '#10b981' },
  { value: 'failed', label: 'Failed', color: '#ef4444' },
  { value: 'bounced', label: 'Bounced', color: '#dc2626' }
];

/**
 * Get color for a rating
 */
export function getRatingColor(rating) {
  if (rating >= 4) return '#22c55e'; // green
  if (rating === 3) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

/**
 * Get priority config by value
 */
export function getPriorityConfig(value) {
  return REVIEW_PRIORITIES.find((p) => p.value === value) || REVIEW_PRIORITIES[1];
}

/**
 * Get sentiment config by value
 */
export function getSentimentConfig(value) {
  return SENTIMENT_LABELS.find((s) => s.value === value) || SENTIMENT_LABELS[1];
}

