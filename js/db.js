// Lokale Datenhaltung in IndexedDB. Alles bleibt auf dem Gerät.
const DB_NAME = 'kassabuch';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('businesses', { keyPath: 'id' });
        const entries = d.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('biz', 'bizId');
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// Führt fn innerhalb einer Transaktion aus; set(v) legt den Rückgabewert fest.
function run(stores, mode, fn) {
  return open().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let result;
    fn(tx, (v) => { result = v; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  }));
}

export const getAll = (store) => run(store, 'readonly', (tx, set) => {
  const r = tx.objectStore(store).getAll();
  r.onsuccess = () => set(r.result);
});

export const put = (store, value) => run(store, 'readwrite', (tx) => {
  tx.objectStore(store).put(value);
});

export const putMany = (store, values) => run(store, 'readwrite', (tx) => {
  const s = tx.objectStore(store);
  values.forEach((v) => s.put(v));
});

export const del = (store, key) => run(store, 'readwrite', (tx) => {
  tx.objectStore(store).delete(key);
});

export const entriesOf = (bizId) => run('entries', 'readonly', (tx, set) => {
  const r = tx.objectStore('entries').index('biz').getAll(bizId);
  r.onsuccess = () => set(r.result);
});

export const getMeta = (key) => run('meta', 'readonly', (tx, set) => {
  const r = tx.objectStore('meta').get(key);
  r.onsuccess = () => set(r.result);
});

function removeEntriesOf(tx, bizId, then) {
  const store = tx.objectStore('entries');
  const cur = store.index('biz').openCursor(IDBKeyRange.only(bizId));
  cur.onsuccess = () => {
    const c = cur.result;
    if (c) { c.delete(); c.continue(); } else if (then) then(store);
  };
}

// Ersetzt einen Betrieb samt allen Buchungen (Wiederherstellung aus Sicherung).
export const replaceBusiness = (biz, entries) => run(['businesses', 'entries'], 'readwrite', (tx) => {
  tx.objectStore('businesses').put(biz);
  removeEntriesOf(tx, biz.id, (store) => entries.forEach((e) => store.put(e)));
});

export const deleteBusiness = (bizId) => run(['businesses', 'entries'], 'readwrite', (tx) => {
  tx.objectStore('businesses').delete(bizId);
  removeEntriesOf(tx, bizId);
});

// Bittet den Browser, die Daten nicht automatisch zu löschen.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* nicht unterstützt */ }
}
