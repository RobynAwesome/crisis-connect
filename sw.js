/* ═══════════════════════════════════════════════════════════
   CrisisConnect Service Worker — Adaptive Offline Strategy
   Cache-first for shell, network-first for API, offline queue.
   Connectivity is not external-dispatch proof.
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'cc-adaptive-v4';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/app.js',
  '/db.js',
  '/kpgs_progressive.js',
  '/offline.html',
  '/404.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(DATA_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/offline.html').then(response => response || caches.match('/index.html'));
        }
      })
  );
});

/*
 * There is currently no configured external incident-dispatch sink in this
 * repository. Background Sync therefore MUST NOT publish SYNC_COMPLETE. The
 * browser may retry local work, but the queue stays pending until a future
 * transport returns a real external-distribution receipt.
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'cc-offline-queue') {
    event.waitUntil(reportDistributionHold());
  }
});

async function reportDistributionHold() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_HELD_NO_EXTERNAL_SINK',
      reason: 'external_distribution_receipt_required',
      ts: new Date().toISOString(),
      canonical_authority_changed: false
    });
  });
}

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'CrisisConnect Alert', body: 'New incident update' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/manifest.json',
      badge: '/manifest.json',
      vibrate: [200, 100, 200],
      tag: 'cc-alert',
      renotify: true,
      requireInteraction: data.urgency === 'critical'
    })
  );
});
