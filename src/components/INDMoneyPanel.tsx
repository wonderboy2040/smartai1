// ============================================================
// INDMoneyPanel — sync control hub for the INDMoney-driven
// ASSET TABLE (the manual table + Google Sheets are REPLACED).
// ------------------------------------------------------------
// • "Connect INDMoney" → full-page OAuth (PKCE) redirect handled by
//   the server (/api/mcp/indmoney/connect).
// • While connected, the server syncs the portfolio 2× DAILY
//   (09:30 & 21:30 IST default — env INDM_SYNC_TIMES) and the
//   synced assets drive the grouped INDIA / USA / Crypto table
//   below with live exchange prices (stocks/ETFs/crypto tick in
//   real-time; MF/FD/bond assets show INDMoney's NAV value).
// • "Sync Now" forces an immediate sync (POST /api/mcp/indmoney/sync).
// • Tokens never touch the browser — everything is proxied through
//   our authed server routes.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useApp } from '../hooks/AppContext';

interface IndmStatus {
  ok?: boolean;
  connected: boolean;
  connecting: boolean;
  connectedAt: number | null;
  lastSyncAt: number | null;
  expiresAt: number | null;
  scope: string | null;
  hasRefreshToken: boolean;
  toolCount: number;
}

const fmtINR = (n: number | null | undefined, decimals = 0): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
};

