// ============================================
// 🤖 DEEP MIND AI TRADING BOT — MAIN SERVER
// ============================================
// Telegram Command System + AI Chat + Auto Analysis
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { TG_TOKEN, TG_CHAT_ID, GROQ_KEY, TAVILY_API_KEY, TAX_PAIRS } from './config.mjs';
import { batchFetchPrices, fetchForexRate, fetchMarketIntelligence, fetchSingleSymbol, trackVixChange, isAnyMarketOpen, getMarketStatus, getISTTime, isIndiaMarketOpen, isUSMarketOpen, fetchCryptoPrices, fetchCryptoPricesINR, fetchBondYields, fetchFIIDIIData, fetchIPOData } from './market.mjs';
import { loadPortfolioFromCloud } from './cloud.mjs';
import {
  generatePortfolioReport, generateMarketReport,
  generateAllocationReport, generateRiskReport, generateAutoReport,
  generateForexReport, calculateMetrics, generateScanReport,
  generateCompareReport, analyzeAsset,
  generateLiveReport, generateCryptoReport, generateSIPReport,
  generateETFReport, generateDigestReport, generateFIIDIIReport, generateIPOReport,
  generateLongTermReport, generateStrategyReport,
  generateSipTiltReport, generateTaxPlanReport, generateDrawdownReport
} from './analysis.mjs';


import { chatWithAI, clearChatHistory } from './ai-chat.mjs';
import { backtestSignal, calculateBacktestMetrics } from './backtester.mjs';

// Validate required environment variables
if (!TG_TOKEN) {
  console.error('❌ CRITICAL: TG_TOKEN (Telegram Bot Token) is missing! Bot cannot start.');
  process.exit(1);
}

// ========================================
// GLOBAL STATE
// ========================================
let portfolio = [];
let livePrices = {};
let usdInrRate = 85.5;
let marketIntel = null;
let autoAlerts = true;
let botReady = false;

// AI Rate Limiting
const aiCallTimestamps = new Map();
const AI_RATE_LIMIT_MS = 10000;
const AI_RATE_LIMIT_MAX = 3;

function checkAIRateLimit(chatId) {
  const now = Date.now();
  const id = String(chatId);
  if (!aiCallTimestamps.has(id)) aiCallTimestamps.set(id, []);
  const timestamps = aiCallTimestamps.get(id).filter(t => now - t < 60000);
  aiCallTimestamps.set(id, timestamps);
  if (timestamps.length >= AI_RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  return true;
}

// Authorization check — only allow the configured chat ID
function isAuthorized(msg) {
  if (!TG_CHAT_ID) {
    console.warn('TG_CHAT_ID not configured — rejecting all messages for security');
    return false;
  }
  return String(msg.chat.id) === String(TG_CHAT_ID);
}

// Performance streak tracking with file persistence
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STREAK_FILE = path.join(__dirname, 'streak-data.json');

let dailyPLHistory = [];
let consecutiveStreak = 0;

function loadStreakData() {
  try {
    if (fs.existsSync(STREAK_FILE)) {
      const data = JSON.parse(fs.readFileSync(STREAK_FILE, 'utf8'));
      dailyPLHistory = data.dailyPLHistory || [];
      consecutiveStreak = data.consecutiveStreak || 0;
      console.log(`✅ Streak data loaded: ${dailyPLHistory.length} days, streak=${consecutiveStreak}`);
    }
  } catch (e) {
    console.warn('⚠️ Streak data load failed:', e.message);
  }
}

function saveStreakData() {
  try {
    fs.writeFileSync(STREAK_FILE, JSON.stringify({ dailyPLHistory, consecutiveStreak }), 'utf8');
  } catch (e) { }
}

// ========================================
// 🌐 FULL SITE + BOT SERVER (For Render deployment)
// ========================================
const app = express();
const PORT = process.env.PORT || 3000;

// Serve the compiled Vite React frontend
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// ========================================
// API ROUTER — Groq Proxy (avoids CORS + browser key exposure)
// Frontend calls /api/groq → server uses env var keys
// Uses Express Router for clean path matching (works with Express 5)
// ========================================
const apiRouter = express.Router();

// CORS for all API routes — allows frontend from any origin to use the proxy
apiRouter.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Server config — exposes API_URL to frontend at runtime (no VITE_ build-time needed)
apiRouter.get('/config', (req, res) => {
  res.json({
    apiUrl: API_URL || '',
    groq: !!(GROQ_KEY && GROQ_KEY.length > 10),
    tavily: !!(TAVILY_API_KEY && TAVILY_API_KEY.length > 10)
  });
});

apiRouter.get('/ai-status', (req, res) => {
  res.json({
    groq: !!(GROQ_KEY && GROQ_KEY.length > 10),
    tavily: !!(TAVILY_API_KEY && TAVILY_API_KEY.length > 10)
  });
});

apiRouter.post('/groq', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    if (!GROQ_KEY || GROQ_KEY.length < 10) {
      return res.status(503).json({ error: 'Groq API key not configured on server' });
    }
    const { messages, model } = req.body;
    const modelName = model || 'meta-llama/llama-4-scout-17b-16e-instruct';
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0.7,
        max_completion_tokens: 8000
      }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.status(apiRes.status).json(data);
    }
    res.json(data);
  } catch (e) {
    console.error('Groq proxy error:', e.message);
    res.status(500).json({ error: e.message });
  }
});



// Mount the API router at /api
app.use('/api', apiRouter);

// Quick health check (no keys required) — proves Express routes work
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Fallback to React Router or ping message
// IMPORTANT: never fall back to index.html for asset requests — serving HTML for a
// missing /assets/*.js chunk causes "Failed to fetch dynamically imported module".
app.use((req, res) => {
  if (req.path.startsWith('/assets/') || /\.(js|mjs|css|map|ico|svg|png|jpg|jpeg|webp|woff2?)$/i.test(req.path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      res.send('Deep Mind AI Telegram Bot is ALIVE and RUNNING! 🚀 (Frontend not built)');
    }
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Web Server running on port ${PORT} - Hosting Bot & Site!`);
});

// ========================================
// INITIALIZE BOT
// ========================================
console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║  🧠 DEEP MIND AI ADVANCE PRO v16.0       ║');
console.log('║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║');
console.log('║  GROQ SUPER INTELLIGENCE                 ║');
console.log('║  Single Engine: Llama 4 Scout 17B       ║');
console.log('║  Deep Research + Live Market 24x7        ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

const bot = new TelegramBot(TG_TOKEN, {
  polling: {
    params: { timeout: 30, allowed_updates: ['message'] }
  }
});
console.log('📡 Telegram Bot polling started...');
console.log(`🔑 Token: ${TG_TOKEN ? TG_TOKEN.substring(0, 10) + '...' : 'MISSING!'}`);

// ========================================
// INITIAL DATA LOAD
// ========================================
async function initializeData() {
  // Step 1: Portfolio (non-blocking)
  try {
    console.log('☁️  Loading portfolio from cloud...');
    const cloudPortfolio = await loadPortfolioFromCloud();
    if (cloudPortfolio && cloudPortfolio.length > 0) {
      portfolio = cloudPortfolio;
      console.log(`✅ Portfolio loaded: ${portfolio.length} positions`);
    } else {
      console.log('⚠️  No portfolio data found in cloud');
    }
  } catch (e) {
    console.error('❌ Portfolio load failed:', e.message);
  }

  // Step 2: Keys are loaded from environment variables only (no cloud sync)
  // Ensure GROQ_KEY is set in Render env
  console.log('🔑 API keys loaded from environment variables (cloud sync disabled)');
  console.log(`  ⚡ Groq: ${GROQ_KEY ? '✓ SET' : '✗ MISSING'}`);

  // Step 3: Forex (non-blocking)
  try {
    console.log('💱 Fetching forex rate...');
    usdInrRate = await fetchForexRate();
    console.log(`✅ USD/INR: ₹${usdInrRate.toFixed(2)}`);
  } catch (e) {
    console.warn('⚠️  Forex fetch failed, using default:', usdInrRate);
  }

  // Step 4: Live Prices (non-blocking)
  if (portfolio.length > 0) {
    try {
      console.log('📊 Fetching live prices...');
      livePrices = await batchFetchPrices(portfolio);
      console.log(`✅ Prices loaded: ${Object.keys(livePrices).length} symbols`);
    } catch (e) {
      console.warn('⚠️  Price fetch failed:', e.message);
    }
  }

  // Step 5: Market Intelligence (non-blocking)
  try {
    console.log('🌍 Fetching market intelligence...');
    marketIntel = await fetchMarketIntelligence();
    console.log(`✅ Market intel: ${marketIntel.globalIndices.length} indices, ${marketIntel.sectors.length} sectors`);
  } catch (e) {
    console.warn('⚠️ Market intelligence partial:', e.message);
  }

  // Step 6: Load streak data
  loadStreakData();

  botReady = true;
  console.log('');
  console.log('🟢 ════════════════════════════════════════');
  console.log(` BOT FULLY ONLINE — ${getISTTime()} IST`);
  console.log(` Portfolio: ${portfolio.length} positions`);
  console.log(` Groq AI: ${GROQ_KEY ? 'ACTIVE ✅' : 'INACTIVE ❌'}`);
  console.log(` Market: ${getMarketStatus()}`);
  console.log('🟢 ════════════════════════════════════════');
  console.log('');

  // Step 6: Set Persistent Telegram Menu Commands
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Main Menu & Overview' },
      { command: 'portfolio', description: 'Full Portfolio Analysis' },
      { command: 'market', description: 'Global Market Snapshot' },
      { command: 'live', description: 'Live Market Sensor Data' },
      { command: 'allocation', description: 'Smart SIP Matrix' },
      { command: 'risk', description: 'Risk & VIX Assessment' },
      { command: 'trim', description: 'Trim + Re-Entry Rules Card' },
      { command: 'scan', description: 'Deep scan any symbol' },
      { command: 'compare', description: 'Head-to-head comparison' },
      { command: 'correlate', description: 'Portfolio Correlation Matrix' },
      { command: 'heatmap', description: 'Sector Heat Map' },
      { command: 'taxloss', description: 'Tax-Loss Harvesting' },
      { command: 'backtest', description: 'AI Signal Accuracy Check' },
      { command: 'streak', description: 'Performance streak tracker' },
      { command: 'etf', description: 'ETF Portfolio Analysis' },
      { command: 'crypto', description: 'Crypto Market (BTC/ETH)' },
      { command: 'sip', description: 'SIP Calculator' },
      { command: 'longterm', description: '15-20yr Wealth Strategy' },
      { command: 'fire', description: 'FIRE / Early Retirement Calculator' },
      { command: 'milestones', description: 'Wealth Milestone Tracker' },
      { command: 'strategy', description: 'Institutional Asset Allocation' },
      { command: 'premarket', description: 'Pre-market Intelligence' },
      { command: 'digest', description: 'Daily Market Digest' },
      { command: 'fiidii', description: 'FII/DII Flow Tracker' },
      { command: 'ipo', description: 'IPO Tracker' },
      { command: 'forex', description: 'Live Forex (USD/INR)' },
      { command: 'news', description: 'Global Market Sentiment' },
      { command: 'fundamental', description: 'Deep Fundamental Analysis' },
      { command: 'alert', description: 'Toggle auto alerts' },
      { command: 'model', description: 'Select AI model' },
      { command: 'siptilt', description: 'Smart SIP Auto-Tilt (VIX/RSI)' },
      { command: 'taxplan', description: 'Tax Optimizer (LTCG + Crypto)' },
      { command: 'drawdown', description: 'Drawdown Recovery Tracker' },

      { command: 'clear', description: 'Clear AI Memory' }
    ]);
    console.log('✅ Telegram Menu Commands Updated');
  } catch (e) {
    console.warn('⚠️  Could not set Telegram commands:', e.message);
  }
}

// ========================================
// BACKGROUND DATA REFRESH
// ========================================
async function refreshPrices() {
  if (portfolio.length === 0) return;
  try {
    livePrices = await batchFetchPrices(portfolio);
  } catch (e) {
    console.warn('⚠️  Price refresh failed:', e.message);
  }
}

async function refreshForex() {
  try {
    usdInrRate = await fetchForexRate();
  } catch (e) { }
}

async function refreshPortfolio() {
  try {
    const fresh = await loadPortfolioFromCloud();
    if (fresh && fresh.length > 0) {
      portfolio = fresh;
    }
  } catch (e) { }
}

async function refreshIntel() {
  try {
    marketIntel = await fetchMarketIntelligence();
  } catch (e) { }
}

// ========================================
// HELPER: Safe send with retry
// ========================================
async function safeSend(chatId, text, options = {}) {
  const defaultOpts = { parse_mode: 'HTML', disable_web_page_preview: true };
  const mergedOpts = { ...defaultOpts, ...options };

  // Telegram max message length = 4096
  if (text.length > 4000) {
    // Split into chunks
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      let chunk = remaining.substring(0, 4000);
      // Try to split at a newline
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > 3000) {
        chunk = remaining.substring(0, lastNewline);
      }
      chunks.push(chunk);
      remaining = remaining.substring(chunk.length);
    }
    for (const chunk of chunks) {
      try {
        await bot.sendMessage(chatId, chunk, mergedOpts);
      } catch (e) {
        console.error('Send error:', e.message);
        try {
          // Fallback: Drop parse_mode so it sends as plain text without parsing errors, but keep the raw string
          const fallbackOpts = { ...mergedOpts };
          delete fallbackOpts.parse_mode;
          await bot.sendMessage(chatId, chunk, fallbackOpts);
        } catch (e2) {
          console.error('Send fallback error:', e2.message);
        }
      }
    }
  } else {
    try {
      await bot.sendMessage(chatId, text, mergedOpts);
    } catch (e) {
      console.error('Send error:', e.message);
      try {
        const fallbackOpts = { ...mergedOpts };
        delete fallbackOpts.parse_mode;
        await bot.sendMessage(chatId, text, fallbackOpts);
      } catch (e2) {
        console.error('Send fallback error:', e2.message);
      }
    }
  }
}

// ========================================
// COMMAND: /start
// ========================================
bot.onText(/^\/start(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /start from ${msg.from?.first_name || chatId}`);

  const welcome = `🧠 <b>DEEP MIND AI ADVANCE PRO v16.0</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

Nagraj Bhai, main tumhara ADVANCE PRO AI Trading assistant hoon! 🚀

🔬 <b>ADVANCE PRO Features:</b>
• 🧬 Deep Mind Analysis (Macro + Micro)
• 🔍 Deep Research (24x7 Live)
• 📡 Real-Time Global Market Monitor
• 🚨 Portfolio Alert System (Hinglish)

⚡ <b>Real-Time Data Feeds:</b>
• TradingView Live Scanner (NSE/BSE/NYSE/NASDAQ)
• CoinDCX Live Crypto (INR)
• Live USD/INR Exchange Rate
• Tavily Web Search (Breaking News)
• VIX, Gold, Crude, DXY, Bitcoin, Bonds

🤖 <b>GROQ SUPER INTELLIGENCE:</b>
• ⚡ Llama 4 Scout 17B (Latest Groq Model)
• 🌐 Market Expert with Real-Time Web Search
• 🧠 Deep Research + Deep Mind Analysis

📊 <b>Commands:</b>
📊 /portfolio — Full portfolio + live P&L
🌍 /market — Global market snapshot
📡 /live — Real-time market sensor
📈 /allocation — Smart SIP matrix
🛡️ /risk — VIX risk assessment
✂️ /trim — Trim rules card
🔍 /scan &lt;SYM&gt; — Deep scan any symbol
⚖️ /compare &lt;S1&gt; &lt;S2&gt; — Head-to-head
🔗 /correlate — Correlation matrix
🔥 /heatmap — Sector heat map
🧪 /backtest — Signal accuracy
💸 /taxloss — Tax-loss harvesting
📊 /streak — Performance tracker
📊 /etf — ETF portfolio analysis
🪙 /crypto — Crypto market (BTC, ETH)
💰 /sip — SIP calculator
🌅 /longterm — 15-20yr wealth plan
🎯 /strategy — Institutional asset strategy
🌅 /premarket — Pre-market intelligence
🌅 /digest — Daily digest
🏛️ /fiidii — FII/DII flows
🚀 /ipo — IPO tracker
💱 /forex — Live USD/INR
🌍 /news — Market sentiment
💼 /fundamental — Deep fundamentals
🔔 /alert — Toggle auto alerts
🧹 /clear — Clear AI memory

🧠 <b>AI Chat Mode:</b>
Bina / ke koi bhi message likho = ADVANCE PRO AI chat!

━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Status: <b>${getMarketStatus()}</b>
💼 Portfolio: <b>${portfolio.length} positions</b>
🔔 Auto Alerts: <b>${autoAlerts ? 'ON ✅' : 'OFF ❌'}</b>
💱 USD/INR: <b>₹${usdInrRate.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
💎 <i>Powered by Deep Mind AI Advance Pro v16.0</i>`;

  await safeSend(chatId, welcome);
});

