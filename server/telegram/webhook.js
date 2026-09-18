// ============================================================
// server/telegram/webhook.js — INTERACTIVE TELEGRAM BOT (v10.1)
// ------------------------------------------------------------
// The bot used to be one-way (notifications only). This module makes
// it LISTEN: Telegram's webhook delivers user messages here and they
// route to the SAME backend agents the website tabs use:
//
//   /intraday <query>   → runProTraderAgent  (intraday desk tools)
//   /crypto <query>     → runCryptoAgent     (CoinDCX desk tools)
//   /status             → both agents' quick status + desk summary
//   /help               → command list
//   plain text          → session memory: continue the LAST desk the
//                         chat used (default crypto — 24/7 desk)
//
// SECURITY (non-negotiable):
//   1. X-Telegram-Bot-Api-Secret-Token header must equal
//      TELEGRAM_WEBHOOK_SECRET when that env is set (Telegram's own
//      mechanism — set at setWebhook time). Without the env set, the
//      webhook refuses everything except in development mode.
//   2. Only the CONFIGURED chat id (secrets/env, same allowlist the
//      notifications use) is processed — every other chat is ignored.
//   3. READ-ONLY: no command here can place/close an order. Any future
//      trading command must go through coindcxOrders.js's full safety
//      gauntlet — this module has zero private paths to money.
//
// Telegram always gets an HTTP 200 fast (long LLM turns happen off
// the response path) — otherwise Telegram retries and doubles AI cost.
// ============================================================
import { telegramConfig, sendTelegramMessage } from '../ai/secrets.js';
import { runIntradayAgentForExternal } from '../intraday/routes.js';
import { runCryptoAgent } from '../ai/cryptoAgent.js';
import { agentStatus, loadAgentConfig } from '../ai/agent.js';
import { getSignals } from '../ai/signals.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// ---------------- session memory (chat-keyed, in-memory) ----------------
const SESSION_TTL_MS = 30 * 60 * 1000; // plain-text routing remembers 30 min
const _sessions = new Map(); // chatId → { desk: 'intraday'|'crypto', at }
const _inflight = new Set(); // chatId → one LLM turn at a time (cost guard)

export function __telegramSessionsForTests() { return _sessions; }

function sessionDeskFor(chatId) {
  const s = _sessions.get(chatId);
  if (s && Date.now() - s.at < SESSION_TTL_MS) return s.desk;
  _sessions.delete(chatId);
  return null;
}
function rememberDesk(chatId, desk) {
  _sessions.set(chatId, { desk, at: Date.now() });
}

// ---------------- command parsing ----------------
/** Split "/intraday BTC ka setup?" → { cmd: 'intraday', query: 'BTC ka setup?' } */
export function parseCommand(text) {
  const t = String(text || '').trim();
  const m = t.match(/^\/(intraday|crypto|status|help|start)(?:\s+([\s\S]*))?$/i);
  if (!m) return { cmd: null, query: t };
  return { cmd: m[1].toLowerCase(), query: (m[2] || '').trim() };
}

// ---------------- desk runners ----------------
async function runDeskAgent(desk, query, aiDeps) {
  const messages = [{ role: 'user', content: query.slice(0, 6000) }];
  if (desk === 'intraday') {
    const out = await runIntradayAgentForExternal(messages);
    return { ok: !!out?.ok, text: out?.ok ? out.text : (out?.error || 'intraday agent unavailable'), engine: out?.engine || null, tools: out?.toolsUsed || [] };
  }
  const out = await runCryptoAgent(messages, aiDeps || {});
  return { ok: !!out?.ok, text: out?.ok ? out.text : (out?.error || 'crypto agent unavailable'), engine: out?.engine || null, tools: out?.toolsUsed || [] };
}

const HELP_TEXT = [
  '🤖 <b>Wealth AI Pro — Interactive Desk Bot</b>',
  '',
  '<b>/crypto</b> &lt;question&gt; — CoinDCX desk agent (spot + futures setups, wallet, positions, sizing, track record)',
  '<b>/intraday</b> &lt;question&gt; — NSE intraday desk agent (setups, deep scans, regime, paper positions)',
  '<b>/status</b> — dono desks ka snapshot (agent state + top signals)',
  '',
  'Plain message bhejo to last-used desk continue hota hai (30 min memory). Answers full-ticket format me aate hain — entry/SL/targets/size/time-window ke saath.',
  '',
  '⚠️ Read-only hai — yeh bot orders place nahi karta.',
].join('\n');

