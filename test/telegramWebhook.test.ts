// ============================================================
// test/telegramWebhook.test.ts — INTERACTIVE TELEGRAM BOT (v10.1)
// ------------------------------------------------------------
// Pins: command parsing, the security gauntlet (secret-token header,
// configured-chat allowlist, production refusal without a secret),
// session memory routing, and the 4096-char message splitting.
// Express app is built inline; sendTelegramMessage + both desk
// agents are mocked.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';

vi.mock('../server/ai/secrets.js', () => ({
  telegramConfig: () => ({ token: 'BOT-TOKEN', chatId: '111222333', source: 'env' }),
  sendTelegramMessage: (...a) => mockSend(...a),
}));
const mockSend = vi.fn(async () => ({ ok: true }));

vi.mock('../server/intraday/routes.js', () => ({
  runIntradayAgentForExternal: (...a) => mockIntradayAgent(...a),
}));
const mockIntradayAgent = vi.fn();

vi.mock('../server/ai/cryptoAgent.js', () => ({
  runCryptoAgent: (...a) => mockCryptoAgent(...a),
}));
const mockCryptoAgent = vi.fn();

vi.mock('../server/ai/agent.js', () => ({
  agentStatus: async () => ({
    ok: true,
    today: { tradesCount: 1, maxTrades: 3, realizedPnlINR: 40 },
    accuracy: { rollingWinRate: null, rollingWindow: 10, correlationGuard: true, dynamicTimeExit: true },
    openPositions: [], blockers: [],
  }),
  loadAgentConfig: () => ({ enabled: true, mode: 'paper' }),
}));

vi.mock('../server/ai/signals.js', () => ({
  getSignals: async () => null, // status degrades honestly
}));

import { registerTelegramWebhook } from '../server/telegram/webhook.js';
import { __testables } from '../server/telegram/webhook.js';

const SECRET = 'test-secret-123';
const CHAT = '111222333';

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerTelegramWebhook(app, { KEYS: {}, OPENAI_COMPAT: {}, TG: { token: 'BOT-TOKEN', chatId: CHAT } });
  return app;
}

const post = (app, body, headers = {}) => new Promise((resolve, reject) => {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      server.close(() => resolve({ status: r.status, body: j }));
    } catch (e) {
      server.close(() => reject(e));
    }
  });
});

