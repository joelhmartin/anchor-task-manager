/**
 * CTM Forms API Client
 */

import client from './client';

export const getAppConfig = () =>
  client.get('/app-config').then(r => r.data);

// CRUD
export const listCtmForms = (clientId, status) =>
  client.get('/ctm-forms', { params: { clientId, status } }).then(r => r.data.forms || []);

export const getCtmForm = (id) =>
  client.get(`/ctm-forms/${id}`).then(r => r.data.form);

export const createCtmForm = (clientId, name, formMode) =>
  client.post('/ctm-forms', { clientId, name, formMode }).then(r => r.data.form);

export const updateCtmForm = (id, updates) =>
  client.put(`/ctm-forms/${id}`, updates).then(r => r.data.form);

export const saveCtmFormConfig = (id, config) =>
  client.put(`/ctm-forms/${id}/config`, { config }).then(r => r.data);

export const publishCtmForm = (id) =>
  client.post(`/ctm-forms/${id}/publish`).then(r => r.data);

export const archiveCtmForm = (id) =>
  client.delete(`/ctm-forms/${id}`).then(r => r.data);

// Preview
export const getCtmFormPreview = (id) =>
  client.get(`/ctm-forms/${id}/preview`).then(r => r.data);

// Submissions
export const listCtmFormSubmissions = (id) =>
  client.get(`/ctm-forms/${id}/submissions`).then(r => r.data.submissions || []);

export const listClientSubmissions = (clientId) =>
  client.get(`/ctm-forms/client/${clientId}/submissions`).then(r => r.data.submissions || []);

export const retryCtmSubmission = (submissionId) =>
  client.post(`/ctm-forms/submissions/${submissionId}/retry-ctm`).then(r => r.data);

export const resendSubmissionEmail = (submissionId) =>
  client.post(`/ctm-forms/submissions/${submissionId}/resend-email`).then(r => r.data);

// Release a spam-held submission: mark legitimate, forward to CTM, send notification.
export const releaseCtmSubmission = (submissionId) =>
  client.post(`/ctm-forms/submissions/${submissionId}/release`).then(r => r.data);

// Analytics
export const getCtmFormAnalytics = (id) =>
  client.get(`/ctm-forms/${id}/analytics`).then(r => r.data);

// CTM configuration health for a published form
export const getCtmFormHealth = (id) =>
  client.get(`/ctm-forms/${id}/health`).then(r => r.data);

// CTM Proxy
export const listCtmReactors = (formId) =>
  client.get(`/ctm-forms/${formId}/ctm/reactors`).then(r => r.data.reactors || []);

export const getReactorDetail = (formId, reactorId) =>
  client.get(`/ctm-forms/${formId}/ctm/reactor-detail/${reactorId}`).then(r => r.data.detail);

export const linkReactor = (formId, reactorId) =>
  client.post(`/ctm-forms/${formId}/ctm/link-reactor`, { reactorId }).then(r => r.data);

export const generateStarter = (formId, reactorId, floatingLabels) =>
  client.post(`/ctm-forms/${formId}/ctm/generate-starter`, { reactorId, floatingLabels }).then(r => r.data);

// AI
export const aiAssist = (instruction, config) =>
  client.post('/ctm-forms/ai/assist', { instruction, config }).then(r => {
    if (!r.data?.config) throw new Error('AI did not return a valid form configuration');
    return r.data.config;
  });

// Templates
export const listCtmFormTemplates = () =>
  client.get('/ctm-forms/templates/list').then(r => r.data.templates || []);

export const saveAsTemplate = (formId, { name, description, category }) =>
  client.post('/ctm-forms/templates', { formId, name, description, category }).then(r => r.data.template);

export const createFormFromTemplate = (templateId, clientId, name) =>
  client.post(`/ctm-forms/templates/${templateId}/use`, { clientId, name }).then(r => r.data.form);

export const deleteCtmFormTemplate = (id) =>
  client.delete(`/ctm-forms/templates/${id}`).then(r => r.data);

// Import/Export/Duplicate
export const exportCtmForm = (id) =>
  client.get(`/ctm-forms/${id}/export`).then(r => r.data);

export const importCtmForm = (clientId, formData) =>
  client.post('/ctm-forms/import', { clientId, formData }).then(r => r.data.form);

export const duplicateCtmForm = (id, clientId) =>
  client.post(`/ctm-forms/${id}/duplicate`, { clientId }).then(r => r.data.form);

// Embed code generator
// data-api-base goes on the div because WP Rocket strips custom data attributes
// from script tags when it minifies them. The embed script checks the container
// div for data-api-base as a fallback when script.src origin doesn't match.
export function generateCtmEmbedCode(form, baseUrl) {
  const base = baseUrl || window.location.origin;
  const clientLabel = form.client_label ? ` — ${form.client_label}` : '';
  return `<!-- Anchor CTM Form: ${form.name}${clientLabel} -->\n<div data-ctm-form-token="${form.embed_token}" data-api-base="${base}/api"></div>\n<script src="${base}/ctm-forms/ctm-forms.js" async></script>`;
}
