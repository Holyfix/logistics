// Malá obálka nad IndexedDB: uložená složka a zpracované exporty (mezipaměť).

const DB_NAME = 'logistics';
const DB_VERSION = 1;
export const STORE_KV = 'kv';
export const STORE_CALLOFFS = 'calloffs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      if (!db.objectStoreNames.contains(STORE_CALLOFFS)) db.createObjectStore(STORE_CALLOFFS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB'));
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB'));
      }),
  );
}

export const idbGet = <T>(store: string, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbSet = (store: string, key: string, value: unknown) => run(store, 'readwrite', (s) => s.put(value, key));
export const idbDelete = (store: string, key: string) => run(store, 'readwrite', (s) => s.delete(key));
export const idbKeys = (store: string) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
