// ============================================================
// Wealth AI Pro — Backend API Proxy Server
// ------------------------------------------------------------
// Serves the built frontend (dist/) AND the /api/* proxy
// endpoints that the frontend expects. All AI provider API
// keys live ONLY on the server (never shipped to the browser).
//
// Run:   node server/index.js   (Render "Web Service" start cmd)
// Env:   PORT, GROQ_API_KEY, GEMINI_API_KEY, CLAUDE_API_KEY,
//        OPENROUTER_API_KEY, CEREBRAS_API_KEY, HF_API_KEY,
//        NVIDIA_API_KEY, TAVILY_API_KEY, API_URL (optional)
// ============================================================
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '1mb' }));

// --- CORS (allow the SPA to call us from any origin) ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ------------------------------------------------------------
// Provider key map (server-side env vars — NOT VITE_*)
// ------------------------------------------------------------
const KEYS = {
  groq:        process.env.GROQ_API_KEY || '',
  gemini:      process.env.GEMINI_API_KEY || '',
  claude:      process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  openrouter:  process.env.OPENROUTER_API_KEY || '',
  cerebras:    process.env.CEREBRAS_API_KEY || '',
  huggingface: process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || '',
  nvidia:      process.env.NVIDIA_API_KEY || '',
  tavily:      process.env.TAVILY_API_KEY || '',
};

// OpenAI-compatible providers — body is forwarded almost as-is.
const OPENAI_COMPAT = {
  groq:        { url: 'https://api.groq.com/openai/v1/chat/completions', defModel: 'llama-3.3-70b-versatile' },
  openrouter:  { url: 'https://openrouter.ai/api/v1/chat/completions',   defModel: 'meta-llama/llama-3.3-70b-instruct:free' },
  cerebras:    { url: 'https://api.cerebras.ai/v1/chat/completions',     defModel: 'llama-3.3-70b' },
  huggingface: { url: 'https://router.huggingface.co/v1/chat/completions', defModel: 'Qwen/Qwen2.5-72B-Instruct' },
  nvidia:      { url: 'https://integrate.api.nvidia.com/v1/chat/completions', defModel: 'meta/llama-3.1-8b-instruct' },
};

function jsonError(res, status, message) {
  return res.status(status).json({ error: { message } });
}

// ------------------------------------------------------------
// GET /api/config  → optional runtime config for the frontend
// ------------------------------------------------------------
app.get('/api/config', (_req, res) => {
  res.json(process.env.API_URL ? { apiUrl: process.env.API_URL } : {});
});

// ------------------------------------------------------------
// GET /api/ai-status → which providers have a key configured.
// The frontend skips any engine that is false here.
// ------------------------------------------------------------
app.get('/api/ai-status', (_req, res) => {
  res.json({
    gemini:      !!KEYS.gemini,
    groq:        !!KEYS.groq,
    claude:      !!KEYS.claude,
    openrouter:  !!KEYS.openrouter,
    cerebras:    !!KEYS.cerebras,
    huggingface: !!KEYS.huggingface,
    nvidia:      !!KEYS.nvidia,
    tavily:      !!KEYS.tavily,
  });
});

// ------------------------------------------------------------
// Generic OpenAI-compatible proxy (groq/openrouter/cerebras/hf/nvidia)
// ------------------------------------------------------------
for (const [name, cfg] of Object.entries(OPENAI_COMPAT)) {
  app.post(`/api/${name}`, async (req, res) => {
    const key = KEYS[name];
    if (!key) return jsonError(res, 503, `${name} not configured`);
    try {
      const body = { ...req.body };
      if (!body.model) body.model = cfg.defModel;
      if (!Array.isArray(body.messages)) return jsonError(res, 400, 'messages[] required');
      const upstream = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...(name === 'openrouter' ? { 'HTTP-Referer': 'https://smartai11.onrender.com', 'X-Title': 'Wealth AI Pro' } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const text = await upstream.text();
      res.status(upstream.status).type('application/json').send(text || '{}');
    } catch (e) {
      return jsonError(res, 502, `${name} upstream error: ${e?.message || e}`);
    }
  });
}

// ------------------------------------------------------------
// POST /api/gemini → translate OpenAI-style messages → Gemini,
// return Gemini's native shape (candidates[0].content.parts[0].text)
// ------------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
  if (!KEYS.gemini) return jsonError(res, 503, 'gemini not configured');
  try {
    const { messages = [], model = 'gemini-2.0-flash' } = req.body || {};
    const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n').trim();
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
    const payload = { contents };
    if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (e) {
    return jsonError(res, 502, `gemini upstream error: ${e?.message || e}`);
  }
});

// ------------------------------------------------------------
// POST /api/claude → Anthropic Messages API,
// return native shape (content[0].text)
// ------------------------------------------------------------
app.post('/api/claude', async (req, res) => {
  if (!KEYS.claude) return jsonError(res, 503, 'claude not configured');
  try {
    const { messages = [], model = 'claude-sonnet-4-20250514', max_tokens = 1024 } = req.body || {};
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n').trim();
    const conv = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
    const payload = { model, max_tokens, messages: conv };
    if (system) payload.system = system;
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEYS.claude,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (e) {
    return jsonError(res, 502, `claude upstream error: ${e?.message || e}`);
  }
});

// ------------------------------------------------------------
// Static frontend (built by `vite build` → dist/)
// ------------------------------------------------------------
const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir));

// SPA fallback for any non-/api route
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  const ready = Object.entries(KEYS).filter(([, v]) => v).map(([k]) => k);
  console.log(`[wealth-ai] server on :${PORT} — providers ready: ${ready.join(', ') || 'NONE (set API keys!)'}`);

  // --- Keep-alive (free-tier anti-spin-down) ---------------------------
  // Render's free Web Service plan spins the instance down after ~15 min
  // with no inbound traffic. On cold start the browser fires all asset
  // requests at once and some 404 before the instance is up, which breaks
  // the SPA (blank page). Self-pinging the public URL keeps the instance
  // awake so it never cold-starts. Render injects RENDER_EXTERNAL_URL
  // automatically; set KEEP_ALIVE=false to disable.
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl && process.env.KEEP_ALIVE !== 'false') {
    const PING_MS = 12 * 60 * 1000; // every 12 min (< Render's 15 min idle)
    setInterval(() => {
      fetch(`${selfUrl}/api/ai-status`, { signal: AbortSignal.timeout(8000) })
        .catch(() => { /* ignore — best-effort keep-alive */ });
    }, PING_MS).unref();
    console.log(`[wealth-ai] keep-alive enabled → ${selfUrl}/api/ai-status every 12m`);
  }
});
