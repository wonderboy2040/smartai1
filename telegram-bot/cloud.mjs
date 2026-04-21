// ============================================
// CLOUD SYNC — Google Apps Script Integration
// ============================================

import { API_URL, setAIKeys } from './config.mjs';

// ========================================
// LOAD PORTFOLIO FROM CLOUD
// ========================================
export async function loadPortfolioFromCloud() {
  if (!API_URL) return null;

  try {
    const res = await fetch(`${API_URL}?action=load&t=${Date.now()}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;

  const text = await res.text();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match || match[0] === '{}') return null;

  let data;
  try { data = JSON.parse(match[0]); } catch { return null; }
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }

    if (data.portfolio && Array.isArray(data.portfolio)) {
      console.log(`☁️ Cloud Sync: Loaded ${data.portfolio.length} positions`);
      return data.portfolio;
    }
  } catch (e) {
    console.warn('☁️ Cloud load failed:', e.message);
  }

  return null;
}

// ========================================
// LOAD AI KEYS FROM CLOUD
// ========================================
export async function loadAIKeysFromCloud() {
  if (!API_URL) return null;

  try {
    const res = await fetch(`${API_URL}?action=loadKeys&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;

  const text = await res.text();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let data;
  try { data = JSON.parse(match[0]); } catch { return null; }

  const keys = {
    GEMINI: data.geminiKey || "",
    PERPLEXITY: data.perplexityKey || "",
    DEEPSEEK: data.deepseekKey || ""
  };

  if (Object.values(keys).some(k => k && k.length > 10)) {
    console.log('🔑 AI Super Intelligence Keys loaded from cloud');
    setAIKeys(keys);
    return keys;
  }
  } catch (e) {
    console.warn('🔑 AI keys cloud load failed:', e.message);
  }

  return null;
}

// ========================================
// SYNC PORTFOLIO TO CLOUD
// ========================================
export async function syncPortfolioToCloud(portfolio, usdInr) {
  if (!API_URL) return false;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ portfolio, timestamp: Date.now(), usdInr })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
