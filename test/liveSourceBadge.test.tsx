// ============================================================
// test/liveSourceBadge.test.tsx — v10.11 (#1) the source-
// transparency badge contract.
//
// THE ASK (user plan): "a small tag next to the live price —
// CoinDCX·RT (green), Finnhub·RT (blue), Yahoo·delayed (amber) —
// only rendered when liveLtp != null."
//
// THE CONTRACT (locked here):
//   • Every server source label maps to its honest pill:
//       coindcx-*            → CoinDCX·RT   (emerald)
//       finnhub-global-rt    → Finnhub·RT   (sky)
//       binance-*            → Binance·RT   (sky, honest fallback label)
//       yahoo-global-rt      → Yahoo·delayed (amber)
//       global-sim-rt        → SIM·synthetic (slate)
//   • Unknown/missing source → neutral LIVE pill (the price IS live,
//     the provenance just wasn't labeled — never a blank, never a
//     wrong guess).
//   • The badge renders ONLY beside a live price (SignalCard gates
//     it on liveLtp != null — locked by the render test below).
// ============================================================
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveSourceBadge, liveSourceBadge } from '../src/components/aitrading/LiveSourceBadge';
import { SignalCard } from '../src/components/aitrading/SignalCard';
import type { AISignal } from '../src/components/aitrading/types';

describe('liveSourceBadge — the pure label mapping', () => {
  it('direct CoinDCX feeds (REST + WS, both domains) → CoinDCX·RT', () => {
    for (const src of ['coindcx-fut-rt', 'coindcx-fut-ws', 'coindcx-glob-rt', 'coindcx-glob-ws', 'coindcx-live']) {
      const b = liveSourceBadge(src);
      expect(b.label).toBe('CoinDCX·RT');
      expect(b.cls).toContain('emerald');
    }
  });
  it('finnhub-global-rt → Finnhub·RT (blue)', () => {
    const b = liveSourceBadge('finnhub-global-rt');
    expect(b.label).toBe('Finnhub·RT');
    expect(b.cls).toContain('sky');
  });
  it('binance fallbacks → Binance·RT (honest fallback label)', () => {
    for (const src of ['binance-fut-rt', 'binance-crypto-ws']) {
      expect(liveSourceBadge(src).label).toBe('Binance·RT');
    }
  });
  it('yahoo-global-rt → Yahoo·delayed (amber)', () => {
    const b = liveSourceBadge('yahoo-global-rt');
    expect(b.label).toBe('Yahoo·delayed');
    expect(b.cls).toContain('amber');
  });
  it('global-sim-rt → SIM·synthetic (slate)', () => {
    const b = liveSourceBadge('global-sim-rt');
    expect(b.label).toBe('SIM·synthetic');
    expect(b.cls).toContain('slate');
  });
  it('unknown or missing → neutral LIVE pill (never a wrong guess, never blank)', () => {
    for (const src of [undefined, null, '', 'mystery-feed']) {
      const b = liveSourceBadge(src);
      expect(b.label).toBe('LIVE');
      expect(b.cls).toContain('emerald');
    }
  });
});

describe('LiveSourceBadge — the pill render', () => {
  it('renders the mapped label', () => {
    render(<LiveSourceBadge src="finnhub-global-rt" />);
    expect(screen.getByText('Finnhub·RT')).toBeTruthy();
  });
});

describe('SignalCard — the badge renders ONLY beside a live price', () => {
  const base: AISignal = {
    id: 't1', market: 'FUTURES', symbol: 'BTC', side: 'LONG', grade: 'STRONG',
    confidence: 82, agreement: 0.8, voters: 10,
    ltp: 50_000, changePct: 2.5,
    reason: 'test', models: [], generatedAt: Date.now(),
  } as unknown as AISignal;

  it('liveLtp present + finnhub source → the Finnhub·RT pill shows next to ⚡ LIVE', () => {
    render(<SignalCard signal={base} liveLtp={61_000.5} liveSrc="finnhub-global-rt" />);
    expect(screen.getByText('⚡ LIVE')).toBeTruthy();
    expect(screen.getByText('Finnhub·RT')).toBeTruthy();
  });

  it('liveLtp present + coindcx WS source → CoinDCX·RT pill', () => {
    render(<SignalCard signal={base} liveLtp={61_000.5} liveSrc="coindcx-fut-ws" />);
    expect(screen.getByText('CoinDCX·RT')).toBeTruthy();
  });

  it('NO live tick → NO badge (and no ⚡ LIVE) — snapshot price only', () => {
    render(<SignalCard signal={base} />);
    expect(screen.queryByText('⚡ LIVE')).toBeNull();
    expect(screen.queryByText('CoinDCX·RT')).toBeNull();
    expect(screen.queryByText('Finnhub·RT')).toBeNull();
    expect(screen.queryByText('LIVE')).toBeNull();
  });
});