async function buildStatusText(aiDeps) {
  const cfg = loadAgentConfig();
  let agentBlock = 'agent status unavailable';
  try {
    const st = await agentStatus(null);
    const wr = st.accuracy?.rollingWinRate;
    agentBlock = [
      `mode <b>${cfg.mode.toUpperCase()}</b>${cfg.enabled ? ' · RUNNING' : ' · STOPPED'}`,
      `today ${st.today?.tradesCount ?? 0}/${st.today?.maxTrades ?? '?'} trades · realized ₹${r2(st.today?.realizedPnlINR ?? 0)}`,
      wr != null ? `rolling win-rate ${wr}% (last ${st.accuracy?.rollingWindow})` : `rolling win-rate: needs ${st.accuracy?.rollingWindow} closed trades`,
      st.accuracy?.correlationGuard !== false ? 'guards: quorum-bar + ATR time-exit + correlation ON' : 'guards: partial',
      (st.blockers || []).slice(0, 2).map(b => `⚠️ ${b.text}`).join('\n'),
    ].filter(Boolean).join('\n');
  } catch { /* keep unavailable */ }

  let deskLines = [];
  try {
    const [crypto, india] = await Promise.all([
      getSignals('CRYPTO', aiDeps, { limit: 3, warmOnly: true }).catch(() => null),
      getSignals('INDIA', aiDeps, { limit: 3, warmOnly: true }).catch(() => null),
    ]);
    const topOf = (b) => (b?.signals || [])[0];
    const c = topOf(crypto), i = topOf(india);
    deskLines.push(`₿ <b>Crypto desk</b>: ${c ? `${c.symbol} ${c.side} ${c.grade} · AI ${c.superIntel?.aiScore ?? c.confidence}` : 'board warming — 30s baad /status'}`);
    deskLines.push(`🇮🇳 <b>India desk</b>: ${i ? `${i.symbol} ${i.side} ${i.grade} · AI ${i.superIntel?.aiScore ?? i.confidence}` : 'board warming — 30s baad /status'}`);
  } catch { /* best-effort */ }

  return ['📊 <b>DESK STATUS</b>', '', ...deskLines, '', `🤖 <b>Auto-agent</b>\n${agentBlock}`].join('\n');
}

// ---------------- the webhook handler ----------------
/**
 * Register POST /api/telegram/webhook + the one-time setWebhook helper.
 * @param app  Express app
 * @param deps { KEYS, OPENAI_COMPAT, TG, jsonError } — AI + telegram deps
 */
