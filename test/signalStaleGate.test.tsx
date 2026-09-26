// ============================================================
// test/signalStaleGate.test.tsx — v13.4 STALENESS & QUORUM FIX
// ------------------------------------------------------------
// The UI teeth, pinned (Fix 3 + Fix 4 client wiring):
//   Fix 3a — a >30-min-old ACTION signal renders the visible grade
//            badge as "ACTION · STALE" (amber), not plain ACTION.
//   Fix 3b — Paper Trade click on a stale signal opens the CONFIRM
//            BAR ("Recheck karo" / "Proceed anyway") instead of
//            firing the execute handler directly. A FRESH signal
//            fires straight through — no regression.
//   Fix 4  — liveInvalidationFor: live price through the SL renders
//            the ⚠ PLAN INVALIDATED strip and the trade buttons stay
//            CLICKABLE (honest warn, never a fake block); a >0.5×ATR
//            run past the entry zone renders ⚠ WEAKENING.
//   Client twin — src/components/aitrading/liveInvalidation.ts pure
//            math mirrors the server (same verdicts on same inputs).
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignalCard } from '../src/components/aitrading/SignalCard';
import { liveInvalidationCheck, liveInvalidationFor } from '../src/components/aitrading/liveInvalidation';
import type { AISignal } from '../src/components/aitrading/types';

const plan = {
  entry: 178.32, stopLoss: 172.5, target1: 185, target2: 191,
  risk: 5.82, riskPct: 3.26, rewardRisk: 2.18, atrUsed: 2.9, planStyle: 'atr-based' as const,
};

const MIN = 60_000;
const base = (over: Partial<AISignal> = {}): AISignal => ({
  symbol: 'CL', market: 'FUTURES', side: 'SHORT', grade: 'ACTION',
  confidence: 68, agreement: 0.62, participating: 4, voters: 4, totalModels: 9,
  ltp: 92.44, changePct: -3.0, plan,
  // fresh by default: last board confirm 2 min ago
  signalAge: { firstSeenAt: Date.now() - 67 * MIN, lastSeenAt: Date.now() - 2 * MIN, ageMs: 0, flips24h: 0 },
  superIntel: {
    aiScore: 76, tier: 'ACTION', drivers: ['momentum'],
    blueprint: {
      side: 'SHORT', entry: 92.44, entryZone: [92.38, 92.67],
      entryTiming: { mode: 'PULLBACK', note: 'rally sell zone' },
      stopLoss: 93.47, targets: { t1: 91.41, t2: 90.38, t3: 89.35 },
      leverage: 3, maxSaneLeverage: 5, liquidation: 95.5,
      leverageNote: '3x', exitPlan: [],
      exitBy: '8h', horizon: { label: 'INTRADAY', hours: 8, note: 'manage' },
      invalidation: 'SL 93.47 break',
    },
  },
  votes: [
    { id: 'm1', name: 'Trend Model', role: 'trend', dir: -1, conf: 80, weight: 1.2, reasons: ['ema down'] },
  ],
  summary: 'test', aiNote: null, executable: false, generatedAt: Date.now(),
  ...over,
});

describe('v13.4 Fix 3a — stale ACTION signal shows the downgraded grade badge', () => {
  it('>30 min since last board confirm → badge reads ACTION · STALE', () => {
    render(<SignalCard signal={base({ signalAge: { firstSeenAt: Date.now() - 90 * MIN, lastSeenAt: Date.now() - 67 * MIN, ageMs: 0, flips24h: 0 } })} onExecuteFutures={vi.fn(async () => ({ ok: true }))} />);
    expect(screen.getByText('ACTION · STALE')).toBeTruthy();
  });

  it('fresh signal keeps the plain ACTION badge (no regression)', () => {
    render(<SignalCard signal={base()} onExecuteFutures={vi.fn(async () => ({ ok: true }))} />);
    expect(screen.getByText('ACTION')).toBeTruthy();
    expect(screen.queryByText('ACTION · STALE')).toBeNull();
  });

  it('a stale STRONG signal keeps its STRONG badge (only ACTION downgrades, per the fix spec)', () => {
    render(<SignalCard signal={base({ grade: 'STRONG', signalAge: { firstSeenAt: Date.now() - 90 * MIN, lastSeenAt: Date.now() - 67 * MIN, ageMs: 0, flips24h: 0 } })} onExecuteFutures={vi.fn(async () => ({ ok: true }))} />);
    expect(screen.getByText('★ STRONG')).toBeTruthy();
  });
});

