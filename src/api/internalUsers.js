import client from './client';

export function fetchInternalUsers() {
  return client.get('/hub/internal-users').then((res) => res.data?.users || []);
}
