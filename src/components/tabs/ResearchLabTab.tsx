import React, { useState, useCallback, useEffect } from 'react';
import { useApp } from '../../hooks/AppContext';
import {
  analyzeJournal, detectPatterns, fetchTheses, saveThesis, deleteThesis,
  fetchScheduledJobs, saveScheduledJob, deleteScheduledJob,
  fetchBrokerStatus, runSwarmCommittee,
  type JournalResult, type PatternResult, type Thesis, type ScheduledJob,
} from '../../utils/researchLabApi';
import { apiFetch } from '../../utils/api';

// ============================================================
// RESEARCH LAB TAB — Vibe-Trading inspired features
// Thesis Tracker · Trade Journal · Pattern Recognition ·
// Swarm Committee · Scheduled Research · Broker Connectors
// ============================================================

const fmtINR = (n: number) => {
  const sign = n >= 0 ? '+' : '';
  if (Math.abs(n) >= 10000000) return `${sign}₹${(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `${sign}₹${(n / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(n).toLocaleString('en-IN')}`;
};

export default React.memo(function ResearchLabTab() {
  const { portfolio, livePrices, usdInrRate } = useApp();
  const [activeSection, setActiveSection] = useState<'thesis' | 'journal' | 'patterns' | 'swarm' | 'schedule' | 'broker'>('thesis');

  const sections = [
    { id: 'thesis', label: '🧠 Thesis Tracker', desc: 'Investment thesis + evidence' },
    { id: 'journal', label: '📒 Trade Journal', desc: 'Behavior diagnostics' },
    { id: 'patterns', label: '📈 Patterns', desc: 'Chart pattern detection' },
    { id: 'swarm', label: '🐝 Swarm Committee', desc: 'Bull vs Bear vs Risk debate' },
    { id: 'schedule', label: '🕒 Scheduled Research', desc: 'Cron-based auto-research' },
    { id: 'broker', label: '🇮🇳 Broker Connectors', desc: 'Dhan + Shoonya' },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Section selector */}
      <div className="quantum-panel rounded-2xl p-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`p-2.5 rounded-xl text-left transition-all ${
                activeSection === s.id
                  ? 'bg-cyan-500/20 border border-cyan-500/40'
                  : 'bg-black/20 border border-white/5 hover:border-white/10'
              }`}
            >
              <div className="text-[11px] font-bold text-white">{s.label}</div>
              <div className="text-[8px] text-slate-500 mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {activeSection === 'thesis' && <ThesisTracker />}
      {activeSection === 'journal' && <TradeJournal />}
      {activeSection === 'patterns' && <PatternRecognition portfolio={portfolio} livePrices={livePrices} />}
      {activeSection === 'swarm' && <SwarmCommittee portfolio={portfolio} livePrices={livePrices} usdInrRate={usdInrRate} />}
      {activeSection === 'schedule' && <ScheduledResearch />}
      {activeSection === 'broker' && <BrokerConnectors />}
    </div>
  );
});

// ============================================================
// 1. THESIS TRACKER
// ============================================================
function ThesisTracker() {
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Thesis>({ symbol: '', thesis: '', criteria: [], status: 'active', evidence: [] });
  const [criteriaInput, setCriteriaInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchTheses();
    setTheses(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.symbol || !form.thesis) return;
    const criteria = criteriaInput.split('\n').filter(c => c.trim());
    await saveThesis({ ...form, criteria });
    setForm({ symbol: '', thesis: '', criteria: [], status: 'active', evidence: [] });
    setCriteriaInput('');
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteThesis(id);
    load();
  };

  const statusColors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    monitoring: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
    validated: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  };

  return (
    <div className="quantum-panel rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-black text-white">🧠 Thesis Tracker</h3>
        <button onClick={() => setShowForm(s => !s)} className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400">
          {showForm ? '✕ Cancel' : '+ New Thesis'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-3 bg-black/30 border border-cyan-500/20 rounded-xl space-y-2">
          <input placeholder="Symbol (e.g. RELIANCE)" value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            className="w-full bg-black/40 rounded px-3 py-2 text-[12px] text-white border border-white/10" />
          <textarea placeholder="Thesis (why are you investing?)" value={form.thesis} onChange={e => setForm(f => ({ ...f, thesis: e.target.value }))}
            className="w-full bg-black/40 rounded px-3 py-2 text-[12px] text-white border border-white/10 h-20 resize-none" />
          <textarea placeholder="Criteria (one per line, e.g. Revenue CAGR >15%)" value={criteriaInput} onChange={e => setCriteriaInput(e.target.value)}
            className="w-full bg-black/40 rounded px-3 py-2 text-[12px] text-white border border-white/10 h-20 resize-none" />
          <button onClick={handleSave} className="px-4 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400">Save Thesis</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-500 text-sm">Loading theses...</div>
      ) : theses.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">No theses yet. Create one to track your investment reasoning.</div>
      ) : (
        <div className="space-y-2">
          {theses.map(t => (
            <div key={t.id} className="bg-black/20 border border-white/5 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-white text-sm">{t.symbol}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] px-2 py-0.5 rounded border ${statusColors[t.status] || statusColors.active}`}>{t.status.toUpperCase()}</span>
                  <button onClick={() => handleDelete(t.id!)} className="text-red-400/50 hover:text-red-400 text-[10px]">✕</button>
                </div>
              </div>
              <p className="text-[11px] text-slate-300 mb-2">{t.thesis}</p>
              {t.criteria && t.criteria.length > 0 && (
                <div className="space-y-0.5">
                  {t.criteria.map((c, i) => (
                    <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1">
                      <span className="text-cyan-500">▸</span> {c}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 2. TRADE JOURNAL ANALYZER
// ============================================================
function TradeJournal() {
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<JournalResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!csvText.trim()) return;
    setAnalyzing(true);
    // Parse CSV: symbol,date,type,qty,price,change(optional)
    const lines = csvText.trim().split('\n');
    const trades = lines.slice(1).map(line => {
      const parts = line.split(',');
      return {
        symbol: parts[0]?.trim() || '',
        date: parts[1]?.trim() || '',
        type: (parts[2]?.trim().toLowerCase() || 'buy') as 'buy' | 'sell',
        qty: parseFloat(parts[3]) || 0,
        price: parseFloat(parts[4]) || 0,
        change: parseFloat(parts[5]) || 0,
      };
    }).filter(t => t.symbol && t.qty > 0 && t.price > 0);

    const r = await analyzeJournal(trades);
    setResult(r);
    setAnalyzing(false);
  };

  const severityColors: Record<string, string> = {
    none: 'text-emerald-400', low: 'text-emerald-400',
    medium: 'text-amber-400', high: 'text-red-400',
  };

  return (
    <div className="quantum-panel rounded-2xl p-4">
      <h3 className="text-base font-black text-white mb-2">📒 Trade Journal Analyzer</h3>
      <p className="text-[11px] text-slate-500 mb-3">Paste CSV: symbol,date(YYYY-MM-DD),type(buy/sell),qty,price,change%</p>

      <textarea
        placeholder="symbol,date,type,qty,price,change&#10;RELIANCE,2026-01-15,buy,10,2450,1.5&#10;RELIANCE,2026-03-20,sell,10,2680,0.8"
        value={csvText}
        onChange={e => setCsvText(e.target.value)}
        className="w-full bg-black/40 rounded-xl px-3 py-2 text-[11px] text-white border border-white/10 h-32 resize-none font-mono mb-3"
      />
      <button onClick={handleAnalyze} disabled={analyzing} className="px-4 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400 disabled:opacity-50 mb-4">
        {analyzing ? '⏳ Analyzing...' : '🔍 Analyze Trades'}
      </button>

      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-black/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-slate-500 uppercase">Win Rate</div>
              <div className="text-sm font-bold text-cyan-400">{result.summary.winRate}%</div>
            </div>
            <div className="bg-black/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-slate-500 uppercase">Roundtrips</div>
              <div className="text-sm font-bold text-white">{result.summary.totalRoundtrips}</div>
            </div>
            <div className="bg-black/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-slate-500 uppercase">Total P&L</div>
              <div className={`text-sm font-bold ${result.summary.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtINR(result.summary.totalPnL)}</div>
            </div>
            <div className="bg-black/30 rounded-lg p-2 text-center">
              <div className="text-[8px] text-slate-500 uppercase">Trades/Wk</div>
              <div className="text-sm font-bold text-amber-400">{result.summary.tradesPerWeek}</div>
            </div>
          </div>

          {/* Diagnostics */}
          <div className="space-y-1.5">
            <div className="text-[10px] text-slate-500 font-bold uppercase">Behavioral Diagnostics</div>
            {[
              { label: '🧠 Disposition Effect', d: result.diagnostics.disposition },
              { label: '⚡ Overtrading', d: result.diagnostics.overtrading },
              { label: '🚀 Chasing Momentum', d: result.diagnostics.chasing },
            ].map(({ label, d }) => (
              <div key={label} className="bg-black/20 rounded-lg p-2 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-white">{label}</div>
                  <div className="text-[9px] text-slate-500">{d.detail}</div>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${severityColors[d.severity]} bg-current/10`}>
                  {d.severity.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 3. PATTERN RECOGNITION
// ============================================================
function PatternRecognition(_props: { portfolio: any[]; livePrices: any }) {
  const [patterns, setPatterns] = useState<PatternResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [symbol, setSymbol] = useState('');

  const detect = async () => {
    if (!symbol) return;
    setLoading(true);
    // Fetch candles via /api/chart
    const PROXY = (import.meta.env.VITE_API_PROXY as string) || '';
    try {
      const res = await apiFetch(`${PROXY}/api/chart?symbol=${encodeURIComponent(symbol)}&market=IN&interval=D`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const candles = data?.candles || [];
        if (candles.length >= 10) {
          const r = await detectPatterns(candles);
          setPatterns(r);
        }
      }
    } catch { /* noop */ }
    setLoading(false);
  };

  return (
    <div className="quantum-panel rounded-2xl p-4">
      <h3 className="text-base font-black text-white mb-2">📈 Pattern Recognition</h3>
      <div className="flex gap-2 mb-3">
        <input placeholder="Symbol (e.g. RELIANCE)" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
          className="flex-1 bg-black/40 rounded px-3 py-1.5 text-[12px] text-white border border-white/10" />
        <button onClick={detect} disabled={loading} className="px-4 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400 disabled:opacity-50">
          {loading ? '⏳' : '🔍 Detect'}
        </button>
      </div>

      {patterns && (
        <div className="space-y-1.5">
          <div className="text-[9px] text-slate-500 mb-1">Detected {patterns.patterns.length} pattern(s) on {patterns.candleCount} candles:</div>
          {patterns.patterns.length === 0 ? (
            <div className="text-[11px] text-slate-500 text-center py-4">No significant patterns detected.</div>
          ) : (
            patterns.patterns.map((p, i) => {
              const colors: Record<string, string> = {
                support: 'border-emerald-500/30 bg-emerald-500/5',
                resistance: 'border-red-500/30 bg-red-500/5',
                uptrend: 'border-emerald-500/30 bg-emerald-500/5',
                downtrend: 'border-red-500/30 bg-red-500/5',
                double_top: 'border-red-500/30 bg-red-500/5',
                double_bottom: 'border-emerald-500/30 bg-emerald-500/5',
                head_shoulders: 'border-red-500/30 bg-red-500/5',
                hammer: 'border-emerald-500/30 bg-emerald-500/5',
                shooting_star: 'border-red-500/30 bg-red-500/5',
                doji: 'border-amber-500/30 bg-amber-500/5',
              };
              return (
                <div key={i} className={`rounded-lg p-2 border ${colors[p.type] || 'border-white/5 bg-black/20'}`}>
                  <div className="text-[11px] font-bold text-white">{p.type.replace(/_/g, ' ').toUpperCase()}</div>
                  <div className="text-[10px] text-slate-400">{p.note}</div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 4. SWARM INVESTMENT COMMITTEE
// ============================================================
function SwarmCommittee({ portfolio, usdInrRate }: { portfolio: any[]; livePrices: any; usdInrRate: number }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setRunning(true);
    const ctx = `Portfolio: ${portfolio.length} positions. USD/INR: ₹${usdInrRate.toFixed(2)}. Top holdings: ${portfolio.slice(0, 5).map(p => p.symbol).join(', ')}`;
    const r = await runSwarmCommittee(query, ctx);
    setResult(r);
    setRunning(false);
  };

  const agentColors: Record<string, string> = {
    bull: 'border-emerald-500/30 bg-emerald-500/5',
    bear: 'border-red-500/30 bg-red-500/5',
    risk: 'border-amber-500/30 bg-amber-500/5',
    pm: 'border-cyan-500/30 bg-cyan-500/5',
  };

  return (
    <div className="quantum-panel rounded-2xl p-4">
      <h3 className="text-base font-black text-white mb-2">🐝 Swarm Investment Committee</h3>
      <p className="text-[11px] text-slate-500 mb-3">4 AI agents debate: Bull vs Bear vs Risk → PM decides</p>

      <div className="flex gap-2 mb-3">
        <input placeholder="Should I buy ITC at ₹450?" value={query} onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-black/40 rounded px-3 py-1.5 text-[12px] text-white border border-white/10" />
        <button onClick={run} disabled={running} className="px-4 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400 disabled:opacity-50">
          {running ? '⏳ Debating...' : '🐝 Run Swarm'}
        </button>
      </div>

      {result && (
        <div className="space-y-2">
          {[
            { label: '🟢 Bull Advocate', text: result.bull, key: 'bull' },
            { label: '🔴 Bear Advocate', text: result.bear, key: 'bear' },
            { label: '⚠️ Risk Officer', text: result.risk, key: 'risk' },
            { label: '📊 PM Decision', text: result.pm, key: 'pm' },
          ].map(({ label, text, key }) => (
            <div key={key} className={`rounded-xl p-2.5 border ${agentColors[key]}`}>
              <div className="text-[10px] font-bold text-white mb-1">{label}</div>
              <div className="text-[11px] text-slate-300 whitespace-pre-wrap">{text}</div>
            </div>
          ))}
          <div className={`text-center py-2 rounded-xl font-bold text-sm ${result.consensus === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : result.consensus === 'AVOID' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
            CONSENSUS: {result.consensus}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 5. SCHEDULED RESEARCH
// ============================================================
function ScheduledResearch() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ScheduledJob>({ prompt: '', cron: '0 18 * * 5', enabled: true });

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchScheduledJobs();
    setJobs(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.prompt || !form.cron) return;
    await saveScheduledJob(form);
    setForm({ prompt: '', cron: '0 18 * * 5', enabled: true });
    setShowForm(false);
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteScheduledJob(id);
    load();
  };

  return (
    <div className="quantum-panel rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-black text-white">🕒 Scheduled Research</h3>
        <button onClick={() => setShowForm(s => !s)} className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400">
          {showForm ? '✕ Cancel' : '+ New Job'}
        </button>
      </div>
      <p className="text-[9px] text-slate-600 mb-3">⚠️ Render free tier: jobs reset on redeploy. Use client-side cron for persistence.</p>

      {showForm && (
        <div className="mb-4 p-3 bg-black/30 border border-cyan-500/20 rounded-xl space-y-2">
          <textarea placeholder="Research prompt (e.g. Rebalance check — list holdings >5% off target)" value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
            className="w-full bg-black/40 rounded px-3 py-2 text-[12px] text-white border border-white/10 h-16 resize-none" />
          <input placeholder="Cron (e.g. 0 18 * * 5 = every Fri 6PM)" value={form.cron} onChange={e => setForm(f => ({ ...f, cron: e.target.value }))}
            className="w-full bg-black/40 rounded px-3 py-2 text-[12px] text-white border border-white/10 font-mono" />
          <button onClick={handleSave} className="px-4 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-[10px] font-bold text-cyan-400">Save Job</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-500 text-sm">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">No scheduled jobs.</div>
      ) : (
        <div className="space-y-2">
          {jobs.map(j => (
            <div key={j.id} className="bg-black/20 border border-white/5 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <code className="text-[10px] text-amber-400 font-mono">{j.cron}</code>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] px-2 py-0.5 rounded ${j.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-500'}`}>
                    {j.enabled ? 'ACTIVE' : 'PAUSED'}
                  </span>
                  <button onClick={() => handleDelete(j.id!)} className="text-red-400/50 hover:text-red-400 text-[10px]">✕</button>
                </div>
              </div>
              <p className="text-[11px] text-slate-300">{j.prompt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 6. BROKER CONNECTORS
// ============================================================
function BrokerConnectors() {
  const [status, setStatus] = useState<{ dhan: boolean; shoonya: boolean }>({ dhan: false, shoonya: false });

  useEffect(() => {
    fetchBrokerStatus().then(setStatus);
  }, []);

  return (
    <div className="quantum-panel rounded-2xl p-4">
      <h3 className="text-base font-black text-white mb-3">🇮🇳 Broker Connectors</h3>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`rounded-xl p-4 border ${status.dhan ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-black/20'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">📊</span>
            <div>
              <div className="text-sm font-bold text-white">Dhan</div>
              <div className={`text-[9px] ${status.dhan ? 'text-emerald-400' : 'text-slate-500'}`}>
                {status.dhan ? '✅ Connected' : '⚠️ Not configured'}
              </div>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 leading-snug">
            Set <code className="text-amber-400">DHAN_CLIENT_ID</code> + <code className="text-amber-400">DHAN_ACCESS_TOKEN</code> in server env.
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${status.shoonya ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/5 bg-black/20'}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🏦</span>
            <div>
              <div className="text-sm font-bold text-white">Shoonya (Finvasia)</div>
              <div className={`text-[9px] ${status.shoonya ? 'text-emerald-400' : 'text-slate-500'}`}>
                {status.shoonya ? '✅ Connected' : '⚠️ Not configured'}
              </div>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 leading-snug">
            Set <code className="text-amber-400">SHOONYA_USER_ID</code> + <code className="text-amber-400">SHOONYA_PASSWORD</code> + <code className="text-amber-400">SHOONYA_VENDOR_CODE</code> in server env.
          </div>
        </div>
      </div>

      <div className="text-[9px] text-slate-600 leading-relaxed">
        ℹ️ Both connectors are read-only (positions + holdings). No order placement — safe for free tier.
        Dhan API: <a href="https://dhanhq.co/docs/v2/" className="text-cyan-400" target="_blank" rel="noopener">docs</a> ·
        Shoonya API: <a href="https://shoonya.finvasia.com/" className="text-cyan-400" target="_blank" rel="noopener">docs</a>
      </div>
    </div>
  );
}
