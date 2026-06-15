import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.warn('VITE_ENCRYPTION_KEY not set — secureStorage encryption is disabled');
}

// All keys that hold sensitive data (API keys, tokens, combined blob)
const SENSITIVE_KEYS = [
  'WEALTH_AI_KEYS',
  'WEALTH_AI_GROQ',
  'WEALTH_AI_GEMINI',
  'WEALTH_AI_CLAUDE',
  'WEALTH_AI_TAVILY',
  'TG_TOKEN',
  'TG_CHAT_ID'
];

/**
 * Encrypt sensitive data (API keys, etc.)
 */
export function encryptData(data: string): string {
  try {
    if (!ENCRYPTION_KEY) return data;
    return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
  } catch (e) {
    console.warn('Encryption failed:', e);
    return data;
  }
}

/**
 * Decrypt sensitive data. Returns null on failure so callers can
 * safely fall back instead of receiving corrupted garbage.
 */
export function decryptData(encrypted: string): string | null {
  try {
    if (!ENCRYPTION_KEY) return encrypted;
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    const text = bytes.toString(CryptoJS.enc.Utf8);
    // Empty result means wrong key / corrupted ciphertext
    if (!text) return null;
    return text;
  } catch (e) {
    console.warn('Decryption failed:', e);
    return null;
  }
}

/**
 * Secure localStorage wrapper with encryption
 */
export const secureStorage = {
  getItem(key: string): string | null {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;
      // Encrypted items carry an "enc:" prefix
      if (item.startsWith('enc:')) {
        const decrypted = decryptData(item.slice(4));
        // FIX: if decryption fails (env key changed/missing), drop the
        // corrupt entry instead of returning garbage to the app.
        if (decrypted === null) {
          try { localStorage.removeItem(key); } catch { }
          return null;
        }
        return decrypted;
      }
      return item;
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      // FIX: encrypt ALL sensitive keys (was missing Gemini/Claude/Tavily/combined blob)
      if (SENSITIVE_KEYS.includes(key) && ENCRYPTION_KEY) {
        const encrypted = encryptData(value);
        localStorage.setItem(key, `enc:${encrypted}`);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn('Storage setItem failed:', e);
    }
  },

  removeItem(key: string): void {
    try { localStorage.removeItem(key); } catch (e) { console.warn('Storage removeItem failed:', e); }
  },

  clear(): void {
    try { localStorage.clear(); } catch (e) { console.warn('Storage clear failed:', e); }
  }
};
