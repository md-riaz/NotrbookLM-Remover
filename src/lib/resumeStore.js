const DB_NAME = 'watermark-remover-db';
const DB_VERSION = 1;
const STORE_NAME = 'segments';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable.'));
  });
}

function getId(jobId, segmentIndex) {
  return `${jobId}:${segmentIndex}`;
}

export async function storeSegmentBlob(jobId, segmentIndex, blob) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id: getId(jobId, segmentIndex), jobId, segmentIndex, blob, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not store segment.'));
  });
  db.close();
}

export async function getSegmentBlob(jobId, segmentIndex) {
  const db = await openDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(getId(jobId, segmentIndex));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read segment.'));
  });
  db.close();
  return record?.blob || null;
}

export async function hasAllSegments(jobId, segmentCount) {
  for (let index = 0; index < segmentCount; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const blob = await getSegmentBlob(jobId, index);
    if (!blob) return false;
  }
  return true;
}

export async function clearSegments(jobId) {
  const db = await openDb();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (cursor.value?.jobId === jobId) {
        cursor.delete();
      }
      cursor.continue();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not clear segments.'));
  });

  db.close();
}
