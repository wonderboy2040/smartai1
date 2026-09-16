// ============================================================
// TapetidePanel — India Stock RESEARCH desk (Tapetide MCP)
// (2026-09 v4.7)
// ------------------------------------------------------------
// Tapetide (tapetide.com) = "India's AI-first stock research
// platform — every NSE & BSE stock". Their MCP server
// (mcp.tapetide.com/mcp) requires the user's own Tapetide
// account (OAuth login = the "API key").
//
// • "Connect Tapetide" → full-page OAuth (PKCE) redirect handled
//   by the server (/api/mcp/tapetide/connect → Tapetide login →
//   callback → back to the INTRADAY tab with ?tpt=ok).
// • Once connected, the account's tool surface is fetched as a
//   CATEGORIZED catalog (AI analysis / quotes / screeners /
//   fundamentals / news / patterns) — tools are discoverable
//   only after login, so the desk renders whatever exists.
// • Click a tool → auto-generated arg form (from its input
//   schema) → Run → result shown as text or pretty JSON.
// • Refresh catalog button (force bypasses the 10-min cache).
//
// No tokens ever reach the browser — the server holds them.
// ============================================================
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';

interface TptStatus {
  ok: boolean;
  connected: boolean;
  connectedAt: number | null;
  serverName: string | null;
  toolsCount: number;
  lastToolsAt: number | null;
  registeredOrigins?: number;
  error?: string;
}

interface TptTool {
  name: string;
  description: string | null;
  inputSchema: { type?: string; properties: string[] } | null;
}
interface TptCategory { key: string; label: string; count: number; tools: TptTool[] }
interface ToolsResponse { ok: boolean; cached: boolean; count: number; catalog: TptCategory[] }

type ToolResult = { ok: boolean; tool: string; payload: unknown } | null;

const fmtTime = (ms: number | null) => {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }); }
  catch { return '—'; }
};

/** Auto arg-form field inference from a tool's input schema. */
interface ArgField { name: string; type: 'text' | 'number' | 'bool' | 'enum'; enumValues?: string[]; required: boolean; placeholder: string }
function inferFields(tool: TptTool): ArgField[] {
  // inputSchema from the API route exposes only property NAMES (keys),
  // so type inference falls back to smart heuristics on the name.
  const names = tool.inputSchema?.properties ?? [];
  return names.map((name) => {
    const n = String(name).toLowerCase();
    let type: ArgField['type'] = 'text';
    if (/qty|quantity|count|limit|size|number|days?|period|interval|page|year|month/.test(n)) type = 'number';
    if (/^(is|has|use|include|with)_|^(is|has|use|include|with)[A-Z]/.test(n)) type = 'bool';
    const placeholder = /symbol|ticker|stock|company/.test(n)
      ? 'e.g. RELIANCE'
      : /exchange/.test(n) ? 'NSE' : type === 'number' ? 'e.g. 10' : '';
    return { name, type, required: /symbol|ticker|stock|company/.test(n), placeholder };
  });
}

const CAT_ICONS: Record<string, string> = {
  analysis: '🧠', quotes: '💰', screener: '🔎', fundamentals: '📊',
  news: '📰', patterns: '📈', portfolio: '🗂️', reference: '📚', other: '🧰',
};

