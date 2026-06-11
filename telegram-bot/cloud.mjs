// ============================================
// CLOUD SYNC — Google Apps Script Integration
// ============================================

import { 
  API_URL, 
  setGroqKey, setGeminiKey, setClaudeKey, setNvidiaKey, setTavilyKey,
  GROQ_KEY, GEMINI_API_KEY, CLAUDE_API_KEY, NVIDIA_API_KEY, TAVILY_API_KEY
} from './config.mjs';

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

export async function loadGroqKeyFromCloud() {
  if (!API_URL) return null;
  
  try {
    const res = await fetch(`${API_URL}?action=loadKey&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    
    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    let data;
    try { data = JSON.parse(match[0]); } catch { return null; }
    const key = data.groqKey || data.geminiKey || data.claudeKey;
    if (key && typeof key === 'string') {
      if (key.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(key);
          if (parsed.groqKey) setGroqKey(parsed.groqKey);
          if (parsed.geminiKey) setGeminiKey(parsed.geminiKey);
          if (parsed.claudeKey) setClaudeKey(parsed.claudeKey);
          if (parsed.nvidiaKey) setNvidiaKey(parsed.nvidiaKey);
          if (parsed.tavilyKey) setTavilyKey(parsed.tavilyKey);
          console.log('🔑 Multi-AI API Keys loaded from cloud (JSON)');
          return parsed.groqKey || parsed.geminiKey || parsed.claudeKey || "";
        } catch (err) {
          console.warn('⚠️ Cloud keys JSON parse failed:', err);
        }
      }
      
      if (key.length > 10) {
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

// ========================================
// SAVE ALL KEYS TO CLOUD
// ========================================
export async function saveAllKeysToCloud() {
  if (!API_URL) return false;
  const payload = {
    groqKey: GROQ_KEY || "",
    geminiKey: GEMINI_API_KEY || "",
    claudeKey: CLAUDE_API_KEY || "",
    nvidiaKey: NVIDIA_API_KEY || "",
    tavilyKey: TAVILY_API_KEY || ""
  };
  const serialized = JSON.stringify(payload);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groqKey: serialized, action: 'saveKey', timestamp: Date.now() })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ========================================
// SAVE GROQ KEY TO CLOUD
// ========================================
export async function saveGroqKeyToCloud(key) {
  if (key && typeof key === 'string') {
    if (key.startsWith('{')) {
      try {
        const parsed = JSON.parse(key);
        if (parsed.groqKey) setGroqKey(parsed.groqKey);
        if (parsed.geminiKey) setGeminiKey(parsed.geminiKey);
        if (parsed.claudeKey) setClaudeKey(parsed.claudeKey);
        if (parsed.nvidiaKey) setNvidiaKey(parsed.nvidiaKey);
        if (parsed.tavilyKey) setTavilyKey(parsed.tavilyKey);
      } catch (err) {}
    } else {
      setGroqKey(key);
    }
  }
  return saveAllKeysToCloud();
}

// ========================================
// SYNC PORTFOLIO TO CLOUD
// ========================================
export async function syncPortfolioToCloud(portfolio, usdInr) {
  if (!API_URL) return false;
  if (!portfolio || portfolio.length === 0) {
    console.warn('☁️ Cloud Sync: Blocking sync because portfolio is empty to prevent accidental deletion.');
    return false;
  }

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', portfolio, timestamp: Date.now(), usdInr })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
