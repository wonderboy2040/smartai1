// ============================================================
// src/components/aitrading/liveInvalidation.ts — v13.4
// ------------------------------------------------------------
// CLIENT TWIN of server/ai/superIntel.js → liveInvalidationCheck().
// The server cannot be imported into the browser bundle, so the SAME
// pure math lives here and the two are kept feature-identical (the
// server suite test/superIntel.test.ts + test/topFiveStaleQuorum.test.ts
// pin both contracts — update them together).
//
// WHAT IT ANSWERS (on every live tick, not just the ~60s board
// recompute): has the streaming price already moved materially
// against the frozen plan — through the stop-loss, or well past the
// intended entry zone — without waiting for the next full recompute?
//   LONG  → invalidated when liveLtp <= stopLoss
//   SHORT → invalidated when liveLtp >= stopLoss
//   > 0.5×ATR beyond the FAR edge of the entry zone → 'weakening'
// Honest degrade: 'ok' whenever the inputs are missing. Never throws.
// ============================================================

export type LiveInvalidationStatus = 'ok' | 'weakening' | 'invalidated';

export interface LiveInvalidationInput {
  side: string | null | undefined;
  liveLtp: number | null | undefined;
  stopLoss: number | null | undefined;
  entryZoneLow: number | null | undefined;
  entryZoneHigh: number | null | undefined;
  atr?: number | null | undefined;
}

export interface LiveInvalidationVerdict {
  status: LiveInvalidationStatus;
  reason?: string;
}

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** v13.4 live-price invalidation — PURE, mirrors the server twin 1:1. */
export function liveInvalidationCheck({
  side, liveLtp, stopLoss, entryZoneLow, entryZoneHigh, atr,
}: LiveInvalidationInput): LiveInvalidationVerdict {
  if (!(finite(liveLtp) && liveLtp > 0) || !finite(stopLoss)) return { status: 'ok' };
  const long = String(side ?? '').toUpperCase() !== 'SHORT';
  if (long ? liveLtp! <= stopLoss! : liveLtp! >= stopLoss!) {
    return { status: 'invalidated', reason: 'live price already through stop-loss — plan is stale, do not enter' };
  }
  const farEdge: unknown = long ? entryZoneLow : entryZoneHigh;
  const a = finite(atr) && atr! > 0 ? atr! : liveLtp! * 0.012;
  if (finite(farEdge) && Math.abs(liveLtp! - (farEdge as number)) > 0.5 * a) {
    return { status: 'weakening', reason: 'price has moved well past the planned entry zone — re-check before entry' };
  }
  return { status: 'ok' };
}

/** Convenience adapter: run the check against a signal card's blueprint
 * + live tick. Reads only optional fields — absent blueprint/plan → ok. */
export function liveInvalidationFor(
  signal: {
    side?: string | null;
    plan?: { stopLoss?: number | null; atrUsed?: number | null } | null;
    superIntel?: { blueprint?: {
      side?: string | null;
      stopLoss?: number | null;
      entryZone?: [number, number] | null;
    } | null } | null | undefined;
  } | null | undefined,
  liveLtp: number | null | undefined,
): LiveInvalidationVerdict {
  const bp = signal?.superIntel?.blueprint ?? null;
  if (!bp && !signal?.plan) return { status: 'ok' };
  return liveInvalidationCheck({
    side: signal?.side ?? bp?.side ?? null,
    liveLtp,
    stopLoss: bp?.stopLoss ?? signal?.plan?.stopLoss ?? null,
    entryZoneLow: bp?.entryZone?.[0] ?? null,
    entryZoneHigh: bp?.entryZone?.[1] ?? null,
    atr: signal?.plan?.atrUsed ?? null,
  });
}
