const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.warn('VITE_ENCRYPTION_KEY not set — secureStorage encryption is disabled');
}

const SENSITIVE_KEYS = [
  'WEALTH_AI_KEYS',
  'WEALTH_AI_GROQ',
  'WEALTH_AI_TAVILY',
  'TG_TOKEN',
  'TG_CHAT_ID'
];

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(ENCRYPTION_KEY || ''),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const saltBuf = new ArrayBuffer(salt.length);
  new Uint8Array(saltBuf).set(salt);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBuf, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data: string): Promise<string> {
  if (!ENCRYPTION_KEY || !isCryptoAvailable()) return data;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(salt);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    enc.encode(data)
  );
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);
  let bin = ''; for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
  return btoa(bin);
}

async function decryptData(encrypted: string): Promise<string | null> {
  if (!ENCRYPTION_KEY || !isCryptoAvailable()) return encrypted;
  try {
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
    const key = await deriveKey(salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted) || null;
  } catch {
    return null;
  }
}

function legacyDecrypt(encrypted: string): string | null {
  try {
    const CryptoJS = (window as any).CryptoJS;
    if (!CryptoJS || !ENCRYPTION_KEY) return null;
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    const text = bytes.toString(CryptoJS.enc.Utf8);
    return text || null;
  } catch {
    return null;
  }
}

let migrationDone = false;

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.includes(key);
}

export const secureStorage = {
  // Synchronous — for non-sensitive data (theme, portfolio, plannerSettings)
  getItem(key: string): string | null {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      if (item.startsWith('enc:')) {
        const payload = item.slice(4);
        // Already migrated to WebCrypto format? (base64 without legacy prefix)
        if (!migrationDone && legacyDecrypt(payload) !== null) {
          const plain = legacyDecrypt(payload);
          if (plain !== null) {
            encryptData(plain).then(reEnc => {
              try { localStorage.setItem(key, `enc:${reEnc}`); migrationDone = true; } catch { }
            }).catch(() => {});
            return plain;
          }
        }
        // Try WebCrypto sync-read (this won't work in Safari workers but fine in main thread)
        if (!isCryptoAvailable()) return null;
        // Fall-through — async caller should use getItemAsync
        return null;
      }

      return item;
    } catch {
      return null;
    }
  },

  // Async — for sensitive data (API keys, tokens)
  async getItemAsync(key: string): Promise<string | null> {
    try {
      const item = localStorage.getItem(key);
      if (!item) return null;

      if (item.startsWith('enc:')) {
        const payload = item.slice(4);

        if (!migrationDone) {
          const legacy = legacyDecrypt(payload);
          if (legacy !== null) {
            try {
              const reEnc = await encryptData(legacy);
              localStorage.setItem(key, `enc:${reEnc}`);
              migrationDone = true;
            } catch { }
            return legacy;
          }
        }

        const decrypted = await decryptData(payload);
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

  // Fire-and-forget — most callers don't need to await
  setItem(key: string, value: string): void {
    if (isSensitive(key) && ENCRYPTION_KEY && isCryptoAvailable()) {
      encryptData(value).then(encrypted => {
        try { localStorage.setItem(key, `enc:${encrypted}`); } catch { }
      });
    } else {
      try { localStorage.setItem(key, value); } catch { }
    }
  },

  // Fire-and-forget set, returns value for chaining convenience
  setItemPlain(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { }
  },

  removeItem(key: string): void {
    try { localStorage.removeItem(key); } catch { }
  },

  clear(): void {
    try { localStorage.clear(); } catch { }
  }
};
