// Service Worker for CloudCLI PWA
// Cache only manifest (needed for PWA install). HTML and JS are never pre-cached
// so a rebuild + refresh always picks up the latest assets.
// Vite replaces this exact declaration in the distribution artifact. The
// query fallback exists only for the development server, where public files
// are served without the build transform.
const EMBEDDED_BUILD_ID = null;
const BUILD_ID = EMBEDDED_BUILD_ID || new URL(self.location.href).searchParams.get('build');
if (!BUILD_ID || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,159}$/.test(BUILD_ID)) {
  throw new Error('CloudCLI service worker requires a valid build identity.');
}
const CACHE_PREFIX = 'cloudcli-web-';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const urlsToCache = [
  '/manifest.json'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Fetch event — network-first for everything except hashed assets
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never intercept API requests or WebSocket upgrades
  const requestUrl = new URL(url);
  if (
    requestUrl.pathname === '/health'
    || requestUrl.pathname.startsWith('/api/')
    || requestUrl.pathname.startsWith('/ws')
    || requestUrl.pathname.startsWith('/shell')
    || requestUrl.pathname.startsWith('/voice-stream')
    || requestUrl.pathname.startsWith('/plugin-ws')
  ) {
    return;
  }

  // Navigation requests (HTML) — always go to network, no caching
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/manifest.json').then(() =>
        new Response('<h1>Offline</h1><p>Please check your connection.</p>', {
          headers: { 'Content-Type': 'text/html' }
        })
      ))
    );
    return;
  }

  // Hashed assets (JS/CSS in /assets/) — cache-first since filenames change per build
  if (url.includes('/assets/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        }))
    );
    return;
  }

  // Everything else — network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.open(CACHE_NAME).then(cache => cache.match(event.request)))
  );
});

// Activate event — purge old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && (name.startsWith(CACHE_PREFIX) || name.startsWith('claude-ui-')))
          .map(name => caches.delete(name))
      ).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
        .then(clients => Promise.all(clients.map(client => client.postMessage({
          type: 'cloudcli:build-activated',
          buildId: BUILD_ID,
        }))))
    )
  );
  self.clients.claim();
});

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'CloudCLI', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/logo-256.png',
    badge: '/logo-128.png',
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'CloudCLI', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const provider = event.notification.data?.provider || null;
  const urlPath = sessionId ? `/session/${sessionId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          client.postMessage({
            type: 'notification:navigate',
            sessionId: sessionId || null,
            provider,
            urlPath
          });
          return;
        }
      }
      return self.clients.openWindow(urlPath);
    })
  );
});
