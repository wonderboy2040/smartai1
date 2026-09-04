// ============================================================
// server/ai/secrets.js — AI TERMINAL SECRETS (server-side only)
// ------------------------------------------------------------
// v6.5 — the roadmap items users asked for by chat:
//   • Telegram bot token + chat id  (alert delivery)
//   • AI Council keys (Gemini / Groq) — the 9th model without
//     needing Render env access
//
// Stored in server/data/ai-secrets.json and mirrored to the
// ENCRYPTED GitHub durable backup (durablePut) — the same pipeline
// as the CoinDCX API keys. Unlike mcp-settings.json (whose values
// are served back to the browser for UI display), these values are
// NEVER returned raw: GET endpoints serve a masked status only
// ({ configured, tail: '…abcd' }). env vars always remain a
// fallback — a secret set here simply WINS (the user typed it in
// the UI precisely because they can't set env on Render easily).
// ============================================================
import { loadJSON, saveJSON } from '../lib/store.js';
import { durablePut } from '../mcp/durable.js';

const SECRETS_FILE = 'ai-secrets.json';

// ---- known keys + validators --------------------
// Each validator: (value) => sanitized string | null (clear).
// Throws a 400-shaped error on invalid input.
const KEYS = {
  telegramBotToken: (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(s)) {
      throw Object.assign(
        new Error('Telegram bot token format is <botId>:<hash> — get it from @BotFather'),
        { status: 400, code: 'BAD_REQUEST' },
      );
    }
    return s;
  },
  telegramChatId: (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim().replace(/^-100/, '100'); // supergroup prefix tolerated
    if (!/^\d{3,20}$/.test(s)) {
      throw Object.assign(
        new Error('Telegram chat id must be numeric — get it from @userinfobot or the bot\'s /getUpdates'),
        { status: 400, code: 'BAD_REQUEST' },
      );
    }
    return s;
  },
  geminiApiKey: (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (s.length < 20 || /\s/.test(s)) {
      throw Object.assign(new Error('Gemini API key looks invalid (expected a long token from aistudio.google.com)'), { status: 400, code: 'BAD_REQUEST' });
    }
    return s;
  },
  groqApiKey: (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (s.length < 20 || /\s/.test(s)) {
      throw Object.assign(new Error('Groq API key looks invalid (expected gsk_... from console.groq.com)'), { status: 400, code: 'BAD_REQUEST' });
    }
    return s;
  },
};

export function getSecrets() {
  const store = loadJSON(SECRETS_FILE, { secrets: {} }) || {};
  const out = {};
  for (const k of Object.keys(KEYS)) {
    const v = store?.secrets?.[k];
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/** Set (or clear, when value == null) one secret. Validates strictly,
 *  persists to disk + pushes the encrypted durable backup. */
export function setSecret(key, value) {
  if (!Object.prototype.hasOwnProperty.call(KEYS, key) || typeof key !== 'string') {
    throw Object.assign(
      new Error(`Unknown secret key: ${String(key)} (known: ${Object.keys(KEYS).join(', ')})`),
      { status: 400, code: 'BAD_REQUEST' },
    );
  }
  const clean = KEYS[key](value);
  const store = loadJSON(SECRETS_FILE, { secrets: {} }) || {};
  if (!store.secrets || typeof store.secrets !== 'object') store.secrets = {};
  if (clean == null) delete store.secrets[key];
  else store.secrets[key] = clean;
  store.updatedAt = Date.now();
  saveJSON(SECRETS_FILE, store);
  try { durablePut(SECRETS_FILE, store); } catch { /* best-effort */ }
  return true;
}

/** Masked status for the browser — NEVER the raw values. */
export function secretsStatus() {
  const s = getSecrets();
  const mask = (v) => (v ? { configured: true, tail: `…${v.slice(-4)}` } : { configured: false, tail: null });
  return {
    telegramBotToken: mask(s.telegramBotToken),
    telegramChatId: mask(s.telegramChatId),
    geminiApiKey: mask(s.geminiApiKey),
    groqApiKey: mask(s.groqApiKey),
  };
}

// ---------------- telegram delivery ----------------
/**
 * Resolve the ACTIVE telegram config: secrets WIN over env (the UI
 * is where the user typed their intent), env is the fallback.
 * Returns { token, chatId } or null when unconfigured.
 */
export function telegramConfig(env = {}) {
  const s = getSecrets();
  const token = s.telegramBotToken || (env?.token || '');
  const chatId = s.telegramChatId || (env?.chatId || '');
  return token && chatId ? { token, chatId, source: s.telegramBotToken ? 'app' : 'env' } : null;
}

/** Fire-and-safe send (never throws; 10s timeout). */
export async function sendTelegramMessage(text, env = {}) {
  const cfg = telegramConfig(env);
  if (!cfg) return { ok: false, error: 'telegram not configured' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, error: `telegram HTTP ${r.status} ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) };
  }
}

// ---------------- test hooks ----------------
export function __resetSecretsForTests() {
  saveJSON(SECRETS_FILE, { secrets: {}, updatedAt: 0 });
}
export function __setSecretForTests(key, value) {
  setSecret(key, value);
}
