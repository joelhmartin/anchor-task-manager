import client from './client';

export function fetchEmailTemplates() {
  return client.get('/hub/journey-email-templates').then((res) => res.data.templates || []);
}
// Same endpoint, but also returns practice-level email defaults:
// { templates, meta: { from_name, from_address, default_reply_to } }
export function fetchEmailTemplatesWithMeta() {
  return client.get('/hub/journey-email-templates').then((res) => ({
    templates: res.data.templates || [],
    meta: res.data.meta || { from_name: '', from_address: '', default_reply_to: [] }
  }));
}
export function createEmailTemplate(payload) {
  return client.post('/hub/journey-email-templates', payload).then((res) => res.data.template);
}
export function updateEmailTemplate(id, payload) {
  return client.put(`/hub/journey-email-templates/${id}`, payload).then((res) => res.data.template);
}
export function deleteEmailTemplate(id) {
  return client.delete(`/hub/journey-email-templates/${id}`).then((res) => res.data);
}
// Send a test of the current email draft to chosen recipients (no journey is mutated).
// payload: { subject, body, body_format, preheader, attachment_file_ids, recipients }
export function sendTestEmail(payload) {
  return client.post('/hub/journey-email-templates/test', payload).then((res) => res.data);
}
