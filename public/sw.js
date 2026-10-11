/* global self, URL, caches, fetch */

const VERSION = 'testagram-shell-v5';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';
const MAX_RUNTIME_ENTRIES = 80;
const MEDIA_CACHE = VERSION + '-media';
const MAX_MEDIA_ENTRIES = 180;
const APP_SHELL = ['/', '/app-icon.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => ![STATIC_CACHE, RUNTIME_CACHE, MEDIA_CACHE].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});


function isMediaRequest(request, url) {
  const path = url.pathname.toLowerCase();
  const accept = request.headers.get('accept') || '';
  return request.destination === 'video' ||
    request.destination === 'audio' ||
    /\.(mp4|webm|mov|m4v|m3u8|ts|m4s|aac|mp3)(?:$|[?#])/i.test(path) ||
    /video\//i.test(accept) ||
    /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(accept);
}

async function trimMediaCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_MEDIA_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_MEDIA_ENTRIES).map((key) => cache.delete(key)));
}

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
  if (isMediaRequest(request, url)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request).then((response) => {
            // Keep successful CORS media responses and opaque media responses.
            // This covers direct MP4/WebM as well as HLS manifests/fragments.
            if (response.ok || response.type === 'opaque') {
              cache.put(request, response.clone()).then(trimMediaCache).catch(() => {});
            }
            return response;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

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

function safeNotificationUrl(value) {
  try {
    const candidate = new URL(typeof value === 'string' ? value : '/notifications', self.location.origin);
    // Push payloads are server-originated but still treated as untrusted input:
    // never let a notification turn a click into an external redirect.
    if (candidate.origin !== self.location.origin || !['https:', 'http:'].includes(candidate.protocol)) {
      return new URL('/notifications', self.location.origin).href;
    }
    return candidate.href;
  } catch {
    return new URL('/notifications', self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : '' }; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Testagram';
  const body = typeof payload.body === 'string' && payload.body.trim() ? payload.body : 'You have a new notification.';
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
  const notificationId = typeof data.notification_id === 'string' && data.notification_id.trim()
    ? data.notification_id.slice(0, 160)
    : undefined;
  const options = {
    body,
    icon: '/app-icon.jpg',
    badge: '/app-icon.jpg',
    data: { action_url: safeNotificationUrl(data.action_url) },
  };
  // Only group/replace notifications when the sender supplies a stable ID.
  // A single constant fallback tag caused unrelated alerts to overwrite each other.
  if (notificationId) {
    options.tag = notificationId;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeNotificationUrl(event.notification.data?.action_url || '/notifications');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
