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
// preflight. The auth token travels in the request body/parameters.
// ============================================================
var AUTH_TOKEN = ''; // Optional secret token (min 12 chars). Leave empty or set to custom secret.

function _checkAuth_(token) {
  // Allow default mode if AUTH_TOKEN is empty or WEALTH_AI_SYNC
  if (!AUTH_TOKEN || AUTH_TOKEN.length === 0 || AUTH_TOKEN === 'WEALTH_AI_SYNC') {
    return null;
  }
  if (token !== AUTH_TOKEN) {
    return { ok: false, error: 'unauthorized' };
  }
  return null;
}

// Sheet/tab used as key→value store.
var SHEET_NAME = 'WealthAISync';
var PORTFOLIO_KEY = 'portfolio';
var GROQ_KEY = 'groqKey';

// Chunk size limit to prevent Google Sheets 50,000 character cell truncation
var CHUNK_SIZE = 40000;

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
function _setChunked_(key, jsonString) {
  var sh = _store_();
  var data = sh.getDataRange().getValues();

  var rowsToDelete = [];
  for (var i = 1; i < data.length; i++) {
    var k = data[i][0];
    if (k === key || (k && k.indexOf(key + '_') === 0)) {
      rowsToDelete.push(i + 1);
    }
  }
  for (var j = rowsToDelete.length - 1; j >= 0; j--) {
    sh.deleteRow(rowsToDelete[j]);
  }

  if (jsonString.length <= CHUNK_SIZE) {
    _set_(key, jsonString);
    return;
  }

  var numChunks = Math.ceil(jsonString.length / CHUNK_SIZE);
  for (var c = 0; c < numChunks; c++) {
    var chunk = jsonString.substring(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
    _set_(key + '_' + c, chunk);
  }
  _set_(key + '_meta', String(numChunks));
}

function _getChunked_(key) {
  var direct = _get_(key);
  if (direct && direct.length > 0) {
    var meta = _get_(key + '_meta');
    if (!meta) return direct;
  }

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

  return direct || '';
}

// Scan all non-WealthAISync sheets for user-entered tabular portfolio data
function _parseSheetRows_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var items = [];

    for (var s = 0; s < sheets.length; s++) {
      var sh = sheets[s];
      if (sh.getName() === SHEET_NAME) continue;

      var data = sh.getDataRange().getValues();
      if (!data || data.length < 2) continue;

      var headerRow = data[0];
      var symIdx = -1, qtyIdx = -1, priceIdx = -1, marketIdx = -1, dateIdx = -1;

      for (var col = 0; col < headerRow.length; col++) {
        var h = String(headerRow[col] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (symIdx < 0 && (h === 'symbol' || h === 'ticker' || h === 'stock' || h === 'asset' || h === 'company' || h === 'companyname' || h === 'stockname' || h === 'assetname' || h === 'name' || h === 'scrip' || h === 'instrument' || h === 'particulars')) symIdx = col;
        if (qtyIdx < 0 && (h === 'qty' || h === 'quantity' || h === 'shares' || h === 'units' || h === 'noofshares' || h === 'numshares' || h === 'totalqty' || h === 'count' || h === 'holding' || h === 'holdings' || h === 'nos' || h === 'volume')) qtyIdx = col;
        if (priceIdx < 0 && (h === 'avgprice' || h === 'buyprice' || h === 'price' || h === 'cost' || h === 'avg' || h === 'averageprice' || h === 'buyingprice' || h === 'purchaseprice' || h === 'buyrate' || h === 'rate' || h === 'costprice' || h === 'avgcost' || h === 'entryprice' || h === 'unitprice')) priceIdx = col;
        if (marketIdx < 0 && (h === 'market' || h === 'exchange' || h === 'type' || h === 'segment' || h === 'country')) marketIdx = col;
        if (dateIdx < 0 && (h === 'dateadded' || h === 'date' || h === 'buydate' || h === 'purchasedate' || h === 'time')) dateIdx = col;
      }

      if (symIdx >= 0 && (qtyIdx >= 0 || priceIdx >= 0)) {
        for (var r = 1; r < data.length; r++) {
          var row = data[r];
          var sym = String(row[symIdx] || '').trim();
          if (!sym) continue;

          var qtyVal = qtyIdx >= 0 ? row[qtyIdx] : 1;
          var priceVal = priceIdx >= 0 ? row[priceIdx] : 0;
          var marketVal = marketIdx >= 0 ? String(row[marketIdx] || '').trim() : '';
          var dateVal = dateIdx >= 0 ? String(row[dateIdx] || '').trim() : '';

          var cleanQty = parseFloat(String(qtyVal).replace(/[^0-9.-]/g, ''));
          var cleanPrice = parseFloat(String(priceVal).replace(/[^0-9.-]/g, ''));

          if (!isNaN(cleanQty) && cleanQty > 0 && !isNaN(cleanPrice) && cleanPrice > 0) {
            var cleanSym = sym.toUpperCase();
            var market = (marketVal === 'US' || marketVal === 'IN')
              ? marketVal
              : (cleanSym.indexOf('.NS') >= 0 || cleanSym.indexOf('.BO') >= 0 ? 'IN' : 'US');

            items.push({
              symbol: cleanSym,
              qty: cleanQty,
              avgPrice: cleanPrice,
              market: market,
              dateAdded: dateVal || new Date().toISOString().split('T')[0]
            });
          }
        }
        if (items.length > 0) break;
      }
    }
    return items;
  } catch (err) {
    return [];
  }
}