export function registerTelegramWebhook(app, deps = {}) {
  const aiDeps = {
    KEYS: deps.KEYS,
    OPENAI_COMPAT: deps.OPENAI_COMPAT,
    getTradingConfig: deps.getTradingConfig,
  };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  app.post('/api/telegram/webhook', async (req, res) => {
    // Telegram needs a fast 200 ALWAYS — do the work after.
    const body = req.body || {};
    const respond = (ok, extra) => res.status(200).json({ ok, ...(extra || {}) });

    // ---- security gate 1: Telegram secret_token header ----
    if (secret) {
      const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
      if (got !== secret) {
        // A 4xx would make Telegram retry a foreign URL forever — the
        // documented pattern is a silent 200 drop.
        return respond(false);
      }
    } else if (process.env.NODE_ENV === 'production') {
      // No secret configured in production → the webhook is not safely
      // armed. Refuse (still 200 to Telegram, but nothing is processed).
      return respond(false, { note: 'TELEGRAM_WEBHOOK_SECRET not configured' });
    }

    const msg = body?.message;
    const chatId = msg?.chat?.id;
    const text = String(msg?.text || '').trim();
    if (!chatId || !text) return respond(true, { ignored: 'no text message' });

    // ---- security gate 2: configured chat-id allowlist ----
    const cfgTG = telegramConfig({ token: deps.TG?.token || process.env.TG_TOKEN || '', chatId: deps.TG?.chatId || process.env.TG_CHAT_ID || '' });
    if (!cfgTG) return respond(true, { ignored: 'telegram not configured' });
    if (String(chatId) !== String(cfgTG.chatId)) {
      return respond(true, { ignored: 'chat not allowlisted' }); // silently drop strangers
    }

    // ---- cost guard: one LLM turn per chat ----
    const chatKey = String(chatId);
    if (_inflight.has(chatKey)) {
      await sendTelegramMessage('⏳ Pichla answer abhi ban raha hai — dusra sawaal thodi der baad.', { token: cfgTG.token, chatId: cfgTG.chatId }).catch(() => {});
      return respond(true, { busy: true });
    }

    // process OFF the response path
    setImmediate(() => {
      _inflight.add(chatKey);
      (async () => {
        try {
          await handleTelegramCommand({ text, chatKey, cfgTG, aiDeps });
        } catch (e) {
          await sendTelegramMessage(`⚠️ Agent error: ${String(e?.message || e).slice(0, 160)}`, { token: cfgTG.token, chatId: cfgTG.chatId }).catch(() => {});
        } finally {
          _inflight.delete(chatKey);
        }
      })();
    });
    return respond(true, { accepted: true });
  });

  // ---------------- one-time setup (auth'd, manual) ----------------
  // POST /api/telegram/setup-webhook { url: "https://<render-app>.onrender.com" }
  // Calls Telegram setWebhook with the secret — do this ONCE per deploy URL.
  app.post('/api/telegram/setup-webhook', async (req, res) => {
    try {
      const cfgTG = telegramConfig({ token: deps.TG?.token || process.env.TG_TOKEN || '', chatId: deps.TG?.chatId || process.env.TG_CHAT_ID || '' });
      if (!cfgTG || !cfgTG.token) return res.status(400).json({ ok: false, error: 'Telegram bot token not configured (secrets ya TG_TOKEN)' });
      const url = String(req.body?.url || '').trim();
      if (!/^https:\/\/.+/.test(url)) return res.status(400).json({ ok: false, error: 'url required (https://your-render-app.onrender.com)' });
      if (!secret) return res.status(400).json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET env set karo pehle (random 32+ chars) — security requirement' });
      const r = await fetch(`https://api.telegram.org/bot${cfgTG.token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${url.replace(/\/$/, '')}/api/telegram/webhook`,
          secret_token: secret,
          allowed_updates: ['message'],
          drop_pending_updates: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) return res.status(502).json({ ok: false, error: `setWebhook failed: ${j?.description || r.status}` });
      res.json({ ok: true, webhook: j.result, url: `${url.replace(/\/$/, '')}/api/telegram/webhook`, note: 'Telegram ab is URL pe messages bhejega. TELEGRAM_WEBHOOK_SECRET verify hota hai har request pe.' });
    } catch (e) {
      res.status(500).json({ ok: false, error: `setup failed: ${e?.message || e}` });
    }
  });

  // quick delete (dev aid)
  app.post('/api/telegram/remove-webhook', async (_req, res) => {
    try {
      const cfgTG = telegramConfig({ token: deps.TG?.token || process.env.TG_TOKEN || '', chatId: deps.TG?.chatId || process.env.TG_CHAT_ID || '' });
      if (!cfgTG?.token) return res.status(400).json({ ok: false, error: 'telegram not configured' });
      const r = await fetch(`https://api.telegram.org/bot${cfgTG.token}/deleteWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      res.json({ ok: !!j?.ok, result: j?.result ?? null });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}

// ---------------- command dispatcher ----------------
async function handleTelegramCommand({ text, chatKey, cfgTG, aiDeps }) {
  const send = (t) => sendTelegramMessage(t, { token: cfgTG.token, chatId: cfgTG.chatId });
  const { cmd, query } = parseCommand(text);

  if (cmd === 'help' || cmd === 'start') {
    await send(HELP_TEXT);
    return;
  }
  if (cmd === 'status') {
    await send('⏳ Status ready ho raha hai…');
    await send(await buildStatusText(aiDeps));
    return;
  }

  let desk = null;
  if (cmd === 'intraday' || cmd === 'crypto') {
    desk = cmd;
    if (!query) {
      await send(desk === 'intraday'
        ? 'Likho: <b>/intraday RELIANCE ka setup kaisa hai?</b>'
        : 'Likho: <b>/crypto SOL ka deep analysis do</b>');
      return;
    }
  } else {
    // plain text → session memory picks the last desk (default crypto)
    desk = sessionDeskFor(chatKey) || 'crypto';
  }
  rememberDesk(chatKey, desk);

  await send(desk === 'intraday' ? '⏳ Intraday desk agent soch raha hai…' : '⏳ Crypto desk agent soch raha hai…');
  const out = await runDeskAgent(desk, query, aiDeps);
  if (!out.ok || !out.text) {
    await send(`⚠️ ${out.text || 'agent unavailable'}`);
    return;
  }
  // Telegram hard-caps messages at 4096 chars — split longer tickets.
  const MAX = 3900;
  const chunks = [];
  let rest = out.text;
  while (rest.length > 0) {
    let cut = rest.length;
    if (cut > MAX) {
      const nl = rest.lastIndexOf('\n', MAX);
      cut = nl > MAX * 0.5 ? nl : MAX; // prefer a line break, else hard cut
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  for (const c of chunks) await send(c);
  // tool trace footer — the transparency the web panels show too
  if (out.tools?.length) {
    await send(`🔧 tools: ${out.tools.join(', ')}${out.engine ? ` · engine ${out.engine}` : ''}`);
  }
}

// test hooks
export const __testables = { parseCommand, buildStatusText, HELP_TEXT };