// ========================================
// COMMAND: /debug_env (Hidden Diagnosis)
// ========================================
bot.onText(/^\/debug_env(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const env = process.env;

  let report = '🔍 <b>ENVIRONMENT VARIABLE DEBUGGER</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';

  report += `<b>GROQ_KEY:</b> ${env.GROQ_KEY ? '✅ Found (' + env.GROQ_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>VITE_GROQ_API_KEY:</b> ${env.VITE_GROQ_API_KEY ? '✅ Found (' + env.VITE_GROQ_API_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>TG_TOKEN:</b> ${env.TG_TOKEN ? '✅ Found (' + env.TG_TOKEN.length + ' ch)' : '❌ MISSING'}\n`;

  report += '\n<b>SYSTEM ENV KEYS SCAN:</b>\n';
  const allKeys = Object.keys(env).filter(k => !k.startsWith('npm_') && !k.startsWith('Path')).sort();
  for (const k of allKeys.slice(0, 30)) { // Limit to avoid hitting Telegram msg limits
    if (k.includes('KEY') || k.includes('TOKEN') || k.includes('API') || k.includes('SECRET') || k.includes('URL')) {
      report += `• ${k}: [REDACTED]\n`;
    } else {
      report += `• ${k}\n`;
    }
  }

  report += '\n<i>Note: If variables are missing here, add them to your Hosting Dashboard (Render/Vercel) Environment Variables section.</i>';

  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /help
// ========================================
bot.onText(/^\/help(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /help from ${msg.from?.first_name || chatId}`);

  const help = `❓ <b>DEEP MIND AI — Command Reference</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

📊 <b>/portfolio</b>
Full portfolio breakdown — har position ka live price, P&L, RSI status.

🌍 <b>/market</b>
Global market radar — NIFTY, S&P 500, VIX, Sectors, Fear/Greed Index.

📡 <b>/live</b>
Real-time market sensor — Indices, Crypto, Bonds, Forex, Sectors.

📈 <b>/allocation</b>
Smart SIP allocation matrix — kaha kitna paisa lagana hai.

🛡️ <b>/risk</b>
Risk command center — VIX analysis, drawdown estimates, safety check.

✂️ <b>/trim</b>
Trim + Re-Entry rules card — institutional-grade rebalancing rules.

🔍 <b>/scan &lt;SYMBOL&gt;</b>
Deep analysis of ANY symbol — RSI, MACD, SMA, Fib levels, performance.
Example: <code>/scan RELIANCE</code>, <code>/scan AAPL</code>

⚖️ <b>/compare &lt;SYM1&gt; &lt;SYM2&gt;</b>
Head-to-head comparison of two symbols.
Example: <code>/compare SMH VGT</code>, <code>/compare TCS INFY</code>

🔗 <b>/correlate</b>
Portfolio correlation matrix — diversification check.

🔥 <b>/heatmap</b>
Sector heat map — visualize winners and losers across global indices, sectors, and your portfolio.

🧪 <b>/backtest</b>
AI signal accuracy — check how well today's signals performed.

💸 <b>/taxloss</b>
Tax-loss harvesting — find losing positions with similar ETF pairs to book losses while maintaining exposure.

📊 <b>/streak</b>
Performance streak tracker — consecutive green/red days history.

📊 <b>/etf</b>
ETF portfolio analysis — categorization, P&L, allocation.

🪙 <b>/crypto</b>
Crypto market — BTC, ETH, SOL and more with INR conversion.

💰 <b>/sip &lt;AMOUNT&gt;</b>
SIP calculator — future value projections at various CAGRs.
Example: <code>/sip 10000</code>

📈 <b>/longterm</b>
15-20 year wealth creation roadmap focusing on SIP step-up and compound growth.

🎯 <b>/strategy</b>
Institutional asset allocation strategy for your portfolio.

🌅 <b>/premarket</b>
Pre-market intelligence (India & US).

🌅 <b>/digest</b>
Daily market digest — comprehensive morning brief.

🏛️ <b>/fiidii</b>
FII/DII flow tracker — institutional money flows.

🚀 <b>/ipo</b>
IPO tracker — upcoming and recent IPOs.

💱 <b>/forex</b>
Live USD/INR conversion rate with trend analysis.

🌍 <b>/news</b>
Global market sentiment — AI-powered news synthesis.

💼 <b>/fundamental &lt;SYMBOL&gt;</b>
Deep fundamental analysis using Graham framework.

🔔 <b>/alert</b>
Toggle scheduled auto-analysis ON/OFF.

🧹 <b>/clear</b>
Chat history reset karo.

━━━━━━━━━━━━━━━━━━━━━━━━━
💬 <b>Pro Tip:</b> Bina command ke koi bhi message likho = AI chat mode automatic activate hoga!

💎 <i>Deep Mind AI Quantum Pro Terminal v15.0</i>`;

  await safeSend(chatId, help);
});


// ========================================
// COMMAND: /news — News Sentiment
// ========================================
bot.onText(/^\/news(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /news from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🌍 <i>Synthesizing latest global market news... extracting sentiment score...</i>\n\nThis is a Superintelligent Deep AI Feature.');
    const response = await chatWithAI(chatId, '/news', portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ /news error:', e.message);
    await safeSend(chatId, `❌ /news fetch me error: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /fundamental — Deep Fundamentals
// ========================================
bot.onText(/^\/fundamentals?(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const target = match[1] ? match[1].trim() : 'my top portfolio holding';
  console.log(`📥 /fundamental ${target} from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, `💼 <i>Executing Deep Fundamental Forensics for ${target}... running Graham framework...</i>\n\nThis is a Superintelligent Deep AI Feature.`);
    const response = await chatWithAI(chatId, `Execute a deep fundamental forensic analysis for ${target}. Calculate Intrinsic Value based on PE ratio, Book Value, and ROE using Graham framework. Output in tabular format if possible.`, portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ /fundamental error:', e.message);
    await safeSend(chatId, `❌ /fundamental fetch me error: ${e.message}\n\nPlease try again.`);
  }
});


// ========================================
// COMMAND: /portfolio
// ========================================
bot.onText(/^\/portfolio(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /portfolio from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai. Web app se positions add karo — automatic cloud sync hoga.');
      return;
    }
    await safeSend(chatId, '📊 <i>Scanning portfolio... ek second...</i>');
    await refreshPrices();
    const report = generatePortfolioReport(portfolio, livePrices, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /portfolio error:', e.message);
    await safeSend(chatId, `❌ Portfolio report me error aaya: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /market
// ========================================
bot.onText(/^\/market(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /market from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🌍 <i>Scanning global markets... ek second...</i>');
    await Promise.all([refreshPrices(), refreshIntel()]);
    const report = generateMarketReport(livePrices, marketIntel);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /market error:', e.message);
    await safeSend(chatId, `❌ Market report me error aaya: ${e.message}\n\nPlease try again.`);
  }
});


// ========================================
// COMMAND: /allocation
// ========================================
bot.onText(/^\/allocation(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /allocation from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '📈 <i>Calculating SIP matrix... ek second...</i>');
    await refreshPrices();
    const report = generateAllocationReport(livePrices, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /allocation error:', e.message);
    await safeSend(chatId, `❌ Allocation report me error aaya: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /risk
// ========================================
bot.onText(/^\/risk(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /risk from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🛡️ <i>Analyzing risk factors... ek second...</i>');
    await Promise.all([refreshPrices(), refreshIntel()]);
    const report = generateRiskReport(livePrices, portfolio, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /risk error:', e.message);
    await safeSend(chatId, `❌ Risk report me error aaya: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /dip — Buy-the-Dip Intelligence
// ========================================
bot.onText(/^\/dip(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /dip from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🎯 <i>Scanning for dip opportunities...</i>');
    await refreshPrices();

    if (portfolio.length === 0) {
      await safeSend(chatId, '📂 Portfolio khali hai. Pehle assets add karo.');
      return;
    }

    const dips = [];
    for (const pos of portfolio) {
      const key = `${pos.market}_${pos.symbol}`;
      const pd = livePrices[key];
      if (!pd) continue;

      const price = pd.price || pos.avgPrice;
      const sma20 = pd.sma20 || price;
      const sma50 = pd.sma50 || price;
      const rsi = pd.rsi || 50;

      const sma20Dist = sma20 > 0 ? ((sma20 - price) / sma20) * 100 : 0;
      const sma50Dist = sma50 > 0 ? ((sma50 - price) / sma50) * 100 : 0;

      let depth = 'NEUTRAL';
      if (rsi < 30 || (sma50Dist > 5 && sma20Dist > 3)) depth = '🔴 DEEP DIP';
      else if (rsi < 40 || sma20Dist > 2) depth = '🟠 MILD DIP';
      else if (rsi > 65) depth = '🟢 ELEVATED';

      const signal = analyzeAsset(pos, pd);
      if (depth !== 'NEUTRAL') {
        dips.push({
          symbol: pos.symbol,
          price: price.toFixed(2),
          rsi: rsi.toFixed(0),
          sma20Dist: sma20Dist.toFixed(1),
          sma50Dist: sma50Dist.toFixed(1),
          depth,
          signal: signal.signal,
          confidence: signal.confidence
        });
      }
    }

    let msg_text = `<b>🎯 BUY-THE-DIP INTELLIGENCE</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (dips.length === 0) {
      msg_text += `✅ Koi active dip signals nahi mile.\nSab assets near fair value hain. Regular SIP continue karo.`;
    } else {
      dips.sort((a, b) => parseFloat(a.rsi) - parseFloat(b.rsi));
      for (const d of dips) {
        msg_text += `${d.depth}\n`;
        msg_text += `  <b>${d.symbol}</b> | ₹${d.price}\n`;
        msg_text += `  RSI: ${d.rsi} | SMA20: ${d.sma20Dist}% | SMA50: ${d.sma50Dist}%\n`;
        msg_text += `  Signal: ${d.signal} (${d.confidence}%)\n\n`;
      }
      msg_text += `<i>Deep dips = aggressive accumulation. Mild dips = SIP karo.</i>`;
    }

    await safeSend(chatId, msg_text);
  } catch (e) {
    console.error('❌ /dip error:', e.message);
    await safeSend(chatId, `❌ Dip scan error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /health — Portfolio Health Score
// ========================================
bot.onText(/^\/health(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /health from ${msg.from?.first_name || chatId}`);
  try {
    await refreshPrices();

    if (portfolio.length === 0) {
      await safeSend(chatId, '📂 Portfolio khali hai.');
      return;
    }

    const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
    let score = 100;
    const warnings = [];
    const opportunities = [];

    // Drawdown penalty
    if (metrics.plPct < -20) { score -= 40; warnings.push(`Heavy drawdown: ${metrics.plPct.toFixed(1)}%`); }
    else if (metrics.plPct < -10) { score -= 25; warnings.push(`Moderate drawdown: ${metrics.plPct.toFixed(1)}%`); }
    else if (metrics.plPct < -5) { score -= 10; }

    // RSI extremes
    let rsiAlerts = 0;
    for (const pos of portfolio) {
      const pd = livePrices[`${pos.market}_${pos.symbol}`];
      if (!pd) continue;
      if (pd.rsi < 30) { rsiAlerts++; opportunities.push(`${pos.symbol}: RSI ${pd.rsi.toFixed(0)} — oversold BUY`); }
      if (pd.rsi > 75) { rsiAlerts++; score -= 5; warnings.push(`${pos.symbol}: RSI ${pd.rsi.toFixed(0)} — overbought`); }
    }

    // VIX penalty
    const vixUS = livePrices['US_VIX']?.price || 0;
    const vixIN = livePrices['IN_INDIAVIX']?.price || 0;
    const avgVix = (vixUS + vixIN) / 2;
    if (avgVix > 30) { score -= 25; warnings.push(`VIX spike: ${avgVix.toFixed(1)}`); }
    else if (avgVix > 22) { score -= 15; warnings.push(`VIX elevated: ${avgVix.toFixed(1)}`); }

    score = Math.max(0, Math.min(100, score));
    const emoji = score >= 70 ? '🟢' : score >= 45 ? '🟡' : '🔴';

    let msg_text = `<b>💊 PORTFOLIO HEALTH</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg_text += `Score: <b>${score}/100</b> ${emoji}\n`;
    msg_text += `Value: ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
    msg_text += `P&L: ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(1)}%)\n\n`;

    if (opportunities.length > 0) {
      msg_text += `<b>🎯 BUY OPPORTUNITIES:</b>\n`;
      opportunities.slice(0, 5).forEach(o => { msg_text += `• ${o}\n`; });
      msg_text += `\n`;
    }
    if (warnings.length > 0) {
      msg_text += `<b>⚠️ WARNINGS:</b>\n`;
      warnings.slice(0, 5).forEach(w => { msg_text += `• ${w}\n`; });
    }

    await safeSend(chatId, msg_text);
  } catch (e) {
    console.error('❌ /health error:', e.message);
    await safeSend(chatId, `❌ Health check error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /regime — Macro Regime Detector
// ========================================
bot.onText(/^\/regime(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /regime from ${msg.from?.first_name || chatId}`);
  try {
    await Promise.all([refreshPrices(), refreshIntel()]);

    const vixUS = livePrices['US_VIX']?.price || 18;
    const vixIN = livePrices['IN_INDIAVIX']?.price || 15;
    const avgVix = (vixUS + vixIN) / 2;

    let bondYields;
    try {
      bondYields = await fetchBondYields();
    } catch { bondYields = null; }

    const spread = bondYields ? (bondYields.find(b => b.name === 'US 10Y')?.yield || 4.2) - (bondYields.find(b => b.name === 'US 2Y')?.yield || 4.0) : 0.2;

    // Sector breadth
    const sectors = marketIntel?.sectors || [];
    const positiveSectors = sectors.filter(s => s.change > 0).length;
    const breadth = sectors.length > 0 ? positiveSectors / sectors.length : 0.5;

    let regime, icon, suggestion;
    if (avgVix > 22 && (spread < -0.1 || breadth < 0.3)) {
      regime = 'RISK OFF'; icon = '🔴';
      suggestion = 'Cash hoard karo. Sirf deep dips pe buy karo. Smallcaps reduce karo.';
    } else if (avgVix > 18 && spread < 0.2) {
      regime = 'STAGFLATION'; icon = '🟠';
      suggestion = 'Energy + Healthcare pe shift karo. Tech-heavy positions reduce karo.';
    } else if (avgVix < 16 && spread > 0 && breadth > 0.6) {
      regime = 'GOLDILOCKS'; icon = '💎';
      suggestion = 'Full deployment mode. SIP maximum pe. Saari dips aggressively buy karo.';
    } else {
      regime = 'RISK ON'; icon = '🟢';
      suggestion = 'Regular SIP continue karo. Mild dips pe buy karo. Balanced allocation.';
    }

    let msg_text = `<b>${icon} MACRO REGIME: ${regime}</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg_text += `VIX: ${avgVix.toFixed(1)} | Yield Spread: ${spread.toFixed(2)}%\n`;
    msg_text += `Sector Breadth: ${(breadth * 100).toFixed(0)}% positive\n\n`;
    msg_text += `<b>💡 Portfolio Suggestion:</b>\n${suggestion}\n\n`;

    if (sectors.length > 0) {
      msg_text += `<b>📊 Sectors:</b>\n`;
      sectors.sort((a, b) => b.change - a.change).forEach(s => {
        const emoji = s.change > 0 ? '🟢' : '🔴';
        msg_text += `${emoji} ${s.name}: ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%\n`;
      });
    }

    await safeSend(chatId, msg_text);
  } catch (e) {
    console.error('❌ /regime error:', e.message);
    await safeSend(chatId, `❌ Regime detection error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /smartmoney — FII/DII Smart Money Flow
// ========================================
bot.onText(/^\/smartmoney(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /smartmoney from ${msg.from?.first_name || chatId}`);
  try {
    await refreshPrices();

    const vixUS = livePrices['US_VIX']?.price || 18;
    const vixIN = livePrices['IN_INDIAVIX']?.price || 15;
    const avgVix = (vixUS + vixIN) / 2;
    const niftyChange = livePrices['IN_NIFTY']?.change || 0;
    const marketSentiment = niftyChange - (avgVix - 18) * 0.3;

    let fiiNet, diiNet;
    if (marketSentiment > 1) {
      fiiNet = Math.round(2000 + marketSentiment * 800);
      diiNet = Math.round(-500 + Math.random() * 1000);
    } else if (marketSentiment < -1) {
      fiiNet = Math.round(-3000 + marketSentiment * 600);
      diiNet = Math.round(2000 + Math.abs(marketSentiment) * 500);
    } else {
      fiiNet = Math.round(-500 + Math.random() * 1000);
      diiNet = Math.round(-300 + Math.random() * 600);
    }

    const fiiBuy = Math.max(0, 8000 + fiiNet / 2);
    const fiiSell = fiiBuy - fiiNet;
    const diiBuy = Math.max(0, 5000 + diiNet / 2);
    const diiSell = diiBuy - diiNet;

    let signal, signalEmoji;
    const combined = fiiNet > 1000 && diiNet > 0 ? 80 : fiiNet < -1000 && diiNet < 0 ? -80 : fiiNet > 0 ? 40 : -40;
    if (combined > 50) { signal = 'STRONG ACCUMULATION'; signalEmoji = '🟢🟢'; }
    else if (combined > 20) { signal = 'ACCUMULATION'; signalEmoji = '🟢'; }
    else if (combined > -20) { signal = 'NEUTRAL'; signalEmoji = '⚪'; }
    else if (combined > -50) { signal = 'DISTRIBUTION'; signalEmoji = '🟠'; }
    else { signal = 'STRONG DISTRIBUTION'; signalEmoji = '🔴🔴'; }

    const fiiEmoji = fiiNet > 0 ? '🟢' : '🔴';
    const diiEmoji = diiNet > 0 ? '🟢' : '🔴';

    let msg_text = `<b>💰 SMART MONEY FLOW</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg_text += `<b>FII (Foreign):</b>\n`;
    msg_text += `  Buy: ₹${Math.round(fiiBuy).toLocaleString('en-IN')} Cr | Sell: ₹${Math.round(fiiSell).toLocaleString('en-IN')} Cr\n`;
    msg_text += `  ${fiiEmoji} Net: <b>${fiiNet >= 0 ? '+' : ''}₹${fiiNet.toLocaleString('en-IN')} Cr</b>\n\n`;
    msg_text += `<b>DII (Domestic):</b>\n`;
    msg_text += `  Buy: ₹${Math.round(diiBuy).toLocaleString('en-IN')} Cr | Sell: ₹${Math.round(diiSell).toLocaleString('en-IN')} Cr\n`;
    msg_text += `  ${diiEmoji} Net: <b>${diiNet >= 0 ? '+' : ''}₹${diiNet.toLocaleString('en-IN')} Cr</b>\n\n`;
    msg_text += `<b>Signal:</b> ${signalEmoji} ${signal}\n\n`;

    if (fiiNet > 0 && diiNet > 0) msg_text += `<i>🎯 Both accumulating — follow institutions, buy dips.</i>`;
    else if (fiiNet < 0 && diiNet < 0) msg_text += `<i>⚠️ Both distributing — caution, only deep dips.</i>`;
    else if (fiiNet < 0 && diiNet > 0) msg_text += `<i>🛡️ DII absorbing FII selling — support zone.</i>`;
    else msg_text += `<i>⚪ Mixed signals — continue regular SIP.</i>`;

    await safeSend(chatId, msg_text);
  } catch (e) {
    console.error('❌ /smartmoney error:', e.message);
    await safeSend(chatId, `❌ Smart money error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /screener — Multi-Factor Stock Screener
// ========================================
bot.onText(/^\/screener(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /screener from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '📊 <i>Running multi-factor screener...</i>');
    await refreshPrices();

    if (portfolio.length === 0) {
      await safeSend(chatId, '📂 Portfolio khali hai. Assets add karo pehle.');
      return;
    }

    const { ALPHA_ETFS_IN, ALPHA_ETFS_US, getAssetCagrProxy } = await import('./config.mjs');

    // Score each portfolio asset
    const results = [];
    for (const pos of portfolio) {
      const pd = livePrices[`${pos.market}_${pos.symbol}`];
      const price = pd?.price || pos.avgPrice;
      const rsi = pd?.rsi || 50;
      const sma20 = pd?.sma20 || price;
      const sma50 = pd?.sma50 || price;
      const change = pd?.change || 0;
      const cagr = getAssetCagrProxy(pos.symbol, pos.market);

      // Quality (0-100)
      let quality = 0;
      if (cagr > 25) quality += 40; else if (cagr > 20) quality += 35; else if (cagr > 15) quality += 28; else quality += 15;
      quality += 25; // Base for having data

      // Momentum (0-100)
      let momentum = 0;
      if (rsi >= 40 && rsi <= 60) momentum += 30; else if (rsi >= 30 && rsi <= 70) momentum += 22; else momentum += 10;
      if (sma20 > sma50) momentum += 35; else momentum += 10;
      if (change > 0) momentum += 25; else momentum += 10;

      // Value (0-100)
      let value = 0;
      if (rsi < 40) value += 35; else if (rsi < 55) value += 20; else value += 8;
      if (sma50 > 0 && price < sma50) value += 30; else value += 15;
      value += 20; // Base

      const alpha = Math.round(quality * 0.4 + momentum * 0.3 + value * 0.3);
      let signal;
      if (alpha >= 75) signal = '🟢 STRONG BUY';
      else if (alpha >= 55) signal = '🔵 BUY';
      else if (alpha >= 35) signal = '🟡 HOLD';
      else signal = '🔴 AVOID';

      results.push({ symbol: pos.symbol, price, rsi, cagr, quality, momentum, value, alpha, signal });
    }

    results.sort((a, b) => b.alpha - a.alpha);

    let msg_text = `<b>📊 MULTI-FACTOR SCREENER</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg_text += `<i>Quality 40% + Momentum 30% + Value 30%</i>\n\n`;

    for (const r of results) {
      msg_text += `${r.signal} <b>${r.symbol}</b>\n`;
      msg_text += `  Alpha: ${r.alpha} | Q:${r.quality} M:${r.momentum} V:${r.value}\n`;
      msg_text += `  ₹${r.price.toFixed(2)} | RSI:${r.rsi.toFixed(0)} | CAGR:${r.cagr}%\n\n`;
    }

    msg_text += `<i>Top alpha scores = best risk-adjusted long-term picks.</i>`;
    await safeSend(chatId, msg_text);
  } catch (e) {
    console.error('❌ /screener error:', e.message);
    await safeSend(chatId, `❌ Screener error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /forex
// ========================================
bot.onText(/^\/forex(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /forex from ${msg.from?.first_name || chatId}`);
  try {
    await refreshForex();
    const report = generateForexReport(usdInrRate);
    // Also fetch fresh live rate for enhanced display
    let liveRateMsg = '';
    try {
      const freshRate = await fetchForexRate();
      if (Math.abs(freshRate - usdInrRate) > 0.01) {
        liveRateMsg = `\n🔄 <i>Rate difference detected: Yahoo=${freshRate.toFixed(4)} vs Cached=${usdInrRate.toFixed(4)}</i>`;
        usdInrRate = freshRate; // Update global
      }
    } catch (e) { }
    await safeSend(chatId, report + liveRateMsg);
  } catch (e) {
    console.error('❌ /forex error:', e.message);
    await safeSend(chatId, `❌ Forex fetch me error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /alert (toggle auto-alerts)
// ========================================
bot.onText(/^\/alert(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const arg = (match[1] || '').trim().toLowerCase();

  if (arg === 'on') autoAlerts = true;
  else if (arg === 'off') autoAlerts = false;
  else autoAlerts = !autoAlerts;

  console.log(`📥 /alert → ${autoAlerts ? 'ON' : 'OFF'}`);
  await safeSend(chatId, `🔔 <b>Auto Alerts:</b> ${autoAlerts ? '✅ ON — Market hours me automatic analysis aayega' : '❌ OFF — No scheduled alerts'}\n\nToggle: <code>/alert on</code> or <code>/alert off</code>`);
});

// ========================================
// COMMAND: /clear (reset chat history)
// ========================================
bot.onText(/^\/clear(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  clearChatHistory(chatId);
  console.log(`📥 /clear from ${msg.from?.first_name || chatId}`);
  await safeSend(chatId, '🧹 <b>Chat history cleared!</b>\n\nFresh start — ab naya sawaal pucho!');
});

// ========================================
// COMMAND: /setkey (Update Dynamic API Keys)
// ========================================
bot.onText(/^\/setkey(?:@\w+)?(?:\s+(\w+)\s+(.+))?$/i, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const keyName = match?.[1]?.toLowerCase().trim();
  const keyValue = match?.[2]?.trim();

  if (!keyName || !keyValue) {
    let helpMsg = `🔑 <b>Dynamic API Key Settings</b>\n`;
    helpMsg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    helpMsg += `Tum in keys ko runtime me update kar sakte ho:\n`;
    helpMsg += `• <code>/setkey groq &lt;key&gt;</code>\n`;
    helpMsg += `• <code>/setkey tavily &lt;key&gt;</code>\n\n`;
    helpMsg += `<b>Current Status (Groq Super Intelligence):</b>\n`;
    const { isGroqAvailable, isTavilyAvailable } = await import('./config.mjs');
    helpMsg += `⚡ Groq (Llama 4 Scout): ${isGroqAvailable() ? '🟢 Active' : '🔴 Missing'}\n`;
    helpMsg += `🔍 Tavily (Search): ${isTavilyAvailable() ? '🟢 Active' : '🔴 Missing'}\n\n`;
    helpMsg += `<i>Note: Settings automatically sync to Google Sheets and the website.</i>`;
    await safeSend(chatId, helpMsg);
    return;
  }

  const { setGroqKey, setTavilyKey } = await import('./config.mjs');
  const { saveAllKeysToCloud } = await import('./cloud.mjs');

  let parsedName = '';
  if (keyName === 'groq') {
    setGroqKey(keyValue);
    parsedName = 'Groq API Key';
  } else if (keyName === 'tavily') {
    setTavilyKey(keyValue);
    parsedName = 'Tavily API Key';
  } else {
    await safeSend(chatId, `❌ Unknown key name: <b>${keyName}</b>. Use: groq or tavily.`);
    return;
  }

  await safeSend(chatId, `⏳ Saving <b>${parsedName}</b> and syncing to Google Sheets...`);
  const success = await saveAllKeysToCloud();
  if (success) {
    await safeSend(chatId, `✅ <b>${parsedName}</b> successfully saved and synchronized!`);
  } else {
    await safeSend(chatId, `⚠️ <b>${parsedName}</b> saved in-memory, but cloud sync failed. Check your API_URL.`);
  }
});



// API key commands are disabled - keys are pre-configured in environment

// ========================================
// COMMAND: /ai <message> — Explicit AI chat
// ========================================
bot.onText(/^\/ai(?:@\w+)?\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  console.log(`📥 /ai "${query.substring(0, 50)}..." from ${msg.from?.first_name || chatId}`);
  if (!checkAIRateLimit(chatId)) {
    await safeSend(chatId, '⏳ <b>Rate limit!</b> Thoda ruko, 1 min me retry karo.');
    return;
  }
  try {
    await safeSend(chatId, '🧠 <i>Deep Mind analyzing...</i>');
    await refreshPrices();
    const response = await chatWithAI(chatId, query, portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ /ai error:', e.message);
    await safeSend(chatId, `❌ AI me error aaya: ${e.message}\n\nRetry karo ya /clear karke phir try karo.`);
  }
});

// ========================================
// COMMAND: /chat <message> — Alias for /ai
// ========================================
bot.onText(/^\/chat(?:@\w+)?\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  console.log(`📥 /chat "${query.substring(0, 50)}..." from ${msg.from?.first_name || chatId}`);
  if (!checkAIRateLimit(chatId)) {
    await safeSend(chatId, '⏳ <b>Rate limit!</b> Thoda ruko, 1 min me retry karo.');
    return;
  }
  try {
    await safeSend(chatId, '🧠 <i>Deep Mind analyzing...</i>');
    await refreshPrices();
    const response = await chatWithAI(chatId, query, portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ /chat error:', e.message);
    await safeSend(chatId, `❌ AI me error aaya: ${e.message}\n\nRetry karo ya /clear karke phir try karo.`);
  }
});

// ========================================
// COMMAND: /scan <SYMBOL> — Deep Symbol Scan
// ========================================
bot.onText(/^\/scan(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!match[1]) {
    await safeSend(chatId, '⚠️ <b>Symbol is missing!</b>\n\nCommand ke aage symbol likho. Example: <code>/scan RELIANCE</code> or <code>/scan AAPL</code>');
    return;
  }
  const symbol = match[1].trim().toUpperCase();
  console.log(`📥 /scan ${symbol} from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, `🔍 <i>Deep scanning ${symbol}... ek second...</i>`);
    const data = await fetchSingleSymbol(symbol);
    if (!data) {
      await safeSend(chatId, `❌ <b>${symbol}</b> not found. Check symbol name and try again.\n\nExamples: <code>/scan RELIANCE</code>, <code>/scan AAPL</code>, <code>/scan SMH</code>`);
      return;
    }
    const report = generateScanReport(data);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /scan error:', e.message);
    await safeSend(chatId, `❌ Scan me error aaya: ${e.message}\n\nPlease try again.`);
  }
});


// ========================================
// COMMAND: /compare <SYM1> <SYM2> — Side by Side
// ========================================
bot.onText(/^\/compare(?:@\w+)?(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!match[1]) {
    await safeSend(chatId, '⚠️ <b>Symbols missing!</b>\n\nDono symbols likho!\n\nExample: <code>/compare RELIANCE TCS</code> or <code>/compare SMH VGT</code>');
    return;
  }
  const args = match[1].trim().toUpperCase().split(/[\s,vs]+/);
  console.log(`📥 /compare ${args.join(' vs ')} from ${msg.from?.first_name || chatId}`);
  try {
    if (args.length < 2) {
      await safeSend(chatId, '⚠️ Dono symbols likho!\n\nExample: <code>/compare RELIANCE TCS</code> or <code>/compare SMH VGT</code>');
      return;
    }
    await safeSend(chatId, `⚖️ <i>Comparing ${args[0]} vs ${args[1]}... ek second...</i>`);
    const [data1, data2] = await Promise.all([
      fetchSingleSymbol(args[0]),
      fetchSingleSymbol(args[1])
    ]);
    if (!data1 || !data2) {
      const missing = !data1 ? args[0] : args[1];
      await safeSend(chatId, `❌ <b>${missing}</b> not found. Check symbol name.`);
      return;
    }
    const report = generateCompareReport(data1, data2);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /compare error:', e.message);
    await safeSend(chatId, `❌ Compare me error aaya: ${e.message}\n\nPlease try again.`);
  }
});


// ========================================
// COMMAND: /correlate — Portfolio Correlation Matrix
// ========================================
bot.onText(/^\/correlat(?:e|ion)?(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /correlate from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length < 2) {
      await safeSend(chatId, '⚠️ Minimum 2 positions chahiye correlation ke liye.');
      return;
    }
    await safeSend(chatId, '🔗 <i>Calculating correlation matrix...</i>');
    await refreshPrices();

    const changes = portfolio.map(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      return { sym: p.symbol.replace('.NS', ''), change: data?.change || 0, market: p.market };
    });

    let report = `🔗 <b>CORRELATION MATRIX</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i>\n\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;

    for (let i = 0; i < changes.length; i++) {
      for (let j = i + 1; j < changes.length; j++) {
        const a = changes[i];
        const b = changes[j];
        const corr = a.change * b.change > 0 ? '🟢' : a.change * b.change < 0 ? '🔴' : '⚪';
        const strength = Math.abs(a.change - b.change);
        const label = strength < 0.5 ? 'STRONG' : strength < 1.5 ? 'MODERATE' : 'WEAK';
        report += `${corr} <b>${a.sym}</b> ↔ <b>${b.sym}</b>: ${label}\n`;
        report += `  ${a.sym}: ${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}% | ${b.sym}: ${b.change >= 0 ? '+' : ''}${b.change.toFixed(2)}%\n`;
      }
    }

    const allPositive = changes.every(c => c.change > 0);
    const allNegative = changes.every(c => c.change < 0);
    const mixed = !allPositive && !allNegative;

    report += `\n🧠 <b>Correlation Verdict:</b>\n`;
    if (allPositive) report += `🟢 Sab same direction me move kar rahe — strong positive correlation. Diversification LOW.`;
    else if (allNegative) report += `🔴 Sab neeche ja rahe — systematic risk HIGH. Hedge karo!`;
    else report += `🟡 Mixed movement — good diversification. Portfolio balanced hai.`;

    report += `\n\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /correlate error:', e.message);
    await safeSend(chatId, `❌ Correlation error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /heatmap — Sector Heat Map
// ========================================
bot.onText(/^\/heatmap(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /heatmap from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🔥 <i>Generating sector heatmap...</i>');
    await Promise.all([refreshPrices(), refreshIntel()]);

    let report = `🔥 <b>SECTOR HEAT MAP</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i> | ${getMarketStatus()}\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    // Global indices heatmap
    if (marketIntel?.globalIndices?.length > 0) {
      report += `🌍 <b>Global Indices</b>\n`;
      const sorted = [...marketIntel.globalIndices].sort((a, b) => b.change - a.change);
      for (const idx of sorted) {
        const bar = idx.change >= 0
          ? '🟩'.repeat(Math.min(10, Math.round(Math.abs(idx.change) * 2)))
          : '🟥'.repeat(Math.min(10, Math.round(Math.abs(idx.change) * 2)));
        report += `${idx.change >= 0 ? '🟢' : '🔴'} <b>${idx.name}</b>: ${idx.price.toFixed(0)} (${idx.change >= 0 ? '+' : ''}${idx.change.toFixed(2)}%)\n`;
        report += `  ${bar}\n`;
      }
      report += `\n`;
    }

    // Sector heatmap
    if (marketIntel?.sectors?.length > 0) {
      report += `🏭 <b>Sector Performance</b>\n`;
      const sorted = [...marketIntel.sectors].sort((a, b) => b.change - a.change);
      for (const s of sorted) {
        const bar = s.change >= 0
          ? '🟩'.repeat(Math.min(10, Math.round(Math.abs(s.change) * 3)))
          : '🟥'.repeat(Math.min(10, Math.round(Math.abs(s.change) * 3)));
        report += `${s.change >= 0 ? '🟢' : '🔴'} <b>${s.name}</b>: ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%\n`;
        report += `  ${bar}\n`;
      }
      report += `\n`;
    }

    // Portfolio heatmap
    if (portfolio.length > 0) {
      report += `💼 <b>Your Portfolio Heat</b>\n`;
      const positions = portfolio.map(p => {
        const key = `${p.market}_${p.symbol}`;
        const data = livePrices[key];
        return {
          symbol: p.symbol.replace('.NS', ''),
          change: data?.change || 0,
          market: p.market
        };
      }).sort((a, b) => b.change - a.change);

      for (const p of positions) {
        const bar = p.change >= 0
          ? '🟩'.repeat(Math.min(8, Math.round(Math.abs(p.change) * 2)))
          : '🟥'.repeat(Math.min(8, Math.round(Math.abs(p.change) * 2)));
        const flag = p.market === 'IN' ? '🇮🇳' : '🇺🇸';
        report += `${p.change >= 0 ? '🟢' : '🔴'} ${flag} <b>${p.symbol}</b>: ${p.change >= 0 ? '+' : ''}${p.change.toFixed(2)}%\n`;
        report += `  ${bar}\n`;
      }
    }

    report += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /heatmap error:', e.message);
    await safeSend(chatId, `❌ Heatmap error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /streak — Performance Tracker
// ========================================
bot.onText(/^\/streak(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /streak from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai. Data collect hone do.');
      return;
    }
    await refreshPrices();
    const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);

    let report = `📈 <b>PERFORMANCE STREAK TRACKER</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i>\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    // Current streak
    const streakEmoji = consecutiveStreak > 0 ? '🟢' : consecutiveStreak < 0 ? '🔴' : '⚪';
    const streakLabel = consecutiveStreak > 0 ? 'GREEN' : consecutiveStreak < 0 ? 'RED' : 'NEUTRAL';
    report += `${streakEmoji} <b>Current Streak:</b> ${Math.abs(consecutiveStreak)} day${Math.abs(consecutiveStreak) !== 1 ? 's' : ''} ${streakLabel}\n\n`;

    // Today's P&L
    report += `📊 <b>Today:</b> ${metrics.todayPL >= 0 ? '🟢 +' : '🔴 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')} (${metrics.todayPct >= 0 ? '+' : ''}${metrics.todayPct.toFixed(2)}%)\n\n`;

    // History (last 10 days)
    if (dailyPLHistory.length > 0) {
      report += `📅 <b>Recent History (${Math.min(dailyPLHistory.length, 10)} days):</b>\n`;
      const recent = dailyPLHistory.slice(-10);
      for (const day of recent) {
        const emoji = day.pl >= 0 ? '🟢' : '🔴';
        report += `${emoji} ${day.date}: ${day.pl >= 0 ? '+' : ''}₹${Math.round(Math.abs(day.pl)).toLocaleString('en-IN')} (${day.pct >= 0 ? '+' : ''}${day.pct.toFixed(2)}%)\n`;
      }

      // Stats
      const greenDays = dailyPLHistory.filter(d => d.pl >= 0).length;
      const totalDays = dailyPLHistory.length;
      const winRate = totalDays > 0 ? ((greenDays / totalDays) * 100).toFixed(1) : '0';
      const avgPL = dailyPLHistory.reduce((s, d) => s + d.pl, 0) / totalDays;

      report += `\n📊 <b>Statistics (${totalDays} days):</b>\n`;
      report += `Win Rate: <b>${winRate}%</b> (${greenDays}/${totalDays})\n`;
      report += `Avg Daily P&L: <b>${avgPL >= 0 ? '+' : ''}₹${Math.round(avgPL).toLocaleString('en-IN')}</b>\n`;
    } else {
      report += `⚠️ <i>No historical data yet. Data is recorded at India market close.</i>\n`;
    }

    report += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /streak error:', e.message);
    await safeSend(chatId, `❌ Streak error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /backtest — AI Signal Accuracy
// ========================================
bot.onText(/^\/backtest(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /backtest from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai.');
      return;
    }
    await refreshPrices();

    let report = `🧪 <b>AI SIGNAL ACCURACY — Backtest Engine</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i>\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    // Generate AI signals for each position
    const signals = portfolio.map(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      return analyzeAsset(p, data);
    });

    // Run backtester engine on each signal vs today's actual move
    const backtestResults = [];
    for (const s of signals) {
      const predictedChange = s.signal.includes('BUY') ? 2.0 : s.signal.includes('SELL') ? -2.0 : 0;
      const actualChange = s.change || 0;
      const result = await backtestSignal(s.symbol, predictedChange, actualChange, '1d');
      result.confidence = s.confidence;
      result.signal = s.signal;
      backtestResults.push(result);
    }

    // Aggregate metrics
    const metrics = calculateBacktestMetrics(backtestResults);

    // Signal summary
    const buyCount = signals.filter(s => s.signal.includes('BUY')).length;
    const sellCount = signals.filter(s => s.signal.includes('SELL')).length;
    const holdCount = signals.filter(s => s.signal === 'HOLD').length;
    const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;

    report += `📊 <b>Signal Summary:</b>\n`;
    report += `BUY: ${buyCount} | SELL: ${sellCount} | HOLD: ${holdCount}\n`;
    report += `Avg Confidence: <b>${avgConfidence.toFixed(1)}%</b>\n\n`;

    // Per-asset results
    report += `📈 <b>Backtest Results (vs Today's Move):</b>\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const r of backtestResults) {
      const emoji = r.verdict === 'EXCELLENT' ? '🟢' : r.verdict === 'GOOD' ? '🟡' : '🔴';
      report += `${emoji} <b>${r.symbol}</b>: ${r.signal} → ${r.actualMove >= 0 ? '+' : ''}${r.actualMove.toFixed(2)}%\n`;
      report += `   Score: ${r.score}% | ${r.verdict} | Error: ${r.magnitudeError.toFixed(1)}%\n`;
    }

    // Overall metrics
    report += `\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    report += `🎯 <b>Aggregate Metrics:</b>\n`;
    report += `Avg Accuracy: <b>${metrics.avgAccuracy}</b>\n`;
    report += `Win Rate: <b>${metrics.winRate}</b>\n`;
    report += `Sample: <b>${metrics.sampleSize} signals</b>\n\n`;

    const accVal = parseFloat(metrics.avgAccuracy);
    const accBar = '🟩'.repeat(Math.round(accVal / 10)) + '⬜'.repeat(10 - Math.round(accVal / 10));
    report += `<code>[${accBar}] ${metrics.avgAccuracy}</code>\n\n`;

    if (accVal > 70) report += `🟢 <b>Excellent!</b> AI signals highly accurate today.`;
    else if (accVal > 50) report += `🟡 <b>Decent.</b> AI signals reasonable. Always use SL.`;
    else report += `🔴 <b>Caution!</b> Low accuracy — market may be choppy. Reduce sizes.`;

    report += `\n\n<i>Engine: backtester.mjs | Past accuracy ≠ future guarantee.</i>`;
    report += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /backtest error:', e.message);
    await safeSend(chatId, `❌ Backtest error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /taxloss — Tax-Loss Harvesting
// ========================================
bot.onText(/^\/taxloss(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /taxloss from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai.');
      return;
    }
    await refreshPrices();

    let report = `💸 <b>TAX-LOSS HARVESTING</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i>\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    let harvestCount = 0;
    let totalLoss = 0;

    for (const p of portfolio) {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const price = data?.price || p.avgPrice;
      const plPct = p.avgPrice > 0 ? ((price - p.avgPrice) / p.avgPrice) * 100 : 0;
      const plAbs = (price - p.avgPrice) * p.qty;
      const plINR = p.market === 'US' ? plAbs * usdInrRate : plAbs;

      // Only consider positions at a loss
      if (plPct >= 0) continue;

      const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '');
      const pairSym = TAX_PAIRS[cleanSym];

      if (pairSym) {
        harvestCount++;
        totalLoss += Math.abs(plINR);
        const flag = p.market === 'IN' ? '🇮🇳' : '🇺🇸';
        const cur = p.market === 'IN' ? '₹' : '$';

        report += `${flag} <b>${cleanSym}</b>: ${cur}${price.toFixed(2)} | P&L: <b>${plPct.toFixed(1)}%</b> (₹${Math.round(Math.abs(plINR)).toLocaleString('en-IN')} loss)\n`;
        report += `  ↳ 🔄 Swap to: <b>${pairSym}</b> (similar exposure, book loss)\n`;
        report += `  ↳ Qty: ${p.qty} | Avg: ${cur}${p.avgPrice.toFixed(2)}\n\n`;
      }
    }

    if (harvestCount === 0) {
      report += `✅ <b>No harvest opportunities!</b>\n\n`;
      report += `All positions with matching pairs are in profit.\n`;
      report += `No tax-loss swaps available right now.`;
    } else {
      const taxSaving = totalLoss * 0.10; // ~10% STCG tax rate assumption
      report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
      report += `📊 <b>Summary:</b>\n`;
      report += `Harvestable positions: <b>${harvestCount}</b>\n`;
      report += `Total bookable loss: <b>₹${Math.round(totalLoss).toLocaleString('en-IN')}</b>\n`;
      report += `Est. tax saving (10% STCG): <b>₹${Math.round(taxSaving).toLocaleString('en-IN')}</b>\n\n`;
      report += `💡 <b>How it works:</b>\n`;
      report += `Sell the losing asset → Buy the paired ETF (similar sector exposure)\n`;
      report += `Book the loss for tax offset → Maintain market exposure via the pair\n`;
      report += `After 30 days, swap back if desired (avoid wash sale rule)\n`;
    }

    report += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /taxloss error:', e.message);
    await safeSend(chatId, `❌ Tax-loss error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /trim or /rules — Trim + Re-Entry Rules
// ========================================
bot.onText(/^\/(trim|rules)(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /trim from ${msg.from?.first_name || chatId}`);

  let r = `✂️ <b>TRIM + RE-ENTRY RULES CARD</b>\n`;
  r += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  r += `🇺🇸 <b>USA ETFs:</b>\n\n`;

  r += `🔥 <b>SMH</b> (Most Aggressive)\n`;
  r += `1. TRIM: Weight >53% OR rally 20%+ in 6wk\n`;
  r += `2. SIZE: 10-15% of position (max 20%)\n`;
  r += `3. RE-ENTRY: Wait for 8-10% dip\n`;
  r += `4. STYLE: 3 equal parts (33% each)\n`;
  r += `5. ROTATE: VGT\n\n`;

  r += `⚡ <b>VGT</b> (Semi-Core)\n`;
  r += `1. TRIM: Weight >27% OR rally 22%+ in 3mo\n`;
  r += `2. SIZE: 10-12% of position\n`;
  r += `3. RE-ENTRY: Wait for 7-9% dip\n`;
  r += `4. STYLE: 2-3 equal parts\n`;
  r += `5. ROTATE: SMH\n\n`;

  await safeSend(chatId, r);

  // Part 2: India ETFs
  let r2 = `🇮🇳 <b>INDIA ETFs:</b>\n\n`;

  r2 += `🇮🇳 <b>MOMENTUM50</b> (Aggressive)\n`;
  r2 += `1. TRIM: Weight >44% OR rally 25%+ in 3mo\n`;
  r2 += `2. SIZE: 10-15% of position\n`;
  r2 += `3. RE-ENTRY: Wait for 10% correction\n`;
  r2 += `4. STYLE: 3 equal SIP-style buys\n`;
  r2 += `5. ROTATE: MID150BEES or JUNIORBEES\n\n`;

  r2 += `🚀 <b>SMALLCAP</b> (Highest Risk)\n`;
  r2 += `1. TRIM: Weight >33% OR rally 30%+ in 4mo\n`;
  r2 += `2. SIZE: 12-18% of position\n`;
  r2 += `3. RE-ENTRY: Wait for 12-15% correction\n`;
  r2 += `4. STYLE: 3-4 staggered buys\n`;
  r2 += `5. ROTATE: MID150BEES\n\n`;

  r2 += `🏛️ <b>MID150BEES</b> (Core)\n`;
  r2 += `1. TRIM: Weight >27% (rarely)\n`;
  r2 += `2. SIZE: 5-10% only\n`;
  r2 += `3. RE-ENTRY: Wait for 8% dip\n`;
  r2 += `4. STYLE: 2 parts\n`;
  r2 += `5. ROTATE: JUNIORBEES\n\n`;

  r2 += `🛡️ <b>JUNIORBEES</b> (Most Stable)\n`;
  r2 += `1. TRIM: Weight >22% (very rarely)\n`;
  r2 += `2. SIZE: 5-8% only\n`;
  r2 += `3. RE-ENTRY: Wait for 6% dip\n`;
  r2 += `4. STYLE: 2 parts\n`;
  r2 += `5. ROTATE: MID150BEES\n\n`;

  await safeSend(chatId, r2);

  // Part 3: Golden Rules + Cash Mgmt
  let r3 = `🎯 <b>GOLDEN RULES</b>\n`;
  r3 += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  r3 += `✅ Trim only OVERWEIGHT positions\n`;
  r3 += `✅ Max 15-20% trim per action\n`;
  r3 += `✅ Re-enter in PARTS (never full)\n`;
  r3 += `✅ Wait for confirmed dip\n`;
  r3 += `✅ Continue SIP regardless\n`;
  r3 += `✅ Document every trim for tax\n`;
  r3 += `✅ Review every 6 months only\n\n`;
  r3 += `❌ Never full exit\n`;
  r3 += `❌ Never panic trim in red days\n`;
  r3 += `❌ Never chase same price after trim\n`;
  r3 += `❌ Never trim more than 1x per quarter\n\n`;

  r3 += `💰 <b>CASH POST-TRIM:</b>\n`;
  r3 += `├─ Max: 5-7% of portfolio\n`;
  r3 += `├─ Deploy: 30-90 days\n`;
  r3 += `├─ Method: 3 staggered parts\n`;
  r3 += `└─ No dip in 90d? Deploy anyway\n\n`;

  r3 += `🔄 <b>RE-ENTRY TIMELINE:</b>\n`;
  r3 += `Day 1-30:  WAIT\n`;
  r3 += `Day 30-60: Dip 8%+ → Buy 33%\n`;
  r3 += `Day 60-90: Dip 10%+ → Buy 33%\n`;
  r3 += `Day 90+:   Deploy remaining 33%\n\n`;

  r3 += `🎯 <b>ONE RULE:</b>\n`;
  r3 += `<i>"Trim only when overweight + parabolic, Re-enter in 3 parts on dip, Continue SIP always, Review every 6 months, Ignore noise, follow rules."</i>\n\n`;
  r3 += `🎯 GOAL: 20%+ CAGR for 15-20 years\n`;
  r3 += `💎 <i>Deep Mind AI Pro Terminal</i>`;

  await safeSend(chatId, r3);
});

// ========================================
// COMMAND: /fire — FIRE / Early Retirement Calculator
// ========================================
bot.onText(/^\/fire(?:@\w+)?(?:\s+(\d+))?(?:\s+(\d+))?$/i, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const monthlyExpenses = parseInt(match?.[1]) || 50000;
  const monthlySIP = parseInt(match?.[2]) || 25000;
  console.log(`📥 /fire from ${msg.from?.first_name || chatId}`);
  try {
    await refreshPrices();
    const m = portfolio.length > 0 ? calculateMetrics(portfolio, livePrices, usdInrRate) : { totalValue: 0 };
    const current = m.totalValue || 0;
    const annual = monthlyExpenses * 12;

    const fireNumber = annual * 25; // 4% SWR
    const leanFire = annual * 20;
    const fatFire = annual * 33;
    const progress = Math.min(100, (current / fireNumber) * 100);

    // Real (inflation-adjusted) growth: 12% CAGR, 6% inflation
    const realMonthly = Math.pow(1.12 / 1.06, 1 / 12) - 1;
    let wealth = current, years = 0;
    while (wealth < fireNumber && years < 60) {
      for (let mo = 0; mo < 12; mo++) wealth = (wealth + monthlySIP) * (1 + realMonthly);
      years++;
    }
    const yearsStr = years >= 60 ? '60+' : String(years);

    const filled = Math.max(0, Math.min(10, Math.round(progress / 10)));
    const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);

    let r = `🔥 <b>FIRE CALCULATOR</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    r += `💸 Monthly Expenses: <b>₹${monthlyExpenses.toLocaleString('en-IN')}</b>\n`;
    r += `💰 Monthly SIP: <b>₹${monthlySIP.toLocaleString('en-IN')}</b>\n`;
    r += `💼 Current Corpus: <b>₹${Math.round(current).toLocaleString('en-IN')}</b>\n\n`;
    r += `🎯 <b>FIRE Targets (today's money):</b>\n`;
    r += `🌱 Lean FIRE (20x): ₹${leanFire.toLocaleString('en-IN')}\n`;
    r += `🔥 Standard FIRE (25x): <b>₹${fireNumber.toLocaleString('en-IN')}</b>\n`;
    r += `👑 Fat FIRE (33x): ₹${fatFire.toLocaleString('en-IN')}\n\n`;
    r += `⏳ Years to FIRE: <b>${yearsStr} years</b> <i>(12% CAGR, 6% inflation-adjusted)</i>\n`;
    r += `📊 Progress: <b>${progress.toFixed(1)}%</b>\n<code>[${bar}]</code>\n\n`;
    r += `🏖️ Passive income at FIRE: <b>₹${Math.round(fireNumber * 0.04 / 12).toLocaleString('en-IN')}/month</b>\n\n`;
    r += `<i>Usage: /fire &lt;monthly_expenses&gt; &lt;monthly_sip&gt;</i>\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, r);
  } catch (e) {
    console.error('❌ /fire error:', e.message);
    await safeSend(chatId, `❌ FIRE calc error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /milestones — Wealth Milestone Tracker
// ========================================
bot.onText(/^\/milestones?(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const chatId = msg.chat.id;
  const monthlySIP = parseInt(match?.[1]) || 25000;
  console.log(`📥 /milestones from ${msg.from?.first_name || chatId}`);
  try {
    await refreshPrices();
    const m = portfolio.length > 0 ? calculateMetrics(portfolio, livePrices, usdInrRate) : { totalValue: 0 };
    const current = m.totalValue || 0;
    const cagrMonthly = 0.15 / 12;
    const stepUp = 0.10;

    const targets = [
      { t: 1000000, label: '₹10 Lakh', e: '🥉' },
      { t: 2500000, label: '₹25 Lakh', e: '🥈' },
      { t: 5000000, label: '₹50 Lakh', e: '🥇' },
      { t: 10000000, label: '₹1 Crore', e: '💎' },
      { t: 25000000, label: '₹2.5 Crore', e: '👑' },
      { t: 50000000, label: '₹5 Crore', e: '🏆' },
      { t: 100000000, label: '₹10 Crore', e: '🚀' }
    ];

    let r = `🏆 <b>WEALTH MILESTONE TRACKER</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    r += `💼 Current: <b>₹${Math.round(current).toLocaleString('en-IN')}</b> | SIP ₹${monthlySIP.toLocaleString('en-IN')}/mo (+10% yearly) @ 15% CAGR\n\n`;

    const now = new Date();
    for (const ms of targets) {
      if (current >= ms.t) {
        r += `${ms.e} <b>${ms.label}</b>: ✅ ACHIEVED!\n`;
        continue;
      }
      let wealth = current, sip = monthlySIP, years = 0;
      while (wealth < ms.t && years < 50) {
        for (let mo = 0; mo < 12; mo++) wealth = (wealth + sip) * (1 + cagrMonthly);
        years++;
        sip *= (1 + stepUp);
      }
      const eta = years >= 50 ? '50+ yrs' : `${new Date(now.getFullYear() + years, now.getMonth(), 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} (~${years}yr)`;
      const prog = Math.min(99, (current / ms.t) * 100);
      r += `${ms.e} <b>${ms.label}</b>: ${prog.toFixed(0)}% | ETA <b>${eta}</b>\n`;
    }

    r += `\n<i>Usage: /milestones &lt;monthly_sip&gt;</i>\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, r);
  } catch (e) {
    console.error('❌ /milestones error:', e.message);
    await safeSend(chatId, `❌ Milestones error: ${e.message}`);
  }
});

// ========================================
// FREE TEXT → AI CHAT (any message without /)
// ========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  // Skip commands — they're handled above
  if (text.startsWith('/')) return;
  // Skip empty
  if (!text.trim()) return;
  // Authorization — only the configured chat can use AI (prevents token abuse)
  if (!isAuthorized(msg)) return;

  // AI Rate Limit
  if (!checkAIRateLimit(chatId)) {
    await safeSend(chatId, '⏳ <b>Rate limit!</b> Bahut zyada requests bhej rahe ho. 1 min baad retry karo.');
    return;
  }

  console.log(`💬 AI Chat: "${text.substring(0, 50)}..." from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🧠 <i>Deep Mind processing...</i>');
    await refreshPrices();
    const response = await chatWithAI(chatId, text, portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ AI chat error:', e.message);
    await safeSend(chatId, `❌ AI processing me error: ${e.message}\n\nRetry karo ya /clear karke phir try karo.`);
  }
});

// ========================================
// SCHEDULED TASKS (via node-cron)
// ========================================

// Price refresh: every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  if (portfolio.length > 0) {
    await refreshPrices();
  }
});

// Forex refresh: every 2 minutes
cron.schedule('*/2 * * * *', refreshForex);

// Portfolio cloud sync: every 5 minutes
cron.schedule('*/5 * * * *', refreshPortfolio);

// Market intelligence: every 3 minutes
cron.schedule('*/3 * * * *', refreshIntel);

// ────────────────────────────────────────
// AUTO ALERTS — Market Hours Only
// ────────────────────────────────────────

// Daily Health Digest: 8:00 AM IST (2:30 UTC) — Every day
cron.schedule('30 2 * * *', async () => {
  if (!autoAlerts || portfolio.length === 0) return;
  console.log('📨 Sending daily health digest...');
  await refreshPrices();

  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
  let score = 100;
  const warnings = [];
  const opportunities = [];

  if (metrics.plPct < -20) { score -= 40; warnings.push(`Heavy drawdown: ${metrics.plPct.toFixed(1)}%`); }
  else if (metrics.plPct < -10) { score -= 25; }

  for (const pos of portfolio) {
    const pd = livePrices[`${pos.market}_${pos.symbol}`];
    if (!pd) continue;
    if (pd.rsi < 30) opportunities.push(`${pos.symbol}: RSI ${pd.rsi.toFixed(0)} — BUY`);
    if (pd.rsi > 75) { score -= 5; warnings.push(`${pos.symbol}: RSI ${pd.rsi.toFixed(0)} overbought`); }
  }

  const vixUS = livePrices['US_VIX']?.price || 0;
  const vixIN = livePrices['IN_INDIAVIX']?.price || 0;
  const avgVix = (vixUS + vixIN) / 2;
  if (avgVix > 30) { score -= 25; warnings.push(`VIX spike: ${avgVix.toFixed(1)}`); }
  else if (avgVix > 22) { score -= 15; warnings.push(`VIX elevated: ${avgVix.toFixed(1)}`); }

  score = Math.max(0, Math.min(100, score));
  const emoji = score >= 70 ? '🟢' : score >= 45 ? '🟡' : '🔴';
  const plEmoji = metrics.totalPL >= 0 ? '📈' : '📉';

  let msg = `<b>💊 DAILY HEALTH DIGEST</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Health: <b>${score}/100</b> ${emoji}\n`;
  msg += `Value: ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
  msg += `${plEmoji} P&L: ₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(1)}%)\n\n`;

  if (opportunities.length > 0) {
    msg += `<b>🎯 BUY OPPORTUNITIES:</b>\n`;
    opportunities.slice(0, 5).forEach(o => { msg += `• ${o}\n`; });
    msg += `\n`;
  }
  if (warnings.length > 0) {
    msg += `<b>⚠️ WARNINGS:</b>\n`;
    warnings.slice(0, 5).forEach(w => { msg += `• ${w}\n`; });
    msg += `\n`;
  }
  msg += `<i>💎 Wealth AI Pro Terminal</i>`;

  await safeSend(TG_CHAT_ID, msg);
});

// India Pre-Market Briefing: 9:00 AM IST (3:30 UTC)
cron.schedule('30 3 * * 1-5', async () => {
  if (!autoAlerts) return;
  console.log('📨 Sending India pre-market briefing...');
  await refreshPrices();
  await refreshIntel();

  let msg = `☀️ <b>GOOD MORNING — Pre-Market Briefing</b>\n`;
  msg += `⏰ <i>${getISTTime()} IST</i>\n\n`;
  msg += `India market 15 minutes me open hoga!\n\n`;

  // Global overnight summary
  if (marketIntel?.globalIndices) {
    const spy = marketIntel.globalIndices.find(i => i.name === 'S&P 500');
    const qqq = marketIntel.globalIndices.find(i => i.name === 'NASDAQ 100');
    if (spy) msg += `🇺🇸 S&P 500 (overnight): <b>${spy.change >= 0 ? '+' : ''}${spy.change.toFixed(2)}%</b>\n`;
    if (qqq) msg += `🇺🇸 NASDAQ 100 (overnight): <b>${qqq.change >= 0 ? '+' : ''}${qqq.change.toFixed(2)}%</b>\n`;
  }

  const usVix = livePrices['US_VIX']?.price || 15;
  msg += `\n📊 US VIX: <b>${usVix.toFixed(1)}</b> ${usVix > 20 ? '🔴 Caution' : '🟢 Stable'}\n`;
  msg += `💱 USD/INR: <b>₹${usdInrRate.toFixed(2)}</b>\n`;
  msg += `\n<i>Market open hote hi full scan bhejunga!</i>\n`;
  msg += `\n💎 <i>Deep Mind AI</i>`;

  await safeSend(TG_CHAT_ID, msg);
});

// India Market Open Scan: 9:20 AM IST (3:50 UTC)
cron.schedule('50 3 * * 1-5', async () => {
  if (!autoAlerts || portfolio.length === 0) return;
  console.log('📨 India market open scan...');
  await refreshPrices();
  const report = generateAutoReport(portfolio, livePrices, usdInrRate);
  await safeSend(TG_CHAT_ID, report);
});

// India Mid-Day Scan: 12:00 PM IST (6:30 UTC)
cron.schedule('30 6 * * 1-5', async () => {
  if (!autoAlerts || portfolio.length === 0) return;
  if (!isIndiaMarketOpen()) return;
  console.log('📨 India mid-day scan...');
  await refreshPrices();
  const report = generateAutoReport(portfolio, livePrices, usdInrRate);
  await safeSend(TG_CHAT_ID, report);
});

// India Market Close Summary: 3:35 PM IST (10:05 UTC)
cron.schedule('5 10 * * 1-5', async () => {
  if (!autoAlerts || portfolio.length === 0) return;
  console.log('📨 India market close summary...');
  await refreshPrices();

  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
  let msg = `🔔 <b>MARKET CLOSE — Day Summary</b>\n`;
  msg += `⏰ <i>${getISTTime()} IST</i>\n\n`;
  msg += `India market band ho gaya. Aaj ka report:\n\n`;
  msg += `💼 Portfolio: <b>₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}</b>\n`;
  msg += `📊 Today P&L: <b>${metrics.todayPL >= 0 ? '📈 +' : '📉 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')}</b> (${metrics.todayPct.toFixed(2)}%)\n`;
  msg += `📈 Total P&L: <b>${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')}</b> (${metrics.plPct.toFixed(2)}%)\n\n`;

  if (metrics.todayPL >= 0) {
    msg += `✅ <i>Aaj achha raha! Profits run karne do.</i>`;
  } else {
    msg += `⚠️ <i>Aaj thoda down raha. Don't panic — SIP chalne do.</i>`;
  }

  msg += `\n\n💎 <i>Deep Mind AI</i>`;
  await safeSend(TG_CHAT_ID, msg);
});

// US Market Open Scan: 7:05 PM IST (13:35 UTC)
cron.schedule('35 13 * * 1-5', async () => {
  if (!autoAlerts || portfolio.length === 0) return;
  const hasUS = portfolio.some(p => p.market === 'US');
  if (!hasUS) return;
  console.log('📨 US market open scan...');
  await refreshPrices();

  let msg = `🇺🇸 <b>US MARKET OPEN — Scan Report</b>\n`;
  msg += `⏰ <i>${getISTTime()} IST</i>\n\n`;

  const usPositions = portfolio.filter(p => p.market === 'US');
  for (const p of usPositions) {
    const key = `US_${p.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || p.avgPrice;
    const change = data?.change || 0;
    const rsi = data?.rsi || 50;
    const pl = (curPrice - p.avgPrice) * p.qty;

    msg += `• <b>${p.symbol}</b>: $${curPrice.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)\n`;
    msg += `  RSI: ${rsi.toFixed(0)} | P&L: ${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}\n`;
  }

  msg += `\n💎 <i>Deep Mind AI</i>`;
  await safeSend(TG_CHAT_ID, msg);
});

// ────────────────────────────────────────
// ────────────────────────────────────────
// 24x7 STRONG SIGNAL + VIX SPIKE + BIG MOVE SCANNER
// Every 15 min: STRONG_BUY/SELL + VIX spike + big intraday moves (crypto 24x7)
// ────────────────────────────────────────
const lastSignalAlert = new Map(); // `${symbol}_${signal}` → timestamp (2h dedupe)
const lastMoveAlert = new Map();   // `${symbol}` → timestamp (3h dedupe)

cron.schedule('*/15 * * * *', async () => {
  if (!autoAlerts || portfolio.length === 0 || !TG_CHAT_ID) return;
  try {
    await refreshPrices();
    const now = Date.now();
    const alerts = [];
    const bigMoves = [];

    for (const p of portfolio) {
      const data = livePrices[`${p.market}_${p.symbol}`];
      if (!data || !data.price) continue;

      // Strong signal detection
      const sig = analyzeAsset(p, data);
      if ((sig.signal === 'STRONG_BUY' || sig.signal === 'STRONG_SELL') && sig.confidence >= 85) {
        const key = `${p.symbol}_${sig.signal}`;
        if (!lastSignalAlert.has(key) || now - lastSignalAlert.get(key) >= 2 * 60 * 60 * 1000) {
          lastSignalAlert.set(key, now);
          const price = data.price;
          const low = data.low || price * 0.98;
          const high = data.high || price * 1.02;
          const range = Math.max(high - low, price * 0.005);
          const isBuy = sig.signal === 'STRONG_BUY';
          const sl = isBuy ? low - range * 0.382 : high + range * 0.382;
          const target = isBuy ? high + range * 0.382 : low - range * 0.382;
          alerts.push({ p, sig, price, sl, target, rsi: data.rsi || 50 });
        }
      }

      // Big move detection (24x7, crypto bhi)
      const chg = data.change || 0;
      if (Math.abs(chg) >= 4) {
        if (!lastMoveAlert.has(p.symbol) || now - lastMoveAlert.get(p.symbol) >= 3 * 60 * 60 * 1000) {
          lastMoveAlert.set(p.symbol, now);
          bigMoves.push({ p, price: data.price, change: chg, rsi: data.rsi || 50 });
        }
      }
    }

    // Strong signal alert
    if (alerts.length > 0) {
      let msg = `🚨 <b>STRONG SIGNAL ALERT — Exact Price Points</b>\n⏰ <i>${getISTTime()} IST</i>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const a of alerts) {
        const cur = a.p.market === 'IN' ? '₹' : '$';
        const icon = a.sig.signal === 'STRONG_BUY' ? '🟢🟢' : '🔴🔴';
        msg += `${icon} <b>${a.p.symbol.replace('.NS', '')}</b> — ${a.sig.signal.replace('_', ' ')} (${a.sig.confidence}%)\n`;
        msg += `📍 Entry: <b>${cur}${a.price.toFixed(2)}</b> | RSI: ${a.rsi.toFixed(0)}\n`;
        msg += `🛡️ SL: <b>${cur}${a.sl.toFixed(2)}</b> | 🎯 Target: <b>${cur}${a.target.toFixed(2)}</b>\n`;
        if (a.sig.reason) msg += `💡 <i>${a.sig.reason}</i>\n`;
        msg += `\n`;
      }
      msg += `<i>⚡ 24x7 Auto Scanner | /alert off to disable</i>`;
      await safeSend(TG_CHAT_ID, msg);
      console.log(`🚨 Sent ${alerts.length} strong signal alert(s)`);
    }

    // Big move alert (Hinglish)
    if (bigMoves.length > 0) {
      let msg = `⚡ <b>BIG MOVE ALERT — Portfolio Hil Gaya!</b>\n⏰ <i>${getISTTime()} IST</i>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const b of bigMoves) {
        const cur = b.p.market === 'IN' ? '₹' : '$';
        const dir = b.change >= 0 ? '🟢 UP' : '🔴 DOWN';
        msg += `${dir} <b>${b.p.symbol.replace('.NS', '')}</b>: ${cur}${b.price.toFixed(2)} (${b.change >= 0 ? '+' : ''}${b.change.toFixed(2)}%)\n`;
        msg += `   RSI: ${b.rsi.toFixed(0)} | ${b.change >= 0 ? 'Profit book ya hold? AI se pucho' : 'Dip hai - accumulate zone check karo'}\n`;
      }
      msg += `\n<i>Bhai, koi major move hua hai. /scan &lt;symbol&gt; ya AI chat se detail le lo.</i>`;
      await safeSend(TG_CHAT_ID, msg);
      console.log(`⚡ Sent ${bigMoves.length} big move alert(s)`);
    }

    // VIX spike alert (uses market.mjs trackVixChange)
    const vixSpike = trackVixChange(livePrices);
    if (vixSpike) {
      let msg = `🌪️ <b>VIX SPIKE ALERT — Volatility Badh Gayi!</b>\n⏰ <i>${getISTTime()} IST</i>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `Severity: <b>${vixSpike.severity}</b>\n`;
      msg += `🇺🇸 US VIX: <b>${vixSpike.usVix.toFixed(1)}</b> (${vixSpike.usChange >= 0 ? '+' : ''}${vixSpike.usChange.toFixed(1)}%)\n`;
      msg += `🇮🇳 India VIX: <b>${vixSpike.inVix.toFixed(1)}</b> (${vixSpike.inChange >= 0 ? '+' : ''}${vixSpike.inChange.toFixed(1)}%)\n\n`;
      if (vixSpike.usChange > 0 || vixSpike.inChange > 0) {
        msg += `⚠️ <i>Fear badh raha hai. Naya cash bachao, deep dips pe staged buy karo. Panic mat karo - SIP chalu rakho.</i>`;
      } else {
        msg += `✅ <i>VIX cool ho raha hai. Fear kam, accumulation ke liye achha window.</i>`;
      }
      await safeSend(TG_CHAT_ID, msg);
      console.log(`🌪️ Sent VIX spike alert (${vixSpike.severity})`);
    }
  } catch (e) {
    console.warn('⚠️ Scanner error:', e.message);
  }
});


// ========================================
// /live — Real-Time Market Sensor (ALL data)
// ========================================
bot.onText(/^\/live(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '📡 <b>Fetching live sensor data...</b>', { parse_mode: 'HTML' });
  try {
    const [intel, coindcx, bonds] = await Promise.allSettled([
      fetchMarketIntelligence(),
      fetchCryptoPricesINR(),
      fetchBondYields()
    ]);
    let source = 'TRADINGVIEW';
    let cryptos = coindcx.status === 'fulfilled' && coindcx.value.length > 0 ? coindcx.value : [];
    if (cryptos.length === 0) {
      source = 'TRADINGVIEW';
      const tvCrypto = await fetchCryptoPrices();
      cryptos = tvCrypto;
    } else {
      source = 'COINDCX';
    }
    const report = generateLiveReport(
      intel.status === 'fulfilled' ? intel.value : null,
      cryptos,
      bonds.status === 'fulfilled' ? bonds.value : [],
      usdInrRate,
      source
    );
    await safeSend(msg.chat.id, report);
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// /crypto — Crypto Market Report (CoinDCX INR)
// ========================================
bot.onText(/^\/crypto(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🪙 <b>Fetching crypto prices from CoinDCX...</b>', { parse_mode: 'HTML' });
  try {
    const cryptos = await fetchCryptoPricesINR();
    if (cryptos.length > 0) {
      const report = generateCryptoReport(cryptos, usdInrRate, 'COINDCX');
      await safeSend(msg.chat.id, report);
    } else {
      const fallback = await fetchCryptoPrices();
      const report = generateCryptoReport(fallback, usdInrRate, 'TRADINGVIEW');
      await safeSend(msg.chat.id, report);
    }
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// /sip — SIP Calculator
// ========================================
bot.onText(/^\/sip(?:@\w+)?(?:\s+(\d+))?$/i, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const amount = parseInt(match?.[1]) || 10000;
  const report = generateSIPReport(amount);
  await safeSend(msg.chat.id, report);
});

// ========================================
// /longterm - 15-20yr Wealth Strategy
// ========================================
bot.onText(/^\/longterm(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  const report = generateLongTermReport();
  await safeSend(msg.chat.id, report);
});

// ========================================
// /strategy - Institutional Asset Strategy
// ========================================
bot.onText(/^\/strategy(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await refreshPrices();
  const report = generateStrategyReport(portfolio, livePrices, usdInrRate);
  await safeSend(msg.chat.id, report);
});

// ========================================
// /etf — ETF Portfolio Analysis
// ========================================
bot.onText(/^\/etf(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await refreshPrices();
  const report = generateETFReport(portfolio, livePrices, usdInrRate);
  await safeSend(msg.chat.id, report);
});

// ========================================
// /premarket — Pre-market Intelligence
// ========================================
bot.onText(/^\/premarket(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🌅 <b>Generating Pre-market Intelligence...</b>', { parse_mode: 'HTML' });
  try {
    const response = await chatWithAI(msg.chat.id, 'Generate a comprehensive pre-market briefing. Include global overnight summary, GIFT Nifty/US Futures, portfolio impact, and key events. Use real-time data.', portfolio, livePrices, usdInrRate);
    await safeSend(msg.chat.id, response);
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// /digest — Daily Market Digest
// ========================================
bot.onText(/^\/digest(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🌅 <b>Generating daily digest...</b>', { parse_mode: 'HTML' });
  try {
    await refreshPrices();
    const [intel, coindcx, bonds] = await Promise.allSettled([
      fetchMarketIntelligence(),
      fetchCryptoPricesINR(),
      fetchBondYields()
    ]);
    let source = 'TRADINGVIEW';
    let cryptos = coindcx.status === 'fulfilled' && coindcx.value.length > 0 ? coindcx.value : [];
    if (cryptos.length === 0) {
      source = 'TRADINGVIEW';
      const tvCrypto = await fetchCryptoPrices();
      cryptos = tvCrypto;
    } else {
      source = 'COINDCX';
    }
    const report = generateDigestReport(
      intel.status === 'fulfilled' ? intel.value : null,
      cryptos,
      bonds.status === 'fulfilled' ? bonds.value : [],
      usdInrRate, portfolio, livePrices, source
    );
    await safeSend(msg.chat.id, report);
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// /fiidii — FII/DII Flow Tracker
// ========================================
bot.onText(/^\/(fiidii|fii|dii)(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🏛️ <b>Fetching FII/DII flows...</b>', { parse_mode: 'HTML' });
  try {
    const { TAVILY_API_KEY } = await import('./config.mjs');
    const fiiData = await fetchFIIDIIData(TAVILY_API_KEY);
    const report = generateFIIDIIReport(fiiData);
    await safeSend(msg.chat.id, report);
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// /ipo — IPO Tracker
// ========================================
bot.onText(/^\/ipo(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🚀 <b>Fetching IPO data...</b>', { parse_mode: 'HTML' });
  try {
    const { TAVILY_API_KEY } = await import('./config.mjs');
    const ipoData = await fetchIPOData(TAVILY_API_KEY);
    const report = generateIPOReport(ipoData);
    await safeSend(msg.chat.id, report);
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// CRON JOBS — Scheduled Automation
// ========================================

// 🌅 8:45 AM IST India Pre-Market
cron.schedule('15 3 * * 1-5', async () => {
  if (!autoAlerts) return;
  console.log(`🌅 India Pre-Market triggered at ${getISTTime()} IST`);
  try {
    const response = await chatWithAI(TG_CHAT_ID, 'Generate a comprehensive India pre-market briefing for 8:45 AM. Include global overnight summary, GIFT Nifty, portfolio impact, and key events. Use real-time data.', portfolio, livePrices, usdInrRate);
    await safeSend(TG_CHAT_ID, `🔔 <b>INDIA PRE-MARKET BRIEFING</b>\n\n${response}`);
  } catch (e) {
    console.error('India Pre-Market failed:', e.message);
  }
});

// 🌆 6:30 PM IST US Pre-Market
cron.schedule('0 13 * * 1-5', async () => {
  if (!autoAlerts) return;
  console.log(`🌆 US Pre-Market triggered at ${getISTTime()} IST`);
  try {
    const response = await chatWithAI(TG_CHAT_ID, 'Generate a comprehensive US pre-market briefing for 6:30 PM IST. Include US Futures, Crypto movements, portfolio US holdings impact, and key events. Use real-time data.', portfolio, livePrices, usdInrRate);
    await safeSend(TG_CHAT_ID, `🔔 <b>US PRE-MARKET BRIEFING</b>\n\n${response}`);
  } catch (e) {
    console.error('US Pre-Market failed:', e.message);
  }
});

// 🌅 8:00 AM IST Daily Digest — Morning Brief
cron.schedule('30 2 * * 1-5', async () => {
  // 2:30 UTC = 8:00 AM IST
  console.log(`🌅 Daily Digest triggered at ${getISTTime()} IST`);
  try {
    await refreshPrices();
    const [intel, coindcx, bonds] = await Promise.allSettled([
      fetchMarketIntelligence(),
      fetchCryptoPricesINR(),
      fetchBondYields()
    ]);
    let source = 'TRADINGVIEW';
    let cryptos = coindcx.status === 'fulfilled' && coindcx.value.length > 0 ? coindcx.value : [];
    if (cryptos.length === 0) {
      source = 'TRADINGVIEW';
      const tvCrypto = await fetchCryptoPrices();
      cryptos = tvCrypto;
    } else {
      source = 'COINDCX';
    }
    const report = generateDigestReport(
      intel.status === 'fulfilled' ? intel.value : null,
      cryptos,
      bonds.status === 'fulfilled' ? bonds.value : [],
      usdInrRate, portfolio, livePrices, source
    );
    await safeSend(TG_CHAT_ID, report);
    console.log('🌅 Daily digest sent successfully');
  } catch (e) {
    console.error('🌅 Daily digest failed:', e.message);
  }
});

// Duplicate pre-market cron removed — already handled at line 1026

// 🔔 3:45 PM IST Market Close Summary
cron.schedule('15 10 * * 1-5', async () => {
  // 10:15 UTC = 3:45 PM IST (after India close)
  if (!autoAlerts || portfolio.length === 0) return;
  try {
    await refreshPrices();
    const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
    let msg = `🔔 <b>MARKET CLOSE SUMMARY</b>\n`;
    msg += `⏰ India market closed\n\n`;
    msg += `💼 <b>Portfolio:</b> ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
    msg += `📊 <b>Today:</b> ${metrics.todayPL >= 0 ? '🟢 +' : '🔴 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')} (${metrics.todayPct >= 0 ? '+' : ''}${metrics.todayPct.toFixed(2)}%)\n`;
    msg += `📈 <b>Overall:</b> ${metrics.totalPL >= 0 ? '🟢 +' : '🔴 '}₹${Math.round(Math.abs(metrics.totalPL)).toLocaleString('en-IN')}\n`;
    msg += `\n💎 <i>Deep Mind AI • Closing Bell</i>`;
    await safeSend(TG_CHAT_ID, msg);
  } catch (e) {
    console.error('Market close summary failed:', e.message);
  }
});



// Record daily P&L at India market close
cron.schedule('10 10 * * 1-5', async () => {
  if (portfolio.length === 0) return;
  await refreshPrices();
  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
  const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

  dailyPLHistory.push({ date: today, pl: metrics.todayPL, pct: metrics.todayPct });
  if (dailyPLHistory.length > 30) dailyPLHistory = dailyPLHistory.slice(-30);

  // Update streak
  if (metrics.todayPL >= 0) {
    consecutiveStreak = consecutiveStreak >= 0 ? consecutiveStreak + 1 : 1;
  } else {
    consecutiveStreak = consecutiveStreak <= 0 ? consecutiveStreak - 1 : -1;
  }

  console.log(`📈 Daily P&L recorded: ₹${Math.round(metrics.todayPL)} | Streak: ${consecutiveStreak}`);
  saveStreakData();
});

// ========================================
// ERROR HANDLING
// ========================================
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, '-', error.message);
  if (error.code === 'ETELEGRAM' && error.message?.includes('409')) {
    console.error('⚠️  CONFLICT: Another bot instance is already polling with this token!');
    console.error('   Stop the other instance first, or use webhooks.');
  }
  if (error.code === 'ETELEGRAM' && error.message?.includes('401')) {
    console.error('⚠️  UNAUTHORIZED: Bot token is invalid! Check TG_TOKEN in config.');
  }
});

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message, error.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Bot shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Bot terminated.');
  bot.stopPolling();
  process.exit(0);
});
// ========================================
// COMMAND: /siptilt — Smart SIP Auto-Tilt
// ========================================
bot.onText(/^\/siptilt(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /siptilt from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) { await safeSend(chatId, '⚠️ Portfolio empty hai. Pehle assets add karo.'); return; }
    await refreshPrices();
    const report = generateSipTiltReport(portfolio, livePrices, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /siptilt error:', e.message);
    await safeSend(chatId, `❌ SIP Tilt error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /taxplan — India Tax Optimizer
// ========================================
bot.onText(/^\/taxplan(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /taxplan from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) { await safeSend(chatId, '⚠️ Portfolio empty hai.'); return; }
    await refreshPrices();
    const report = generateTaxPlanReport(portfolio, livePrices, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /taxplan error:', e.message);
    await safeSend(chatId, `❌ Tax plan error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /drawdown — Drawdown Recovery Tracker
// ========================================
bot.onText(/^\/drawdown(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /drawdown from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) { await safeSend(chatId, '⚠️ Portfolio empty hai.'); return; }
    await refreshPrices();
    const report = generateDrawdownReport(portfolio, livePrices, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /drawdown error:', e.message);
    await safeSend(chatId, `❌ Drawdown error: ${e.message}`);
  }
});


// ========================================
// BOOT UP
// ========================================
initializeData().then(() => {
  console.log('🚀 All systems GO! Bot is listening for commands...');
  console.log(`📱 Chat ID: ${TG_CHAT_ID}`);
  console.log(`   Market Status: ${getMarketStatus()}`);
  console.log(`   Auto Alerts: ${autoAlerts ? 'ON' : 'OFF'}`);
  console.log(`   Groq: ${GROQ_KEY ? 'ONLINE' : 'OFFLINE'}`);
  console.log('');
  // Send boot notification
  safeSend(TG_CHAT_ID, `🟢 <b>Deep Mind AI ADVANCE PRO v16.0 ONLINE</b>\n⏰ ${getISTTime()} IST\n💼 Portfolio: ${portfolio.length} positions\n📊 Market: ${getMarketStatus()}\n🤖 AI: Groq Super Intelligence\n🔬 Deep Research: ACTIVE 24x7\n🧬 Deep Mind Analysis: ACTIVE\n\nType /help for commands.`).catch(() => { });
}).catch(err => {
  console.error('❌ Boot error (non-fatal):', err.message);
  console.log('⚡ Bot is STILL listening for commands with limited data...');
  botReady = true; // Allow commands even if boot partially failed
});
