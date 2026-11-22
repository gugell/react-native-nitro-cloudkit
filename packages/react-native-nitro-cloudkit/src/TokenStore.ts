/**
 * Where the client keeps sync tokens for `pull()`: memory, MMKV, AsyncStorage, SQLite… Values are
 * opaque strings (CKSyncEngine's serialized state, a few KB).
 */
export interface TokenStore {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

/** Tokens in memory: tests, and apps that start over on every launch. */
export function createMemoryTokenStore(): TokenStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
}

/** The shape of a synchronous key-value store such as an `MMKV` instance. */
export interface KeyValueStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete?(key: string): void;
  remove?(key: string): void;
}

/** Tokens in a synchronous key-value store, e.g. `createKeyValueTokenStore(new MMKV())`. */
export function createKeyValueTokenStore(storage: KeyValueStorage): TokenStore {
  return {
    get: (key) => storage.getString(key) ?? null,
    set: (key, value) => storage.set(key, value),
    delete: (key) => {
      if (storage.remove) storage.remove(key);
      else storage.delete?.(key);
    },
  };
}
