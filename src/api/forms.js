/**
 * Forms API Client
 *
 * Functions for managing forms, presets, and submissions.
 */

import client from './client';

// ==========================
// Form Management
// ==========================

/**
 * List forms for a client
 * @param {string} [clientId] - Optional client ID (admin viewing another client)
 * @param {Object} [options] - { status?: 'draft' | 'published' | 'archived' }
 * @returns {Promise<Array>}
 */
export function listForms(clientId, options = {}) {
  const params = { ...options };
  if (clientId) params.clientId = clientId;
  return client.get('/forms', { params }).then((res) => res.data.forms || []);
}

/**
 * Get form details
 * @param {string} formId - Form ID
 * @returns {Promise<Object>}
 */
export function getForm(formId) {
  return client.get(`/forms/${formId}`).then((res) => res.data.form);
}

/**
 * Create a new form
 * @param {string} clientId - Client user ID
 * @param {Object} config - { name, description?, formType, presetId?, schemaJson?, settings? }
 * @returns {Promise<Object>}
 */
export function createForm(clientId, config) {
  return client.post('/forms', { clientId, ...config }).then((res) => res.data.form);
}

/**
 * Update form details
 * @param {string} formId - Form ID
 * @param {Object} updates - { name?, description?, settings_json? }
 * @returns {Promise<Object>}
 */
export function updateForm(formId, updates) {
  return client.put(`/forms/${formId}`, updates).then((res) => res.data.form);
}

/**
 * Save draft schema (without publishing)
 * @param {string} formId - Form ID
 * @param {Object} schemaJson - { fields, submitLabel?, style? }
 * @returns {Promise<Object>}
 */
export function saveDraftSchema(formId, schemaJson) {
  return client.put(`/forms/${formId}/draft`, { schemaJson }).then((res) => res.data.form);
}

/**
 * Archive a form
 * @param {string} formId - Form ID
 * @returns {Promise<Object>}
 */
export function archiveForm(formId) {
  return client.delete(`/forms/${formId}`).then((res) => res.data);
}

/**
 * Publish a form version
 * @param {string} formId - Form ID
 * @param {Object} versionData - { reactCode?, schemaJson, cssCode? }
 * @returns {Promise<Object>}
 */
export function publishForm(formId, versionData) {
  return client.post(`/forms/${formId}/publish`, versionData).then((res) => res.data);
}

/**
 * Get form version history
 * @param {string} formId - Form ID
 * @returns {Promise<Array>}
 */
export function getFormVersions(formId) {
  return client.get(`/forms/${formId}/versions`).then((res) => res.data.versions || []);
}

// ==========================
// Form Submissions
// ==========================

/**
 * List submissions for a form
 * @param {string} formId - Form ID
 * @param {Object} [options] - { limit?, offset?, dateFrom?, dateTo? }
 * @returns {Promise<Array>}
 */
export function listFormSubmissions(formId, options = {}) {
  return client.get(`/forms/${formId}/submissions`, { params: options }).then((res) => res.data.submissions || []);
}

/**
 * Get submission detail (includes decrypted PHI for authorized users)
 * @param {string} submissionId - Submission ID
 * @returns {Promise<Object>}
 */
export function getSubmissionDetail(submissionId) {
  return client.get(`/forms/submissions/${submissionId}`).then((res) => res.data.submission);
}

// ==========================
// Form Presets
// ==========================

/**
 * List all form presets
 * @param {Object} [options] - { category?, formType? }
 * @returns {Promise<Array>}
 */
export function listFormPresets(options = {}) {
  return client.get('/forms/presets', { params: options }).then((res) => res.data.presets || []);
}

/**
 * Create a new form preset (admin only)
 * @param {Object} preset - { name, description?, category?, formType?, schemaJson?, reactCode?, cssCode? }
 * @returns {Promise<Object>}
 */
export function createFormPreset(preset) {
  return client.post('/forms/presets', preset).then((res) => res.data.preset);
}

/**
 * Update a form preset (admin only, non-system presets)
 * @param {string} presetId - Preset ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>}
 */
export function updateFormPreset(presetId, updates) {
  return client.put(`/forms/presets/${presetId}`, updates).then((res) => res.data.preset);
}

