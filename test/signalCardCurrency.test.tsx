// ============================================================
// test/signalCardCurrency.test.tsx — v10.5.3 currency-display
// regression suite (Issue #1: global futures priced in ₹).
//
// THE BUG: SignalCard's `px()` helper and a dozen call sites branched
// only on `futures`, so GLOBALFUTURES (Global Equity SIM) cards fell
// through to the ₹ branch — an AAPL card showed "ENTRY ₹178.32" and
// the ticket summary showed "₹ RISK @ SL" for a USD-priced share.
//
// THE FIX: `px()` takes a currency tag ('inr' | 'usdt' | 'usd') and
// the whole ticket resolves its unit through one shared decision.
//
// THE CONTRACT (locked here):
//   • GLOBALFUTURES card renders NO ₹ character anywhere — header,
//     plan strip, blueprint strip, opened ticket, labels, tooltips.
//   • FUTURES keeps the USDT domain (CoinDCX USDT-margined perps).
//   • INDIA keeps ₹ (NSE).
//   • The USD and USDT labels are never conflated (USD ≠ USDT text).
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignalCard } from '../src/components/aitrading/SignalCard';
import type { AISignal } from '../src/components/aitrading/types';

const plan = {
  entry: 178.32, stopLoss: 172.5, target1: 185, target2: 191,
  risk: 5.82, riskPct: 3.26, rewardRisk: 2.18, atrUsed: 2.9, planStyle: 'atr-based' as const,
};

const base = (market: AISignal['market']): AISignal => ({
  symbol: market === 'GLOBALFUTURES' ? 'MU' : market === 'FUTURES' ? 'B-SOL_USDT' : 'RELIANCE',
  market, side: 'LONG', grade: 'STRONG',
  confidence: 82, agreement: 0.78, participating: 9, voters: 9, totalModels: 10,
  ltp: market === 'INDIA' ? 2890 : market === 'FUTURES' ? 148.2 : 178.32,
  changePct: 1.2, plan,
  superIntel: {
    aiScore: 83, tier: 'STRONG', drivers: ['momentum', 'trend'],
    blueprint: {
      side: 'LONG', entry: 178.32, entryZone: [177.2, 179.4],
      entryTiming: { mode: 'IMMEDIATE', note: 'breakout window' },
      stopLoss: 172.5, targets: { t1: 185, t2: 191, t3: 198 },
      leverage: 3, maxSaneLeverage: 5, liquidation: 149.5,
      leverageNote: '3x sane for this stop',
      exitPlan: [
        { at: 185, bookPct: 40, action: 'book T1' },
        { at: 191, bookPct: 40, action: 'book T2' },
        { at: 198, bookPct: 20, action: 'runner trail' },
      ],
      exitBy: '5 sessions', horizon: { label: 'swing', hours: 96, note: 'daily trend intact' },
      invalidation: 'close below 172.5',
    },
  },
  votes: [
    { id: 'm1', name: 'Trend Model', role: 'trend', dir: 1, conf: 80, weight: 1.2, reasons: ['ema aligned'] },
  ],
  summary: 'test', aiNote: null, executable: true, generatedAt: Date.now(),
});

const noopExec = async () => ({ ok: true });

describe('v10.5.3 SignalCard currency display — the global desk never renders ₹', () => {
  it('GLOBALFUTURES card (closed state): USD everywhere, zero ₹ characters', () => {
    const { container } = render(<SignalCard signal={base('GLOBALFUTURES')} onExecuteGlobal={noopExec} />);
    const text = container.textContent || '';
    expect(text).not.toContain('₹');
    // header LTP + plan strip price the card in USD
    expect(text).toContain('USD');
    expect(text).toMatch(/USD\s?178/);
  });

  it('GLOBALFUTURES opened SIMPLE TRADE TICKET: no ₹ in the full ticket (labels, chips, guide)', () => {
    const { container } = render(<SignalCard signal={base('GLOBALFUTURES')} onExecuteGlobal={noopExec} />);
    fireEvent.click(screen.getByRole('button', { name: /🚀/ }));
    // the ticket renders asynchronously with state — assert the full tree again
    const text = container.textContent || '';
    expect(text).not.toContain('₹');
    expect(text).toContain('MARGIN USD');
    expect(text).toContain('USD RISK @ SL');
    expect(text).toContain('USD PROFIT @ T2');
    expect(text).toMatch(/USD\s?178\.32/); // ENTRY priced in USD
    expect(text).toMatch(/USD\s?172\.5/); // SL priced in USD
  });

  it('the USD label is never conflated with the crypto USDT domain', () => {
    const { container } = render(<SignalCard signal={base('GLOBALFUTURES')} onExecuteGlobal={noopExec} />);
    const text = container.textContent || '';
    expect(text).not.toContain('USDT'); // global SIM = shares of a USD instrument
    const { container: c2 } = render(<SignalCard signal={base('FUTURES')} onExecuteFutures={noopExec} />);
    expect((c2.textContent || '')).toContain('USDT');
  });

  it('GLOBALFUTURES paper-execute toast also stays in the USD domain', () => {
    const { container } = render(<SignalCard signal={base('GLOBALFUTURES')} onExecuteGlobal={noopExec} />);
    fireEvent.click(screen.getByRole('button', { name: /🚀/ }));
    fireEvent.click(screen.getByRole('button', { name: /PAPER EXECUTE/i }));
    return new Promise((resolve) => setTimeout(() => {
      const text = container.textContent || '';
      expect(text).not.toContain('₹');
      expect(text).toMatch(/@\s?178\.32 USD/);
      resolve(null);
    }, 50));
  });

  it('FUTURES (real CoinDCX perps) keeps the USDT domain, not USD', () => {
    const { container } = render(<SignalCard signal={base('FUTURES')} onExecuteFutures={noopExec} />);
    const text = container.textContent || '';
    expect(text).toContain('USDT');
    expect(text).not.toContain('USD '); // "USD " with space — the SIM desk prefix
    expect(text).not.toContain('₹');
  });

  it('INDIA keeps the ₹ domain (the fix must not regress the NSE desk)', () => {
    const { container } = render(<SignalCard signal={base('INDIA')} onExecuteIndia={noopExec} />);
    expect(container.textContent || '').toContain('₹');
    expect(container.textContent || '').not.toContain('USD');
    expect(container.textContent || '').not.toContain('USDT');
  });
});
