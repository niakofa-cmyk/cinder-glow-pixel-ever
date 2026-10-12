import { parseSnapshot, type SessionSnapshot } from "./session-snapshot.ts";

const DATABASE = "aurora-local-sessions";
const STORE = "sessions";
const KEY = "current";

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("Local session storage is unavailable in this browser.");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let finished = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("Local storage timed out. Close other Aurora tabs and retry.")), 10000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => fail(request.error ?? new Error("Could not open local session storage."));
    request.onblocked = () => fail(new Error("Local storage is blocked by another Aurora tab. Close it and retry."));
    request.onsuccess = () => {
      if (finished) { request.result.close(); return; }
      finished = true;
      clearTimeout(timer);
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? request.error ?? new Error("Local storage operation was interrupted."));
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("Local storage operation failed."));
    });
  } finally {
    db.close();
  }
}

export async function readLocalSession(): Promise<SessionSnapshot | null> {
  const value: unknown = await transaction("readonly", store => store.get(KEY));
  return value === undefined ? null : parseSnapshot(value);
}

export async function writeLocalSession(snapshot: SessionSnapshot): Promise<void> {
  const valid = parseSnapshot(snapshot);
  await transaction("readwrite", store => store.put(valid, KEY));
}

export async function removeLocalSession(): Promise<void> {
  await transaction("readwrite", store => store.delete(KEY));
}

export function storageMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "Browser storage is full. The previous saved session was kept. Free space or save a shorter program.";
  }
  return error instanceof Error ? error.message : "Local session storage failed. Your current audio is still open.";
}