/**
 * Delete a form preset (admin only, non-system presets)
 * @param {string} presetId - Preset ID
 * @returns {Promise<Object>}
 */
export function deleteFormPreset(presetId) {
  return client.delete(`/forms/presets/${presetId}`).then((res) => res.data);
}

// ==========================
// CTM FormReactor Integration
// ==========================

/**
 * List CTM FormReactors for a form's client
 */
export function listCtmReactors(formId) {
  return client.get(`/forms/${formId}/ctm/reactors`).then((res) => res.data.reactors || []);
}

/**
 * Create a CTM FormReactor from form schema
 */
export function createCtmReactor(formId, trackingNumberId) {
  return client.post(`/forms/${formId}/ctm/reactor`, { trackingNumberId }).then((res) => res.data);
}

/**
 * Link form to an existing CTM FormReactor
 */
export function linkCtmReactor(formId, reactorId) {
  return client.post(`/forms/${formId}/ctm/link`, { reactorId }).then((res) => res.data);
}

/**
 * List CTM custom fields for a form's client
 */
export function listCtmCustomFields(formId) {
  return client.get(`/forms/${formId}/ctm/custom-fields`).then((res) => res.data.customFields || []);
}

/**
 * List CTM tracking numbers for a form's client
 */
export function listCtmTrackingNumbers(formId) {
  return client.get(`/forms/${formId}/ctm/numbers`).then((res) => res.data.numbers || []);
}

/**
 * Disable CTM integration for a form
 */
export function disableCtmIntegration(formId) {
  return client.delete(`/forms/${formId}/ctm`).then((res) => res.data);
}

// ==========================
// Notification Overrides
// ==========================

/**
 * Get notification config for a form
 */
export function getNotificationOverride(formId) {
  return client.get(`/forms/${formId}/notifications`).then((res) => res.data.override);
}

/**
 * Create/update notification config for a form
 */
export function upsertNotificationOverride(formId, config) {
  return client.put(`/forms/${formId}/notifications`, config).then((res) => res.data.override);
}

/**
 * Delete notification override (revert to account defaults)
 */
export function deleteNotificationOverride(formId) {
  return client.delete(`/forms/${formId}/notifications`).then((res) => res.data);
}

// ==========================
// Import / Export / Duplicate
// ==========================

/**
 * Export form as JSON (triggers download)
 */
export function exportForm(formId) {
  return client.get(`/forms/${formId}/export`).then((res) => res.data);
}

/**
 * Import form from JSON config
 */
export function importForm(clientId, formData) {
  return client.post('/forms/import', { clientId, formData }).then((res) => res.data.form);
}

/**
 * Duplicate a form
 */
export function duplicateForm(formId, clientId) {
  return client.post(`/forms/${formId}/duplicate`, { clientId }).then((res) => res.data.form);
}

// ==========================
// AI Form Builder
// ==========================

/**
 * Generate form schema from natural language prompt
 */
export function generateFormSchema(prompt, formType) {
  return client.post('/forms/ai/generate', { prompt, formType }).then((res) => res.data.schema);
}

// ==========================
// Embed Helpers
// ==========================

/**
 * Generate the embed code snippet for a form
 * @param {Object} form - Form object with embed_token
 * @param {string} [baseUrl] - Override base URL
 * @returns {string}
 */
export function generateEmbedCode(form, baseUrl) {
  const base = baseUrl || window.location.origin;
  return `<!-- Anchor Form: ${form.name} -->
<div id="anchor-form-${form.id}" data-form-token="${form.embed_token}"></div>
<script src="${base}/forms/anchor-forms.js" async></script>`;
}

/**
 * Generate tracking script code for client website
 * @param {string} clientId - Client user ID
 * @param {string} [baseUrl] - Override base URL
 * @returns {string}
 */
export function generateTrackingScriptCode(clientId, baseUrl) {
  const base = baseUrl || window.location.origin;
  return `<!-- Anchor Universal Tracking -->
<script src="${base}/tracking/anchor-tracking.js"
        data-client-id="${clientId}"
        data-api-base="${base}/api"
        async></script>`;
}
