import client from './client';

// Client-portal Activity Log API — self-scoped on the server to the logged-in client
// (req.portalUserId). Mirrors the admin activity/email-log endpoints but read-only and scoped.

export function fetchPortalActivityLogs(params = {}) {
  return client.get('/hub/portal/activity-logs', { params }).then((res) => res.data);
}

export function exportPortalActivityCsv(params = {}) {
  return client.get('/hub/portal/activity-logs/export.csv', { params, responseType: 'blob' }).then((res) => res.data);
}

export function fetchPortalEmailLogs(params = {}) {
  return client.get('/hub/portal/email-logs', { params }).then((res) => res.data);
}

export function fetchPortalEmailDetail(id) {
  return client.get(`/hub/portal/email-logs/${id}`).then((res) => res.data);
}

export function exportPortalEmailCsv(params = {}) {
  return client.get('/hub/portal/email-logs/export.csv', { params, responseType: 'blob' }).then((res) => res.data);
}
