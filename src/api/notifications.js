import client from './client';

export function fetchNotifications() {
  return client.get('/hub/notifications').then((res) => res.data);
}

export function markNotificationRead(id) {
  return client.post(`/hub/notifications/${id}/read`).then((res) => res.data);
}

export function markAllNotificationsRead() {
  return client.post('/hub/notifications/read-all').then((res) => res.data);
}
