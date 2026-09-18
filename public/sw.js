/* global self, URL */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Testagram';
  const body = payload.body || 'You have a new notification.';
  const data = payload.data || {};
  const actionUrl = data.action_url || '/notifications';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/app-icon.jpg',
      badge: '/app-icon.jpg',
      tag: data.notification_id || 'testagram-notification',
      renotify: true,
      data: { action_url: actionUrl },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.action_url || '/notifications', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
