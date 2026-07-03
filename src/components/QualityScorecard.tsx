import React, { useState, useEffect, useCallback } from 'react';
import { fetchFundamentals } from '../utils/fundamentalsApi';
import {
  computeQualityScorecard, formatScorecardForTelegram,
  type QualityScorecard as QualityScorecardData,
} from '../utils/qualityScorecard';
import { secureStorage } from '../utils/secureStorage';
import { sendTelegramAlert } from '../utils/api';

interface Props {
  symbol: string;
  market: 'IN' | 'US';
}

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  'A':  'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  'B+': 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  'B':  'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  'C':  'text-amber-400 bg-amber-500/10 border-amber-500/30',
  'D':  'text-orange-400 bg-orange-500/10 border-orange-500/30',
  'F':  'text-red-400 bg-red-500/10 border-red-500/30',
};

export const QualityScorecard = React.memo(({ symbol, market }: Props) => {
  const [data, setData] = useState<QualityScorecardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError('');
    try {
      const fundamentals = await fetchFundamentals(symbol, market);
      if (!fundamentals) {
        setError('Fundamental data unavailable. Yahoo Finance may be rate-limited.');
        setData(null);
        return;
      }
      const scorecard = computeQualityScorecard(fundamentals);
      setData(scorecard);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [symbol, market]);

  useEffect(() => { load(); }, [load]);

  const sendToTelegram = async () => {
    if (!data) return;
    setSending(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      const msg = formatScorecardForTelegram(data);
      const ok = await sendTelegramAlert(token || '', chatId || '', msg);
      alert(ok ? '✅ Sent to Telegram!' : '⚠️ Send failed — Telegram not configured.');
    } finally {
      setSending(false);
    }
  };

  if (!symbol) return null;

  if (loading) {
    return (
      <div className="quantum-panel rounded-2xl p-4 border-cyan-500/10 animate-pulse">
        <div className="text-xs text-slate-500">Loading quality scorecard for {symbol}...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="quantum-panel rounded-2xl p-4 border-red-500/10">
        <div className="text-xs text-red-400 mb-2">⚠️ {error}</div>
        <button onClick={load} className="text-[10px] text-cyan-400 hover:underline">↻ Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const gradeColor = GRADE_COLORS[data.grade] || GRADE_COLORS['C'];
  const scoreColor = data.totalScore >= 80 ? 'text-emerald-400'
    : data.totalScore >= 65 ? 'text-cyan-400'
    : data.totalScore >= 45 ? 'text-amber-400'
    : 'text-red-400';

  return (
    <div className="quantum-panel rounded-2xl p-4 border-cyan-500/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">Quality Scorecard</div>
          <div className="text-[9px] text-slate-600 mt-0.5">Fundamental analysis · cached 24h</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sendToTelegram}
            disabled={sending}
            className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {sending ? '⏳' : '📤 TG'}
          </button>
          <button onClick={load} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-slate-400 hover:text-white">
            ↻
          </button>
        </div>
      </div>

      {/* Score + Grade */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-black/30 border border-white/5 rounded-xl p-3 text-center">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">Quality Score</div>
          <div className={`text-3xl font-black font-mono ${scoreColor}`}>{data.totalScore}</div>
          <div className="text-[8px] text-slate-600">/100</div>
        </div>
        <div className={`bg-black/30 border rounded-xl p-3 text-center ${gradeColor}`}>
          <div className="text-[9px] uppercase font-bold tracking-wider mb-1 opacity-70">Grade</div>
          <div className="text-3xl font-black font-mono">{data.grade}</div>
          <div className="text-[8px] opacity-70 mt-0.5">
            {data.totalScore >= 80 ? 'Excellent' : data.totalScore >= 65 ? 'Good' : data.totalScore >= 45 ? 'Marginal' : 'Avoid'}
          </div>
        </div>
      </div>

      {/* Red flags banner */}
      {data.redFlags.length > 0 && (
        <div className="mb-3 p-2 bg-red-500/5 border border-red-500/20 rounded-lg">
          <div className="text-[9px] text-red-400 font-bold uppercase tracking-wider mb-1">🚨 Red Flags ({data.redFlags.length})</div>
          <ul className="space-y-0.5">
            {data.redFlags.slice(0, 3).map((r, i) => (
              <li key={i} className="text-[9px] text-red-300/80 leading-snug">• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Factor breakdown */}
      <div className="space-y-1.5 mb-3">
        {data.factors.map((f) => {
          const barWidth = f.score;
          const barColor = f.score >= 80 ? 'bg-emerald-500'
            : f.score >= 60 ? 'bg-cyan-500'
            : f.score >= 40 ? 'bg-amber-500'
            : 'bg-red-500';
          return (
            <div key={f.name} className="bg-black/20 border border-white/5 rounded-lg p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-300 font-bold flex items-center gap-1">
                  {f.redFlag && <span className="text-red-400">⚠️</span>}
                  {f.name}
                  <span className="text-[8px] text-slate-600">({(f.weight * 100).toFixed(0)}%)</span>
                </span>
                <span className={`text-[10px] font-mono font-bold ${
                  f.score >= 80 ? 'text-emerald-400' : f.score >= 60 ? 'text-cyan-400' : f.score >= 40 ? 'text-amber-400' : 'text-red-400'
                }`}>{f.score.toFixed(0)}</span>
              </div>
              <div className="w-full bg-slate-800/60 rounded-full h-1.5 mb-1">
                <div className={`${barColor} h-full rounded-full transition-all`} style={{ width: `${barWidth}%` }} />
              </div>
              <div className="text-[8px] text-slate-500 leading-tight">{f.detail.split('\n')[0]}</div>
            </div>
          );
        })}
      </div>

      {/* Recommendation */}
      <div className="p-2 bg-cyan-500/5 border border-cyan-500/15 rounded-lg">
        <div className="text-[9px] text-cyan-400 font-bold uppercase tracking-wider mb-1">💡 Verdict</div>
        {data.recommendations.map((r, i) => (
          <div key={i} className="text-[10px] text-cyan-200/80 leading-snug">{r}</div>
        ))}
      </div>

      <div className="text-[8px] text-slate-700 mt-2 leading-tight">
        ⚠️ Educational only. Fundamentals via Yahoo Finance (may be stale/incomplete for Indian stocks). Cross-check with company annual reports before large allocations.
      </div>
    </div>
  );
});

QualityScorecard.displayName = 'QualityScorecard';