describe('v13.4 Fix 3b — stale paper-trade confirm gate', () => {
  const staleSignal = () => base({ signalAge: { firstSeenAt: Date.now() - 90 * MIN, lastSeenAt: Date.now() - 67 * MIN, ageMs: 0, flips24h: 0 } });

  it('PAPER TRADE click on a stale signal opens the confirm bar, handler NOT called', () => {
    const onExecuteFutures = vi.fn(async () => ({ ok: true }));
    const onDeep = vi.fn();
    render(<SignalCard signal={staleSignal()} onExecuteFutures={onExecuteFutures} onDeep={onDeep} />);
    fireEvent.click(screen.getByRole('button', { name: /PAPER TRADE/i }));
    expect(onExecuteFutures).not.toHaveBeenCalled();
    expect(screen.getByText(/STALE SIGNAL/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Recheck karo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Proceed anyway/i })).toBeTruthy();
  });

  it('"Proceed anyway" fires the deferred paper handler exactly once', () => {
    const onExecuteFutures = vi.fn(async () => ({ ok: true }));
    render(<SignalCard signal={staleSignal()} onExecuteFutures={onExecuteFutures} />);
    fireEvent.click(screen.getByRole('button', { name: /PAPER TRADE/i }));
    fireEvent.click(screen.getByRole('button', { name: /Proceed anyway/i }));
    expect(onExecuteFutures).toHaveBeenCalledTimes(1);
    expect(onExecuteFutures.mock.calls[0][0].symbol).toBe('CL');
    expect(onExecuteFutures.mock.calls[0][1]).toBe('paper');
  });

  it('"Recheck karo" triggers the deep re-analysis instead of the trade', () => {
    const onExecuteFutures = vi.fn(async () => ({ ok: true }));
    const onDeep = vi.fn();
    render(<SignalCard signal={staleSignal()} onExecuteFutures={onExecuteFutures} onDeep={onDeep} />);
    fireEvent.click(screen.getByRole('button', { name: /PAPER TRADE/i }));
    fireEvent.click(screen.getByRole('button', { name: /Recheck karo/i }));
    expect(onDeep).toHaveBeenCalledTimes(1);
    expect(onDeep.mock.calls[0][0].symbol).toBe('CL');
    expect(onExecuteFutures).not.toHaveBeenCalled();
  });

  it('FRESH signal: PAPER TRADE fires straight through (no confirm bar)', () => {
    const onExecuteFutures = vi.fn(async () => ({ ok: true }));
    render(<SignalCard signal={base()} onExecuteFutures={onExecuteFutures} />);
    fireEvent.click(screen.getByRole('button', { name: /PAPER TRADE/i }));
    expect(onExecuteFutures).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/STALE SIGNAL/i)).toBeNull();
  });

  it('every desk quick-paper button is gated (crypto spot included)', () => {
    // fresh crypto card → paper fires straight through
    const onExecute = vi.fn(async () => ({ ok: true }));
    const r1 = render(<SignalCard signal={base({ market: 'CRYPTO', symbol: 'BTCINR' })} onExecute={onExecute} />);
    fireEvent.click(screen.getByRole('button', { name: /PAPER TRADE/i }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    r1.unmount();
    // stale crypto card → the gate opens the confirm bar instead
    const onExecute2 = vi.fn(async () => ({ ok: true }));
    render(<SignalCard signal={base({ market: 'CRYPTO', symbol: 'ETHINR', signalAge: { firstSeenAt: Date.now() - 90 * MIN, lastSeenAt: Date.now() - 67 * MIN, ageMs: 0, flips24h: 0 } })} onExecute={onExecute2} />);
    fireEvent.click(screen.getByRole('button', { name: /PAPER TRADE/i }));
    expect(onExecute2).not.toHaveBeenCalled();
    expect(screen.getByText(/STALE SIGNAL/i)).toBeTruthy();
  });
});

