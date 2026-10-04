/* global self, URL, caches, fetch */

const VERSION = 'testagram-shell-v3';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';
const MAX_RUNTIME_ENTRIES = 80;
const APP_SHELL = ['/', '/app-icon.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trimRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_RUNTIME_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses here: home-feed is personalized for signed-in users.
  // The application owns its safe, user-local IndexedDB feed cache instead.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'font' || request.destination === 'image')) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy).then(trimRuntimeCache)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : '' }; }
  const title = payload.title || 'Testagram';
  const body = payload.body || 'You have a new notification.';
  const data = payload.data || {};
  const actionUrl = data.action_url || '/notifications';
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/app-icon.jpg', badge: '/app-icon.jpg',
    tag: data.notification_id || 'testagram-notification', renotify: true,
    data: { action_url: actionUrl },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.action_url || '/notifications', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) if ('focus' in client) { client.navigate(target); return client.focus(); }
    return self.clients.openWindow(target);
  }));
});
