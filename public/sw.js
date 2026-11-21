/* Small offline shell cache + best-effort background sync for queued GPS sightings. */
const CACHE_NAME = 'byahepanay-shell-v2';
const SHELL_URLS = ['/', '/manifest.json', '/icon.svg'];
const DB_NAME = 'byahepanay-offline';
const STORE_NAME = 'sightings';
const DB_VERSION = 1;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (['style', 'script', 'image', 'font'].includes(request.destination)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'byahepanay-sightings') event.waitUntil(flushSightings());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FLUSH_SIGHTINGS') event.waitUntil(flushSightings());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'queueId', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function remove(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function flushSightings() {
  let db;
  try {
    db = await openDb();
    const entries = await getAll(db);
    for (const entry of entries) {
      const { queueId, ...payload } = entry;
      let response;
      try {
        response = await fetch('/api/sightings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, observedAt: entry.queuedAt }) });
      } catch { break; }
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) await remove(db, queueId);
      else break;
    }
  } catch (error) {
    // The page's foreground queue worker will retry when it next becomes online.
    console.warn('ByahePanay background sync deferred', error);
  } finally {
    db?.close();
  }
}
