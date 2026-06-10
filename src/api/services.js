import client from './client';

export function fetchServices() {
  return client.get('/hub/services').then((res) => res.data.services || []);
}

export function createService(payload) {
  return client.post('/hub/services', payload).then((res) => res.data.service);
}

export function updateService(id, payload) {
  return client.put(`/hub/services/${id}`, payload).then((res) => res.data.service);
}

export function deleteService(id) {
  return client.delete(`/hub/services/${id}`).then((res) => res.data);
}

export function fetchActiveClients(status = 'active') {
  const params = status ? { status } : undefined;
  return client.get('/hub/active-clients', { params }).then((res) => res.data.active_clients || []);
}

export function agreeToService(userId, payload) {
  return client.post(`/hub/clients/${userId}/agree-to-service`, payload).then((res) => res.data);
}

export function redactOldServices() {
  return client.post('/hub/active-clients/redact-services').then((res) => res.data);
}

export function archiveActiveClient(id) {
  return client.post(`/hub/active-clients/${id}/archive`).then((res) => res.data);
}

export function addServicesToActiveClient(id, services) {
  return client.post(`/hub/active-clients/${id}/services`, { services }).then((res) => res.data.active_client);
}

export function restoreActiveClient(id) {
  return client.post(`/hub/active-clients/${id}/unarchive`).then((res) => res.data);
}

export function applyServicePreset(clientId, services) {
  return client.post(`/hub/clients/${clientId}/service-presets`, { services }).then((res) => res.data);
}

export function fetchClientServices(clientId) {
  return client.get(`/hub/admin/clients/${clientId}/services`).then((res) => res.data.services || []);
}

export function saveClientServices(clientId, services) {
  return client.put(`/hub/admin/clients/${clientId}/services`, { services }).then((res) => res.data.services || []);
}
