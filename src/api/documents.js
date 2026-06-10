import client from './client';

export function fetchDocuments() {
  return client.get('/hub/docs').then((res) => res.data.docs || []);
}

export function uploadDocuments(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append('client_doc', file));
  return client
    .post('/hub/docs', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((res) => res.data.docs || []);
}

export function deleteDocument(id) {
  return client.delete(`/hub/docs/${id}`).then((res) => res.data);
}

export function markDocumentViewed(id) {
  return client.post(`/hub/docs/${id}/viewed`).then((res) => res.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOCUMENTS (admin-managed, visible to all clients)
// ─────────────────────────────────────────────────────────────────────────────

// Client-facing: fetch shared/helpful docs
export function fetchSharedDocuments() {
  return client.get('/hub/shared-docs').then((res) => res.data.shared_docs || []);
}

// Admin: fetch shared docs with creator info
export function fetchSharedDocumentsAdmin() {
  return client.get('/hub/shared-docs/admin').then((res) => res.data.shared_docs || []);
}

// Admin: upload new shared document(s)
export function uploadSharedDocuments(files, labels = [], descriptions = []) {
  const formData = new FormData();
  files.forEach((file, i) => {
    formData.append('shared_doc', file);
    if (labels[i]) formData.append('labels', labels[i]);
    if (descriptions[i]) formData.append('descriptions', descriptions[i]);
  });
  return client
    .post('/hub/shared-docs/admin', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((res) => res.data.shared_docs || []);
}

// Admin: update shared document (label, description, sort_order)
export function updateSharedDocument(id, data) {
  return client.put(`/hub/shared-docs/admin/${id}`, data).then((res) => res.data.shared_doc);
}

// Admin: delete shared document
export function deleteSharedDocument(id) {
  return client.delete(`/hub/shared-docs/admin/${id}`).then((res) => res.data);
}

// Admin: reorder shared documents
export function reorderSharedDocuments(order) {
  return client.post('/hub/shared-docs/admin/reorder', { order }).then((res) => res.data);
}
