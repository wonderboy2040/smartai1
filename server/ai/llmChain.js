// ============================================================
// server/ai/llmChain.js — v11.0 · SHARED LLM PROVIDER CHAIN
// ------------------------------------------------------------
// The exact chain signals.js uses (Gemini → Groq → Cerebras →
// OpenRouter), extracted so the Global Market Council can ride the
// SAME chain without a circular import (signals.js ↔ council.js).
// signals.js keeps its local copy untouched — surgical-change
// discipline; this module is the v11+ home for new consumers.
// ============================================================

function tryParseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

export function aiKeysPresent(KEYS) {
  return !!(KEYS && (KEYS.gemini || KEYS.groq || KEYS.cerebras || KEYS.openrouter));
}

async function askGemini(prompt, KEYS) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      const parsed = tryParseJson(text);
      if (parsed) return parsed;
    } catch { /* next model */ }
  }
  return null;
}

async function askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, provider) {
  const cfg = OPENAI_COMPAT?.[provider];
  if (!cfg || !KEYS?.[provider]) return null;
  try {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEYS[provider]}` },
      body: JSON.stringify({
        model: cfg.defModel,
        messages: [
          { role: 'system', content: 'You are an elite trading desk analyst. Respond with STRICT JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || '';
    return tryParseJson(text);
  } catch { return null; }
}

/**
 * One ask through the provider chain. Returns { json, model } or
 * { json: null, model: null } — never throws.
 */
export async function councilAsk(prompt, deps) {
  const { KEYS, OPENAI_COMPAT } = deps || {};
  let json = null, model = null;
  if (KEYS?.gemini) { json = await askGemini(prompt, KEYS); model = json ? 'gemini' : null; }
  if (!json && KEYS?.groq) { json = await askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'groq'); model = json ? 'groq' : null; }
  if (!json && KEYS?.cerebras) { json = await askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'cerebras'); model = json ? 'cerebras' : null; }
  if (!json && KEYS?.openrouter) { json = await askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, 'openrouter'); model = json ? 'openrouter' : null; }
  return { json, model };
}

export const __testables = { tryParseJson };
