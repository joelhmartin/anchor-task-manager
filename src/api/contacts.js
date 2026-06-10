import client from './client';

// Owner-scoped contact list. params: { search, status, category, tag, service, from, to, page, limit }
// `category` is a comma-separated list of visible lead categories (qualified, unanswered,
// not_a_fit, spam, pending_review); a contact matches if any activity is in that set.
export function fetchContacts(params = {}) {
  return client.get('/hub/contacts', { params }).then((res) => ({
    contacts: res.data.contacts || [],
    pagination: res.data.pagination || null
  }));
}

// Owner-scoped opaque state version. Returns { version, contacts: {count, mtime}, journeys: {count, mtime} }.
// The `version` string changes whenever this owner's contacts or client_journeys tables change.
// Used by useStateVersionPoll to detect cross-client edits and trigger a board refetch.
export function fetchStateVersion() {
  return client.get('/hub/state-version').then((res) => res.data);
}

// Distinct tags actually applied to this owner's contacts (for the tag filter dropdown).
export function fetchContactTagOptions() {
  return client.get('/hub/contacts/tag-options').then((res) => res.data.tags || []);
}

// Soft archive / restore a contact. archived: boolean. Returns { contact: { id, archived_at } }.
export function archiveContact(id, archived) {
  return client.patch(`/hub/contacts/${id}/archive`, { archived }).then((res) => res.data);
}

// Authed CSV download of the filtered set; returns a Blob. Same filters as fetchContacts.
export function exportContactsCsv(params = {}) {
  return client.get('/hub/contacts/export.csv', { params, responseType: 'blob' }).then((res) => res.data);
}

// Owner-scoped profile: { contact, phones, emails, tags, consent, activity_count }
export function fetchContact(id) {
  return client.get(`/hub/contacts/${id}`).then((res) => res.data);
}

// Apply a tag to a contact. Pass { tagId } to attach an existing tag, or
// { tagName, tagColor } to create-or-get a free-form tag on the fly.
// Resolves to { ok, tag: { id, name, color } }.
export function addContactTag(id, body) {
  return client.post(`/hub/contacts/${id}/tags`, body).then((res) => res.data);
}

export function removeContactTagApi(id, tagId) {
  return client.delete(`/hub/contacts/${id}/tags/${tagId}`).then((res) => res.data);
}

export function updateContactConsent(id, patch) {
  return client.patch(`/hub/contacts/${id}/consent`, patch).then((res) => res.data);
}

// Attach a catalog service to a contact. Idempotent.
// Resolves to { ok, service: { id, service_id, service_name, source, source_ref_id, created_at } }.
export function attachContactService(contactId, serviceId) {
  return client.post(`/hub/contacts/${contactId}/services`, { service_id: serviceId }).then((res) => res.data);
}

// Soft-remove a service from a contact. Resolves to { ok: true }.
export function removeContactService(contactId, serviceId) {
  return client.delete(`/hub/contacts/${contactId}/services/${serviceId}`).then((res) => res.data);
}

// Contact-level notes (lead_notes keyed by contact_id). Returns all of the contact's notes, newest first.
export function fetchContactNotes(contactId) {
  return client.get(`/hub/contacts/${contactId}/notes`).then((res) => res.data.notes || []);
}

// Add a note to a contact. Resolves to { note: {...} } (or the row).
export function addContactNote(contactId, body) {
  return client.post(`/hub/contacts/${contactId}/notes`, { body }).then((res) => res.data);
}

// Delete one of the contact's notes (owner + note scoped). Resolves to { ok: true }.
export function deleteContactNote(contactId, noteId) {
  return client.delete(`/hub/contacts/${contactId}/notes/${noteId}`).then((res) => res.data);
}

// Staff-only merge queue + split (mounted on the staff contacts router under /hub).
export function fetchMergeCandidates(status = 'pending') {
  return client.get('/hub/contacts/merge-candidates', { params: { status } }).then((res) => res.data.candidates || []);
}

export function mergeContacts(keepId, mergeId, candidateId) {
  return client.post('/hub/contacts/merge', { keepId, mergeId, candidateId }).then((res) => res.data);
}

export function dismissMergeCandidate(candidateId) {
  return client.post(`/hub/contacts/merge-candidates/${candidateId}/dismiss`).then((res) => res.data);
}

export function splitContact(id, identifierType, identifierId) {
  return client.post(`/hub/contacts/${id}/split`, { identifierType, identifierId }).then((res) => res.data);
}
