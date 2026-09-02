// ============================================================
// INDMoneyPanel — real portfolio via INDMoney's official MCP server
// ------------------------------------------------------------
// • "Connect INDMoney" → full-page OAuth (PKCE) redirect handled by
//   the server (/api/mcp/indmoney/connect). INDMoney asks the user
//   to log in & approve `portfolio:read` — then we're redirected back
//   to /?tab=portfolio&indm=ok.
// • Once connected, this panel polls /api/mcp/indmoney/portfolio and
//   renders a normalized holdings view (stocks / MFs / FDs / gold…).
// • Tokens never touch the browser — everything is proxied through
//   our authed server routes.
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';

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

interface IndmHolding {
  name: string;
  symbol: string | null;
  qty: number | null;
  avgPrice: number | null;
  currentPrice: number | null;
  value: number | null;
  invested: number | null;
  pnl: number | null;
  pnlPct: number | null;
  assetType: string;
}

interface IndmSummary {
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPct: number | null;
  holdingCount: number;
}

interface IndmPortfolio {
  ok: boolean;
  reason?: string | null;
  holdings: IndmHolding[];
  summary: IndmSummary | null;
  tool?: string | null;
  toolDescription?: string | null;
  fetchedAt?: number;
  cached?: boolean;
  tools?: { name: string; description: string | null }[];
  payloadPreview?: string | null;
}

const fmtINR = (n: number | null | undefined, decimals = 0): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
};

