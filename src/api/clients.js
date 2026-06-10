import client from './client';

export function fetchClients() {
  return client.get('/hub/clients').then((res) => res.data.clients || []);
}

export function createClient(payload) {
  return client.post('/hub/clients', payload).then((res) => res.data);
}

export function updateClient(id, payload) {
  return client.put(`/hub/clients/${id}`, payload).then((res) => res.data.client);
}

export function deleteClient(id, { deleteBoard = false } = {}) {
  const params = deleteBoard ? '?delete_board=true' : '';
  return client.delete(`/hub/clients/${id}${params}`).then((res) => res.data);
}

export function fetchClientDetail(id) {
  return client.get(`/hub/clients/${id}`).then((res) => res.data.client);
}

export function sendClientOnboardingEmail(id) {
  return client.post(`/hub/clients/${id}/onboarding-email`).then((res) => res.data);
}

export function completeClientOnboarding(id) {
  return client.post(`/hub/clients/${id}/complete-onboarding`).then((res) => res.data);
}

export function activateClient(id) {
  return client.post(`/hub/clients/${id}/activate`).then((res) => res.data);
}

export function deactivateClient(id) {
  return client.post(`/hub/clients/${id}/deactivate`).then((res) => res.data);
}

export function getClientOnboardingLink(id) {
  return client.get(`/hub/clients/${id}/onboarding-link`).then((res) => res.data);
}

export function generateClientOnboardingLink(id) {
  return client.post(`/hub/clients/${id}/generate-onboarding-link`).then((res) => res.data);
}

export function getClientActivationLink(id) {
  return client.get(`/hub/clients/${id}/activation-link`).then((res) => res.data);
}

export function generateClientActivationLink(id) {
  return client.post(`/hub/clients/${id}/generate-activation-link`).then((res) => res.data);
}

export function sendClientActivationEmail(id) {
  return client.post(`/hub/clients/${id}/send-activation-email`).then((res) => res.data);
}

export function updateClientNotifications(id, payload) {
  return client.put(`/hub/clients/${id}/notifications`, payload).then((res) => res.data);
}

// Admin: Client Team Management
export function fetchClientTeam(clientId) {
  return client.get(`/hub/clients/${clientId}/team`).then((res) => res.data);
}

export function sendClientTeamInvite(clientId, { email, firstName, role }) {
  return client.post(`/hub/clients/${clientId}/team/invite`, { email, firstName, role }).then((res) => res.data);
}

export function resendClientTeamInvite(clientId, inviteId) {
  return client.post(`/hub/clients/${clientId}/team/invite/${inviteId}/resend`).then((res) => res.data);
}

export function revokeClientTeamInvite(clientId, inviteId) {
  return client.delete(`/hub/clients/${clientId}/team/invite/${inviteId}`).then((res) => res.data);
}

export function removeClientTeamMember(clientId, memberId) {
  return client.delete(`/hub/clients/${clientId}/team/members/${memberId}`).then((res) => res.data);
}

export function updateClientTeamMemberRole(clientId, memberId, role) {
  return client.patch(`/hub/clients/${clientId}/team/members/${memberId}`, { role }).then((res) => res.data);
}

export function updateClientTeamInvite(clientId, inviteId, { role, firstName }) {
  const body = {};
  if (role !== undefined) body.role = role;
  if (firstName !== undefined) body.first_name = firstName;
  return client.patch(`/hub/clients/${clientId}/team/invite/${inviteId}`, body).then((res) => res.data);
}

export function transferClientOwnership(clientId, { target, currentOwnerAction }) {
  return client
    .post(`/hub/clients/${clientId}/team/transfer-ownership`, { target, currentOwnerAction })
    .then((res) => res.data);
}
