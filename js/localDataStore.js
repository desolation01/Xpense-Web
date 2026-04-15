(function () {
  const DB_NAME = "xpense-local-db";
  const DB_VERSION = 1;
  const STORE_NAME = "kv";

  const hasIndexedDB = typeof window !== "undefined" && "indexedDB" in window;

  function structuredCloneSafe(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function parseLocalStorageValue(raw) {
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      if (raw === "null") return null;
      const num = Number(raw);
      if (Number.isFinite(num) && String(num) === raw) return num;
      return raw;
    }
  }

  function serializeLocalStorageValue(value) {
    return JSON.stringify(value);
  }

  class LocalDataStore {
    constructor() {
      this.dbPromise = null;
      this.useFallback = !hasIndexedDB;
      this.ready = false;
    }

    async init() {
      if (this.ready) return;
      if (this.useFallback) {
        this.ready = true;
        return;
      }

      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
      });

      try {
        await this.dbPromise;
        this.ready = true;
      } catch (error) {
        console.warn("IndexedDB unavailable, falling back to localStorage", error);
        this.useFallback = true;
        this.ready = true;
      }
    }

    async getData(key) {
      await this.init();

      if (this.useFallback) {
        return parseLocalStorageValue(localStorage.getItem(key));
      }

      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error(`Failed to read key: ${key}`));
      });
    }

    async saveData(key, value) {
      await this.init();
      const safeValue = structuredCloneSafe(value);

      if (this.useFallback) {
        localStorage.setItem(key, serializeLocalStorageValue(safeValue));
        return;
      }

      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(safeValue, key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error(`Failed to write key: ${key}`));
      });
    }

    async deleteData(key) {
      await this.init();

      if (this.useFallback) {
        localStorage.removeItem(key);
        return;
      }

      const db = await this.dbPromise;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error(`Failed to delete key: ${key}`));
      });
    }

    async seedDefaults(defaults) {
      await this.init();
      const entries = Object.entries(defaults || {});

      for (const [key, value] of entries) {
        const existing = await this.getData(key);
        if (typeof existing === "undefined") {
          await this.saveData(key, value);
        }
      }
    }

    async exportAllData(keys) {
      await this.init();
      const result = {};
      const keyList = Array.isArray(keys) ? keys : [];

      for (const key of keyList) {
        result[key] = await this.getData(key);
      }

      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: result,
      };
    }

    async importAllData(payload) {
      await this.init();
      if (!payload || typeof payload !== "object") return;
      const data = payload.data && typeof payload.data === "object" ? payload.data : payload;

      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "undefined") continue;
        await this.saveData(key, value);
      }
    }
  }

  window.localDataStore = new LocalDataStore();
})();
