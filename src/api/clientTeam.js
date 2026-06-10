import client from './client';

/**
 * Fetch team members for the current client account
 */
export function fetchTeamMembers() {
  return client.get('/client-team').then((res) => res.data);
}

/**
 * Fetch pending invites for the current client account
 */
export function fetchPendingInvites() {
  return client.get('/client-team/invites').then((res) => res.data);
}

/**
 * Send an invitation to a new team member
 * @param {Object} params
 * @param {string} params.email - Email to invite
 * @param {string} [params.firstName] - First name (optional)
 * @param {string} [params.role] - Role (member or admin)
 */
export function sendInvite({ email, firstName, role = 'member' }) {
  return client.post('/client-team/invite', { email, firstName, role }).then((res) => res.data);
}

/**
 * Resend an invitation
 * @param {string} inviteId - ID of the invite to resend
 */
export function resendInvite(inviteId) {
  return client.post(`/client-team/invite/${inviteId}/resend`).then((res) => res.data);
}

/**
 * Revoke a pending invitation
 * @param {string} inviteId - ID of the invite to revoke
 */
export function revokeInvite(inviteId) {
  return client.delete(`/client-team/invite/${inviteId}`).then((res) => res.data);
}

/**
 * Remove a team member
 * @param {string} memberId - ID of the member record to remove
 */
export function removeMember(memberId) {
  return client.delete(`/client-team/members/${memberId}`).then((res) => res.data);
}

/**
 * Leave the team (for non-owners)
 */
export function leaveTeam() {
  return client.post('/client-team/leave').then((res) => res.data);
}

/**
 * Validate an invite token (public, no auth required)
 * @param {string} token - The invite token
 */
export function validateInviteToken(token) {
  return client.get(`/client-invite/${token}`).then((res) => res.data);
}

/**
 * Accept an invite and create/link account (public, no auth required)
 * @param {string} token - The invite token
 * @param {Object} params
 * @param {string} params.firstName - First name
 * @param {string} params.lastName - Last name
 * @param {string} params.password - Password
 */
export function acceptInvite(token, { firstName, lastName, password }) {
  return client.post(`/client-invite/${token}/accept`, { firstName, lastName, password }).then((res) => res.data);
}
