import { Position, PriceData } from '../types';
import { formatPrice } from '../utils/constants';
import { isAnyMarketOpen, getMarketStatus } from '../utils/telegram';
import { MTFMatrix } from './MTFMatrix';
import { DeepFibZones } from './DeepFibZones';
import { RefObject } from 'react';

export function DashboardTab(props: any) {
  const {
    avgVix, sentiment, symbolInput, setSymbolInput, analyzeSymbol, isAnalyzing,
    currentSymbol, currentMarket, currentPrice, currentChange, currentRsi, signalData,
    metrics, openAddModal, chartInterval, setChartInterval, chartContainerRef,
    currentData, usdInrRate, portfolio, livePrices, quickSelect
  } = props;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Macro Alert */}
      <div className={`alert-banner glass-card rounded-2xl p-4 border ${avgVix > 17 ? 'border-red-500/30 bg-red-950/20' : 'border-emerald-500/30 bg-emerald-950/20'} animate-fade-in-up`}>
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${avgVix > 17 ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
            {avgVix > 17 ? '🚨' : '🚀'}
          </div>
          <div className="flex-1">
            <div className={`font-bold uppercase tracking-wider text-sm ${sentiment.color}`}>
              {avgVix > 17 ? 'RISK ALERT: SELLOFF WARNING' : 'BULLISH: WHALE ACCUMULATION'}
            </div>
            <div className="text-sm text-slate-400/80 mt-0.5">
              {avgVix > 17 ? 'Market me institutional liquidation chal raha hai. Cash hold karo.' : 'Dark pools heavily buy kar rahe hain. SIP continue karo.'}
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-3 glass-card p-3 rounded-2xl animate-fade-in-up delay-75">
        <div className="flex-1 relative">
          <input
            type="text"
            value={symbolInput}
            onChange={e => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && analyzeSymbol()}
            placeholder="Search any asset... (AAPL, RELIANCE, SPY)"
            className="w-full px-5 py-3.5 pl-12 glass-input rounded-xl uppercase font-semibold text-white placeholder-slate-600"
          />
          <span className="absolute left-4 top-3.5 text-lg text-slate-500">🔍</span>
        </div>
        <button
          onClick={analyzeSymbol}
          disabled={isAnalyzing}
          className="btn-primary px-7 py-3.5 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-white disabled:opacity-50"
        >
          {isAnalyzing ? '⏳ Scanning...' : 'SCAN ⚡'}
        </button>
      </div>

      {/* MTF Matrix & Deep Fib Integration */}
      <div className="grid md:grid-cols-2 gap-5">
        <MTFMatrix data={currentData} symbol={currentSymbol} />
        <DeepFibZones data={currentData} symbol={currentSymbol} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-fade-in-up delay-100">
        <div className="stat-card glass-card rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Target Asset</div>
          <div className="text-xl font-black text-cyan-400 mt-1 font-display">{currentSymbol.replace('.NS', '') || '---'}</div>
          <div className="text-[10px] text-slate-600 mt-1 font-mono">{currentMarket === 'IN' ? 'NSE/BSE' : 'NASDAQ/NYSE'}</div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Live Price</div>
          <div className={`text-xl font-black font-mono mt-1 ${currentChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
          </div>
          <div className={`text-xs font-bold mt-1 flex items-center gap-1 ${currentChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            <span className="text-[10px]">{currentChange >= 0 ? '▲' : '▼'}</span> {currentChange.toFixed(2)}%
          </div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">AI Signal</div>
          <div className={`text-lg font-black mt-1 ${signalData.color}`}>{signalData.signal}</div>
          <div className="mt-1">
            <div className="w-full bg-slate-800/60 rounded-full h-1.5">
              <div className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all" style={{ width: `${signalData.conf}%` }} />
            </div>
            <div className="text-[10px] text-slate-500 mt-1 font-mono">{signalData.conf}% confidence</div>
          </div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">RSI Index</div>
          <div className={`text-xl font-black font-mono mt-1 ${currentRsi < 35 ? 'text-emerald-400' : currentRsi > 65 ? 'text-red-400' : 'text-cyan-400'}`}>
            {currentRsi.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-600 mt-1">{currentRsi < 35 ? '⬇ Oversold' : currentRsi > 65 ? '⬆ Overbought' : '↔ Neutral'}</div>
        </div>
        <div className="stat-card glass-card rounded-2xl p-4 col-span-2 md:col-span-1">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Portfolio</div>
          <div className="text-xl font-black text-purple-400 font-mono mt-1">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
          <div className={`text-xs font-bold mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(1)}% total
          </div>
        </div>
      </div>

      {/* Value Zones */}
      <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-150">
        <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">🎯</span>
          Value Zones
        </h2>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 text-center">
            <div className="text-emerald-400/80 text-[10px] font-bold uppercase tracking-wider mb-2">Deep Value</div>
            <div className="text-xl font-black text-emerald-400 font-mono">
              {currentPrice > 0 ? formatPrice(currentPrice * 0.95, currentMarket === 'IN' ? '₹' : '$') : '--'}
            </div>
            <div className="text-[10px] text-emerald-500/60 mt-1">-5% from CMP</div>
          </div>
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-center">
            <div className="text-amber-400/80 text-[10px] font-bold uppercase tracking-wider mb-2">Fair Price</div>
            <div className="text-xl font-black text-amber-400 font-mono">
              {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
            </div>
            <div className="text-[10px] text-amber-500/60 mt-1">Current Market</div>
          </div>
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
            <div className="text-red-400/80 text-[10px] font-bold uppercase tracking-wider mb-2">Overheated</div>
            <div className="text-xl font-black text-red-400 font-mono">
              {currentPrice > 0 ? formatPrice(currentPrice * 1.15, currentMarket === 'IN' ? '₹' : '$') : '--'}
            </div>
            <div className="text-[10px] text-red-500/60 mt-1">+15% from CMP</div>
          </div>
        </div>
        <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${currentRsi < 45 ? 'bg-emerald-500/5 border-emerald-500/20' : currentRsi > 65 ? 'bg-red-500/5 border-red-500/20' : 'bg-cyan-500/5 border-cyan-500/20'}`}>
          <div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">AI Verdict</div>
            <div className="text-sm font-bold text-white mt-1">
              {currentRsi < 45 ? `📈 WHALE ACTION: Algorithms buying ${currentSymbol.replace('.NS', '')}` :
                currentRsi > 65 ? `📉 DISTRIBUTION: Book partial profits` :
                `📊 NEUTRAL: Trading at fair valuation`}
            </div>
          </div>
          <button 
            onClick={() => openAddModal()}
            className="btn-primary px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-xl font-bold text-white text-sm whitespace-nowrap"
          >
            📈 Invest
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">📊</span>
            Live Chart — {currentSymbol.replace('.NS', '')}
          </h2>
          <div className="flex gap-0.5 bg-black/40 p-1 rounded-lg">
            {['D', 'W', 'M'].map(int => (
              <button
                key={int}
                onClick={() => setChartInterval(int)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  chartInterval === int ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                1{int}
              </button>
            ))}
          </div>
        </div>
        <div 
          ref={chartContainerRef} 
          className="h-[500px] rounded-xl bg-black/30 border border-white/5 overflow-hidden"
        />
      </div>

      {/* Quantum Forensics Panel */}
      {currentPrice > 0 && (
        <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-200">
          <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm">🧬</span>
            Quantum Forensics — {currentSymbol.replace('.NS', '')}
            <span className="ml-auto badge bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px]">DEEP SCAN</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {/* RSI Gauge */}
            <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">RSI Gauge</div>
              <div className="relative w-full h-3 bg-gradient-to-r from-emerald-600 via-amber-500 to-red-600 rounded-full overflow-hidden mb-2">
                <div className="absolute top-0 w-1 h-full bg-white shadow-lg shadow-white/50" style={{ left: `${Math.min(100, currentRsi)}%` }} />
              </div>
              <div className={`text-2xl font-black font-mono ${currentRsi < 35 ? 'text-emerald-400' : currentRsi > 65 ? 'text-red-400' : 'text-amber-400'}`}>
                {currentRsi.toFixed(1)}
              </div>
              <div className="text-[10px] text-slate-600 mt-1">{currentRsi < 30 ? 'OVERSOLD 🟢' : currentRsi > 70 ? 'OVERBOUGHT 🔴' : 'NEUTRAL ↔'}</div>
            </div>

            {/* MACD / SMA Trend */}
            <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">MACD Trend</div>
              <div className={`text-2xl font-black ${currentData?.macd !== undefined ? (currentData.macd > 0 ? 'text-emerald-400' : 'text-red-400') : (currentChange > 0.5 ? 'text-emerald-400' : currentChange < -0.5 ? 'text-red-400' : 'text-slate-400')}`}>
                {currentData?.macd !== undefined ? (currentData.macd > 0 ? '📈 BULL' : '📉 BEAR') : (currentChange > 0.5 ? '📈 BULL' : currentChange < -0.5 ? '📉 BEAR' : '➡️ FLAT')}
              </div>
              <div className="text-[10px] text-slate-600 mt-1">
                {currentData?.macd !== undefined ? `MACD: ${currentData.macd.toFixed(2)}` : `Momentum: ${Math.abs(currentChange) > 2 ? 'STRONG' : Math.abs(currentChange) > 0.5 ? 'MODERATE' : 'WEAK'}`}
              </div>
            </div>

            {/* Volume Analysis */}
            <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Volume Flow</div>
              <div className="text-2xl font-black text-cyan-400 font-mono">
                {currentData?.volume ? (currentData.volume > 1000000 ? `${(currentData.volume / 1000000).toFixed(1)}M` : `${(currentData.volume / 1000).toFixed(0)}K`) : 'N/A'}
              </div>
              <div className="text-[10px] text-slate-600 mt-1">
                {currentData?.volume && currentData.volume > 500000 ? '🔥 HIGH ACTIVITY' : '💤 LOW FLOW'}
              </div>
            </div>

            {/* Day Range */}
            <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Day Range</div>
              <div className="flex items-center gap-2 justify-center mb-1">
                <span className="text-xs font-mono text-emerald-400">{formatPrice(currentData?.low || currentPrice * 0.98, currentMarket === 'IN' ? '₹' : '$')}</span>
                <span className="text-slate-600">→</span>
                <span className="text-xs font-mono text-red-400">{formatPrice(currentData?.high || currentPrice * 1.02, currentMarket === 'IN' ? '₹' : '$')}</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full" style={{ width: `${currentData?.high && currentData?.low ? ((currentPrice - currentData.low) / (currentData.high - currentData.low)) * 100 : 50}%` }} />
              </div>
              <div className="text-[10px] text-slate-600 mt-1">Position in range</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${isAnyMarketOpen() ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>
              {getMarketStatus()}
            </span>
            <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              💱 USD/INR ₹{usdInrRate.toFixed(2)}
            </span>
            <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${currentChange >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {currentChange >= 0 ? '📈' : '📉'} {currentChange >= 0 ? '+' : ''}{currentChange.toFixed(2)}% Today
            </span>
          </div>
        </div>
      )}

      {/* Quick Assets */}
      <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-300">
        <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">📂</span>
          Core Holdings
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {portfolio.length === 0 ? (
            <div className="w-full text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl animate-fade-in">
              <div className="text-3xl mb-2 animate-float">📂</div>
              <p className="font-medium">No holdings yet</p>
              <p className="text-xs text-slate-700 mt-1">Add assets to start tracking</p>
            </div>
          ) : (
            [...new Set(portfolio.map((p: Position) => p.symbol))].map((sym, i) => {
              const p = portfolio.find((x: Position) => x.symbol === sym)!;
              const key = `${p.market}_${sym}`;
              const data = livePrices[key];
              const change = data?.change || 0;
              return (
                <button
                  key={sym}
                  onClick={() => quickSelect(sym)}
                  className="stat-card glass-card px-4 py-3 rounded-xl text-left animate-fade-in-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="font-bold text-white text-sm">{sym.replace('.NS', '')}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="font-mono text-xs text-slate-300">
                      {formatPrice(data?.price || p.avgPrice, p.market === 'IN' ? '₹' : '$')}
                    </span>
                    <span className={`font-bold text-xs ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
