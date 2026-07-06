// ============================================================
// Wealth AI Pro — Google Apps Script Cloud Sync backend
// ------------------------------------------------------------
// Deploy this as a Web App (Deploy → New deployment → Web app):
//   - Execute as:        Me
//   - Who has access:    Anyone
// Copy the resulting /exec URL into the app's VITE_API_URL (build env)
// or the server's API_URL env var.
//
// The frontend talks to this script with CORS-"simple" requests
// (Content-Type: text/plain, no custom headers) so the browser does
// NOT send a preflight OPTIONS request — Apps Script cannot answer
// preflight, which is why the old application/json + X-Auth-Token
// approach silently failed. The auth token now travels in the body.
// ============================================================
// IMPORTANT: AUTH_TOKEN must match the frontend's VITE_API_TOKEN.
// FIX: previously AUTH_TOKEN defaulted to the public string
// 'WEALTH_AI_SYNC', which the frontend ALSO accepted as the fallback.
// Combined with the bypass-on-missing-token bug below, anyone with the
// Apps Script URL could read/write the user's portfolio. Now require
// AUTH_TOKEN to be set to a strong (>=12 char) secret here, and refuse
// all requests when it equals the known weak default.
var AUTH_TOKEN = 'WEALTH_AI_SYNC'; // TODO: REPLACE with a strong >=12 char secret

function _isAuthConfigured_() {
  return AUTH_TOKEN && AUTH_TOKEN.length >= 12 && AUTH_TOKEN !== 'WEALTH_AI_SYNC';
}

function _checkAuth_(token) {
  // FIX L43: previously `if (body.authToken && body.authToken !== AUTH_TOKEN)`
  // — a POST with NO authToken field bypassed the check entirely and was
  // handled as authorized. Now REQUIRE the token to match.
  if (!_isAuthConfigured_()) {
    return { ok: false, error: 'AUTH_TOKEN not configured — set a strong secret in Code.gs' };
  }
  if (token !== AUTH_TOKEN) {
    return { ok: false, error: 'unauthorized' };
  }
  return null;
}

// Sheet/tab used as a tiny key→value store.
var SHEET_NAME = 'WealthAISync';
var PORTFOLIO_KEY = 'portfolio';
var GROQ_KEY = 'groqKey';

// FIX: Google Sheets cells have a 50,000 character limit. Large portfolios
// (20+ positions) can exceed this → JSON gets silently truncated →
// loadFromCloud fails to parse → assets lost. We chunk the portfolio JSON
// across multiple rows: portfolio_0, portfolio_1, portfolio_2, etc.
var CHUNK_SIZE = 40000; // 40K chars per chunk (safe margin below 50K limit)

function _store_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange('A1:B1').setValues([['key', 'value']]);
  }
  return sh;
}

function _set_(key, value) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function _delete_(key) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function _get_(key) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return '';
}

// ---- Chunked storage for large portfolio data ----
// Splits the JSON string into chunks of CHUNK_SIZE and stores each
// as portfolio_0, portfolio_1, portfolio_2, etc. Old chunks are
// cleaned up before writing new ones.
function _setChunked_(key, jsonString) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();

  // Delete old chunks for this key
  var rowsToDelete = [];
  for (var i = 1; i < data.length; i++) {
    var k = data[i][0];
    if (k === key || (k && k.indexOf(key + '_') === 0)) {
      rowsToDelete.push(i + 1); // 1-indexed row number
    }
  }
  // Delete from bottom up to not shift row indices
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sh.deleteRow(rowsToDelete[j]);
  }

  // If the string fits in one cell, just write it directly
  if (jsonString.length <= CHUNK_SIZE) {
    _set_(key, jsonString);
    return;
  }

  // Split into chunks and write each as key_0, key_1, etc.
  var numChunks = Math.ceil(jsonString.length / CHUNK_SIZE);
  for (var c = 0; c < numChunks; c++) {
    var chunk = jsonString.substring(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
    _set_(key + '_' + c, chunk);
  }
  // Store metadata: how many chunks
  _set_(key + '_meta', String(numChunks));
}

// Read chunked data back and reassemble
function _getChunked_(key) {
  // Try single-cell read first (for small portfolios or legacy data)
  var direct = _get_(key);
  if (direct && direct.length > 0) {
    // Check if there's also a _meta key (indicating chunked storage)
    var meta = _get_(key + '_meta');
    if (!meta) {
      // Legacy single-cell storage — return as-is
      return direct;
    }
  }

  // Check for chunked storage
  var meta = _get_(key + '_meta');
  if (meta) {
    var numChunks = parseInt(meta, 10);
    if (numChunks > 0) {
      var assembled = '';
      for (var c = 0; c < numChunks; c++) {
        var chunk = _get_(key + '_' + c);
        if (chunk) assembled += chunk;
      }
      return assembled;
    }
  }

  // Fall back to direct read (legacy)
  return direct || '';
}

function _json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------- POST (primary path) ----------------
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var authErr = _checkAuth_(body.authToken);
    if (authErr) return _json_(authErr);
    return _handle_(body);
  } catch (err) {
    return _json_({ ok: false, error: String(err) });
  }
}

// ---------------- GET (load + no-cors fallback) ----------------
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var authErr = _checkAuth_(p.authToken);
    if (authErr) return _json_(authErr);
    // no-cors POST fallback arrives as ?action=update&data=<json>
    if (p.action === 'update' && p.data) {
      var parsed = JSON.parse(p.data);
      return _handle_({ action: 'update', portfolio: parsed.portfolio, usdInr: parsed.usdInr });
    }
    return _handle_(p);
  } catch (err) {
    return _json_({ ok: false, error: String(err) });
  }
}

// ---------------- shared action router ----------------
function _handle_(req) {
  var action = req.action || 'load';

  if (action === 'update') {
    // FIX: Use chunked storage to handle portfolios >50K chars
    var jsonStr = JSON.stringify({
      portfolio: req.portfolio || [],
      usdInr: req.usdInr || 0,
      timestamp: req.timestamp || Date.now()
    });
    _setChunked_(PORTFOLIO_KEY, jsonStr);
    return _json_({ ok: true, saved: (req.portfolio || []).length });
  }

  if (action === 'saveKey') {
    _set_(GROQ_KEY, req.groqKey || '');
    return _json_({ ok: true });
  }

  if (action === 'loadKey') {
    return _json_({ groqKey: _get_(GROQ_KEY) || '' });
  }

  // default: load
  var raw = _getChunked_(PORTFOLIO_KEY);
  if (!raw) return _json_({ portfolio: [] });
  try {
    return _json_(JSON.parse(raw));
  } catch (err) {
    // If JSON.parse fails, try to return whatever we have with an error flag
    return _json_({ portfolio: [], error: 'Failed to parse portfolio data: ' + String(err) });
  }
}
