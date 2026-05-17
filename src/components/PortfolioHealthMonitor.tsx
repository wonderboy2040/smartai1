import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Position, PriceData, PortfolioHealth } from '../types';
import { computeHealthScore, checkAlertConditions, generateDailyDigest } from '../utils/portfolioMonitor';
import { sendTelegramAlert } from '../utils/api';

interface PortfolioHealthMonitorProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  metrics: { totalValue: number; totalPL: number; plPct: number; todayPL: number };
  telegramConfig: { token: string; chatId: string; enabled: boolean };
}

export const PortfolioHealthMonitor = React.memo(({ portfolio, livePrices, metrics, telegramConfig }: PortfolioHealthMonitorProps) => {
  const [health, setHealth] = useState<PortfolioHealth | null>(null);
  const [expanded, setExpanded] = useState(false);
  const previousHighsRef = useRef<Record<string, number>>({});
  const lastDigestDateRef = useRef<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Compute health score
  const currentHealth = useMemo(() => {
    if (portfolio.length === 0) return null;
    return computeHealthScore(portfolio, livePrices, metrics);
  }, [portfolio, livePrices, metrics]);

  // Update health state periodically (every 30s to avoid excessive renders)
  useEffect(() => {
    if (currentHealth) {
      setHealth(currentHealth);
    }
  }, [currentHealth]);

  // Background monitoring: check alerts every 60s
  useEffect(() => {
    if (!telegramConfig.enabled || !telegramConfig.token || !telegramConfig.chatId) return;

    intervalRef.current = setInterval(() => {
      // Update previous highs
      portfolio.forEach(pos => {
        const key = `${pos.market}_${pos.symbol}`;
        const price = livePrices[key]?.price;
        if (price) {
          const prev = previousHighsRef.current[key] || 0;
          if (price > prev) previousHighsRef.current[key] = price;
        }
      });

      // Check alert conditions
      const alerts = checkAlertConditions(portfolio, livePrices, previousHighsRef.current);
      const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL');
      if (criticalAlerts.length > 0) {
        const msg = `<b>🚨 PORTFOLIO ALERT</b>\n\n${criticalAlerts.map(a => `• ${a.message}`).join('\n')}\n\n<i>Wealth AI Pro</i>`;
        sendTelegramAlert(telegramConfig.token, telegramConfig.chatId, msg).catch(() => {});
      }

      // Daily digest at 8 AM IST
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const todayStr = ist.toISOString().split('T')[0];
      const hour = ist.getHours();

      if (hour === 8 && lastDigestDateRef.current !== todayStr && currentHealth) {
        lastDigestDateRef.current = todayStr;
        const digest = generateDailyDigest(portfolio, livePrices, currentHealth, metrics);
        sendTelegramAlert(telegramConfig.token, telegramConfig.chatId, digest).catch(() => {});
      }
    }, 60000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [telegramConfig, portfolio, livePrices, currentHealth, metrics]);

  if (!health || portfolio.length === 0) return null;

  const emoji = health.alertLevel === 'GREEN' ? '🟢' : health.alertLevel === 'YELLOW' ? '🟡' : '🔴';
  const bgColor = health.alertLevel === 'GREEN' ? 'bg-emerald-500/10 border-emerald-500/30'
    : health.alertLevel === 'YELLOW' ? 'bg-amber-500/10 border-amber-500/30'
    : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {/* Health Badge */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`${bgColor} border rounded-full px-3 py-1.5 flex items-center gap-2 hover:scale-105 transition-transform shadow-lg`}
      >
        <span className="text-sm">{emoji}</span>
        <span className="text-xs font-bold text-slate-200">{health.score}</span>
        <span className="text-[10px] text-slate-400">Health</span>
      </button>

      {/* Expanded Panel */}
      {expanded && (
        <div className="absolute bottom-12 right-0 w-72 quantum-panel p-3 shadow-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-200">PORTFOLIO HEALTH</span>
            <span className={`text-sm font-bold ${health.alertLevel === 'GREEN' ? 'text-emerald-400' : health.alertLevel === 'YELLOW' ? 'text-amber-400' : 'text-red-400'}`}>
              {health.score}/100
            </span>
          </div>

          {/* Health Bar */}
          <div className="quantum-progress mb-2">
            <div
              className={`quantum-progress-fill transition-all ${health.score >= 70 ? 'bg-emerald-500' : health.score >= 45 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${health.score}%` }}
            />
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="text-center">
              <div className="quantum-label">Drawdown</div>
              <div className="text-xs font-mono text-red-400">{health.drawdownFromHigh.toFixed(1)}%</div>
            </div>
            <div className="text-center">
              <div className="quantum-label">RSI Alerts</div>
              <div className="text-xs font-mono text-amber-400">{health.rsiExtremeCount}</div>
            </div>
            <div className="text-center">
              <div className="quantum-label">VIX</div>
              <div className={`text-xs font-mono ${health.vixStatus === 'SPIKE' ? 'text-red-400' : health.vixStatus === 'ELEVATED' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {health.vixStatus}
              </div>
            </div>
          </div>

          {/* Buy Opportunities */}
          {health.buyOpportunities.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-emerald-400 font-medium mb-0.5">BUY OPPORTUNITIES</div>
              {health.buyOpportunities.slice(0, 3).map((b, i) => (
                <div key={i} className="text-[10px] text-slate-400">• {b}</div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {health.warnings.length > 0 && (
            <div>
              <div className="text-[10px] text-amber-400 font-medium mb-0.5">WARNINGS</div>
              {health.warnings.slice(0, 3).map((w, i) => (
                <div key={i} className="text-[10px] text-slate-400">• {w}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

PortfolioHealthMonitor.displayName = 'PortfolioHealthMonitor';
