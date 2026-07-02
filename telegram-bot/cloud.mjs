// ============================================
// CLOUD SYNC — Google Apps Script Integration
// Advance Pro v16.0 — Groq Super Intelligence
// ============================================

import {
  API_URL,
  setGroqKey, setTavilyKey,
  GROQ_KEY, TAVILY_API_KEY
} from './config.mjs';

export async function loadPortfolioFromCloud() {
  if (!API_URL) return null;

  try {
    const res = await fetch(`${API_URL}?action=load&t=${Date.now()}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;

    const text = await res.text();
    // FIX: greedy `\{[\s\S]*\}` over-captures when Apps Script wraps JSON
    // in HTML/prose. Try strict JSON.parse first, then non-greedy fallback.
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match || match[0] === '{}') return null;
      try { data = JSON.parse(match[0]); } catch { return null; }
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return null; }
    }

    if (data && data.portfolio && Array.isArray(data.portfolio)) {
      console.log(`☁️ Cloud Sync: Loaded ${data.portfolio.length} positions`);
      return data.portfolio;
    }
  } catch (e) {
    console.warn('☁️ Cloud load failed:', e.message);
  }

  return null;
}

export async function loadGroqKeyFromCloud() {
  if (!API_URL) return null;

  try {
    const res = await fetch(`${API_URL}?action=loadKey&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;

    const text = await res.text();
    // FIX: greedy regex replaced with strict JSON.parse + non-greedy fallback.
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return null;
      try { data = JSON.parse(match[0]); } catch { return null; }
    }
    const key = data.groqKey;
    if (key && typeof key === 'string') {
      if (key.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(key);
          if (parsed.groqKey) setGroqKey(parsed.groqKey);
          if (parsed.tavilyKey) setTavilyKey(parsed.tavilyKey);
          console.log('🔑 Groq API key loaded from cloud (JSON)');
          return parsed.groqKey || "";
        } catch (err) {
          console.warn('⚠️ Cloud keys JSON parse failed:', err);
        }
      }

      // FIX CRIT: previously `key.length > 10` accepted any string — a user
      // running `/setkey groq junkjunkjunk` would overwrite the working key
      // with garbage and brick AI chat for everyone. Require the canonical
      // `gsk_` prefix + minimum length.
      if (key.startsWith('gsk_') && key.length > 20) {
        console.log('🔑 Groq API Key loaded from cloud (Legacy string)');
        setGroqKey(key);
        return key;
      }
    }
  } catch (e) {
    console.warn('🔑 Groq key cloud load failed:', e.message);
  }

  return null;
}

export async function saveAllKeysToCloud() {
  if (!API_URL) return false;
  const payload = {
    groqKey: GROQ_KEY || "",
    tavilyKey: TAVILY_API_KEY || ""
  };
  const serialized = JSON.stringify(payload);
  try {
    // FIX: no timeout previously → if Apps Script hangs, request hangs forever.
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groqKey: serialized, action: 'saveKey', timestamp: Date.now() }),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export async function saveGroqKeyToCloud(key) {
  if (key && typeof key === 'string') {
    if (key.startsWith('{')) {
      try {
        const parsed = JSON.parse(key);
        if (parsed.groqKey) setGroqKey(parsed.groqKey);
        if (parsed.tavilyKey) setTavilyKey(parsed.tavilyKey);
      } catch (err) {}
    } else {
      setGroqKey(key);
    }
  }
  return saveAllKeysToCloud();
}

export async function syncPortfolioToCloud(portfolio, usdInr) {
  if (!API_URL) return false;
  if (!portfolio || portfolio.length === 0) {
    console.warn('☁️ Cloud Sync: Blocking sync because portfolio is empty to prevent accidental deletion.');
    return false;
  }

  try {
    // FIX: no timeout previously.
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', portfolio, timestamp: Date.now(), usdInr }),
      signal: AbortSignal.timeout(10000)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
