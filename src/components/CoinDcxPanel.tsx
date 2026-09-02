// ============================================================
// CoinDcxPanel — the crypto half of the synced ASSET TABLE.
// ------------------------------------------------------------
// INDMoney MCP covers India/USA + whatever crypto it tracks; this
// panel connects the user's actual CoinDCX exchange account:
//   • API key + secret entered ONCE — validated server-side with a
//     real /users/balances call, then stored ONLY on the server
//     (server/data/mcp-coindcx.json — gitignored, never in the
//     browser, never in the bundle).
//   • Balances merge into the same Asset Table snapshot (2× daily
//     auto-sync + Sync Now), each coin valued at the LIVE CoinDCX
//     INR price (same upstream feed the price ticker uses).
//   • Crypto rows tick in real-time via the SSE crypto stream.
//
// Security: create the key in CoinDCX with VIEW/read permission
// only — SmartAI never places orders.
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { connectCoinDcx, disconnectCoinDcx, fetchCoinDcxStatus, CoinDcxInfo } from '../utils/api';
import { useApp } from '../hooks/AppContext';

const timeAgo = (ts: number | null | undefined): string => {
  if (!ts) return '—';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const CoinDcxPanel = React.memo(function CoinDcxPanel() {
  const { indmMeta, indmSyncing, loadIndmAssets, portfolio } = useApp();
  const [status, setStatus] = useState<CoinDcxInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  const cdcxInfo = indmMeta?.coindcx || status;
  const connected = !loading && (cdcxInfo?.connected ?? false);
  const coindcxRows = indmMeta?.counts?.coindcx ?? 0;

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchCoinDcxStatus();
      if (mountedRef.current) setStatus(data);
    } catch { /* offline — panel degrades to indmMeta info */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshStatus().finally(() => { if (mountedRef.current) setLoading(false); });
    return () => { mountedRef.current = false; };
  }, [refreshStatus]);

  // After a successful connect the server runs a coindcx-only quick sync;
  // re-pull the snapshot until the crypto rows land (or give up silently).
  useEffect(() => {
    if (!connected || coindcxRows > 0) return;
    let tries = 0;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (++tries > 12) return;
      void loadIndmAssets();
    }, 5000);
    return () => clearInterval(t);
  }, [connected, coindcxRows, loadIndmAssets]);

  const handleConnect = async () => {
    if (!apiKey.trim() || !secret.trim()) {
      setError('API key aur secret dono required hain.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const out = await connectCoinDcx(apiKey.trim(), secret.trim());
      if (out.ok) {
        setApiKey('');
        setSecret('');
        setNotice('✅ CoinDCX connected — crypto balances syncing…');
        setBusy(false);
        void refreshStatus();
        await loadIndmAssets(); // server already quick-synced coindcx during connect
        setTimeout(() => { if (mountedRef.current) setNotice(''); }, 8000);
      } else {
        setError(out.error || 'Connect failed — key/secret galat lag rahe hain.');
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect CoinDCX? Crypto exchange rows will be removed from the asset table (INDMoney assets stay).')) return;
    setBusy(true);
    try {
      await disconnectCoinDcx();
      setNotice('Disconnected from CoinDCX.');
      await refreshStatus();
      await loadIndmAssets(); // picks up cleared coindcx rows
      setTimeout(() => { if (mountedRef.current) setNotice(''); }, 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  // -------------------- render --------------------
  if (loading) {
    return (
      <div className="quantum-panel rounded-2xl p-4 flex items-center gap-3 text-slate-400 text-sm">
        <span className="inline-block animate-spin">⏳</span> Checking CoinDCX connection…
      </div>
    );
  }

  return (
    <div className="quantum-panel rounded-2xl p-4 sm:p-5 border border-amber-500/20 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-xl shadow-lg shadow-amber-500/20">
            🪙
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black gradient-text-cyan font-display leading-tight">
              CoinDCX Crypto Sync
              {connected && (
                <span className="ml-2 text-[9px] font-black text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5 align-middle inline-flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse-dot" /> {coindcxRows > 0 ? 'CRYPTO SOURCE' : 'CONNECTED'}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500">
              {connected
                ? `Exchange balances in the asset table • ${coindcxRows} crypto rows • live CoinDCX prices`
                : 'Apne CoinDCX account ke crypto balances bhi asset table me add karo'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <button
                onClick={() => void loadIndmAssets(true)}
                disabled={indmSyncing || busy}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50"
                title="Force sync now (INDMoney + CoinDCX)"
              >
                <span className={indmSyncing ? 'inline-block animate-spin' : ''}>🔄</span> {indmSyncing ? 'Syncing…' : 'Sync Now'}
              </button>
              <button
                onClick={() => void handleDisconnect()}
                disabled={busy}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm text-red-400 border border-red-500/20 hover:border-red-500/50 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <span className="text-[10px] text-slate-500 font-bold self-center hidden sm:inline">API key needed →</span>
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

      {/* Connect form */}
      {!connected && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="CoinDCX API key"
                autoComplete="off"
                className="w-full bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Secret</label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="CoinDCX API secret"
                autoComplete="off"
                className="w-full bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void handleConnect()}
              disabled={busy}
              className="px-5 py-2 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/25 disabled:opacity-50"
            >
              {busy ? 'Connecting…' : '🔗 Connect CoinDCX'}
            </button>
            <a
              href="https://coindcx.com/settings/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-amber-300/80 hover:text-amber-300 font-semibold underline decoration-dotted"
            >
              CoinDCX → Profile → API Keys se banao ↗
            </a>
          </div>
          <div className="text-xs text-slate-400 leading-relaxed space-y-1.5">
            <p>
              <b className="text-slate-300">Kaise kaam karta hai:</b> Connect karte hi aapke CoinDCX balances (BTC/ETH/… INR values ke saath)
              asset table ke <b>Crypto</b> group me aa jayenge — 2× daily auto-sync + live prices (jo coins INDMoney me hain wo alag rows rahenge).
            </p>
            <p className="text-slate-500">
              🔑 Key banate waqt <b>View / read-only</b> permission kafi hai — SmartAI kabhi trade nahi karta. Keys sirf server pe store hote hain (encrypted at rest nahi hain, server access = key access).
            </p>
          </div>
        </div>
      )}

      {/* Connected status strip */}
      {connected && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-center">
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Crypto Rows</div>
            <div className="text-xs font-black text-amber-300 font-mono mt-0.5">{coindcxRows}</div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Balance Sync</div>
            <div className="text-xs font-black text-white font-mono mt-0.5" title={cdcxInfo?.lastSyncAt ? new Date(cdcxInfo.lastSyncAt).toLocaleString('en-IN') : ''}>
              {timeAgo(cdcxInfo?.lastSyncAt)}
            </div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Currencies</div>
            <div className="text-xs font-black text-slate-300 font-mono mt-0.5">{cdcxInfo?.balanceCount ?? '—'}</div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Live Prices</div>
            <div className="text-xs font-black text-emerald-400 font-mono mt-0.5">CoinDCX feed</div>
          </div>
          <div className="quantum-panel rounded-xl px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Restart-Safe</div>
            <div className="text-xs font-black font-mono mt-0.5" title={
              status?.durable?.configured
                ? 'API keys auto-restore after server restarts (encrypted GitHub backup)'
                : 'Server restart par keys dobara daalni padengi — GITHUB_BACKUP_TOKEN + GITHUB_BACKUP_REPO set karein'
            }>
              {status?.durable?.configured ? <span className="text-emerald-300">ON</span> : <span className="text-amber-300">OFF</span>}
            </div>
          </div>
        </div>
      )}

      {/* CoinDCX balance-sync failure banner (rows stay, marked stale) */}
      {connected && cdcxInfo?.lastError && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-300">
          <p className="font-semibold">
            Last CoinDCX balance sync failed — showing the previous balances. Reason: <span className="font-mono text-xs">{cdcxInfo.lastError}</span>
          </p>
          <p className="text-xs text-amber-200/80 mt-1">Check the API key is still active (CoinDCX → Settings → API Keys), or hit “Sync Now”.</p>
        </div>
      )}

      {/* Footer */}
      {connected && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>🪙 Crypto rows me “(CoinDCX)” name ke saath dikhte hain • values live INR prices se • remove/restore sab rows pe available</span>
          <span>{portfolio.length > 0 ? `table: ${portfolio.length} rows` : ''}</span>
        </div>
      )}
    </div>
  );
});

export default CoinDcxPanel;
