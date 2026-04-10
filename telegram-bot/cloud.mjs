// ============================================
// CLOUD SYNC — Google Apps Script Integration
// ============================================

import { API_URL, setGeminiKey } from './config.mjs';

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
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match || match[0] === '{}') return null;
    
    let data = JSON.parse(match[0]);
    if (typeof data === 'string') data = JSON.parse(data);
    
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
// LOAD GEMINI KEY FROM CLOUD
// ========================================
export async function loadGeminiKeyFromCloud() {
  if (!API_URL) return null;
  
  try {
    const res = await fetch(`${API_URL}?action=loadKey&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    
    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    
    const data = JSON.parse(match[0]);
    const key = data.geminiKey;
    if (key && typeof key === 'string' && key.length > 10) {
      console.log('🔑 Gemini API Key loaded from cloud');
      setGeminiKey(key);
      return key;
    }
  } catch (e) {
    console.warn('🔑 Gemini key cloud load failed:', e.message);
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
