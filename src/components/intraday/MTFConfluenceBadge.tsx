// ============================================================
// intraday/MTFConfluenceBadge — v10.5 (Upgrade 1)
// ------------------------------------------------------------
// The 5m/15m/1h multi-timeframe confluence read on a signal card:
//   • 3 TF chips — green (bull read), red (bear read), gray (neutral
//     / no data), each carrying its confidence in the tooltip
//   • an agreement % badge — 100% = all three aligned (full
//     confluence, the server boosted conviction +15), < 67% = the
//     timeframes disagree (the server already banned STRONG and
//     penalized -20 conf — this badge makes the conflict visible
//     BEFORE the user clicks the trade button)
//
// Data source: the India AI board's signal payload (sig.mtf) —
// server/ai/signals.js tapeMTFFromBase(), gated by the
// AI_ENABLE_MTF_CONFLUENCE flag. Renders NOTHING when the payload
// is absent (flag off / tapes unresolved — honest degrade).
// ============================================================
import { memo } from 'react';
import type { MTFConfluence, MTFTapeRead } from '../aitrading/types';

const TF_META: Array<{ key: 'm5' | 'm15' | 'h1'; label: string; title: string }> = [
  { key: 'm5', label: '5m', title: '5-minute tape — entry timing' },
  { key: 'm15', label: '15m', title: '15-minute tape — THE trading timeframe (the vote anchor)' },
  { key: 'h1', label: '1h', title: '1-hour tape — the intraday trend' },
];

function chipCls(dir: number | null | undefined): string {
  if (dir == null) return 'bg-slate-600/20 text-slate-500 border-slate-600/30';
  if (dir > 0) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (dir < 0) return 'bg-red-500/15 text-red-300 border-red-500/40';
  return 'bg-slate-600/20 text-slate-400 border-slate-600/30';
}

function TfChip({ label, read, title }: { label: string; read: MTFTapeRead | null; title: string }) {
  const dir: number | null = read?.dir ?? null;
  const arrow = dir == null ? '·' : dir > 0 ? '▲' : dir < 0 ? '▼' : '·';
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[9px] font-black font-mono border tracking-wide ${chipCls(dir)}`}
      title={read ? `${title} — ${dir != null && dir > 0 ? 'bull' : dir != null && dir < 0 ? 'bear' : 'neutral'} read, ${read.conf}% conf` : `${title} — no data`}
    >
      {label} {arrow}
    </span>
  );
}

function agreementBadgeCls(agreement: number): string {
  if (agreement >= 1) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (agreement >= 0.67) return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30';
  return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
}

export const MTFConfluenceBadge = memo(function MTFConfluenceBadge({ mtf }: { mtf?: MTFConfluence | null }) {
  if (!mtf || (!mtf.m5 && !mtf.m15 && !mtf.h1)) return null;
  const agreement = mtf.agreement;
  const pct = agreement != null ? Math.round(agreement * 100) : null;
  return (
    <div className="flex items-center gap-1 flex-wrap" title="MTF confluence — 5m / 15m / 1h tape reads; agreement is measured against the 15m trading timeframe">
      {TF_META.map(({ key, label, title }) => (
        <TfChip key={key} label={label} read={mtf[key]} title={title} />
      ))}
      {pct != null && (
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-black font-mono border tracking-wide ${agreementBadgeCls(agreement!)}`}
          title={
            agreement! >= 1
              ? 'ALL 3 timeframes aligned — full confluence (server: +15 conviction boost)'
              : agreement! < 0.67
                ? 'Timeframes DISAGREE (< 67%) — server: -20 conviction penalty + STRONG banned'
                : '2 of 3 timeframes aligned — partial confluence'
          }
        >
          MTF {pct}%
        </span>
      )}
    </div>
  );
});