const TYPE_STYLES: Record<string, { emoji: string; cls: string }> = {
  Stock: { emoji: '📈', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20' },
  'Mutual Fund': { emoji: '🪙', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  ETF: { emoji: '🔗', cls: 'text-violet-300 bg-violet-500/10 border-violet-500/20' },
  'Fixed Income / Gold': { emoji: '🛡️', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  Other: { emoji: '📦', cls: 'text-slate-300 bg-white/5 border-white/10' },
};

export const INDMoneyPanel = React.memo(function INDMoneyPanel() {
  const [status, setStatus] = useState<IndmStatus | null>(null);
  const [portfolio, setPortfolio] = useState<IndmPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showTools, setShowTools] = useState(false);
  const mountedRef = useRef(true);

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

  const loadPortfolio = useCallback(async (force = false) => {
    setSyncing(true);
    setError('');
    try {
      const res = await apiFetch('/api/mcp/indmoney/portfolio', {
        method: force ? 'POST' : 'GET',
        headers: force ? { 'Content-Type': 'application/json' } : undefined,
        body: force ? '{}' : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Portfolio fetch failed');
        setPortfolio(null);
      } else {
        setPortfolio(data as IndmPortfolio);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, []);

  // Mount: read OAuth redirect result + initial status + auto portfolio.
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      // ?tab=portfolio&indm=ok|error (set by the OAuth callback redirect).
      try {
        const params = new URLSearchParams(window.location.search);
        const indm = params.get('indm');
        if (indm === 'ok') {
          setNotice('✅ INDMoney connected successfully!');
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

      const st = await refreshStatus();
      setLoading(false);
      if (st?.connected) {
        void loadPortfolio(false);
        // Auto-dismiss the success notice.
        setTimeout(() => { if (mountedRef.current) setNotice(''); }, 6000);
      }
    })();
    return () => { mountedRef.current = false; };
  }, [refreshStatus, loadPortfolio]);

  const handleConnect = () => {
    // Full-page navigation — the server 302s to INDMoney's OAuth page.
    window.location.href = '/api/mcp/indmoney/connect';
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect INDMoney? Your tokens will be revoked and portfolio view removed.')) return;
    setSyncing(true);
    try {
      await apiFetch('/api/mcp/indmoney/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      setPortfolio(null);
      setNotice('Disconnected from INDMoney.');
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  };

  const grouped = useMemo(() => {
    if (!portfolio?.holdings?.length) return [] as { type: string; items: IndmHolding[]; value: number }[];
    const map = new Map<string, IndmHolding[]>();
    for (const h of portfolio.holdings) {
      const arr = map.get(h.assetType) || [];
      arr.push(h);
      map.set(h.assetType, arr);
    }
    return [...map.entries()]
      .map(([type, items]) => ({
        type,
        items: [...items].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
        value: items.reduce((a, h) => a + (h.value ?? 0), 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [portfolio]);

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
              INDMoney Portfolio <span className="text-[10px] font-bold text-violet-400 border border-violet-500/30 bg-violet-500/10 rounded-md px-1.5 py-0.5 align-middle ml-1">MCP</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {connected
                ? `Live sync via official MCP • last: ${status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString('en-IN') : 'pending'}`
                : 'Connect your INDMoney account via official MCP server (read-only)'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <button
                onClick={() => void loadPortfolio(true)}
                disabled={syncing}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50"
                title="Force re-sync from INDMoney MCP"
              >
                <span className={syncing ? 'inline-block animate-spin' : ''}>🔄</span> Sync
              </button>
              <button
                onClick={() => void handleDisconnect()}
                disabled={syncing}
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
            (stocks, mutual funds, FDs, gold) read-only mode me yahan dikhega — manual entry ki zaroorat khatam.
          </p>
          <p className="text-slate-500">
            🔒 Secure OAuth login • read-only <span className="font-mono">portfolio:read</span> scope • tokens sirf server pe store hote hain.
          </p>
        </div>
      )}

      {/* Summary cards */}
      {connected && portfolio?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Current Value</div>
            <div className="text-lg sm:text-xl font-black text-cyan-400 font-mono">₹{fmtINR(portfolio.summary.totalValue)}</div>
          </div>
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Invested</div>
            <div className="text-lg sm:text-xl font-black text-white font-mono">₹{fmtINR(portfolio.summary.totalInvested)}</div>
          </div>
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Total P&L</div>
            <div className={`text-lg sm:text-xl font-black font-mono ${(portfolio.summary.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {(portfolio.summary.totalPnl ?? 0) >= 0 ? '+' : ''}₹{fmtINR(portfolio.summary.totalPnl)}
            </div>
          </div>
          <div className="quantum-panel rounded-xl p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Returns</div>
            <div className={`text-lg sm:text-xl font-black font-mono ${(portfolio.summary.totalPnlPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolio.summary.totalPnlPct != null ? `${portfolio.summary.totalPnlPct >= 0 ? '+' : ''}${portfolio.summary.totalPnlPct}%` : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Syncing shimmer */}
      {connected && syncing && !portfolio && (
        <div className="quantum-panel rounded-xl p-4 flex items-center gap-3 text-slate-400 text-sm">
          <span className="inline-block animate-spin">⏳</span> Fetching portfolio from INDMoney MCP…
        </div>
      )}

      {/* Portfolio tool unavailable */}
      {connected && portfolio && !portfolio.ok && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-300 space-y-2">
          <p className="font-semibold">
            Connected ✅ — lekin portfolio tool auto-detect nahi hua (reason: <span className="font-mono">{portfolio.reason}</span>).
          </p>
          {portfolio.tools && portfolio.tools.length > 0 && (
            <p className="text-xs text-amber-200/80">
              Available tools: {portfolio.tools.map(t => t.name).join(', ')}
            </p>
          )}
          {portfolio.payloadPreview && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-200/80">Raw response (debug)</summary>
              <pre className="mt-2 p-2 rounded-lg bg-black/30 overflow-x-auto text-[10px] text-slate-400 whitespace-pre-wrap">{portfolio.payloadPreview}</pre>
            </details>
          )}
        </div>
      )}

      {/* Holdings by asset type */}
      {grouped.map(({ type, items, value }) => {
        const st = TYPE_STYLES[type] || TYPE_STYLES.Other;
        return (
          <div key={type} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className={`inline-flex items-center gap-1.5 text-xs font-bold rounded-lg border px-2.5 py-1 ${st.cls}`}>
                {st.emoji} {type} <span className="opacity-60">({items.length})</span>
              </div>
              <div className="text-xs font-mono font-bold text-slate-400">₹{fmtINR(value)}</div>
            </div>
            <div className="quantum-panel rounded-xl overflow-hidden">
              <div className="overflow-x-auto scrollbar-hide">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 text-[10px] uppercase tracking-wider border-b border-white/5">
                      <th className="text-left px-3 py-2.5 font-bold">Name</th>
                      <th className="text-right px-3 py-2.5 font-bold">Qty</th>
                      <th className="text-right px-3 py-2.5 font-bold hidden sm:table-cell">Avg</th>
                      <th className="text-right px-3 py-2.5 font-bold hidden sm:table-cell">Price</th>
                      <th className="text-right px-3 py-2.5 font-bold">Value</th>
                      <th className="text-right px-3 py-2.5 font-bold">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((h, i) => {
                      const pnlPos = (h.pnl ?? 0) >= 0;
                      return (
                        <tr key={`${h.name}-${i}`} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                          <td className="px-3 py-2.5 max-w-[180px] sm:max-w-[260px]">
                            <div className="font-semibold text-slate-200 truncate" title={h.name}>{h.name}</div>
                            {h.symbol && <div className="text-[10px] text-slate-500 font-mono">{h.symbol}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-300">{h.qty != null ? fmtINR(h.qty, 2) : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-400 hidden sm:table-cell">{h.avgPrice != null ? `₹${fmtINR(h.avgPrice, 2)}` : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-400 hidden sm:table-cell">{h.currentPrice != null ? `₹${fmtINR(h.currentPrice, 2)}` : '—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-white font-bold">{h.value != null ? `₹${fmtINR(h.value)}` : '—'}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold ${pnlPos ? 'text-emerald-400' : 'text-red-400'}`}>
                            {h.pnl != null ? `${pnlPos ? '+' : ''}₹${fmtINR(h.pnl)}` : '—'}
                            {h.pnlPct != null && <div className="text-[10px] opacity-70">{pnlPos ? '+' : ''}{h.pnlPct}%</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}

      {/* Tool badge / meta footer */}
      {connected && portfolio?.ok && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>
            source: <span className="font-mono text-violet-400">{portfolio.tool}</span>
            {portfolio.fetchedAt && <> • synced {new Date(portfolio.fetchedAt).toLocaleString('en-IN')}</>}
          </span>
          <button onClick={() => setShowTools(v => !v)} className="hover:text-slate-300 underline underline-offset-2">
            {showTools ? 'hide' : 'view'} MCP tools ({status?.toolCount ?? 0})
          </button>
        </div>
      )}
      {showTools && (
        <div className="quantum-panel rounded-xl p-3 text-[11px] space-y-1.5 max-h-48 overflow-y-auto">
          {portfolio?.tools?.length ? portfolio.tools.map(t => (
            <div key={t.name} className="flex gap-2">
              <span className="font-mono text-violet-400 shrink-0">{t.name}</span>
              <span className="text-slate-500 truncate" title={t.description ?? ''}>{t.description}</span>
            </div>
          )) : (
            <p className="text-slate-500">
              Tool list cached server-side. <button className="underline" onClick={() => void loadPortfolio(true)}>Re-sync</button> to refresh.
            </p>
          )}
        </div>
      )}
    </div>
  );
});
