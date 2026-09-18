// ============================================================
// lib/backup — durable remote backup for runtime state (was intraday/backup)
// ------------------------------------------------------------
// PROBLEM: Render free plan ships an EPHEMERAL filesystem. Every
// spin-down / restart / redeploy re-checks-out the git repo, so
// server/data/paper-trades.json (runtime-written, gitignored)
// is silently wiped — the paper-trading history resets to 0.
//
// FIX: mirror the JSON state to the SAME GitHub repository on a
// dedicated branch (default: data-backup) via the Contents API.
//   • scheduleBackup() — debounced, coalesced, rate-limited push
//   • restoreBackup() — boot-time pull when local state is empty
// Pushes to a NON-deploy branch never trigger a Render auto-deploy,
// so there is no restart loop.
//
// CONFIG (all optional — module is a silent no-op without them):
//   GITHUB_BACKUP_TOKEN  — fine-grained PAT (Contents: RW)
//   GITHUB_BACKUP_REPO   — "owner/name"
//   GITHUB_BACKUP_BRANCH — default "data-backup"
// Every failure path is non-throwing: backup is best-effort and
// must never take down a trading route.
// ============================================================
const PUSH_DEBOUNCE_MS = 5000;   // coalesce bursts (watcher ticks)
const PUSH_MIN_GAP_MS = 60_000;  // GitHub abuse safety per file
const FETCH_TIMEOUT_MS = 10_000;

const _log = (msg) => console.log(`[backup] ${msg}`);

const _pending = new Map();      // filename -> latest data object
const _lastPush = new Map();     // filename -> ts
const _inflight = new Map();     // filename -> promise
let _lastAttempt = 0;            // module-wide circuit breaker

export function backupConfigured() {
  const token = process.env.GITHUB_BACKUP_TOKEN;
  const repo = process.env.GITHUB_BACKUP_REPO;
  return !!(token && repo && /^[^/\s]+\/[^/\s]+$/.test(repo.trim()));
}

function _headers() {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${process.env.GITHUB_BACKUP_TOKEN}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'wealthai-backup/1.0',
  };
}

function _apiBase() {
  return `https://api.github.com/repos/${process.env.GITHUB_BACKUP_REPO.trim()}`;
}

function _branch() {
  return (process.env.GITHUB_BACKUP_BRANCH || 'data-backup').trim() || 'data-backup';
}

function _filePath(filename) {
  const dir = (process.env.GITHUB_BACKUP_DIR || 'backups').replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${filename}` : filename;
}

async function _gh(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { ..._headers(), ...(opts.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return r;
}

// ------------------------------------------------------------
// PUSH — one serialized, coalesced upload per file.
// ------------------------------------------------------------
async function _doPush(filename, data) {
  const path = _filePath(filename);
  // 1) Resolve the existing blob's sha (create-on-404).
  let sha = null;
  try {
    const head = await _gh(`${_apiBase()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(_branch())}`);
    if (head.ok) {
      const j = await head.json();
      sha = j?.sha || null;
    } else if (head.status !== 404) {
      _log(`head ${filename} -> HTTP ${head.status}, skipping push`);
      return false;
    }
  } catch (e) {
    _log(`head ${filename} failed: ${e?.message || e}`);
    return false;
  }

  // 2) Create or update the blob on the branch.
  const body = JSON.stringify({
    message: `backup: ${filename} (${new Date().toISOString()})`,
    content: Buffer.from(JSON.stringify(data), 'utf8').toString('base64'),
    branch: _branch(),
    ...(sha ? { sha } : {}),
  });
  const put = await _gh(`${_apiBase()}/contents/${encodeURIComponent(path)}`, { method: 'PUT', body });
  if (put.status === 409 || put.status === 422) {
    // Lost a sha race (another instance pushed first). Non-fatal —
    // the remote copy is at least as fresh as ours.
    _log(`push ${filename} -> ${put.status} (race), remote is fresh`);
    return false;
  }
  if (!put.ok) {
    _log(`push ${filename} -> HTTP ${put.status}`);
    return false;
  }
  _log(`pushed ${filename} -> ${_branch()}:${path}`);
  return true;
}

export function scheduleBackup(filename, data) {
  if (!backupConfigured()) return;
  _pending.set(filename, data);
  _queueFlush(filename);
}

function _queueFlush(filename) {
  const t = setTimeout(() => { _flush(filename); }, PUSH_DEBOUNCE_MS);
  if (typeof t.unref === 'function') t.unref();
}

async function _flush(filename) {
  if (_inflight.has(filename)) return;               // serialized
  const data = _pending.get(filename);
  if (!data) return;
  const gap = Date.now() - (_lastPush.get(filename) || 0);
  if (gap < PUSH_MIN_GAP_MS) { _queueFlush(filename); return; }
  if (Date.now() - _lastAttempt < 3000) { _queueFlush(filename); return; }

  _lastAttempt = Date.now();
  _pending.delete(filename);
  const p = (async () => {
    try { return await _doPush(filename, data); }
    catch (e) { _log(`push ${filename} error: ${e?.message || e}`); return false; }
    finally { _inflight.delete(filename); }
  })();
  _inflight.set(filename, p);
  // If another write landed mid-push, flush it after this one ends.
  p.then(() => { if (_pending.has(filename)) _queueFlush(filename); }).catch(() => {});
}

// ------------------------------------------------------------
// RESTORE — fetch the last backup blob as a parsed object.
// Returns null when unconfigured / missing / corrupt.
// ------------------------------------------------------------
export async function restoreBackup(filename) {
  if (!backupConfigured()) return null;
  const path = _filePath(filename);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await _gh(`${_apiBase()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(_branch())}`);
      if (r.status === 404) return null;
      if (!r.ok) { _log(`restore ${filename} -> HTTP ${r.status}`); continue; }
      const j = await r.json();
      const raw = Buffer.from(j?.content || '', 'base64').toString('utf8');
      const parsed = JSON.parse(raw);
      _log(`restored ${filename} from ${_branch()} (${raw.length} bytes)`);
      return parsed;
    } catch (e) {
      _log(`restore ${filename} attempt ${attempt} failed: ${e?.message || e}`);
    }
  }
  return null;
}
