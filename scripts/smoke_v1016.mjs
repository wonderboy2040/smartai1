#!/usr/bin/env node
// scripts/smoke_v1016.mjs — v10.16 boot smoke (hermetic import + contract check)
// SMARTAI_DATA_DIR isolates all store IO into a temp dir. Verifies:
//   1. manualTrades imports (the fixed ../intraday/backup.js path) + full export contract
//   2. record → snapshot freeze → view → close end-to-end in-memory
//   3. level-touch row contract (status/side/manual flag)
//   4. the telegramPush 5s-pipeline wiring (source-level contract — the
//      full sink behavior is test-locked in vitest)
//   5. S3 threshold reform exports (proportional bar + flat A/B arm)
//   6. bot.mjs /manual + /manualclose commands
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SMARTAI_DATA_DIR = mkdtempSync(join(tmpdir(), 'smoke-v1016-'));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

console.log('v10.16 boot smoke');

{
  const mt = await import('../server/ai/manualTrades.js');
  ok('manualTrades imports + exports the full contract', [
    mt.recordManualTrade, mt.listManualTrades, mt.closeManualTrade,
    mt.ltpForManualTrade, mt.manualTradeView, mt.manualConvictionOf,
    mt.manualTradesToPositionRows, mt.startManualTradeMonitor,
    mt.manualMonitorStatus, mt.flushManualState, mt.evaluateManualTradeAlerts,
    mt.flipSummary, mt.stateOfManualTrade, mt.manualPnlOf,
  ].every(f => typeof f === 'function'));

  mt.__resetManualStoreForTests();
  const r = mt.recordManualTrade({
    market: 'INDIA', symbol: 'RELIANCE', side: 'LONG', entryPrice: 1235, qty: 10,
    signal: { side: 'LONG', grade: 'STRONG', confidence: 82, superIntel: { aiScore: 84 }, plan: { entry: 1235, stopLoss: 1210, target1: 1260 } },
  });
  ok('record → snapshot frozen (aiScore 84 + plan SL 1210)', r.ok === true && r.trade.origin.aiScore === 84 && r.trade.origin.plan.stopLoss === 1210);
  const v = mt.manualTradeView(r.trade, { ltp: 1250, conviction: { state: 'HOLDING', delta: -2, currentScore: 82, entryScore: 84 } });
  ok('manualTradeView → pnl/dists/banner wired', v.__view.pnl.pnlPct > 1 && v.__view.distances.sl < 0 && v.__view.banner === 'THESIS_INTACT');
  const rows = mt.manualTradesToPositionRows([{ ...r.trade, __ltp: 1209 }]);
  ok('level-touch rows: MAN- id + OPEN + LONG side + manual flag', rows[0]?.id === 'MAN-1' && rows[0]?.status === 'OPEN' && rows[0]?.side === 'LONG' && rows[0]?.manual === true);
  const c = mt.closeManualTrade(1, { exitPrice: 1250 });
  ok('close stamps exit P&L honestly', c.ok === true && c.trade.exitPnlPct > 1);
  mt.stopManualTradeMonitor();
}

{
  // telegramPush wiring contract at the source level (the sink behavior
  // itself is test-locked in test/telegramPush.test.ts — a raw import
  // here would drag the whole coindcxOrders graph for no extra proof).
  const src = readFileSync(new URL('../server/ai/telegramPush.js', import.meta.url), 'utf8');
  ok('telegramPush sink section 1c wires manual rows into the 5s pipeline', src.includes('manualTradesToPositionRows(listManualTrades({ status: \'OPEN\' }))'));
  ok('formatLevelTouch carries the MANUAL tag + honest manual footer', src.includes('aapka trade') && src.includes('manual conviction monitor zinda hai'));
  ok('instaPushStatus carries manualPushes', src.includes('_status.manualPushes'));
}

{
  const agent = await import('../server/ai/agent.js');
  const d = agent.AGENT_DEFAULTS;
  ok('S3 threshold reform: conf 60 / agreement 0.65 / quorumPenalty 5 / proportional', d.minConfidence === 60 && d.minAgreement === 0.65 && d.quorumPenalty === 5 && d.thresholdProfile === 'proportional');
  ok('effectiveScoreBar proportional: 3 voters → 78, 1 voter → 80, 8 voters → 75',
    agent.effectiveScoreBar(d, { voters: 3 }) === 78
    && agent.effectiveScoreBar(d, { voters: 1 }) === 80
    && agent.effectiveScoreBar(d, { voters: 8 }) === 75);
  ok('flat A/B arm restores the legacy 85 bar', agent.effectiveScoreBar({ ...d, thresholdProfile: 'flat', quorumPenalty: 10 }, { voters: 3 }) === 85);
}

{
  const bot = readFileSync(new URL('../telegram-bot/bot.mjs', import.meta.url), 'utf8');
  ok('bot.mjs /manual command registered', bot.includes('bot.onText(/^\\/manual(@\\w+)?$/i'));
  ok('bot.mjs /manualclose command registered', bot.includes('bot.onText(/^\\/manualclose'));
  ok('bot.mjs /help mentions both commands', bot.includes('<b>/manual</b>') && bot.includes('<b>/manualclose'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
