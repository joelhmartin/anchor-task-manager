import client from './client';

export function getTutorialCompletions() {
  return client.get('/tutorials/completions').then((res) => res.data.completions || []);
}

export function markTutorialComplete(tutorialId) {
  return client.post(`/tutorials/${tutorialId}/complete`).then((res) => res.data);
}
