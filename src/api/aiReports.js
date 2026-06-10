import client from './client';

// Note: the shared `client` axios instance has baseURL '/api', so all paths
// here are relative — do NOT prefix with '/api/'. The interceptors attach
// Authorization, x-acting-user, x-client-account, and X-Device-Id headers.

export const listAiTemplates = (params = {}) =>
  client.get('/reports/ai-templates', { params }).then((r) => r.data.templates);

export const getAiTemplate = (id) =>
  client.get(`/reports/ai-templates/${id}`).then((r) => r.data.template);

export const createAiTemplate = (body) =>
  client.post('/reports/ai-templates', body).then((r) => r.data.template);

export const updateAiTemplate = (id, body) =>
  client.patch(`/reports/ai-templates/${id}`, body).then((r) => r.data.template);

export const testRunAiTemplate = (id, body) =>
  client.post(`/reports/ai-templates/${id}/test-run`, body).then((r) => r.data.run);

export const approveAiTemplate = (id, body) =>
  client.post(`/reports/ai-templates/${id}/approve`, body).then((r) => r.data.version);

export const startRun = (body) =>
  client.post('/reports/runs', body).then((r) => r.data.run);

export const getRun = (id) =>
  client.get(`/reports/runs/${id}`).then((r) => r.data);

export const getRunItem = (id) =>
  client.get(`/reports/run-items/${id}`).then((r) => r.data.item);

export const listClientReports = (clientId) =>
  client.get(`/reports/client/${clientId}/items`).then((r) => r.data.items);
