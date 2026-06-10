import client from './client';

/**
 * Client Groups API
 * For organizing clients into expandable groups in the admin view
 */

export const getClientGroups = () => client.get('/hub/client-groups').then((res) => res.data);

export const createClientGroup = (data) => client.post('/hub/client-groups', data).then((res) => res.data);

export const updateClientGroup = (id, data) => client.put(`/hub/client-groups/${id}`, data).then((res) => res.data);

export const deleteClientGroup = (id) => client.delete(`/hub/client-groups/${id}`).then((res) => res.data);

export const fetchClientGroupTeam = (id) => client.get(`/hub/client-groups/${id}/team`).then((res) => res.data);

export const sendClientGroupInvite = (id, { email, firstName, role }) =>
  client.post(`/hub/client-groups/${id}/team/invite`, { email, firstName, role }).then((res) => res.data);

export const resendClientGroupInvite = (id, inviteId) =>
  client.post(`/hub/client-groups/${id}/team/invite/${inviteId}/resend`).then((res) => res.data);

export const revokeClientGroupInvite = (id, inviteId) =>
  client.delete(`/hub/client-groups/${id}/team/invite/${inviteId}`).then((res) => res.data);

export const updateClientGroupMemberRole = (id, memberId, role) =>
  client.patch(`/hub/client-groups/${id}/team/members/${memberId}`, { role }).then((res) => res.data);

export const removeClientGroupMember = (id, memberId) =>
  client.delete(`/hub/client-groups/${id}/team/members/${memberId}`).then((res) => res.data);

export const uploadGroupIcon = (id, file) => {
  const formData = new FormData();
  formData.append('icon', file);
  return client.post(`/hub/client-groups/${id}/icon`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }).then((res) => res.data);
};

export const deleteGroupIcon = (id) => client.delete(`/hub/client-groups/${id}/icon`).then((res) => res.data);
