// ============================================================
// IndexedDB Storage Engine — Wealth AI (v13.5 cleanup)
// ------------------------------------------------------------
// v13.5 (full-site recheck): this file shipped 6 object stores but
// only TWO were ever live — aiChatHistory (NeuralChat memory) and
// userPreferences (paperMirror durability). The other four
// (transactions, priceHistory, offlineQueue, portfolioSnapshots)
// were never read: the ledger uses localStorage 'txn_history',
// nothing ever wrote priceHistory, nothing ever drained the offline
// queue, and portfolioSnapshots was WRITE-ONLY (App.tsx saved a
// row per minute, nothing ever read it — unbounded accumulation).
// DB_VERSION 2 deletes those stores from existing browsers (frees
// the junk) and this module now exposes only the live surface.
// ============================================================

export interface DBChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  model?: string;
  latencyMs?: number;
  confidence?: number;
  sentiment?: string;
}

const DB_NAME = 'wealthai_idb_v18';
const DB_VERSION = 2;

class IndexedDBStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isAvailable: boolean = typeof window !== 'undefined' && 'indexedDB' in window;

  private async getDB(): Promise<IDBDatabase> {
    if (!this.isAvailable) {
      throw new Error('IndexedDB not available in current environment');
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // v13.5 cleanup: v1 created 6 stores; 4 were dead from day one.
          // The v2 upgrade DELETES them from existing browsers so the
          // write-only junk (a year of per-minute portfolioSnapshots on
          // long-lived devices) is reclaimed.
          for (const dead of ['transactions', 'priceHistory', 'offlineQueue', 'portfolioSnapshots']) {
            if (db.objectStoreNames.contains(dead)) {
              try { db.deleteObjectStore(dead); } catch { /* best-effort */ }
            }
          }

          // AI Chat history store
          if (!db.objectStoreNames.contains('aiChatHistory')) {
            const chatStore = db.createObjectStore('aiChatHistory', { keyPath: 'id' });
            chatStore.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // User preferences & profile
          if (!db.objectStoreNames.contains('userPreferences')) {
            db.createObjectStore('userPreferences', { keyPath: 'key' });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          // v10.13 (deep-recheck M7): reset the cached promise on failure —
          // a transient open failure (private mode, blocked upgrade, quota)
          // used to leave the REJECTED promise cached forever, so every call
          // this session took the localStorage fallback even after IndexedDB
          // recovered.
          this.dbPromise = null;
          reject(request.error);
        };
        request.onblocked = () => {
          console.warn('[IndexedDB] Database upgrade blocked');
          this.dbPromise = null; // v10.13: allow a retry once the blocker clears
        };
      } catch (err) {
        reject(err);
      }
    });

    return this.dbPromise;
  }

  // --- AI Chat History ---
  async saveChatMessage(msg: DBChatMessage): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('aiChatHistory', 'readwrite');
        const store = tx.objectStore('aiChatHistory');
        const req = store.put(msg);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        const list = JSON.parse(localStorage.getItem('neural_chat_v5') || '[]');
        list.push(msg);
        localStorage.setItem('neural_chat_v5', JSON.stringify(list.slice(-50)));
      } catch {}
    }
  }

  async getChatHistory(limit = 100): Promise<DBChatMessage[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('aiChatHistory', 'readonly');
        const store = tx.objectStore('aiChatHistory');
        const req = store.getAll();
        req.onsuccess = () => {
          const results = (req.result || []) as DBChatMessage[];
          results.sort((a, b) => a.timestamp - b.timestamp);
          resolve(results.slice(-limit));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        return JSON.parse(localStorage.getItem('neural_chat_v5') || '[]');
      } catch {
        return [];
      }
    }
  }

  async clearChatHistory(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('aiChatHistory', 'readwrite');
        const store = tx.objectStore('aiChatHistory');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.removeItem('neural_chat_v5');
      } catch {}
    }
  }

  // --- User Preferences & Profile Learning ---
  async setUserPreference<T>(key: string, value: T): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('userPreferences', 'readwrite');
        const store = tx.objectStore('userPreferences');
        const req = store.put({ key, value, updatedAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      try {
        localStorage.setItem(`pref_${key}`, JSON.stringify(value));
      } catch {}
    }
  }

  async getUserPreference<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('userPreferences', 'readonly');
        const store = tx.objectStore('userPreferences');
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.value !== undefined) {
            resolve(req.result.value as T);
          } else {
            resolve(defaultValue);
          }
        };
        req.onerror = () => resolve(defaultValue);
      });
    } catch {
      try {
        const item = localStorage.getItem(`pref_${key}`);
        return item ? JSON.parse(item) : defaultValue;
      } catch {
        return defaultValue;
      }
    }
  }
}

export const appDB = new IndexedDBStorage();