export const TapetidePanel = memo(function TapetidePanel() {
  const [status, setStatus] = useState<TptStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toolsResp, setToolsResp] = useState<ToolsResponse | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<TptTool | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string | boolean>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult>(null);
  const mountedRef = useRef(true);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/mcp/tapetide/status');
      const data = await res.json() as TptStatus;
      if (mountedRef.current) setStatus(data);
    } catch { /* status is best-effort */ }
    finally { if (mountedRef.current) setLoading(false); }
  }, []);

  const loadTools = useCallback(async (force = false) => {
    setToolsLoading(true); setToolsError(null);
    try {
      const res = await apiFetch(`/api/mcp/tapetide/tools${force ? '?force=1' : ''}`);
      const data = await res.json() as ToolsResponse;
      if (mountedRef.current) {
        setToolsResp(data);
        // auto-open the first category (AI analysis first — the most useful)
        const cats = data?.catalog;
        if (cats && cats.length > 0 && openCat == null) setOpenCat(cats[0].key);
      }
    } catch (e) {
      if (mountedRef.current) setToolsError(e instanceof Error ? e.message : 'Failed to load Tapetide tools');
    } finally {
      if (mountedRef.current) setToolsLoading(false);
    }
  }, [openCat]);

  // Boot: status + OAuth redirect params (?tpt=ok|error&reason=…).
  useEffect(() => {
    mountedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const tpt = params.get('tpt');
    if (tpt === 'ok') {
      setNotice('✅ Tapetide connected — India research desk loading…');
      setTimeout(() => { if (mountedRef.current) setNotice(''); }, 8000);
    } else if (tpt === 'error') {
      setError(`Tapetide connect failed: ${params.get('reason') || 'unknown error'}`);
    }
    void refreshStatus();
    return () => { mountedRef.current = false; };
  }, [refreshStatus]);

  // Connected → fetch the tool catalog once.
  useEffect(() => {
    if (status?.connected) void loadTools();
  }, [status?.connected, loadTools]);

  // Tab focus: cheap status re-pull (scheduled server changes show up).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshStatus]);

  const handleConnect = () => {
    window.location.href = `${PROXY_BASE}/api/mcp/tapetide/connect`;
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Tapetide? The India research desk tools will be locked until you reconnect.')) return;
    try {
      await apiFetch('/api/mcp/tapetide/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setStatus((s) => (s ? { ...s, connected: false, toolsCount: 0 } : s));
      setToolsResp(null); setSelectedTool(null); setResult(null);
      setNotice('Disconnected from Tapetide.');
      setTimeout(() => { if (mountedRef.current) setNotice(''); }, 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    }
  };

  const pickTool = (tool: TptTool) => {
    setSelectedTool(tool);
    setResult(null);
    setArgValues({});
  };

  const runTool = async () => {
    if (!selectedTool) return;
    setRunning(true); setResult(null); setError(null);
    try {
      // Coerce arg values: numbers → Number, booleans → boolean, empty → dropped.
      const fields = inferFields(selectedTool);
      const args: Record<string, string | number | boolean> = {};
      for (const f of fields) {
        const raw = argValues[f.name];
        if (raw === undefined || raw === '' || raw === false) continue;
        if (f.type === 'number') {
          const n = Number(raw);
          if (Number.isFinite(n)) args[f.name] = n;
        } else if (f.type === 'bool') {
          args[f.name] = raw === true || raw === 'true';
        } else {
          args[f.name] = String(raw).toUpperCase().trim();
        }
      }
      const res = await apiFetch('/api/mcp/tapetide/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: selectedTool.name, args }),
      });
      const data = await res.json() as ToolResult;
      if (mountedRef.current) setResult(data);
    } catch (e) {
      if (mountedRef.current) setError(e instanceof Error ? e.message : 'Tool call failed');
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  };

  // -------------------- render --------------------
  if (loading) {
    return (
      <div className="quantum-panel rounded-2xl p-4 flex items-center gap-3 text-slate-400 text-sm">
        <span className="inline-block animate-spin">⏳</span> Checking Tapetide MCP connection…
      </div>
    );
  }

  const connected = status?.connected;
  const fields = selectedTool ? inferFields(selectedTool) : [];
  const payloadJson = result ? (() => {
    const p = (result as Record<string, unknown>)?.payload;
    if (typeof p === 'string') return null;
    try { return JSON.stringify(p, null, 2); } catch { return null; }
  })() : null;
  const payloadText = result ? (typeof (result as Record<string, unknown>)?.payload === 'string' ? String((result as Record<string, unknown>).payload) : null) : null;

  return (
    <div className="quantum-panel rounded-2xl p-4 sm:p-5 border border-amber-500/20 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-xl shadow-lg shadow-amber-500/20">
            🇮🇳
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black gradient-text-cyan font-display leading-tight">
              Tapetide India Research <span className="text-[10px] font-bold text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded-md px-1.5 py-0.5 align-middle ml-1">MCP</span>
              {connected && (
                <span className="ml-2 text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 rounded px-1.5 py-0.5 align-middle inline-flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse-dot" /> {status?.serverName || 'CONNECTED'}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-500">
              {connected
                ? `${status?.toolsCount ?? 0} research tools • NSE & BSE • last catalog ${fmtTime(status?.lastToolsAt)}`
                : "India's AI-first stock research (NSE/BSE) — apne Tapetide account se connect karo"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <button
                onClick={() => void loadTools(true)}
                disabled={toolsLoading}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50"
                title="Re-fetch the tool catalog (bypasses 10-min cache)"
              >
                <span className={toolsLoading ? 'inline-block animate-spin' : ''}>🔄</span> {toolsLoading ? 'Loading…' : 'Refresh Tools'}
              </button>
              <button
                onClick={() => void handleDisconnect()}
                className="quantum-btn-ghost px-4 py-2 rounded-xl font-semibold text-sm text-red-400 border border-red-500/20 hover:border-red-500/50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              className="px-5 py-2 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/25"
              title="Login with your Tapetide account (redirects to tapetide.com)"
            >
              🔗 Connect Tapetide
            </button>
          )}
        </div>
      </div>

      {/* Notices */}
      {notice && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-300 font-semibold">{notice}</div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-sm text-red-300 font-semibold break-words">⚠️ {error}</div>
      )}

      {/* Not connected explainer */}
      {!connected && (
        <div className="text-xs text-slate-400 leading-relaxed space-y-1.5">
          <p>
            <b className="text-slate-300">Ye kya hai:</b> Tapetide ka official MCP server{' '}
            <span className="text-amber-300 font-mono">mcp.tapetide.com</span> — India ka AI-first stock research platform (har NSE/BSE stock
            par AI analysis, screeners, fundamentals). Server-listed "free" claim ke against 401 Bearer auth lagta hai —{' '}
            <b className="text-slate-300">account login hi API key hai</b>.
          </p>
          <p className="text-slate-500">
            🔒 Secure OAuth login (read-only research) • PKCE + dynamic client registration • tokens sirf server pe store hote hain •
            Connect karne par Intraday TAB me research desk activate ho jaata hai.
          </p>
        </div>
      )}

      {/* Tool catalog */}
      {connected && (
        <div className="space-y-3">
          {toolsLoading && !toolsResp && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <span className="inline-block animate-spin">⏳</span> Discovering your Tapetide tool catalog…
            </div>
          )}
          {toolsError && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 text-xs text-amber-300">
              Tool catalog load failed: {toolsError} — <button className="underline font-semibold" onClick={() => void loadTools(true)}>retry</button>
            </div>
          )}
          {toolsResp && toolsResp.count === 0 && !toolsError && (
            <div className="text-xs text-slate-500">
              Is account par koi tool expose nahi hua (plan limit ho sakta hai). Tapetide dashboard se plan check karo, phir Refresh Tools dabaao.
            </div>
          )}
          {toolsResp?.catalog.map((cat) => {
            const open = openCat === cat.key;
            return (
              <div key={cat.key} className="rounded-xl border border-white/5 bg-slate-900/40 overflow-hidden">
                <button
                  onClick={() => setOpenCat(open ? null : cat.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs font-black text-slate-200 uppercase tracking-wider">
                    <span className="text-base">{CAT_ICONS[cat.key] ?? '🧰'}</span> {cat.label}
                    <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded px-1.5 py-0.5">{cat.count}</span>
                  </span>
                  <span className="text-slate-500 text-[10px]">{open ? '▼' : '▶'}</span>
                </button>
                {open && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {cat.tools.map((tool) => {
                      const sel = selectedTool?.name === tool.name;
                      return (
                        <div key={tool.name} className={`rounded-lg border px-3 py-2 transition-colors ${sel ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-white/5 bg-slate-950/40 hover:border-white/10'}`}>
                          <button onClick={() => pickTool(tool)} className="w-full text-left">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-mono font-bold text-cyan-300">{tool.name}</span>
                              {sel && <span className="text-[9px] font-black text-amber-400">SELECTED</span>}
                            </div>
                            {tool.description && (
                              <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{tool.description}</div>
                            )}
                          </button>
                          {sel && (
                            <div className="mt-2.5 pt-2.5 border-t border-white/10 space-y-2.5">
                              {/* Arg form (auto-generated) */}
                              {fields.length > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {fields.map((f) => (
                                    <label key={f.name} className="block">
                                      <span className="text-[9px] font-mono font-bold text-slate-500 uppercase">
                                        {f.name}{f.required ? <span className="text-amber-400"> *</span> : null}
                                      </span>
                                      {f.type === 'bool' ? (
                                        <input
                                          type="checkbox"
                                          checked={argValues[f.name] === true}
                                          onChange={(e) => setArgValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                                          className="mt-1 block accent-amber-500"
                                        />
                                      ) : (
                                        <input
                                          type={f.type === 'number' ? 'number' : 'text'}
                                          value={typeof argValues[f.name] === 'string' ? (argValues[f.name] as string) : ''}
                                          placeholder={f.placeholder}
                                          onChange={(e) => setArgValues((v) => ({ ...v, [f.name]: e.target.value }))}
                                          className="mt-1 w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:outline-none"
                                        />
                                      )}
                                    </label>
                                  ))}
                                </div>
                              )}
                              {fields.length === 0 && (
                                <div className="text-[10px] text-slate-500">No inputs — direct run karo.</div>
                              )}
                              <button
                                onClick={() => void runTool()}
                                disabled={running}
                                className="px-4 py-1.5 rounded-lg font-bold text-[11px] text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 transition-all"
                              >
                                <span className={running ? 'inline-block animate-spin' : ''}>⚡</span> {running ? 'Running…' : 'Run Tool'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Result viewer */}
      {result && (
        <div className="rounded-xl border border-emerald-500/20 bg-slate-950/60 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono font-black text-emerald-300 uppercase tracking-wider">
              ✓ {result.tool} — result
            </span>
            <button
              onClick={() => { void navigator.clipboard?.writeText(payloadJson ?? payloadText ?? ''); }}
              className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-400"
              title="Copy result"
            >
              ⧉ Copy
            </button>
          </div>
          {payloadText && (
            <pre className="text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">{payloadText}</pre>
          )}
          {payloadJson && (
            <pre className="text-[10px] font-mono text-cyan-200 whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">{payloadJson}</pre>
          )}
        </div>
      )}
    </div>
  );
});
