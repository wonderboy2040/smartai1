import React from 'react';
import { useApp } from '../../hooks/AppContext';
import { getAssetCagrProxy } from '../../utils/constants';
import { calculateVaR, runStressTests, analyzeConcentrationRisk } from '../../utils/riskEngine';
import { MacroRegimePanel } from '../MacroRegimePanel';
import { SmartMoneyPanel } from '../SmartMoneyPanel';
import { SectorRotationPanel } from '../SectorRotationPanel';
import { getBatchInterval } from '../../utils/api';

export const MacroTab = React.memo(function MacroTab() {
  const {
    portfolio, livePrices, metrics,
    sentiment, avgVix, usVix, inVix, wsLatency, sectorData,
  } = useApp();

  return (
    <div className="space-y-5 animate-fade-in">
      <h2 className="text-2xl font-black gradient-text-cyan font-display">🌍 Risk Radar</h2>

      <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">⚙️</span>
          Risk Diagnostics
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-black/20 p-4 rounded-xl">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Global VIX</div>
            <div className={`text-xl font-black ${avgVix > 22 ? 'text-red-400' : avgVix > 16 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {avgVix > 22 ? 'BEARISH' : avgVix > 16 ? 'VOLATILE' : 'BULLISH'}
            </div>
            <div className="text-[10px] text-slate-500 mt-2 font-mono">
              US: <strong className="text-slate-300">{usVix.toFixed(1)}</strong> | IN: <strong className="text-slate-300">{inVix.toFixed(1)}</strong>
            </div>
          </div>
          <div className="bg-black/20 p-4 rounded-xl">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Risk Assessment</div>
            <div className={`text-lg font-bold ${sentiment.color}`}>{sentiment.text}</div>
          </div>
        </div>
      </div>

      <MacroRegimePanel livePrices={livePrices} />
      <SmartMoneyPanel livePrices={livePrices} />
      <SectorRotationPanel portfolio={portfolio} livePrices={livePrices} sectorData={sectorData} />

      <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up delay-100">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center text-sm">🤖</span>
          Asset Analysis
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          {portfolio.map(p => {
            const key = `${p.market}_${p.symbol}`;
            const data = livePrices[key];
            const rsi = data?.rsi || 50;
            const cgr = getAssetCagrProxy(p.symbol, p.market);
            const colorMap: Record<string, { border: string; bg: string; text: string }> = {
              red: { border: 'border-red-500/20', bg: 'bg-red-500/5', text: 'text-red-400' },
              emerald: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400' },
              amber: { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400' },
              blue: { border: 'border-blue-500/20', bg: 'bg-blue-500/5', text: 'text-blue-400' },
            };
            let tag = '🔵 FAIR VALUE', colorKey = 'blue';
            if (cgr <= 10) { tag = '🔴 ROTATE'; colorKey = 'red'; }
            else if (rsi < 45) { tag = '🟢 VALUE'; colorKey = 'emerald'; }
            else if (rsi > 70) { tag = '🟠 HOT'; colorKey = 'amber'; }
            const c = colorMap[colorKey];
            return (
              <div key={p.id} className={`bg-black/20 p-4 rounded-xl border ${c.border}`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-white">{p.symbol.replace('.NS', '')}</div>
                  <span className={`${c.bg} ${c.text} px-2 py-1 rounded-md text-[10px] font-bold border ${c.border}`}>{tag}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  RSI: <span className="text-slate-300">{rsi.toFixed(1)}</span> | CAGR: <span className="text-slate-300">{cgr}%</span>
                </div>
              </div>
            );
          })}
          {portfolio.length === 0 && (
            <div className="col-span-2 text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl animate-fade-in">
              <div className="text-3xl mb-2">🤖</div>
              <p className="font-medium">No assets to analyze</p>
              <p className="text-xs text-slate-700 mt-1">Add portfolio holdings first</p>
            </div>
          )}
        </div>
      </div>

      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up delay-200">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-sm">VaR</span>
            Value at Risk Analysis
            <span className="ml-auto badge bg-red-500/10 text-red-400 border border-red-500/20 text-[10px]">ADVANCED</span>
          </h3>
          {(() => {
            const varResult = calculateVaR(metrics.totalValue, portfolio, livePrices);
            return (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-red-500/5 border border-red-500/15 p-4 rounded-xl text-center">
                  <div className="text-[10px] text-red-400/80 font-bold uppercase tracking-wider mb-1">Parametric</div>
                  <div className="text-lg font-black text-red-400 font-mono">Rs.{varResult.parametric.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/15 p-4 rounded-xl text-center">
                  <div className="text-[10px] text-amber-400/80 font-bold uppercase tracking-wider mb-1">Historical</div>
                  <div className="text-lg font-black text-amber-400 font-mono">Rs.{varResult.historical.toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-orange-500/5 border border-orange-500/15 p-4 rounded-xl text-center">
                  <div className="text-[10px] text-orange-400/80 font-bold uppercase tracking-wider mb-1">Monte Carlo</div>
                  <div className="text-lg font-black text-orange-400 font-mono">Rs.{varResult.monteCarlo.toLocaleString('en-IN')}</div>
                </div>
                <div className="col-span-3 text-center mt-2">
                  <span className="text-[10px] text-slate-400">Confidence: {varResult.confidence * 100}% — Max daily loss estimate</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up delay-300">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-sm">Stress</span>
            Stress Testing
          </h3>
          {(() => {
            const stressResults = runStressTests(portfolio, livePrices);
            return (
              <div className="space-y-2">
                {stressResults.map((s, i) => (
                  <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-white text-sm">{s.name}</div>
                      <div className="text-[10px] text-slate-500">{s.description}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-red-400 font-mono">Rs.{Math.round(Math.abs(s.impactPct * metrics.totalValue / 100)).toLocaleString('en-IN')}</div>
                      <div className="text-[10px] text-red-400/60">{Math.abs(s.impactPct)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up delay-400">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-yellow-500/10 flex items-center justify-center text-sm">Concentration</span>
            Concentration Risk
          </h3>
          {(() => {
            const concRisk = analyzeConcentrationRisk(portfolio, livePrices);
            return (
              <div className="space-y-2">
                {concRisk.map((c, i) => (
                  <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-white text-sm">{c.symbol}</div>
                      <div className="text-right">
                        <span className="text-xs text-slate-300">{c.weight}%</span>
                        <span className="text-[10px] text-slate-500 ml-2">Risk: {c.contributionToRisk}</span>
                      </div>
                    </div>
                    <div className="w-full h-1 bg-slate-800/80 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-red-500 transition-all" style={{ width: `${Math.min(100, c.contributionToRisk * 2)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">Conn</span>
          Connection Quality
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-black/20 p-3 rounded-xl text-center">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">WS Latency</div>
            <div className={`text-lg font-black font-mono ${wsLatency.avg < 500 ? 'text-emerald-400' : wsLatency.avg < 1000 ? 'text-amber-400' : 'text-red-400'}`}>
              {wsLatency.avg}ms
            </div>
          </div>
          <div className="bg-black/20 p-3 rounded-xl text-center">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Heartbeat</div>
            <div className="text-lg font-black text-cyan-400 font-mono">{(wsLatency.heartbeat / 1000).toFixed(0)}s</div>
          </div>
          <div className="bg-black/20 p-3 rounded-xl text-center">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Batch Interval</div>
            <div className="text-lg font-black text-purple-400 font-mono">{getBatchInterval() / 1000}s</div>
          </div>
        </div>
      </div>
    </div>
  );
});
