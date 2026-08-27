// ============================================================
// intraday/store — tiny JSON file persistence for intraday state
// ------------------------------------------------------------
// Persists tracked signals, paper trades and the custom watchlist
// under server/data/ so a Render restart (or crash) does not wipe
// the day's track record / virtual positions. Writes are atomic
// (tmp file + rename) and failure-tolerant: a read-only filesystem
// degrades to in-memory-only operation instead of crashing the API.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');

let _dirReady = false;
function ensureDir() {
  if (_dirReady) return true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _dirReady = true;
  } catch {
    _dirReady = false;
  }
  return _dirReady;
}

export function loadJSON(filename, fallback) {
  try {
    const p = path.join(DATA_DIR, filename);
    if (!fs.existsSync(p)) return structuredClone(fallback);
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    // Merge over fallback so newly-added fields get sane defaults
    // when reading a file written by an older build.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      return { ...structuredClone(fallback), ...parsed };
    }
    return parsed;
  } catch {
    return structuredClone(fallback);
  }
}

export function saveJSON(filename, data) {
  try {
    if (!ensureDir()) return false;
    const p = path.join(DATA_DIR, filename);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, p);
    return true;
  } catch {
    // Non-fatal: persistence is best-effort (read-only FS ⇒ memory-only mode).
    return false;
  }
}
