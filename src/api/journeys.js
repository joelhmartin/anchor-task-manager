import client from './client';

export function fetchJourneys(params = {}) {
  return client.get('/hub/journeys', { params }).then((res) => res.data.journeys || []);
}
export function fetchJourney(id) {
  return client.get(`/hub/journeys/${id}`).then((res) => res.data.journey);
}
export function createJourney(payload) {
  return client.post('/hub/journeys', payload).then((res) => res.data.journey);
}
export function updateJourney(id, payload) {
  return client.put(`/hub/journeys/${id}`, payload).then((res) => res.data.journey);
}
export function moveJourneyStage(id, stage) {
  return client.patch(`/hub/journeys/${id}/stage`, { stage }).then((res) => res.data.journey);
}
export function sendJourneyEmail(id, payload) {
  return client.post(`/hub/journeys/${id}/email`, payload).then((res) => res.data.journey);
}
export function addJourneyNote(id, body) {
  return client.post(`/hub/journeys/${id}/note`, { body }).then((res) => res.data.journey);
}
export function sendJourneyText(id, payload) {
  return client.post(`/hub/journeys/${id}/text`, payload).then((res) => res.data);
}
export function cancelScheduledSend(id) {
  return client.post(`/hub/journeys/${id}/schedule/cancel`).then((res) => res.data.journey);
}
export function convertJourney(id, payload = {}) {
  return client.post(`/hub/journeys/${id}/convert`, payload).then((res) => res.data.journey);
}
export function archiveJourney(id) {
  return client.post(`/hub/journeys/${id}/archive`).then((res) => res.data.journey);
}
export function restoreJourney(id) {
  return client.post(`/hub/journeys/${id}/unarchive`).then((res) => res.data.journey);
}
