const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function openStore() {
  const request = indexedDB.open('maya-content-studio', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('studio');
  return requestResult(request);
}

export async function loadState(db) {
  return requestResult(db.transaction('studio').objectStore('studio').get('state'));
}

export function saveState(db, state) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('studio', 'readwrite');
    transaction.objectStore('studio').put(state, 'state');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Storage transaction aborted.'));
  });
}
