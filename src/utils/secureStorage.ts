import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.warn('VITE_ENCRYPTION_KEY not set — secureStorage encryption is disabled');
}

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
 * Decrypt sensitive data
 */
export function decryptData(encrypted: string): string {
  try {
    if (!ENCRYPTION_KEY) return encrypted;
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    console.warn('Decryption failed:', e);
    return encrypted;
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
      // Check if item looks encrypted (has salt prefix)
      if (item.startsWith('enc:')) {
        return decryptData(item.slice(4));
      }
      return item;
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      const sensitiveKeys = ['WEALTH_AI_GROQ', 'TG_TOKEN', 'TG_CHAT_ID'];
      if (sensitiveKeys.includes(key) && ENCRYPTION_KEY) {
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
    localStorage.removeItem(key);
  },

  clear(): void {
    localStorage.clear();
  }
};
