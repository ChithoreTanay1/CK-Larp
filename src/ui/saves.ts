/** Save slots in IndexedDB, plus file export/import. */

export interface SaveSlot {
  name: string;
  scenario: string;
  realm: string;
  ruler: string;
  date: string;
  savedAt: number;
  size: number;
  buffer: ArrayBuffer;
}

const DB = 'ashes-and-iron';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          res(req.result);
        };
        t.onerror = () => rej(t.error);
      }),
  );
}

export const putSave = (s: SaveSlot) => tx('readwrite', (st) => st.put(s)).then(() => undefined);
export const getSave = (name: string) => tx<SaveSlot | undefined>('readonly', (st) => st.get(name));
export const deleteSave = (name: string) => tx('readwrite', (st) => st.delete(name)).then(() => undefined);
export const listSaves = () => tx<SaveSlot[]>('readonly', (st) => st.getAll()).then((all) => all.sort((a, b) => b.savedAt - a.savedAt));

export function downloadSave(s: SaveSlot): void {
  const url = URL.createObjectURL(new Blob([s.buffer], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.name.replace(/[^\w-]+/g, '_')}.aisave`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(): Promise<ArrayBuffer | null> {
  return new Promise((res) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.aisave';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return res(null);
      f.arrayBuffer().then(res, () => res(null));
    };
    input.click();
  });
}
