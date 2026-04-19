// ============================================
// 🎯 TRIM + RE-ENTRY RULES — Master Strategy Card
// ============================================

import { useState } from 'react';

interface ETFRule {
  symbol: string;
  emoji: string;
  label: string;
  category: 'US' | 'IN';
  style: string; // aggressive, core, semi-core, etc.
  trimWhen: string;
  trimSize: string;
  reEntryDip: string;
  reEntryStyle: string;
  rotateTo: string;
  masterLine: string;
  accentFrom: string;
  accentTo: string;
}

const ETF_RULES: ETFRule[] = [
  {
    symbol: 'SMH', emoji: '🔥', label: 'Most Aggressive', category: 'US',
    style: 'Aggressive', trimWhen: 'Weight > 53% OR rally 20%+ in 6 weeks',
    trimSize: '10-15% of position (max 20%)', reEntryDip: '8-10% dip from trim price',
    reEntryStyle: '3 equal parts (33% each)', rotateTo: 'QQQM (if not re-entering)',
    masterLine: 'Trim aggressive, Re-enter on -10% dip',
    accentFrom: 'from-red-500', accentTo: 'to-orange-500'
  },
  {
    symbol: 'QQQM', emoji: '💎', label: 'Core — Rarely Touch', category: 'US',
    style: 'Core', trimWhen: 'Weight > 42% (rare)',
    trimSize: '5-8% only', reEntryDip: '6-8% dip',
    reEntryStyle: '2 equal parts (50% each)', rotateTo: 'SMH (if SMH dipped) or XLK',
    masterLine: 'Rarely trim, Re-enter on -7% dip',
    accentFrom: 'from-cyan-500', accentTo: 'to-blue-500'
  },
  {
    symbol: 'XLK', emoji: '⚡', label: 'Semi-Core', category: 'US',
    style: 'Semi-Core', trimWhen: 'Weight > 27% OR rally 22%+ in 3 months',
    trimSize: '10-12% of position', reEntryDip: '7-9% dip from trim price',
    reEntryStyle: '2-3 equal parts', rotateTo: 'QQQM (broader exposure)',
    masterLine: 'Moderate trim, Re-enter on -8% dip',
    accentFrom: 'from-amber-500', accentTo: 'to-yellow-500'
  },
  {
    symbol: 'MOMOMENTUM', emoji: '🇮🇳', label: 'Aggressive', category: 'IN',
    style: 'Aggressive', trimWhen: 'Weight > 44% OR rally 25%+ in 3 months',
    trimSize: '10-15% of position', reEntryDip: '10% correction',
    reEntryStyle: '3 equal SIP-style buys', rotateTo: 'MID150BEES or JUNIORBEES',
    masterLine: 'Trim if hot, Re-enter on -10% dip',
    accentFrom: 'from-orange-500', accentTo: 'to-red-500'
  },
  {
    symbol: 'SMALLCAP', emoji: '🚀', label: 'Highest Risk', category: 'IN',
    style: 'High Risk', trimWhen: 'Weight > 33% OR rally 30%+ in 4 months',
    trimSize: '12-18% of position', reEntryDip: '12-15% correction',
    reEntryStyle: '3-4 staggered buys', rotateTo: 'MID150BEES (safer)',
    masterLine: 'Trim if euphoric, Re-enter on -13% dip',
    accentFrom: 'from-rose-500', accentTo: 'to-pink-500'
  },
  {
    symbol: 'MID150BEES', emoji: '🏛️', label: 'Core', category: 'IN',
    style: 'Core', trimWhen: 'Weight > 27% (rarely)',
    trimSize: '5-10% only', reEntryDip: '8% dip',
    reEntryStyle: '2 parts', rotateTo: 'JUNIORBEES',
    masterLine: 'Mostly hold, Re-enter on -8% dip',
    accentFrom: 'from-emerald-500', accentTo: 'to-teal-500'
  },
  {
    symbol: 'JUNIORBEES', emoji: '🛡️', label: 'Most Stable', category: 'IN',
    style: 'Stable', trimWhen: 'Weight > 22% (very rarely)',
    trimSize: '5-8% only', reEntryDip: '6% dip',
    reEntryStyle: '2 parts', rotateTo: 'MID150BEES',
    masterLine: 'Almost never sell, Re-enter on -6% dip',
    accentFrom: 'from-blue-500', accentTo: 'to-indigo-500'
  }
];