// Render a human-readable "Portfolio" sheet tab for visual inspection in Google Sheets
function _updateHumanReadableSheet_(portfolio) {
  if (!portfolio || !Array.isArray(portfolio) || portfolio.length === 0) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Portfolio');
    if (!sh) {
      sh = ss.insertSheet('Portfolio');
    }

    sh.clearContents();
    var rows = [
      ['Symbol', 'Market', 'Quantity', 'Avg Price', 'Date Added', 'Est Total Value']
    ];

    for (var i = 0; i < portfolio.length; i++) {
      var p = portfolio[i];
      var qty = parseFloat(p.qty) || 0;
      var price = parseFloat(p.avgPrice) || 0;
      rows.push([
        p.symbol || '',
        p.market || '',
        qty,
        price,
        p.dateAdded || '',
        qty * price
      ]);
    }

    sh.getRange(1, 1, rows.length, 6).setValues(rows);
    sh.getRange('A1:F1').setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    if (portfolio.length > 0) {
      sh.getRange(2, 4, portfolio.length, 1).setNumberFormat('#,##0.00');
      sh.getRange(2, 6, portfolio.length, 1).setNumberFormat('#,##0.00');
    }
  } catch (e) {
    // Non-critical formatting error
  }
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
    var jsonStr = JSON.stringify({
      portfolio: req.portfolio || [],
      usdInr: req.usdInr || 0,
      timestamp: req.timestamp || Date.now()
    });
    _setChunked_(PORTFOLIO_KEY, jsonStr);
    _updateHumanReadableSheet_(req.portfolio || []);
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
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.portfolio && Array.isArray(parsed.portfolio) && parsed.portfolio.length > 0) {
        return _json_(parsed);
      }
    } catch (err) {
      // Fall through to sheet table scan
    }
  }

  // Fallback: Scan sheet tabs for tabular row data (e.g. user typed rows into Google Sheets)
  var rowsData = _parseSheetRows_();
  if (rowsData && rowsData.length > 0) {
    return _json_({ portfolio: rowsData });
  }

  if (!raw) return _json_({ portfolio: [] });
  try {
    return _json_(JSON.parse(raw));
  } catch (err) {
    return _json_({ portfolio: [], error: 'Failed to parse portfolio data: ' + String(err) });
  }
}
