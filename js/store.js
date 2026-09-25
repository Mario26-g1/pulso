// Almacenamiento: IndexedDB en el celular, o solo memoria si el usuario desactiva el historial.

const DB = 'copia-clara', VER = 1, STORES = ['docs', 'pages', 'sigs'];

let dbp = null;
function openDB() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
        if (!db.objectStoreNames.contains('sigs')) db.createObjectStore('sigs', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('blocked'));
    });
  }
  return dbp;
}

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const idb = {
  async get(s, id) { const db = await openDB(); return req(db.transaction(s).objectStore(s).get(id)); },
  async all(s) { const db = await openDB(); return req(db.transaction(s).objectStore(s).getAll()); },
  async put(s, obj) {
    const db = await openDB();
    const t = db.transaction(s, 'readwrite'); t.objectStore(s).put(obj);
    return new Promise((res, rej) => { t.oncomplete = () => res(obj); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort')); });
  },
  async del(s, id) {
    const db = await openDB();
    const t = db.transaction(s, 'readwrite'); t.objectStore(s).delete(id);
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  },
  async byDoc(docId) { const db = await openDB(); return req(db.transaction('pages').objectStore('pages').index('docId').getAll(docId)); },
  async clear() {
    const db = await openDB();
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach(s => t.objectStore(s).clear());
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
};

function makeMem() {
  const m = Object.fromEntries(STORES.map(s => [s, new Map()]));
  return {
    async get(s, id) { return m[s].get(id); },
    async all(s) { return [...m[s].values()]; },
    async put(s, obj) { m[s].set(obj.id, obj); return obj; },
    async del(s, id) { m[s].delete(id); },
    async byDoc(docId) { return [...m.pages.values()].filter(p => p.docId === docId); },
    async clear() { STORES.forEach(s => m[s].clear()); }
  };
}
const mem = makeMem();

let backend = mem;
let persistent = false;

export async function initStore(wantPersist) {
  if (wantPersist && 'indexedDB' in window) {
    try { await openDB(); backend = idb; persistent = true; }
    catch { backend = mem; persistent = false; }
  } else { backend = mem; persistent = false; }
  if (persistent && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return persistent;
}

export const isPersistent = () => persistent;

/** Cambia entre guardar en el celular y solo memoria, moviendo lo que ya existe. */
export async function setPersistent(on) {
  if (on === persistent) return persistent;
  const from = backend;
  const data = {};
  for (const s of STORES) data[s] = await from.all(s);
  if (on) {
    await openDB();
    for (const s of STORES) for (const o of data[s]) await idb.put(s, o);
    await mem.clear();
    backend = idb; persistent = true;
  } else {
    await mem.clear();
    for (const s of STORES) for (const o of data[s]) await mem.put(s, o);
    await idb.clear();
    backend = mem; persistent = false;
  }
  return persistent;
}

export const store = {
  getDoc: id => backend.get('docs', id),
  allDocs: async () => (await backend.all('docs')).sort((a, b) => b.updatedAt - a.updatedAt),
  putDoc: d => backend.put('docs', d),
  async deleteDoc(id) {
    const pages = await backend.byDoc(id);
    for (const p of pages) await backend.del('pages', p.id);
    await backend.del('docs', id);
  },
  getPage: id => backend.get('pages', id),
  putPage: p => backend.put('pages', p),
  delPage: id => backend.del('pages', id),
  async pagesOf(doc) {
    const list = await backend.byDoc(doc.id), byId = new Map(list.map(p => [p.id, p]));
    return doc.pageIds.map(id => byId.get(id)).filter(Boolean);
  },
  allSigs: async () => (await backend.all('sigs')).sort((a, b) => b.createdAt - a.createdAt),
  getSig: id => backend.get('sigs', id),
  putSig: s => backend.put('sigs', s),
  delSig: id => backend.del('sigs', id),
  clearAll: () => backend.clear()
};
