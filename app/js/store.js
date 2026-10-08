// Tiny IndexedDB wrapper: a key/value store (cached catalog) and the outbox (sales waiting to sync).
const DB = 'omnitill', VER = 1;
let dbp;
function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out; const rq = fn(s); if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k)).catch(() => undefined);
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)).catch(() => {});
export const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k)).catch(() => {});
export const outboxAll = () => tx('outbox', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => x.created - y.created)).catch(() => []);
export const outboxPut = (row) => tx('outbox', 'readwrite', (s) => s.put(row));
export const outboxDel = (id) => tx('outbox', 'readwrite', (s) => s.delete(id));
export async function wipeCache() { await tx('kv', 'readwrite', (s) => s.clear()).catch(() => {}); }
