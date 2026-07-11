// ============================================================
// RESEARCH LAB — Vibe-Trading inspired features
// ------------------------------------------------------------
// Client-side API wrappers for the new server endpoints:
//   /api/journal/analyze — Trade Journal + Behavior Diagnostics
//   /api/patterns/detect — Pattern Recognition
//   /api/thesis          — Thesis Tracker (CRUD)
//   /api/schedule        — Scheduled Research (CRUD)
//   /api/broker/*        — Dhan + Shoonya connectors
// ============================================================

import { apiFetch } from './api';

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

// ---- Trade Journal Analyzer ----
export interface JournalTrade {
  symbol: string;
  date: string;
  type: 'buy' | 'sell';
  qty: number;
  price: number;
  change?: number;
}

export interface JournalResult {
  roundtrips: any[];
  summary: {
    totalTrades: number;
    totalRoundtrips: number;
    winRate: number;
    avgWinHoldDays: number;
    avgLossHoldDays: number;
    totalPnL: number;
    tradesPerWeek: number;
  };
  diagnostics: {
    disposition: { severity: string; ratio: number; detail: string };
    overtrading: { severity: string; tradesPerWeek: number; detail: string };
    chasing: { severity: string; pct: number; detail: string };
  };
}

export async function analyzeJournal(trades: JournalTrade[]): Promise<JournalResult | null> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/journal/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trades }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ---- Pattern Recognition ----
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }
export interface PatternResult { patterns: { type: string; price?: number; note: string; slope?: number; strength?: number }[]; candleCount: number; }

export async function detectPatterns(candles: Candle[]): Promise<PatternResult | null> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/patterns/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candles }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ---- Thesis Tracker ----
export interface Thesis {
  id?: string;
  symbol: string;
  thesis: string;
  criteria: string[];
  status: 'active' | 'monitoring' | 'rejected' | 'validated';
  evidence: { date: string; note: string; status: 'pass' | 'fail' | 'neutral' }[];
  updatedAt?: number;
  createdAt?: number;
}

export async function fetchTheses(): Promise<Thesis[]> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/thesis`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function saveThesis(t: Thesis): Promise<Thesis | null> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/thesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function deleteThesis(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/thesis/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

// ---- Scheduled Research ----
export interface ScheduledJob {
  id?: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: number | null;
  createdAt?: number;
}

export async function fetchScheduledJobs(): Promise<ScheduledJob[]> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/schedule`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function saveScheduledJob(job: ScheduledJob): Promise<ScheduledJob | null> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function deleteScheduledJob(id: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/schedule/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

// ---- Broker Connectors ----
export async function fetchBrokerStatus(): Promise<{ dhan: boolean; shoonya: boolean }> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/broker/status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { dhan: false, shoonya: false };
    return await res.json();
  } catch { return { dhan: false, shoonya: false }; }
}

export async function fetchDhanHoldings(): Promise<any[] | null> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/broker/dhan/holdings`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return null; }
}

export async function fetchShoonyaHoldings(): Promise<any[] | null> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/broker/shoonya/holdings`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.holdings || [];
  } catch { return null; }
}

// ---- Swarm Investment Committee ----
// Runs 4 LLM agents in parallel: bull, bear, risk, PM.
// Uses the existing /api/groq or /api/gemini endpoints.
export interface SwarmResult {
  bull: string;
  bear: string;
  risk: string;
  pm: string;
  consensus: string;
}

export async function runSwarmCommittee(
  query: string,
  portfolioContext: string,
  engine: 'groq' | 'gemini' | 'claude' = 'groq'
): Promise<SwarmResult | null> {
  const runAgent = async (role: string, systemPrompt: string) => {
    try {
      const res = await apiFetch(`${PROXY_BASE}/api/${engine}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${query}\n\nPORTFOLIO CONTEXT:\n${portfolioContext}` },
          ],
          model: engine === 'groq' ? 'llama-3.3-70b-versatile' : engine === 'gemini' ? 'gemini-2.5-flash' : 'claude-sonnet-4-20250514',
          max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return `${role} agent unavailable`;
      const data = await res.json();
      if (engine === 'gemini') return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (engine === 'claude') return data?.content?.[0]?.text || '';
      return data?.choices?.[0]?.message?.content || '';
    } catch { return `${role} agent failed`; }
  };

  try {
    const [bull, bear, risk] = await Promise.all([
      runAgent('Bull', 'You are a BULL ADVOCATE — find every positive reason to buy. Focus on growth, moat, tailwinds, valuation upside. Be convincing but honest. 200 words max. Simple Hinglish.'),
      runAgent('Bear', 'You are a BEAR ADVOCATE — find every risk and negative. Focus on competition, regulatory risk, valuation risk, downside scenarios. Be convincing but honest. 200 words max. Simple Hinglish.'),
      runAgent('Risk', 'You are a RISK OFFICER — assess position sizing, correlation, stop-loss levels, portfolio impact. Give specific numbers. 150 words max. Simple Hinglish.'),
    ]);

    // PM synthesizes after seeing all 3
    const pm = await runAgent('PM', `You are a PORTFOLIO MANAGER. Three analysts gave their views:\n\nBULL:\n${bull}\n\nBEAR:\n${bear}\n\nRISK:\n${risk}\n\nGive your FINAL DECISION: BUY / WAIT / AVOID with exact entry, SL, targets, and position size. 200 words max. Simple Hinglish.`);

    const consensus = pm.includes('BUY') ? 'BUY' : pm.includes('WAIT') ? 'WAIT' : pm.includes('AVOID') ? 'AVOID' : 'REVIEW';

    return { bull, bear, risk, pm, consensus };
  } catch { return null; }
}