const timeAgo = (ts: number | null | undefined): string => {
  if (!ts) return '—';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const clockTime = (ts: number | null | undefined): string => {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

export const INDMoneyPanel = React.memo(function INDMoneyPanel() {
  const { indmSource, indmMeta, indmSyncing, loadIndmAssets, portfolio } = useApp();
  const [status, setStatus] = useState<IndmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [, forceTick] = useState(0); // minute-tick so "next sync" countdowns refresh
  const mountedRef = useRef(true);

  const indmActive = indmSource === 'indmoney';

  const refreshStatus = useCallback(async (): Promise<IndmStatus | null> => {
    try {
      const res = await apiFetch('/api/mcp/indmoney/status');
      if (!res.ok) return null;
      const data = (await res.json()) as IndmStatus;
      if (mountedRef.current) setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // Mount: OAuth redirect result + status + (assets load is triggered by
  // useAppState itself on auth — we only refresh it here after connect).
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      let connectedNow = false;
      try {
        const params = new URLSearchParams(window.location.search);
        const indm = params.get('indm');
        if (indm === 'ok') {
          connectedNow = true;
          setNotice('✅ INDMoney connected — syncing your portfolio…');
          void loadIndmAssets(true); // first sync right after connect
        } else if (indm === 'error') {
          setError(`INDMoney connect failed: ${params.get('reason') || 'unknown error'}`);
        }
        if (indm) {
          params.delete('indm');
          params.delete('reason');
          params.delete('tab');
          const qs = params.toString();
          window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
        }
      } catch { /* non-fatal */ }

      await refreshStatus();
      setLoading(false);
      if (connectedNow) setTimeout(() => { if (mountedRef.current) setNotice(''); }, 8000);
    })();
    return () => { mountedRef.current = false; };
  }, [refreshStatus, loadIndmAssets]);

  // Minute tick: keeps "2h ago" / "next sync in …" fresh while the tab is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') forceTick(n => n + 1); }, 60_000);
    return () => clearInterval(t);
  }, []);

  // First-sync watcher: while connected but no assets rendered yet, re-pull
  // the snapshot every 20s (GET /assets fires a server-side background sync
  // when stale). Gives up after ~5 minutes; manual "Sync Now" still works.
  useEffect(() => {
    if (!status?.connected || indmActive) return;
    let tries = 0;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (++tries > 15) return;
      void loadIndmAssets();
    }, 20_000);
    return () => clearInterval(t);
  }, [status?.connected, indmActive, loadIndmAssets]);

  // Tab focus: re-pull the (cheap) snapshot so scheduled server-side syncs appear.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void refreshStatus();
        void loadIndmAssets();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshStatus, loadIndmAssets]);

  const handleConnect = () => {
    // Full-page navigation — the server 302s to INDMoney's OAuth page.
    window.location.href = '/api/mcp/indmoney/connect';
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect INDMoney? The synced asset table will be cleared (Google Sheets stays disconnected).')) return;
    try {
      await apiFetch('/api/mcp/indmoney/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setNotice('Disconnected from INDMoney — asset table now manual.');
      await refreshStatus();
      await loadIndmAssets(); // picks up cleared snapshot → manual mode
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    }
  };

  const summary = indmMeta?.summary || null;
  const positions = useMemo(() => indmMeta?.positions || [], [indmMeta]);
  const nextSync = indmMeta?.nextSyncAt ?? null;
  const counts = indmMeta?.counts || null;

  // -------------------- render --------------------
  if (loading) {
    return (
      <div className="quantum-panel rounded-2xl p-4 flex items-center gap-3 text-slate-400 text-sm">
        <span className="inline-block animate-spin">⏳</span> Checking INDMoney MCP connection…
      </div>
    );
  }

  const connected = status?.connected;

  return (
    <div className="quantum-panel rounded-2xl p-4 sm:p-5 border border-violet-500/20 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xl shadow-lg shadow-violet-500/20">
            🏦
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black gradient-text-cyan font-display leading-tight">
              INDMoney Auto-Sync <span className="text-[10px] font-bold text-violet-400 border border-violet-500/30 bg-violet-500/10 rounded-md px-1.5 py-0.5 align-middle ml-1">MCP</span>
              {indmActive && (
                <span className="ml-2 text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5 align-middle inline-flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-dot" /> ASSET SOURCE
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500">
              {indmActive
                ? `Asset table = INDMoney portfolio • ${counts?.live ?? 0} live-priced • ${counts?.noLive ?? 0} NAV-priced • Google Sheets disconnected`
                : connected
                  ? 'Connected — waiting for first sync…'
                  : 'Connect your INDMoney account — assets table auto-syncs (manual entry retired)'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <button
                onClick={() => void loadIndmAssets(true)}
                disabled={indmSyncing}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50"
                title="Force sync now (server → INDMoney MCP)"
              >
                <span className={indmSyncing ? 'inline-block animate-spin' : ''}>🔄</span> {indmSyncing ? 'Syncing…' : 'Sync Now'}
              </button>
              <button
                onClick={() => void handleDisconnect()}
                disabled={indmSyncing}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm text-red-400 border border-red-500/20 hover:border-red-500/50 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              className="px-5 py-2 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 transition-all shadow-lg shadow-violet-500/25"
              title="Authorize SmartAI to read your INDMoney portfolio (read-only)"
            >
              🔗 Connect INDMoney
            </button>
          )}
        </div>
      </div>

      {/* Notices */}
      {notice && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-300 font-semibold">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-sm text-red-300 font-semibold break-words">
          ⚠️ {error}
        </div>
      )}

      {/* Not connected explainer */}
      {!connected && !error && (
        <div className="text-xs text-slate-400 leading-relaxed space-y-1.5">
          <p>
            <b className="text-slate-300">How it works:</b> Connect karte hi INDMoney ka official{' '}
            <span className="text-violet-300 font-mono">mcp.indmoney.com</span> server se aapka <b>real portfolio</b>{' '}
            (India stocks/ETF/MF, US stocks, crypto) 2× daily auto-sync hoga — aur yahi data Assets Table me dikhega.
          </p>
          <p className="text-slate-500">
            🔒 Secure OAuth login • read-only <span className="font-mono">portfolio:read</span> scope • tokens sirf server pe store hote hain.
          </p>
        </div>
      )}

      {/* Sync schedule / status strip */}
      {connected && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Last Sync</div>
            <div className="text-xs font-black text-white font-mono mt-0.5" title={indmMeta?.syncedAt ? new Date(indmMeta.syncedAt).toLocaleString('en-IN') : ''}>
              {timeAgo(indmMeta?.syncedAt)}
            </div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Next Auto-Sync</div>
            <div className="text-xs font-black text-violet-300 font-mono mt-0.5" title={nextSync ? new Date(nextSync).toLocaleString('en-IN') : ''}>
              {nextSync ? clockTime(nextSync) : '—'}
            </div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Sync Slots (IST)</div>
            <div className="text-xs font-black text-slate-300 font-mono mt-0.5">
              {(indmMeta?.slots || ['09:30', '21:30']).join(' • ')}
            </div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Assets Synced</div>
            <div className="text-xs font-black text-cyan-300 font-mono mt-0.5">
              {counts ? `${counts.assets} (${counts.live} live)` : portfolio.length || '—'}
            </div>
          </div>
        </div>
      )}

      {/* Official INDMoney summary (server's own numbers) */}
      {indmActive && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Current Value</div>
            <div className="text-lg sm:text-xl font-black text-cyan-400 font-mono">₹{fmtINR(summary.totalValue)}</div>
            {summary.oneDayChange != null && (
              <div className={`text-[10px] font-mono font-bold ${summary.oneDayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                1D: {summary.oneDayChange >= 0 ? '+' : ''}₹{fmtINR(summary.oneDayChange)}
                {summary.oneDayChangePct != null && ` (${summary.oneDayChangePct >= 0 ? '+' : ''}${summary.oneDayChangePct.toFixed(2)}%)`}
              </div>
            )}
          </div>
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Invested</div>
            <div className="text-lg sm:text-xl font-black text-white font-mono">₹{fmtINR(summary.totalInvested)}</div>
          </div>
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Total P&L</div>
            <div className={`text-lg sm:text-xl font-black font-mono ${(summary.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(summary.totalPnl ?? 0) >= 0 ? '+' : ''}₹{fmtINR(summary.totalPnl)}
            </div>
          </div>
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Returns</div>
            <div className={`text-lg sm:text-xl font-black font-mono ${(summary.totalPnlPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.totalPnlPct != null ? `${summary.totalPnlPct >= 0 ? '+' : ''}${summary.totalPnlPct}%` : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Sync failure diagnostics — degraded-tolerant: stale-but-usable
          assets keep rendering; the banner explains the last failure */}
      {connected && indmMeta?.lastError && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-300">
          <p className="font-semibold">
            Last sync failed — showing the previous snapshot. Reason: <span className="font-mono text-xs">{indmMeta.lastError}</span>
          </p>
          <p className="text-xs text-amber-200/80 mt-1">Auto-retry next scheduled slot, or hit “Sync Now”. INDMoney token may need a reconnect if this persists.</p>
        </div>
      )}
      {connected && indmMeta?.reason && !indmActive && indmMeta.reason !== 'not-connected' && indmMeta.reason !== 'no-snapshot' && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-300">
          <p className="font-semibold">Snapshot not available yet (reason: <span className="font-mono text-xs">{indmMeta.reason}</span>).</p>
          <p className="text-xs text-amber-200/80 mt-1">Hit “Sync Now” to pull your portfolio from INDMoney MCP.</p>
        </div>
      )}

      {/* Trading positions (MTF / delivery / intraday) — informative extra
          (already included in the synced holdings values, shown separately
          by INDMoney too) */}
      {indmActive && positions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold rounded-lg border px-2.5 py-1 text-amber-300 bg-amber-500/10 border-amber-500/20">
              ⚡ Trading Positions <span className="opacity-60">({positions.length})</span>
            </div>
            <div className="text-xs font-mono font-bold text-slate-400">₹{fmtINR(positions.reduce((a, p) => a + (p.invested || 0), 0))}</div>
          </div>
          <div className="quantum-panel rounded-xl overflow-hidden">
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-white/5">
                    <th className="text-left px-3 py-2.5 font-bold">Instrument</th>
                    <th className="text-left px-3 py-2.5 font-bold">Type</th>
                    <th className="text-right px-3 py-2.5 font-bold">Qty</th>
                    <th className="text-right px-3 py-2.5 font-bold hidden sm:table-cell">Avg</th>
                    <th className="text-right px-3 py-2.5 font-bold">Value</th>
                    <th className="text-right px-3 py-2.5 font-bold hidden sm:table-cell">T+1</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={`${p.positionId ?? p.name}-${i}`} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2.5 max-w-[200px] sm:max-w-[280px]">
                        <div className="font-semibold text-slate-200 truncate" title={p.name}>{p.name}</div>
                        {p.symbol && <div className="text-[10px] text-slate-500 font-mono">{p.symbol}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-[10px] font-bold rounded border px-1.5 py-0.5 text-amber-300 bg-amber-500/10 border-amber-500/20">{p.kind}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">{p.qty != null ? fmtINR(p.qty, 2) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-400 hidden sm:table-cell">{p.avgPrice != null ? `₹${fmtINR(p.avgPrice, 2)}` : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-white font-bold">{p.invested != null ? `₹${fmtINR(p.invested)}` : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-500 hidden sm:table-cell">{p.t1Qty > 0 ? fmtINR(p.t1Qty, 0) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Footer meta */}
      {indmActive && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>
            🇮🇳 India · 🦅 USA · 🪙 Crypto assets in the table below · prices tick live during market hours · NAV assets refresh on each sync
          </span>
          {status?.expiresAt && <span title="Token auto-refreshes server-side">MCP session active</span>}
        </div>
      )}
    </div>
  );
});
