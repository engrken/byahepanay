export interface QueuedSighting {
  tripId: string;
  checkpointId: string;
  lat: number;
  lng: number;
  kind: 'roadside' | 'rider_beacon';
  requestId?: string;
  /** Legacy queue records may include this untrusted value; server ignores it. */
  spotterId?: string;
  riderStatus?: string;
  queuedAt: string;
}

const DB_NAME = 'byahepanay-offline';
const STORE_NAME = 'sightings';
const DB_VERSION = 1;

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'queueId', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline queue.'));
  });
}

export async function enqueueSighting(sighting: QueuedSighting): Promise<void> {
  const db = await openQueueDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(sighting);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save sighting offline.'));
    tx.onabort = () => reject(tx.error ?? new Error('Offline queue write was aborted.'));
  });
  db.close();
  requestBackgroundSync();
}

export async function getQueuedSightingCount(): Promise<number> {
  try {
    const db = await openQueueDb();
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  } catch {
    return 0;
  }
}

export async function flushSightingQueue(): Promise<{ sent: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { sent: 0, remaining: await getQueuedSightingCount() };
  const db = await openQueueDb(); let sent = 0;
  try {
    const sessionResponse = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!sessionResponse.ok) return { sent: 0, remaining: await getQueuedSightingCount() };
    const entries = await new Promise<Array<QueuedSighting & { queueId: number }>>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as Array<QueuedSighting & { queueId: number }>); request.onerror = () => reject(request.error);
    });
    const legacySpotterId = entries.find((entry) => entry.spotterId)?.spotterId;
    if (legacySpotterId) {
      const migration = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ legacySpotterId }) });
      if (!migration.ok) return { sent: 0, remaining: entries.length };
    }
    for (const entry of entries) {
      if (!entry.requestId) entry.requestId = crypto.randomUUID();
      if (entry.spotterId) delete entry.spotterId;
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).put(entry);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
      let response: Response;
      try { response = await fetch('/api/sightings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ tripId: entry.tripId, checkpointId: entry.checkpointId, lat: entry.lat, lng: entry.lng, kind: entry.kind, requestId: entry.requestId, riderStatus: entry.riderStatus, observedAt: entry.queuedAt }) }); } catch { break; }
      if (response.ok) { await deleteQueuedRecord(db, entry.queueId); sent += 1; }
      else if (response.status >= 400 && response.status < 500 && response.status !== 429) await deleteQueuedRecord(db, entry.queueId);
      else break;
    }
  } finally { db.close(); }
  return { sent, remaining: await getQueuedSightingCount() };
}
function deleteQueuedRecord(db: IDBDatabase, queueId: number) {
  return new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE_NAME,'readwrite');tx.objectStore(STORE_NAME).delete(queueId);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) => {
    const syncRegistration = registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };
    return syncRegistration.sync?.register('byahepanay-sightings');
  }).catch(() => undefined);
}
