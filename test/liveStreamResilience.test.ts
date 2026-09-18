// ============================================================
// test/liveStreamResilience.test.ts — v10.13 (deep-recheck H4):
// the main /api/stream SSE client's blindness to stream death.
//
// THE BUG: onStatus only fired on server 'status' frames — a dead
// stream kept the LAST healthy feedStatus in useAppState forever
// (crypto watchdog at 30s cadence, sync loop skipping REST batches,
// header still showing every feed LIVE). And on a FATAL error the
// browser auto-retried the SAME baked-in URL (expired ?session=
// token) forever on its default interval.
//
// THE CONTRACT (locked here with a fake EventSource):
//   • onerror → immediate honest downgrade: onStatus({}) — pollers
//     speed up instead of trusting stale "live" flags
//   • a transient error streak < 6 → the browser's auto-reconnect
//     is left alone (onopen resets the streak — blips self-heal)
//   • a SUSTAINED streak (≥ 6 failures, no open) → the client takes
//     over: closes the auto-retry loop and schedules a capped manual
//     backoff that REBUILDS the URL — re-reading the session token
//     (a re-login heals the stream instead of looping 401s forever)
//   • the returned disconnect() kills everything (no zombie timers)
// Hermetic: no network — EventSource is a fake class.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- fake EventSource ----
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0; // CONNECTING
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(e: { data: string }) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(ev: string, fn: (e: { data: string }) => void) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev)!.push(fn);
  }
  // test controls
  open() { this.readyState = 1; this.onopen?.(); }
  fail() { this.onerror?.(); }
  serverEvent(ev: string, data: unknown) {
    for (const fn of [...(this.listeners.get(ev) || [])]) fn({ data: JSON.stringify(data) });
  }
  close() { if (!this.closed) { this.closed = true; this.readyState = 2; } }
}

// ---- fresh module per suite (the client keeps no state, but be strict) ----
import { connectLiveStream } from '../src/utils/liveStream';
import { setSessionToken } from '../src/utils/api';

const tickFrame = (key: string, price: number) => ({ key, price, change: 0.2, time: Date.now(), source: 'groww-live' });

describe('liveStream — v10.13 error handling + capped manual reconnect', () => {
  let onTick: ReturnType<typeof vi.fn>;
  let onStatus: ReturnType<typeof vi.fn>;
  let disconnect: (() => void) | null;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    localStorage.clear();
    setSessionToken('token-A');
    onTick = vi.fn();
    onStatus = vi.fn();
    disconnect = connectLiveStream({
      inSymbols: ['RELIANCE'], usSymbols: [], cryptoSymbols: [],
      onTick, onStatus,
    });
  });
  afterEach(() => {
    disconnect?.();
    vi.unstubAllGlobals();
    setSessionToken(null);
    vi.useRealTimers();
  });

  it('connects with the session token on the URL and forwards ticks + status', () => {
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain('/api/stream?');
    expect(FakeEventSource.instances[0].url).toContain('session=token-A');
    const es = FakeEventSource.instances[0];
    es.open();
    es.serverEvent('tick', tickFrame('IN_RELIANCE', 2925.5));
    expect(onTick).toHaveBeenCalledWith('IN_RELIANCE', expect.objectContaining({ price: 2925.5, src: 'groww-live' }));
    es.serverEvent('status', { 'groww-live': true });
    expect(onStatus).toHaveBeenCalledWith({ 'groww-live': true });
  });

  it('onerror → immediate HONEST downgrade (onStatus({}) — stale "live" flags cleared)', () => {
    const es = FakeEventSource.instances[0];
    es.serverEvent('status', { 'groww-live': true }); // healthy…
    es.fail();
    // the LAST status the app sees must be the downgrade, not the stale healthy map
    expect(onStatus).toHaveBeenLastCalledWith({});
  });

  it('transient error streak (< 6) → browser auto-reconnect left alone (no manual takeover)', () => {
    const es = FakeEventSource.instances[0];
    for (let i = 0; i < 5; i++) es.fail();
    expect(es.closed).toBe(false); // still auto-reconnecting
    expect(FakeEventSource.instances).toHaveLength(1); // no manual new connection
  });

  it('onopen resets the streak — repeated blip+heal cycles never trip the manual path', () => {
    const es = FakeEventSource.instances[0];
    for (let cycle = 0; cycle < 10; cycle++) { es.fail(); es.open(); }
    expect(es.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('SUSTAINED streak (≥ 6) → closes the auto-retry loop + schedules a capped manual reconnect', async () => {
    vi.useFakeTimers();
    const es = FakeEventSource.instances[0];
    for (let i = 0; i < 6; i++) es.fail();
    expect(es.closed).toBe(true); // the doomed tight loop was stopped
    expect(FakeEventSource.instances).toHaveLength(1); // no NEW connection yet (backoff pending)
    // the manual retry fires after the backoff window…
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('the manual reconnect REBUILDS the URL — a refreshed session token heals the stream', async () => {
    vi.useFakeTimers();
    const es = FakeEventSource.instances[0];
    for (let i = 0; i < 6; i++) es.fail();
    // the user re-logs-in while the backoff is pending
    setSessionToken('token-B');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toContain('session=token-B');
  });

  it('disconnect() kills everything — no zombie reconnect timers after teardown', async () => {
    vi.useFakeTimers();
    const es = FakeEventSource.instances[0];
    for (let i = 0; i < 6; i++) es.fail();
    disconnect?.();
    disconnect = null;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.instances).toHaveLength(1); // nothing reconnects after teardown
  });
});
