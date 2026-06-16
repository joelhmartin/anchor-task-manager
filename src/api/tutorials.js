// Tutorials are a dashboard feature with no backend in the Task Manager.
// Stubbed to no-ops so TutorialContext stays intact without hitting a 404.

export function getTutorialCompletions() {
  return Promise.resolve([]);
}

export function markTutorialComplete() {
  return Promise.resolve({});
}
