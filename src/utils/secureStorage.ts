import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY || 'wealth-ai-default-key-change-in-prod';

/**
 * Encrypt sensitive data (API keys, etc.)
 */
export function encryptData(data: string): string {
  try {
    return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
  } catch (e) {
    console.error('Encryption failed:', e);
    return data; // Fallback to plain text (not ideal, but prevents breakage)
  }
}

/**
 * Decrypt sensitive data
 */
export function decryptData(encrypted: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    console.error('Decryption failed:', e);
    return encrypted; // Fallback
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
      // Encrypt sensitive keys
      const sensitiveKeys = ['WEALTH_AI_GROQ', 'TG_TOKEN', 'TG_CHAT_ID'];
      if (sensitiveKeys.includes(key)) {
        const encrypted = encryptData(value);
        localStorage.setItem(key, `enc:${encrypted}`);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (e) {
      console.error('Storage setItem failed:', e);
    }
  },

  removeItem(key: string): void {
    localStorage.removeItem(key);
  },

  clear(): void {
    localStorage.clear();
  }
};
