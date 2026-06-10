import client from './client';

// ── Client-facing ──
export function fetchActiveUpdates() {
  return client.get('/portal-updates').then((res) => res.data.updates || []);
}

export function dismissUpdate(id) {
  return client.post(`/portal-updates/${id}/dismiss`).then((res) => res.data);
}

// ── Admin authoring ──
export function fetchAllUpdates() {
  return client.get('/portal-updates/admin').then((res) => res.data.updates || []);
}

export function createUpdate(payload) {
  return client.post('/portal-updates/admin', payload).then((res) => res.data.update);
}

export function updateUpdate(id, payload) {
  return client.put(`/portal-updates/admin/${id}`, payload).then((res) => res.data.update);
}

export function deleteUpdate(id) {
  return client.delete(`/portal-updates/admin/${id}`).then((res) => res.data);
}
