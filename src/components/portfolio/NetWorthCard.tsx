// ============================================================
// portfolio/NetWorthCard — v10.5 NET WORTH SUMMARY (Upgrade 3)
// ------------------------------------------------------------
// The unified INDMoney net-worth view for the Portfolio tab: every
// synced asset (India stocks + USA stocks + mutual funds + EPF +
// gold + FD/bonds + CoinDCX crypto) bucketed into its asset class,
// ONE donut + total, the "last synced" stamp and a manual Sync Now.
//
// Data: GET /api/mcp/indmoney/assets → netWorth (server-side
// netWorthSnapshot() — hidden rows excluded, all values INR).
// Rendering is pure SVG (no chart lib — the repo style).
// ============================================================
import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { IndmNetWorth, IndmNetWorthCategory } from '../../utils/api';
import { forceIndmSync, fetchIndmAssets } from '../../utils/api';

const CLASS_COLOR: Record<string, string> = {
  Equity: '#34d399',
  'Mutual Funds': '#22d3ee',
  EPF: '#a78bfa',
  Gold: '#fbbf24',
  Crypto: '#f472b6',
  'Fixed Income': '#94a3b8',
  Other: '#64748b',
};
const CLASS_EMOJI: Record<string, string> = {
  Equity: '📈', 'Mutual Funds': '🧺', EPF: '🏛️', Gold: '🪙', Crypto: '🪩', 'Fixed Income': '🏦', Other: '📦',
};

function fmtINR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function minsAgo(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Pure-SVG donut: one arc per category, zero when empty. */
function Donut({ categories }: { categories: IndmNetWorthCategory[] }) {
  const R = 52, C = 2 * Math.PI * R;
  const arcs = useMemo(() => {
    const valued = categories.filter(c => c.pct != null && c.pct > 0);
    let acc = 0;
    return valued.map(c => {
      const frac = (c.pct || 0) / 100;
      const arc = { c, dash: frac * C, offset: -acc * C };
      acc += frac;
      return arc;
    });
  }, [categories, C]);
  return (
    <svg viewBox="0 0 140 140" className="w-[128px] h-[128px] shrink-0" role="img" aria-label="Asset allocation donut">
      <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="16" />
      {arcs.map(({ c, dash, offset }, i) => (
        <circle
          key={i}
          cx="70" cy="70" r={R} fill="none"
          stroke={CLASS_COLOR[c.category] || '#64748b'}
          strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`}
          strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
        >
          <title>{`${c.category}: ${fmtINR(c.valueINR)} (${c.pct?.toFixed(1)}%)`}</title>
        </circle>
      ))}
      <text x="70" y="66" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9, fontWeight: 700 }}>
        NET WORTH
      </text>
      <text x="70" y="80" textAnchor="middle" className="fill-slate-100" style={{ fontSize: 12, fontWeight: 900 }}>
        {(categories.reduce((a, c) => a + (c.pct ?? 0), 0) > 0) ? '' : '—'}
      </text>
    </svg>
  );
}

interface NetWorthCardProps {
  netWorth?: IndmNetWorth | null;
  onSynced?: () => void;
}

export const NetWorthCard = memo(function NetWorthCard({ netWorth, onSynced }: NetWorthCardProps) {
  const [syncing, setSyncing] = useState(false);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const out = await forceIndmSync().catch(() => null);
      if (!out) await fetchIndmAssets().catch(() => null); // force failed → at least refresh the snapshot view
      onSynced?.();
    } finally {
      setSyncing(false);
    }
  }, [syncing, onSynced]);

  if (!netWorth || !netWorth.ok || !(netWorth.totalValueINR > 0)) {
    return (
      <div className="quantum-panel rounded-2xl border border-white/10 p-4 bg-black/30">
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Net Worth Summary</div>
        <div className="text-xs text-slate-500 mt-2 leading-relaxed">
          INDMoney connect karo (sources panel upar) — stocks, mutual funds, EPF, gold aur CoinDCX crypto
          sab ek donut me dikhega.
        </div>
      </div>
    );
  }

  const syncedFrom = netWorth.sources?.indmoney ? 'INDMoney' : 'CoinDCX';
  return (
    <div className="quantum-panel rounded-2xl border border-white/10 p-4 bg-black/30">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
          💎 Net Worth Summary
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-slate-500 font-mono" title={netWorth.syncedAt ? new Date(netWorth.syncedAt).toLocaleString() : ''}>
            last synced from {syncedFrom}: {minsAgo(netWorth.syncedAt)}
          </span>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="px-2 py-1 rounded-lg text-[10px] font-bold border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all disabled:opacity-40 flex items-center gap-1"
            title="Force a full INDMoney + CoinDCX sync now"
          >
            <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3">
        <Donut categories={netWorth.categories} />
        <div className="flex-1 min-w-0">
          <div className="text-2xl font-black text-slate-100 font-mono leading-tight">
            {fmtINR(netWorth.totalValueINR)}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            {netWorth.holdingCount} holdings · {netWorth.valuedCount} valued · all INR
          </div>
          <div className="mt-2 space-y-1 max-h-[132px] overflow-y-auto scroll-thin pr-1">
            {netWorth.categories.map(c => (
              <div key={c.category} className="flex items-center gap-2 text-[10px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CLASS_COLOR[c.category] || '#64748b' }} />
                <span className="text-slate-300 font-semibold truncate flex-1">
                  {CLASS_EMOJI[c.category] || '📦'} {c.category}
                  <span className="text-slate-600"> · {c.count}</span>
                </span>
                <span className="text-slate-400 font-mono">{c.pct != null ? `${c.pct.toFixed(0)}%` : '—'}</span>
                <span className="text-slate-200 font-mono w-[72px] text-right">{fmtINR(c.valueINR)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-[8.5px] text-slate-600 mt-2 leading-relaxed" title={netWorth.note}>
        Values INDMoney-native INR (US rows at the app's own rate) · hidden rows excluded{netWorth.lastError ? ` · last sync error: ${netWorth.lastError}` : ''}
      </div>
    </div>
  );
});
