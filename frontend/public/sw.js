const CACHE = 'smarthome-v1';

// Beim Installieren: Shell cachen
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(['/', '/manifest.json'])
    )
  );
  self.skipWaiting();
});

// Beim Aktivieren: alte Caches löschen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network-first für API, Cache-first für Assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API-Requests immer live holen
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Alles andere: Network first, bei Fehler Cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push-Benachrichtigung empfangen
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'SmartHome', {
      body:  data.body  ?? '',
      icon:  data.icon  ?? '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data:  { url: data.url ?? '/' },
    })
  );
});

// Klick auf Benachrichtigung → App öffnen
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      clients.openWindow(url);
    })
  );
});