describe('v13.4 Fix 4 — live invalidation strip (client wiring)', () => {
  it('live price through the SL → ⚠ PLAN INVALIDATED strip renders, button stays ENABLED', () => {
    // SHORT CL: SL 93.47 — live at 93.6 is THROUGH the stop
    const onExecuteFutures = vi.fn(async () => ({ ok: true }));
    render(<SignalCard signal={base()} onExecuteFutures={onExecuteFutures} liveLtp={93.6} />);
    expect(screen.getByText(/PLAN INVALIDATED/i)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /PAPER TRADE/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // informed, not blocked
  });

  it('live price > 0.5×ATR past the far entry-zone edge → ⚠ WEAKENING strip', () => {
    // SHORT: far edge = zone HIGH 92.67, atr 2.9 → 0.5×ATR = 1.45;
    // live 90.38 → |90.38 - 92.67| = 2.29 > 1.45 (and below SL → not invalidated)
    render(<SignalCard signal={base()} onExecuteFutures={vi.fn(async () => ({ ok: true }))} liveLtp={90.38} />);
    expect(screen.getByText(/WEAKENING/i)).toBeTruthy();
  });

  it('live price inside the thesis → no strip (honest silence)', () => {
    render(<SignalCard signal={base()} onExecuteFutures={vi.fn(async () => ({ ok: true }))} liveLtp={92.5} />);
    expect(screen.queryByText(/PLAN INVALIDATED/i)).toBeNull();
    expect(screen.queryByText(/WEAKENING/i)).toBeNull();
  });

  it('no live tick → no strip (board snapshot alone never triggers it)', () => {
    render(<SignalCard signal={base()} onExecuteFutures={vi.fn(async () => ({ ok: true }))} liveLtp={null} />);
    expect(screen.queryByText(/PLAN INVALIDATED/i)).toBeNull();
  });
});

describe('v13.4 client twin — liveInvalidation.ts pure math (mirrors the server)', () => {
  it('same verdicts as the server twin on the CL trigger case', () => {
    const input = { side: 'SHORT', liveLtp: 93.6, stopLoss: 93.47, entryZoneLow: 92.38, entryZoneHigh: 92.67, atr: 2.9 };
    expect(liveInvalidationCheck(input)).toEqual({ status: 'invalidated', reason: expect.any(String) });
    expect(liveInvalidationCheck({ ...input, liveLtp: 90.38 }).status).toBe('weakening');
    expect(liveInvalidationCheck({ ...input, liveLtp: 92.5 }).status).toBe('ok');
  });

  it('liveInvalidationFor reads the blueprint + plan ATR off the signal shape', () => {
    const sig = base();
    expect(liveInvalidationFor(sig, 93.6).status).toBe('invalidated');
    expect(liveInvalidationFor(sig, 92.5).status).toBe('ok');
    // no blueprint, no plan → honest ok
    expect(liveInvalidationFor({ side: 'LONG' }, 100).status).toBe('ok');
    expect(liveInvalidationFor(null, 100).status).toBe('ok');
  });
});

describe('v13.4 Fix 5 — PULLBACK entry-trigger semantics copy', () => {
  it('PULLBACK mode renders the "bounce is the entry trigger" clarification with the SL', () => {
    render(<SignalCard signal={base()} onExecuteFutures={vi.fn(async () => ({ ok: true }))} />);
    expect(screen.getByText(/Ye bounce\/recovery hi entry trigger hai/i)).toBeTruthy();
    // px() currency-tags the SL: "thesis SL (93.47 USDT)" on the futures desk
    expect(screen.getByText(/thesis SL \(93\.47( USDT)?\) break hone tak intact hai/i)).toBeTruthy();
    // SHORT → "rally sell karna hai", never the LONG copy
    expect(screen.getByText(/rally sell karna hai/i)).toBeTruthy();
    expect(screen.queryByText(/dip buy karna hai/i)).toBeNull();
  });

  it('IMMEDIATE mode renders no pullback copy (no noise on breakout windows)', () => {
    const sig = base({
      superIntel: {
        ...base().superIntel!,
        blueprint: {
          ...base().superIntel!.blueprint!,
          entryTiming: { mode: 'IMMEDIATE', note: 'abhi entry window open hai' },
        },
      },
    });
    render(<SignalCard signal={sig} onExecuteFutures={vi.fn(async () => ({ ok: true }))} />);
    expect(screen.queryByText(/Ye bounce\/recovery hi entry trigger hai/i)).toBeNull();
  });
});
