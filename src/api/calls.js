import client from './client';

// Fetch cached calls with optional filters and pagination
export function fetchCalls(params = {}) {
  return client.get('/hub/calls', { params }).then((res) => ({
    calls: res.data.calls || [],
    cached: res.data.cached || false,
    pagination: res.data.pagination || null,
    categoryCounts: res.data.categoryCounts || null,
    lifecycleCounts: res.data.lifecycleCounts || null,
    distinctSources: res.data.distinctSources || [],
    message: res.data.message
  }));
}

// Sync with CTM and return updated calls (use for background refresh)
export function syncCalls(fullSync = false) {
  return client.post('/hub/calls/sync', { fullSync }).then((res) => ({
    calls: res.data.calls || [],
    synced: res.data.synced || false,
    newCalls: res.data.newCalls || 0,
    updatedCalls: res.data.updatedCalls || 0,
    pagination: res.data.pagination || null,
    syncMeta: res.data.syncMeta || null,
    message: res.data.message
  }));
}

export function scoreCall(callId, score) {
  return client.post(`/hub/calls/${callId}/score`, { score }).then((res) => res.data);
}

export function clearCallScore(callId) {
  return client.delete(`/hub/calls/${callId}/score`).then((res) => res.data);
}

export function clearAndReloadCalls() {
  return client.delete('/hub/calls').then((res) => ({
    calls: res.data.calls || [],
    message: res.data.message
  }));
}

// Get lead statistics
export function fetchLeadStats(days = 30) {
  return client.get('/hub/calls/stats', { params: { days } }).then((res) => res.data);
}

// Get detailed lead info with history
export function fetchLeadDetail(callId) {
  return client.get(`/hub/calls/${callId}/detail`).then((res) => res.data);
}

export function fetchLeadRecordingUrl(callId) {
  return client.get(`/hub/calls/${callId}/recording`).then((res) => res.data);
}

export function fetchLeadRecordingBlob(callId) {
  return client.get(`/hub/calls/${callId}/recording/stream`, { responseType: 'blob' }).then((res) => res.data);
}

// Get call history for a lead's phone number
export function fetchCallHistory(callId) {
  return client.get(`/hub/calls/${callId}/history`).then((res) => res.data);
}

// Export leads to CSV (returns blob)
export function exportLeadsCsv() {
  return client.get('/hub/calls/export', { responseType: 'blob' }).then((res) => res.data);
}

// Move lead to pipeline stage
export function moveLeadToStage(callId, stageId) {
  return client.put(`/hub/calls/${callId}/stage`, { stage_id: stageId }).then((res) => res.data);
}

// Link lead to active client
export function linkLeadToClient(callId, activeClientId) {
  return client.post(`/hub/calls/${callId}/link-client`, { activeClientId }).then((res) => res.data);
}

// Unlink lead from active client
export function unlinkLeadFromClient(callId) {
  return client.delete(`/hub/calls/${callId}/link-client`).then((res) => res.data);
}

// Rename the contact behind a lead (human-set name; shows across the contact's activity).
export function renameContact(contactId, name) {
  return client.patch(`/hub/contacts/${contactId}/name`, { name }).then((res) => res.data.contact);
}

// =====================
// PIPELINE STAGES
// =====================

export function fetchPipelineStages() {
  return client.get('/hub/pipeline-stages').then((res) => res.data.stages || []);
}

export function createPipelineStage(data) {
  return client.post('/hub/pipeline-stages', data).then((res) => res.data.stage);
}

export function updatePipelineStage(id, data) {
  return client.put(`/hub/pipeline-stages/${id}`, data).then((res) => res.data.stage);
}

export function deletePipelineStage(id) {
  return client.delete(`/hub/pipeline-stages/${id}`).then((res) => res.data);
}

// =====================
// LEAD NOTES
// =====================

export function fetchLeadNotes(callId) {
  return client.get(`/hub/leads/${callId}/notes`).then((res) => res.data.notes || []);
}

export function addLeadNote(callId, body, noteType = 'note', metadata = {}) {
  return client.post(`/hub/leads/${callId}/notes`, { body, note_type: noteType, metadata }).then((res) => res.data.note);
}

export function deleteLeadNote(callId, noteId) {
  return client.delete(`/hub/leads/${callId}/notes/${noteId}`).then((res) => res.data);
}

// =====================
// SAVED VIEWS
// =====================

export function fetchSavedViews() {
  return client.get('/hub/lead-views').then((res) => res.data.views || []);
}

export function createSavedView(name, filters, isDefault = false) {
  return client.post('/hub/lead-views', { name, filters, is_default: isDefault }).then((res) => res.data.view);
}

export function deleteSavedView(id) {
  return client.delete(`/hub/lead-views/${id}`).then((res) => res.data);
}

// =====================
// LEAD TAGS
// =====================

export function fetchAllTags() {
  return client.get('/hub/lead-tags').then((res) => res.data.tags || []);
}

export function createTag(name, color) {
  return client.post('/hub/lead-tags', { name, color }).then((res) => res.data.tag);
}

export function deleteTag(id) {
  return client.delete(`/hub/lead-tags/${id}`).then((res) => res.data);
}

export function fetchCallTags(callId) {
  return client.get(`/hub/calls/${callId}/tags`).then((res) => res.data.tags || []);
}

export function addTagToCall(callId, tagId, tagName, tagColor) {
  return client.post(`/hub/calls/${callId}/tags`, { tag_id: tagId, tag_name: tagName, tag_color: tagColor }).then((res) => res.data.tags || []);
}

export function removeTagFromCall(callId, tagId) {
  return client.delete(`/hub/calls/${callId}/tags/${tagId}`).then((res) => res.data);
}

export function updateCallCategory(callId, category) {
  return client.put(`/hub/calls/${callId}/category`, { category }).then((res) => res.data);
}

export function hideCall(callId) {
  return client.put(`/hub/calls/${callId}/hide`).then((res) => res.data);
}

export function hideSingleCall(callId) {
  return client.put(`/hub/calls/${callId}/hide-single`).then((res) => res.data);
}

export function unhideCall(callId) {
  return client.put(`/hub/calls/${callId}/unhide`).then((res) => res.data);
}
