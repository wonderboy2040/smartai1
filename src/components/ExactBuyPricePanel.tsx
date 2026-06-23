import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../hooks/AppContext';
import { calculateExactEntryPrice, EntryPriceResult } from '../utils/entryPriceEngine';
import { calculateConfluence, ConfluenceResult } from '../utils/confluenceEngine';
import { analyzeSentimentWithAI, SentimentResult, fetchStockNews } from '../utils/sentimentEngine';
import { calculatePortfolioRisk, RiskMetrics } from '../utils/riskAnalyzer';
import { runBacktest, BacktestResult } from '../utils/backtestEngine';
import { getUpcomingEarnings, EarningsEvent } from '../utils/earningsCalendar';
import { sendTelegramAlert } from '../utils/api';
import { secureStorage } from '../utils/secureStorage';

export function ExactBuyPricePanel() {
  const { currentSymbol, currentMarket, currentData, livePrices, portfolio, usdInrRate } = useApp();
  const [entryResult, setEntryResult] = useState<EntryPriceResult | null>(null);
  const [confluence, setConfluence] = useState<ConfluenceResult | null>(null);
  const [sentiment, setSentiment] = useState<SentimentResult | null>(null);
  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeLayer, setActiveLayer] = useState<'entry' | 'confluence' | 'risk' | 'backtest' | 'earnings'>('entry');
  const [tgSending, setTgSending] = useState(false);

  const cur = currentMarket === 'IN' ? '\u20B9' : '$';

  // Run all engines when symbol changes
  const runAllEngines = useCallback(async () => {
    if (!currentSymbol || !currentData) return;
    setLoading(true);
    try {
      const [entry, conf, sent, risk, bt] = await Promise.allSettled([
        calculateExactEntryPrice(currentSymbol, currentMarket as 'IN' | 'US', currentData),
        Promise.resolve(calculateConfluence(currentSymbol, currentMarket as 'IN' | 'US', currentData)),
        fetchStockNews(currentSymbol, currentMarket as 'IN' | 'US').then(news =>
          analyzeSentimentWithAI(currentSymbol, currentMarket as 'IN' | 'US', news)
        ),
        Promise.resolve(calculatePortfolioRisk(portfolio, livePrices, usdInrRate)),
        runBacktest(currentSymbol, currentMarket as 'IN' | 'US', '1Y', 15)
      ]);

      if (entry.status === 'fulfilled') setEntryResult(entry.value);
      if (conf.status === 'fulfilled') setConfluence(conf.value);
      if (sent.status === 'fulfilled') setSentiment(sent.value);
      if (risk.status === 'fulfilled') setRiskMetrics(risk.value);
      if (bt.status === 'fulfilled') setBacktestResult(bt.value);

      setEarnings(getUpcomingEarnings(currentMarket as 'IN' | 'US', 30));
    } catch (e) { console.warn('Engine error:', e); }
    finally { setLoading(false); }
  }, [currentSymbol, currentMarket, currentData, portfolio, livePrices, usdInrRate]);

  useEffect(() => { runAllEngines(); }, [runAllEngines]);

  // Push to Telegram
  const pushToTg = useCallback(async () => {
    setTgSending(true);
    const [token, chatId] = await Promise.all([
      secureStorage.getItemAsync('TG_TOKEN'),
      secureStorage.getItemAsync('TG_CHAT_ID')
    ]);

    let msg = `<b>EXACT BUY PRICE REPORT: ${currentSymbol}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (entryResult) {
      msg += `<b>ENTRY ZONE:</b> ${cur}${entryResult.exactEntryPrice.low} - ${cur}${entryResult.exactEntryPrice.high}\n`;
      msg += `<b>Optimal:</b> ${cur}${entryResult.exactEntryPrice.optimal}\n`;
      msg += `<b>SL:</b> ${cur}${entryResult.stopLoss} | <b>T1:</b> ${cur}${entryResult.targetPrice1} | <b>T2:</b> ${cur}${entryResult.targetPrice2}\n`;
      msg += `<b>R:R:</b> 1:${entryResult.riskRewardRatio}\n`;
      msg += `<b>Signal:</b> ${entryResult.signal} (${entryResult.entryConfidence}% conf)\n\n`;
    }
    if (confluence) {
      msg += `<b>CONFLUENCE:</b> ${confluence.confluenceScore}/100 - ${confluence.confluenceSignal}\n`;
      msg += `${confluence.alignment}\n\n`;
    }
    if (sentiment) {
      msg += `<b>SENTIMENT:</b> ${sentiment.overall} (${sentiment.score}/100)\n\n`;
    }

    await sendTelegramAlert(token || '', chatId || '', msg);
    setTgSending(false);
  }, [entryResult, confluence, sentiment, currentSymbol, cur]);

  if (!currentSymbol || !currentData) {
    return (
      <div className="quantum-panel rounded-2xl p-8 text-center">
        <div className="text-4xl mb-3 animate-float">{'\u{1F3AF}'}</div>
        <div className="text-slate-400 font-medium">Select a symbol to get Exact Buy Price</div>
        <div className="text-xs text-slate-600 mt-1">3-Layer AI Entry Engine</div>
      </div>
    );
  }

  const combinedScore = entryResult && confluence && sentiment
    ? Math.round(entryResult.entryConfidence * 0.35 + confluence.confluenceScore * 0.35 + sentiment.score * 0.3 + 50)
    : 0;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header with combined score */}
      <div className="quantum-panel rounded-2xl p-5 border border-cyan-500/10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-black gradient-text-cyan font-display flex items-center gap-2">
              {'\u{1F3AF}'} EXACT BUY PRICE ENGINE
            </h2>
            <div className="text-xs text-slate-500 mt-1">3-Layer: Technical + ML + AI Validation</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className={`text-3xl font-black font-mono ${combinedScore >= 70 ? 'text-emerald-400' : combinedScore >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                {loading ? '...' : combinedScore}
              </div>
              <div className="text-[9px] text-slate-500 uppercase">Combined</div>
            </div>
            <button onClick={pushToTg} disabled={tgSending} className="quantum-btn-primary px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl text-xs font-bold text-white disabled:opacity-40">
              {tgSending ? '...' : '\uD83D\uDCF1} TG'}
            </button>
          </div>
        </div>

        {/* Layer Tabs */}
        <div className="flex gap-1 bg-black/30 p-1 rounded-xl overflow-x-auto scrollbar-hide">
          {[
            { id: 'entry', label: '\uD83C\uDFAF Entry', emoji: '\uD83C\uDFAF' },
            { id: 'confluence', label: '\u{1F4CA} Confluence', emoji: '\u{1F4CA}' },
            { id: 'risk', label: '\u{1F6E1}\uFE0F Risk', emoji: '\u{1F6E1}\uFE0F' },
            { id: 'backtest', label: '\u{1F9EA} Backtest', emoji: '\u{1F9EA}' },
            { id: 'earnings', label: '\u{1F4C5} Earnings', emoji: '\u{1F4C5}' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveLayer(tab.id as typeof activeLayer)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex-shrink-0 ${activeLayer === tab.id ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entry Price Panel */}
      {activeLayer === 'entry' && entryResult && (
        <div className="space-y-3">
          {/* Exact Entry Zone */}
          <div className="quantum-panel rounded-2xl p-5 border border-emerald-500/10">
            <h3 className="text-sm font-bold text-emerald-400 mb-1 flex items-center gap-2">
              {'\u{1F3AF}'} EXACT BUY ZONE
            </h3>
            <div className="text-[10px] text-slate-500 mb-3 leading-snug">
              {'\u{1F449}'} <span className="text-cyan-400 font-bold">Optimal Entry</span> is the single price to trust. Buy anywhere inside the zone; it&apos;s a suggested entry &mdash; <span className="text-slate-400">not your holding cost</span>. The same numbers show in Confluence &amp; Dip panels.
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-center">
                <div className="text-[9px] text-emerald-400/80 font-bold uppercase">Entry Low</div>
                <div className="text-lg font-black text-emerald-400 font-mono">{cur}{entryResult.exactEntryPrice.low}</div>
              </div>
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3 text-center">
                <div className="text-[9px] text-cyan-400/80 font-bold uppercase">Optimal Entry</div>
                <div className="text-xl font-black text-cyan-400 font-mono">{cur}{entryResult.exactEntryPrice.optimal}</div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-center">
                <div className="text-[9px] text-amber-400/80 font-bold uppercase">Entry High</div>
                <div className="text-lg font-black text-amber-400 font-mono">{cur}{entryResult.exactEntryPrice.high}</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2">
                <div className="text-[9px] text-red-400/80 font-bold">STOP LOSS</div>
                <div className="text-sm font-black text-red-400 font-mono">{cur}{entryResult.stopLoss}</div>
              </div>
              <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2">
                <div className="text-[9px] text-emerald-400/80 font-bold">TARGET 1</div>
                <div className="text-sm font-black text-emerald-400 font-mono">{cur}{entryResult.targetPrice1}</div>
              </div>
              <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2">
                <div className="text-[9px] text-emerald-400/80 font-bold">TARGET 2</div>
                <div className="text-sm font-black text-emerald-400 font-mono">{cur}{entryResult.targetPrice2}</div>
              </div>
              <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-2">
                <div className="text-[9px] text-cyan-400/80 font-bold">R:R RATIO</div>
                <div className="text-sm font-black text-cyan-400 font-mono">1:{entryResult.riskRewardRatio}</div>
              </div>
            </div>
            <div className={`mt-3 p-3 rounded-xl border flex items-center justify-between ${entryResult.signal === 'STRONG_BUY' ? 'bg-emerald-500/5 border-emerald-500/20' : entryResult.signal === 'BUY' ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
              <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase">AI Verdict</div>
                <div className="text-sm font-bold text-white mt-0.5">{entryResult.signal} - Confidence: {entryResult.entryConfidence}%</div>
              </div>
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${entryResult.signal === 'STRONG_BUY' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'}`}>
                {entryResult.entryConfidence}%
              </div>
            </div>
          </div>

          {/* Layer 1: Technical */}
          <div className="quantum-panel rounded-2xl p-4 border border-cyan-500/10">
            <h3 className="text-sm font-bold text-cyan-400 mb-3">LAYER 1: Technical ({entryResult.technical.technicalScore}/100)</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">VWAP</div>
                <div className={`text-sm font-bold font-mono ${entryResult.technical.vwap.bias === 'BULLISH' ? 'text-emerald-400' : entryResult.technical.vwap.bias === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>
                  {cur}{entryResult.technical.vwap.vwap.toFixed(2)}
                </div>
                <div className="text-[9px] text-slate-600">{entryResult.technical.vwap.bias}</div>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">POC (Max Vol)</div>
                <div className="text-sm font-bold text-cyan-400 font-mono">{cur}{entryResult.technical.volumeProfile.poc.toFixed(2)}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {entryResult.technical.supportZones.slice(0, 3).map((z, i) => (
                <div key={i} className="flex items-center justify-between bg-emerald-500/5 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-emerald-400">{z.label}</span>
                  <span className="text-xs font-mono text-emerald-300">{cur}{z.price.toFixed(2)}</span>
                  <span className="text-[9px] text-slate-500">Str: {z.strength}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Layer 2: ML */}
          <div className="quantum-panel rounded-2xl p-4 border border-purple-500/10">
            <h3 className="text-sm font-bold text-purple-400 mb-3">LAYER 2: ML Analysis ({entryResult.ml.mlScore}/100)</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Bounce Prob</div>
                <div className={`text-lg font-black font-mono ${entryResult.ml.supportBounceProbability > 70 ? 'text-emerald-400' : entryResult.ml.supportBounceProbability > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                  {entryResult.ml.supportBounceProbability}%
                </div>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Vol Regime</div>
                <div className="text-xs font-bold text-cyan-400">{entryResult.ml.volatilityRegime}</div>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-[9px] text-slate-500">Pattern</div>
                <div className="text-[10px] font-bold text-purple-400">{entryResult.ml.patternMatch}</div>
              </div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-[9px] text-slate-500 mb-1">90% Confidence Interval</div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-emerald-400">{cur}{entryResult.ml.confidenceInterval.low}</span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full" style={{ width: `${entryResult.ml.confidenceInterval.confidence}%` }} />
                </div>
                <span className="text-xs font-mono text-red-400">{cur}{entryResult.ml.confidenceInterval.high}</span>
              </div>
              <div className="text-[9px] text-slate-600 text-center mt-1">{entryResult.ml.confidenceInterval.confidence}% confidence</div>
            </div>
          </div>

          {/* Layer 3: AI Validation */}
          <div className="quantum-panel rounded-2xl p-4 border border-amber-500/10">
            <h3 className="text-sm font-bold text-amber-400 mb-3">LAYER 3: AI Validation ({entryResult.aiValidation.aiScore}/100)</h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="flex items-center gap-2 bg-black/30 rounded-lg p-2">
                <span className={entryResult.aiValidation.fundamentalJustified ? 'text-emerald-400' : 'text-red-400'}>
                  {entryResult.aiValidation.fundamentalJustified ? '\u2705' : '\u274C'}
                </span>
                <span className="text-xs text-slate-300">Fundamentals OK</span>
              </div>
              <div className="flex items-center gap-2 bg-black/30 rounded-lg p-2">
                <span className={entryResult.aiValidation.sectorAlignment ? 'text-emerald-400' : 'text-red-400'}>
                  {entryResult.aiValidation.sectorAlignment ? '\u2705' : '\u274C'}
                </span>
                <span className="text-xs text-slate-300">Sector Aligned</span>
              </div>
            </div>
            <div className="bg-black/20 rounded-lg p-2">
              <div className="text-[9px] text-slate-500">AI Verdict</div>
              <div className="text-xs text-cyan-200 mt-0.5">{entryResult.aiValidation.aiVerdict}</div>
            </div>
          </div>
        </div>
      )}

      {/* Confluence Panel */}
      {activeLayer === 'confluence' && confluence && (
        <div className="quantum-panel rounded-2xl p-5 border border-cyan-500/10">
          <h3 className="text-sm font-bold text-cyan-400 mb-3">Multi-Timeframe Confluence ({confluence.confluenceScore}/100)</h3>
          <div className="space-y-3">
            {confluence.timeframes.map(tf => (
              <div key={tf.timeframe} className="bg-black/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white">{tf.timeframe}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tf.trend === 'BULLISH' ? 'bg-emerald-500/15 text-emerald-400' : tf.trend === 'BEARISH' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                    {tf.trend} ({tf.strength})
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><div className="text-[9px] text-slate-500">RSI</div><div className="text-xs font-bold text-cyan-400">{tf.rsi}</div></div>
                  <div><div className="text-[9px] text-slate-500">SMA</div><div className="text-[10px] font-bold text-slate-300">{tf.smaCross}</div></div>
                  <div><div className="text-[9px] text-slate-500">MACD</div><div className="text-[10px] font-bold text-slate-300">{tf.macdSignal}</div></div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 bg-black/20 rounded-xl p-3">
            <div className="text-xs text-slate-300">{confluence.alignment}</div>
          </div>
          {confluence.institutionalFlow.estimatedFlow !== 'NEUTRAL' && (
            <div className="mt-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3">
              <div className="text-[10px] text-indigo-400 font-bold uppercase mb-1">Institutional Flow</div>
              <div className="text-xs text-indigo-200">{confluence.institutionalFlow.fiiEstimate}</div>
              <div className="text-xs text-indigo-200">{confluence.institutionalFlow.diiEstimate}</div>
            </div>
          )}
        </div>
      )}

      {/* Risk Panel */}
      {activeLayer === 'risk' && riskMetrics && (
        <div className="quantum-panel rounded-2xl p-5 border border-red-500/10">
          <h3 className="text-sm font-bold text-red-400 mb-3">Portfolio Risk Analysis</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">VaR (95%)</div>
              <div className="text-lg font-black text-red-400 font-mono">{cur}{riskMetrics.portfolioVaR.amount.toLocaleString('en-IN')}</div>
              <div className="text-[9px] text-slate-600">{riskMetrics.portfolioVaR.percent}%/day</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">Drawdown</div>
              <div className="text-lg font-black text-amber-400 font-mono">{riskMetrics.currentDrawdown.percent}%</div>
              <div className="text-[9px] text-slate-600">Current</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">Sharpe Ratio</div>
              <div className="text-lg font-black text-cyan-400 font-mono">{riskMetrics.sharpeRatio}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">Risk Score</div>
              <div className={`text-lg font-black font-mono ${riskMetrics.riskScore < 30 ? 'text-emerald-400' : riskMetrics.riskScore < 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {riskMetrics.riskScore}/100
              </div>
            </div>
          </div>
          {riskMetrics.alerts.length > 0 && (
            <div className="space-y-1.5">
              {riskMetrics.alerts.slice(0, 4).map((a, i) => (
                <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${a.level === 'CRITICAL' ? 'bg-red-500/10 border border-red-500/20' : a.level === 'WARNING' ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
                  <span className="text-xs">{a.level === 'CRITICAL' ? '\uD83D\uDD34' : a.level === 'WARNING' ? '\uD83D\uDFE0' : '\uD83D\uDD35'}</span>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-white">{a.message}</div>
                    <div className="text-[10px] text-slate-400">{a.action}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Backtest Panel */}
      {activeLayer === 'backtest' && backtestResult && (
        <div className="quantum-panel rounded-2xl p-5 border border-purple-500/10">
          <h3 className="text-sm font-bold text-purple-400 mb-3">Backtest: RSI+SMA Strategy</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">Win Rate</div>
              <div className={`text-lg font-black font-mono ${backtestResult.winRate > 60 ? 'text-emerald-400' : backtestResult.winRate > 45 ? 'text-amber-400' : 'text-red-400'}`}>
                {backtestResult.winRate}%
              </div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">Total Return</div>
              <div className={`text-lg font-black font-mono ${backtestResult.totalReturn > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {backtestResult.totalReturn > 0 ? '+' : ''}{backtestResult.totalReturn}%
              </div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 text-center">
              <div className="text-[9px] text-slate-500">Sharpe</div>
              <div className="text-lg font-black text-cyan-400 font-mono">{backtestResult.sharpeRatio}</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center mb-3">
            <div><div className="text-[9px] text-slate-500">Trades</div><div className="text-xs font-bold text-white">{backtestResult.totalTrades}</div></div>
            <div><div className="text-[9px] text-slate-500">Avg Return</div><div className="text-xs font-bold text-cyan-400">{backtestResult.avgReturn}%</div></div>
            <div><div className="text-[9px] text-slate-500">Max Win</div><div className="text-xs font-bold text-emerald-400">+{backtestResult.maxWin}%</div></div>
            <div><div className="text-[9px] text-slate-500">Profit Factor</div><div className="text-xs font-bold text-purple-400">{backtestResult.profitFactor}</div></div>
          </div>
          {backtestResult.trades.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Recent Trades</div>
              {backtestResult.trades.slice(-5).map((t, i) => (
                <div key={i} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-1.5">
                  <span className={`text-xs ${t.result === 'WIN' ? 'text-emerald-400' : t.result === 'LOSS' ? 'text-red-400' : 'text-slate-400'}`}>
                    {t.result === 'WIN' ? '\u2705' : t.result === 'LOSS' ? '\u274C' : '\u26AA'} {t.entryDate}
                  </span>
                  <span className="text-xs font-mono text-slate-300">{cur}{t.entryPrice} {'\u2192'} {cur}{t.exitPrice}</span>
                  <span className={`text-xs font-bold ${t.returnPct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.returnPct > 0 ? '+' : ''}{t.returnPct}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Earnings Panel */}
      {activeLayer === 'earnings' && (
        <div className="quantum-panel rounded-2xl p-5 border border-amber-500/10">
          <h3 className="text-sm font-bold text-amber-400 mb-3">Earnings Calendar (Next 30 Days)</h3>
          {earnings.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-4">No major earnings in next 30 days</div>
          ) : (
            <div className="space-y-2">
              {earnings.slice(0, 8).map((e, i) => (
                <div key={i} className="bg-black/30 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-white">{e.symbol}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${e.aiPrediction.direction === 'BULLISH' ? 'bg-emerald-500/15 text-emerald-400' : e.aiPrediction.direction === 'BEARISH' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                      {e.aiPrediction.direction}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{e.date} ({e.daysUntil}d)</span>
                    <span>Beat: {e.historicalBeatRate}%</span>
                    <span>Move: ~{e.aiPrediction.expectedMove}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sentiment Bar */}
      {sentiment && activeLayer === 'entry' && (
        <div className="quantum-panel rounded-2xl p-4 border border-blue-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-lg ${sentiment.overall === 'BULLISH' ? 'text-emerald-400' : sentiment.overall === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>
                {sentiment.overall === 'BULLISH' ? '\uD83D\uDFE2' : sentiment.overall === 'BEARISH' ? '\uD83D\uDD34' : '\uD83D\uDFE1'}
              </span>
              <div>
                <div className="text-xs font-bold text-white">News Sentiment: {sentiment.overall}</div>
                <div className="text-[10px] text-slate-500">Score: {sentiment.score}/100 | Conf: {sentiment.confidence}%</div>
              </div>
            </div>
            <div className="text-right">
              <div className="w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${sentiment.score > 0 ? 'bg-emerald-500' : sentiment.score < 0 ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, Math.abs(sentiment.score))}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