beforeEach(() => {
  mockSend.mockClear();
  mockIntradayAgent.mockReset().mockResolvedValue({ ok: true, text: 'intraday answer', toolsUsed: ['analyze_setup'], engine: 'test' });
  mockCryptoAgent.mockReset().mockResolvedValue({ ok: true, text: 'crypto answer', toolsUsed: ['get_live_crypto_signals'], engine: 'test' });
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

// ============================================================
// command parsing
// ============================================================
describe('parseCommand', () => {
  const { parseCommand } = __testables;
  it('splits /crypto <query>', () => {
    expect(parseCommand('/crypto SOL deep analysis')).toEqual({ cmd: 'crypto', query: 'SOL deep analysis' });
  });
  it('splits /intraday and lowercases the command', () => {
    expect(parseCommand('/INTRADAY RELIANCE?')).toEqual({ cmd: 'intraday', query: 'RELIANCE?' });
  });
  it('bare command carries an empty query', () => {
    expect(parseCommand('/status')).toEqual({ cmd: 'status', query: '' });
  });
  it('plain text → no command', () => {
    expect(parseCommand('kya buy karu?')).toEqual({ cmd: null, query: 'kya buy karu?' });
  });
});

// ============================================================
// the security gauntlet
// ============================================================
describe('webhook security', () => {
  it('WRONG secret-token header → ignored (ok false), agent never called', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    const { status, body } = await post(app, { message: { chat: { id: CHAT }, text: '/crypto hi' } }, { 'x-telegram-bot-api-secret-token': 'WRONG' });
    expect(status).toBe(200); // silent drop (Telegram would retry on 4xx)
    expect(body.ok).toBe(false);
  });

  it('PRODUCTION without any secret configured → refuses to process', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const app = buildApp();
    const { body } = await post(app, { message: { chat: { id: CHAT }, text: '/crypto hi' } });
    expect(body.ok).toBe(false);
    process.env.NODE_ENV = 'test';
  });

  it('non-allowlisted chat id → silently ignored even with the right secret', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    const { body } = await post(app, { message: { chat: { id: '999' }, text: '/crypto hi' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    expect(body.ignored).toBe('chat not allowlisted');
    await new Promise(r => setTimeout(r, 50));
    expect(mockCryptoAgent).not.toHaveBeenCalled();
  });

  it('allowlisted chat + right secret → accepted, dispatched async', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    const { body } = await post(app, { message: { chat: { id: CHAT }, text: '/crypto top setups' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    expect(body.accepted).toBe(true);
    await new Promise(r => setTimeout(r, 100));
    expect(mockCryptoAgent).toHaveBeenCalledTimes(1);
    const msgs = mockCryptoAgent.mock.calls[0][0];
    expect(msgs[0].content).toBe('top setups');
  });

  it('busy chat (in-flight) → polite wait message, no parallel LLM cost', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    mockCryptoAgent.mockImplementation(() => new Promise(r => setTimeout(() => r({ ok: true, text: 'slow' }), 200)));
    await post(app, { message: { chat: { id: CHAT }, text: '/crypto q1' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 30)); // q1 in flight
    const { body } = await post(app, { message: { chat: { id: CHAT }, text: '/crypto q2' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    expect(body.busy).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(mockCryptoAgent).toHaveBeenCalledTimes(1); // q2 never dispatched
  });
});

// ============================================================
// routing + session memory
// ============================================================
describe('command routing', () => {
  it('/crypto routes to the crypto agent, /intraday to the intraday agent', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    await post(app, { message: { chat: { id: CHAT }, text: '/crypto BTC setup' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 80));
    expect(mockCryptoAgent).toHaveBeenCalledTimes(1);
    await post(app, { message: { chat: { id: CHAT }, text: '/intraday RELIANCE' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 80));
    expect(mockIntradayAgent).toHaveBeenCalledTimes(1);
  });

  it('PLAIN TEXT continues the last desk (session memory, default crypto)', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    // first: /intraday sets the session
    await post(app, { message: { chat: { id: CHAT }, text: '/intraday SBIN' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 80));
    // plain follow-up → should go to the intraday desk again
    await post(app, { message: { chat: { id: CHAT }, text: 'aur TCS?' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 80));
    expect(mockIntradayAgent).toHaveBeenCalledTimes(2);
    expect(mockCryptoAgent).not.toHaveBeenCalled();
  });

  it('/help sends the command list and never calls an agent', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    await post(app, { message: { chat: { id: CHAT }, text: '/help' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 80));
    expect(mockSend.mock.calls.some(c => /Interactive Desk Bot/i.test(String(c[0])))).toBe(true);
    expect(mockCryptoAgent).not.toHaveBeenCalled();
    expect(mockIntradayAgent).not.toHaveBeenCalled();
  });

  it('/status sends the desk snapshot', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    await post(app, { message: { chat: { id: CHAT }, text: '/status' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 120));
    const sent = mockSend.mock.calls.map(c => String(c[0]));
    expect(sent.some(t => /DESK STATUS/i.test(t))).toBe(true);
  });

  it('long agent answers are split into ≤4096-char chunks (Telegram cap)', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    mockCryptoAgent.mockResolvedValue({ ok: true, text: 'x'.repeat(8000) + '\nlast line', toolsUsed: [] });
    await post(app, { message: { chat: { id: CHAT }, text: '/crypto batao' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 120));
    const texts = mockSend.mock.calls.map(c => String(c[0]));
    const payload = texts.filter(t => !/⏳|🔧/.test(t));
    expect(payload.length).toBeGreaterThanOrEqual(2);
    expect(payload.every(t => t.length <= 4096)).toBe(true);
  });

  it('tool-trace footer is sent after the answer (transparency)', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const app = buildApp();
    await post(app, { message: { chat: { id: CHAT }, text: '/crypto kuch bhi' } }, { 'x-telegram-bot-api-secret-token': SECRET });
    await new Promise(r => setTimeout(r, 120));
    expect(mockSend.mock.calls.some(c => /tools: get_live_crypto_signals/i.test(String(c[0])))).toBe(true);
  });
});