const GOLDEN_RULES_DO = [
  'Trim only OVERWEIGHT positions',
  'Maximum 15-20% trim per action',
  'Re-enter in PARTS (never full at once)',
  'Wait for confirmed dip (not just intraday)',
  'Continue SIP regardless of trim',
  'Document every trim for tax',
  'Review every 6 months only'
];

const GOLDEN_RULES_DONT = [
  'Never full exit',
  'Never panic trim in red days',
  'Never chase same price after trim',
  'Never trust "exact magic levels"',
  'Never trim more than once per quarter'
];

export function TrimRules() {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [activeMarket, setActiveMarket] = useState<'ALL' | 'US' | 'IN'>('ALL');

  const filtered = activeMarket === 'ALL' ? ETF_RULES : ETF_RULES.filter(e => e.category === activeMarket);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            🎯 Trim + Re-Entry Rules
          </h2>
          <p className="text-slate-500 text-sm mt-1">5 rules per ETF — Execute, don't overthink</p>
        </div>
        <div className="flex gap-1 bg-black/30 rounded-xl p-1">
          {(['ALL', 'US', 'IN'] as const).map(m => (
            <button
              key={m}
              onClick={() => setActiveMarket(m)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${activeMarket === m
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20'
                : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {m === 'US' ? '🇺🇸 USA' : m === 'IN' ? '🇮🇳 India' : '🌍 All'}
            </button>
          ))}
        </div>
      </div>

      {/* ETF Rule Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(etf => {
          const isExpanded = expandedCard === etf.symbol;
          return (
            <div
              key={etf.symbol}
              onClick={() => setExpandedCard(isExpanded ? null : etf.symbol)}
              className={`glass-card rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:border-cyan-500/20 ${isExpanded ? 'ring-1 ring-cyan-500/30 col-span-1 md:col-span-2 xl:col-span-1' : ''}`}
            >
              {/* Card Header with gradient accent */}
              <div className={`h-1.5 bg-gradient-to-r ${etf.accentFrom} ${etf.accentTo}`} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{etf.emoji}</span>
                    <div>
                      <div className="font-black text-white text-lg">{etf.symbol}</div>
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{etf.label}</div>
                    </div>
                  </div>
                  <span className={`badge text-[10px] ${etf.category === 'US' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                    {etf.category === 'US' ? '🇺🇸 US' : '🇮🇳 IN'}
                  </span>
                </div>

                {/* Master one-liner */}
                <div className="bg-black/30 rounded-xl p-3 mb-3 border border-white/5">
                  <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider mb-1">Master Formula</div>
                  <div className="text-sm text-white font-semibold">{etf.masterLine}</div>
                </div>

                {/* 5 Rules */}
                <div className="space-y-2">
                  <RuleLine num={1} label="TRIM WHEN" value={etf.trimWhen} color="text-red-400" />
                  <RuleLine num={2} label="TRIM SIZE" value={etf.trimSize} color="text-amber-400" />
                  <RuleLine num={3} label="RE-ENTRY" value={etf.reEntryDip} color="text-emerald-400" />
                  <RuleLine num={4} label="RE-ENTRY STYLE" value={etf.reEntryStyle} color="text-cyan-400" />
                  <RuleLine num={5} label="ROTATE TO" value={etf.rotateTo} color="text-purple-400" />
                </div>

                {/* Expand indicator */}
                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-white/5 animate-fade-in">
                    <ReEntryTimeline symbol={etf.symbol} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cash Management Card */}
      <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">💰</span>
          Cash Management Post-Trim
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Max Cash" value="5-7%" sub="of total portfolio" color="text-emerald-400" />
          <StatBox label="Deploy Timeline" value="30-90" sub="days max" color="text-cyan-400" />
          <StatBox label="Method" value="3 Parts" sub="staggered buys" color="text-amber-400" />
          <StatBox label="No Dip 90d?" value="Deploy" sub="anyway at market" color="text-purple-400" />
        </div>
        <div className="mt-3 bg-black/20 rounded-xl p-3 border border-white/5">
          <p className="text-xs text-slate-400">
            <span className="text-amber-400 font-bold">Why?</span> Cash drag kills returns. Market doesn't always dip when you want. Long-term invested rehna &gt; timing.
          </p>
        </div>
      </div>

      {/* Re-Entry Decision Tree */}
      <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">🔄</span>
          Re-Entry Decision Tree
        </h3>
        <div className="space-y-2">
          <TimelineStep day="Day 1-30" action="WAIT — Don't redeploy" color="bg-slate-500" />
          <TimelineStep day="Day 30-60" action="If dip 8%+ → Buy 33%" color="bg-amber-500" />
          <TimelineStep day="Day 60-90" action="If dip 10%+ → Buy another 33%" color="bg-emerald-500" />
          <TimelineStep day="Day 90+" action="Deploy remaining 33% regardless" color="bg-cyan-500" />
        </div>
        <div className="mt-3 bg-amber-500/5 border border-amber-500/15 rounded-xl p-3">
          <p className="text-xs text-amber-400 font-semibold">
            ⚠️ If no dip in 90 days → Deploy in 2-3 tranches at current price. Time in market &gt; waiting for perfect price.
          </p>
        </div>
      </div>

      {/* Golden Rules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* DO */}
        <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
          <h3 className="text-base font-bold text-emerald-400 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">✅</span>
            Golden Rules — ALWAYS
          </h3>
          <div className="space-y-2">
            {GOLDEN_RULES_DO.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3">
                <span className="text-emerald-400 font-bold text-xs mt-0.5">✅</span>
                <span className="text-sm text-slate-300">{rule}</span>
              </div>
            ))}
          </div>
        </div>
        {/* DON'T */}
        <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
          <h3 className="text-base font-bold text-red-400 mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-sm">❌</span>
            Golden Rules — NEVER
          </h3>
          <div className="space-y-2">
            {GOLDEN_RULES_DONT.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                <span className="text-red-400 font-bold text-xs mt-0.5">❌</span>
                <span className="text-sm text-slate-300">{rule}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Final One-Liner */}
      <div className="glass-card rounded-2xl p-6 text-center animate-fade-in-up border border-cyan-500/10">
        <div className="text-lg font-black text-white mb-2">🎯 ONE RULE TO RULE THEM ALL</div>
        <p className="text-cyan-400 font-semibold text-sm leading-relaxed max-w-xl mx-auto">
          "Trim only when overweight + parabolic, Re-enter in 3 parts on dip, Continue SIP always, Review every 6 months, Ignore noise, follow rules."
        </p>
        <div className="mt-3 text-xs text-slate-500">🎯 GOAL: 20%+ CAGR for 15-20 years</div>
      </div>
    </div>
  );
}

// Sub-components
function RuleLine({ num, label, value, color }: { num: number; label: string; value: string; color: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`w-5 h-5 rounded-md bg-white/5 flex items-center justify-center text-[10px] font-black ${color} shrink-0 mt-0.5`}>{num}</span>
      <div>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{label}: </span>
        <span className="text-xs text-slate-300">{value}</span>
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-black/20 border border-white/5 p-4 rounded-xl text-center">
      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-black font-mono ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function TimelineStep({ day, action, color }: { day: string; action: string; color: string }) {
  return (
    <div className="flex items-center gap-3 bg-black/20 rounded-xl p-3 border border-white/5">
      <div className={`w-3 h-3 rounded-full ${color} shrink-0`} />
      <div>
        <span className="text-xs font-bold text-white">{day}: </span>
        <span className="text-xs text-slate-400">{action}</span>
      </div>
    </div>
  );
}

function ReEntryTimeline({ symbol }: { symbol: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider">Re-Entry Timeline for {symbol}</div>
      <div className="text-xs text-slate-400 space-y-1">
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-slate-500" />Day 1-30: WAIT (don't redeploy)</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" />Day 30-60: If dip target hit → Buy 33%</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500" />Day 60-90: If deeper dip → Buy another 33%</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-cyan-500" />Day 90+: Deploy remaining regardless</div>
      </div>
    </div>
  );
}
