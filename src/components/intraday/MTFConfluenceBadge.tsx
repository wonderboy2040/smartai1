// ============================================================
// intraday/MTFConfluenceBadge — v10.5 (Upgrade 1) → v13.3 MTF-6
// ------------------------------------------------------------
// THE FULL multi-timeframe confluence read on a signal card — the
// user's "1min/5min/15min/1hr/4hr/1d full analysis" spec made visible:
//   • 6 TF chips in two groups — LTF (1m entry trigger · 5m timing ·
//     15m THE trading TF/anchor) and HTF (1h intraday · 4h swing ·
//     1d macro tide): green (bull), red (bear), gray (neutral/no data),
//     each carrying its confidence in the tooltip
//   • an agreement % badge — 100% = the whole ladder aligned (server
//     boosted conviction +15), < 67% = disagreement (server already
//     banned STRONG + penalized −20 — this badge makes the conflict
//     visible BEFORE the user clicks the trade button)
//   • a HTF/LTF split line when both sub-agreements are present —
//     "tide vs ripple" at a glance
//
// Data source: sig.mtf on EVERY desk's signal payload (v13.3 — India
// AND crypto/futures/global) — server/ai/signals.js
// tapeMTFFromBase6(), gated by the AI_ENABLE_MTF_CONFLUENCE flag.
// Renders NOTHING when the payload is absent (flag off / tapes
// unresolved — honest degrade). m1/h4/d1 are optional fields: an
// older 3-TF payload still renders its 3 chips.
// ============================================================
import { memo } from 'react';
import type { MTFConfluence, MTFTapeRead } from '../aitrading/types';

type TfKey = 'm1' | 'm5' | 'm15' | 'h1' | 'h4' | 'd1';

const LTF_META: Array<{ key: TfKey; label: string; title: string }> = [
  { key: 'm1', label: '1m', title: '1-minute tape — the entry TRIGGER (micro timing)' },
  { key: 'm5', label: '5m', title: '5-minute tape — entry-timing confirmation' },
  { key: 'm15', label: '15m', title: '15-minute tape — THE trading timeframe (the vote anchor)' },
];
const HTF_META: Array<{ key: TfKey; label: string; title: string }> = [
  { key: 'h1', label: '1h', title: '1-hour tape — the intraday trend' },
  { key: 'h4', label: '4h', title: '4-hour tape — the swing trend' },
  { key: 'd1', label: '1d', title: 'daily tape — the macro direction (the TIDE)' },
];

function chipCls(dir: number | null | undefined): string {
  if (dir == null) return 'bg-slate-600/20 text-slate-500 border-slate-600/30';
  if (dir > 0) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (dir < 0) return 'bg-red-500/15 text-red-300 border-red-500/40';
  return 'bg-slate-600/20 text-slate-400 border-slate-600/30';
}

function TfChip({ label, read, title }: { label: string; read: MTFTapeRead | null | undefined; title: string }) {
  const dir: number | null | undefined = read == null ? null : read.dir;
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

const pct = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v * 100));

export const MTFConfluenceBadge = memo(function MTFConfluenceBadge({ mtf }: { mtf?: MTFConfluence | null }) {
  if (!mtf || (!mtf.m5 && !mtf.m15 && !mtf.h1 && !mtf.m1 && !mtf.h4 && !mtf.d1)) return null;
  const agreement = mtf.agreement;
  const p = pct(agreement);
  const htfP = pct(mtf.htfAgreement ?? null);
  const ltfP = pct(mtf.ltfAgreement ?? null);
  const six = !!(mtf.m1 || mtf.h4 || mtf.d1);
  return (
    <div className="flex items-center gap-1 flex-wrap" title={`MTF-6 confluence — 1m / 5m / 15m / 1h / 4h / 1d tape reads; agreement is measured against the 15m trading timeframe (aligned / active voters, neutral tapes abstain)`}>
      <span className="px-1 py-0.5 rounded text-[8px] font-black font-mono border bg-violet-500/10 text-violet-300 border-violet-500/30 tracking-wider" title="Super Intelligence MTF-6 — the full-ladder confluence read (v13.3)">
        {six ? 'MTF-6' : 'MTF'}
      </span>
      {LTF_META.map(({ key, label, title }) => (
        <TfChip key={key} label={label} read={mtf[key]} title={title} />
      ))}
      <span className="text-slate-600 text-[9px] font-black" title="lower timeframes → entry timing | higher timeframes → the trend/tide">|</span>
      {HTF_META.map(({ key, label, title }) => (
        <TfChip key={key} label={label} read={mtf[key]} title={title} />
      ))}
      {p != null && (
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-black font-mono border tracking-wide ${agreementBadgeCls(agreement!)}`}
          title={
            agreement! >= 1
              ? 'The WHOLE ladder aligned — full confluence (server: +15 conviction boost)'
              : agreement! < 0.67
                ? 'Timeframes DISAGREE (< 67%) — server: −20 conviction penalty + STRONG banned'
                : '2/3+ of the active timeframes aligned — partial confluence'
          }
        >
          {p}%
        </span>
      )}
      {htfP != null && ltfP != null && (
        <span className="px-1 py-0.5 rounded text-[8px] font-black font-mono border border-slate-600/30 bg-black/30 text-slate-400 tracking-wide" title="tide vs ripple — the HTF (1h/4h/1d) agreement vs the LTF (1m/5m/15m) agreement">
          TIDE {htfP}% · RIPPLE {ltfP}%
        </span>
      )}
    </div>
  );
});
