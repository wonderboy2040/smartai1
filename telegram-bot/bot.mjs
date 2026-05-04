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
import { TG_TOKEN, TG_CHAT_ID, GROQ_KEY, GEMINI_API_KEY, CLAUDE_API_KEY } from './config.mjs';
import { batchFetchPrices, fetchForexRate, fetchMarketIntelligence, fetchSingleSymbol, trackVixChange, isAnyMarketOpen, getMarketStatus, getISTTime, isIndiaMarketOpen, isUSMarketOpen, fetchCryptoPrices, fetchBondYields, fetchFIIDIIData, fetchIPOData } from './market.mjs';
import { loadPortfolioFromCloud, loadGroqKeyFromCloud, saveGroqKeyToCloud } from './cloud.mjs';
import {
  generatePortfolioReport, generateMarketReport,
  generateAllocationReport, generateRiskReport, generateAutoReport,
  generateForexReport, calculateMetrics, generateScanReport,
  generateCompareReport, analyzeAsset,
  generateLiveReport, generateCryptoReport, generateSIPReport,
  generateETFReport, generateDigestReport, generateFIIDIIReport, generateIPOReport
} from './analysis.mjs';
import { chatWithAI, clearChatHistory } from './ai-chat.mjs';

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
  if (!TG_CHAT_ID) return true; // No chat ID configured = allow all
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
  } catch (e) {}
}

// ========================================
// 🌐 FULL SITE + BOT SERVER (For Render deployment)
// ========================================
const app = express();
const PORT = process.env.PORT || 3000;

// Serve the compiled Vite React frontend
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Fallback to React Router or ping message
app.use((req, res) => {
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
console.log('║  🧠 DEEP MIND AI QUANTUM PRO v4.0         ║');
console.log('║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║');
console.log('║  Real-Time Pro Trading Intelligence      ║');
console.log('║  Groq + Gemini 2.5 + Claude Sonnet 4     ║');
console.log('║  Live Market Data + Tavily Web Search     ║');
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

  // Step 2: Groq Key (non-blocking)
  try {
    console.log('🔑 Loading Groq API key...');
    await loadGroqKeyFromCloud();
    console.log(`✅ Groq key: ${GROQ_KEY ? 'SET (' + GROQ_KEY.substring(0, 8) + '...)' : 'NOT SET'}`);
  } catch (e) {
    console.warn('⚠️  Groq key load failed:', e.message);
  }

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
console.log(` Gemini AI: ${GEMINI_API_KEY ? 'ACTIVE ✅' : 'INACTIVE ❌'}`);
console.log(` Claude AI: ${CLAUDE_API_KEY ? 'ACTIVE ✅' : 'INACTIVE ❌'}`);
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
        { command: 'backtest', description: 'AI Signal Accuracy Check' },
        { command: 'streak', description: 'Performance streak tracker' },
        { command: 'etf', description: 'ETF Portfolio Analysis' },
        { command: 'crypto', description: 'Crypto Market Report' },
        { command: 'sip', description: 'SIP Calculator' },
        { command: 'digest', description: 'Daily Market Digest' },
        { command: 'fiidii', description: 'FII/DII Flow Tracker' },
        { command: 'ipo', description: 'IPO Tracker' },
        { command: 'forex', description: 'Live Forex (USD/INR)' },
        { command: 'news', description: 'Global Market Sentiment' },
        { command: 'fundamental', description: 'Deep Fundamental Analysis' },
        { command: 'alert', description: 'Toggle auto alerts' },
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
  } catch (e) {}
}

async function refreshPortfolio() {
  try {
    const fresh = await loadPortfolioFromCloud();
    if (fresh && fresh.length > 0) {
      portfolio = fresh;
    }
  } catch (e) {}
}

async function refreshIntel() {
  try {
    marketIntel = await fetchMarketIntelligence();
  } catch (e) {}
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

  const welcome = `🧠 <b>DEEP MIND AI QUANTUM PRO v4.0</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

Nagraj Bhai, main tumhara QUANTUM PRO AI Trading assistant hoon! 🚀

⚡ <b>Real-Time Data Feeds:</b>
• TradingView Live Scanner (NSE/BSE/NYSE/NASDAQ)
• Live USD/INR Exchange Rate
• Tavily Web Search (Breaking News)
• VIX, Gold, Crude, DXY, Bitcoin

🤖 <b>AI Engines:</b>
• ⚡ Groq Llama-3.3 70B (Ultra-Fast)
• 🔵 Google Gemini 2.5 Flash (Real-Time Intel)
• 🟣 Claude Sonnet 4 (Deep Analysis)

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
🧪 /backtest — Signal accuracy
📊 /streak — Performance tracker
📊 /etf — ETF portfolio analysis
🪙 /crypto — Crypto market
💰 /sip — SIP calculator
🌅 /digest — Daily digest
🏛️ /fiidii — FII/DII flows
🚀 /ipo — IPO tracker
💱 /forex — Live USD/INR
🌍 /news — Market sentiment
💼 /fundamental — Deep fundamentals
🔔 /alert — Toggle auto alerts
🧹 /clear — Clear AI memory

🧠 <b>AI Chat Mode:</b>
Bina / ke koi bhi message likho = AI QUANTUM chat!

━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Status: <b>${getMarketStatus()}</b>
💼 Portfolio: <b>${portfolio.length} positions</b>
🔔 Auto Alerts: <b>${autoAlerts ? 'ON ✅' : 'OFF ❌'}</b>
💱 USD/INR: <b>₹${usdInrRate.toFixed(2)}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
💎 <i>Powered by Deep Mind AI Quantum Pro Terminal v4.0</i>`;

  await safeSend(chatId, welcome);
});

// ========================================
// COMMAND: /debug_env (Hidden Diagnosis)
// ========================================
bot.onText(/^\/debug_env(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  const env = process.env;
  
  let report = '🔍 <b>ENVIRONMENT VARIABLE DEBUGGER</b>\n━━━━━━━━━━━━━━━━━━━━━━\n';
  
  // Directly check the variables from config and process.env
  report += `<b>GROQ_KEY:</b> ${env.GROQ_KEY ? '✅ Found (' + env.GROQ_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>VITE_GROQ_API_KEY:</b> ${env.VITE_GROQ_API_KEY ? '✅ Found (' + env.VITE_GROQ_API_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>GEMINI_API_KEY:</b> ${env.GEMINI_API_KEY ? '✅ Found (' + env.GEMINI_API_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>VITE_GEMINI_API_KEY:</b> ${env.VITE_GEMINI_API_KEY ? '✅ Found (' + env.VITE_GEMINI_API_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>CLAUDE_API_KEY:</b> ${env.CLAUDE_API_KEY ? '✅ Found (' + env.CLAUDE_API_KEY.length + ' ch)' : '❌ MISSING'}\n`;
  report += `<b>VITE_CLAUDE_API_KEY:</b> ${env.VITE_CLAUDE_API_KEY ? '✅ Found (' + env.VITE_CLAUDE_API_KEY.length + ' ch)' : '❌ MISSING'}\n`;
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
Example: <code>/compare SMH QQQM</code>, <code>/compare TCS INFY</code>

🔗 <b>/correlate</b>
Portfolio correlation matrix — diversification check.

🧪 <b>/backtest</b>
AI signal accuracy — check how well today's signals performed.

📊 <b>/streak</b>
Performance streak tracker — consecutive green/red days history.

📊 <b>/etf</b>
ETF portfolio analysis — categorization, P&L, allocation.

🪙 <b>/crypto</b>
Crypto market — BTC, ETH, SOL and more with INR conversion.

💰 <b>/sip &lt;AMOUNT&gt;</b>
SIP calculator — future value projections at various CAGRs.
Example: <code>/sip 10000</code>

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

💎 <i>Deep Mind AI Quantum Pro Terminal v4.0</i>`;

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
    } catch(e) {}
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
  const chatId = msg.chat.id;
  clearChatHistory(chatId);
  console.log(`📥 /clear from ${msg.from?.first_name || chatId}`);
  await safeSend(chatId, '🧹 <b>Chat history cleared!</b>\n\nFresh start — ab naya sawaal pucho!');
});

// ========================================
// COMMAND: /setkey (Admin-only Groq key update)
// ========================================
bot.onText(/^\/setkey(?:@\w+)?\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const key = match[1].trim();
  console.log(`📥 /setkey from ${msg.from?.first_name || chatId}`);
  await safeSend(chatId, '⚠️ <b>API Keys are pre-configured!</b>\n\nYe system already environment me configure hai. Admin se contact karo agar key change karni hai.');
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
    await safeSend(chatId, '⚠️ <b>Symbols missing!</b>\n\nDono symbols likho!\n\nExample: <code>/compare RELIANCE TCS</code> or <code>/compare SMH QQQM</code>');
    return;
  }
  const args = match[1].trim().toUpperCase().split(/[\s,vs]+/);
  console.log(`📥 /compare ${args.join(' vs ')} from ${msg.from?.first_name || chatId}`);
  try {
    if (args.length < 2) {
      await safeSend(chatId, '⚠️ Dono symbols likho!\n\nExample: <code>/compare RELIANCE TCS</code> or <code>/compare SMH QQQM</code>');
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

    let report = `🧪 <b>AI SIGNAL ACCURACY — Backtest</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i>\n`;
    report += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    const signals = portfolio.map(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      return analyzeAsset(p, data);
    });

    const buyCount = signals.filter(s => s.signal.includes('BUY')).length;
    const sellCount = signals.filter(s => s.signal.includes('SELL')).length;
    const holdCount = signals.filter(s => s.signal === 'HOLD').length;

    const totalAssets = signals.length;
    const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / totalAssets;

    const actualGainers = signals.filter(s => s.change > 0).length;
    const buyCorrect = signals.filter(s => s.signal.includes('BUY') && s.change > 0).length;
    const sellCorrect = signals.filter(s => s.signal.includes('SELL') && s.change < 0).length;
    const holdCorrect = signals.filter(s => s.signal === 'HOLD' && Math.abs(s.change) < 2).length;

    const totalCorrect = buyCorrect + sellCorrect + holdCorrect;
    const accuracy = totalAssets > 0 ? ((totalCorrect / totalAssets) * 100).toFixed(1) : '0';

    report += `📊 <b>Signal Summary:</b>\n`;
    report += `BUY: ${buyCount} | SELL: ${sellCount} | HOLD: ${holdCount}\n`;
    report += `Avg Confidence: <b>${avgConfidence.toFixed(1)}%</b>\n\n`;

    report += `📈 <b>Accuracy Check (vs Today's Move):</b>\n`;
    report += `BUY signals that went UP: <b>${buyCorrect}/${buyCount}</b>\n`;
    report += `SELL signals that went DOWN: <b>${sellCorrect}/${sellCount}</b>\n`;
    report += `HOLD signals that stayed flat: <b>${holdCorrect}/${holdCount}</b>\n\n`;

    const accBar = '🟩'.repeat(Math.round(parseFloat(accuracy) / 10)) + '⬜'.repeat(10 - Math.round(parseFloat(accuracy) / 10));
    report += `<code>[${accBar}] ${accuracy}%</code>\n\n`;

    if (parseFloat(accuracy) > 70) report += `🟢 <b>Excellent!</b> AI signals are highly accurate today.`;
    else if (parseFloat(accuracy) > 50) report += `🟡 <b>Decent.</b> AI signals are reasonable. Always use SL.`;
    else report += `🔴 <b>Caution!</b> Low signal accuracy today — market may be choppy. Reduce position sizes.`;

    report += `\n\n<i>Based on today's price action vs AI signals. Past accuracy ≠ future guarantee.</i>`;
    report += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /backtest error:', e.message);
    await safeSend(chatId, `❌ Backtest error: ${e.message}`);
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
  r += `5. ROTATE: QQQM\n\n`;

  r += `💎 <b>QQQM</b> (Core — Rarely Touch)\n`;
  r += `1. TRIM: Weight >42% (rare)\n`;
  r += `2. SIZE: 5-8% only\n`;
  r += `3. RE-ENTRY: Wait for 6-8% dip\n`;
  r += `4. STYLE: 2 equal parts (50% each)\n`;
  r += `5. ROTATE: SMH or VGT\n\n`;

  r += `⚡ <b>VGT</b> (Semi-Core)\n`;
  r += `1. TRIM: Weight >27% OR rally 22%+ in 3mo\n`;
  r += `2. SIZE: 10-12% of position\n`;
  r += `3. RE-ENTRY: Wait for 7-9% dip\n`;
  r += `4. STYLE: 2-3 equal parts\n`;
  r += `5. ROTATE: QQQM\n\n`;

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
// FREE TEXT → AI CHAT (any message without /)
// ========================================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  // Skip commands — they're handled above
  if (text.startsWith('/')) return;
  // Skip empty
  if (!text.trim()) return;

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

// ========================================
// /live — Real-Time Market Sensor (ALL data)
// ========================================
bot.onText(/^\/live(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '📡 <b>Fetching live sensor data...</b>', { parse_mode: 'HTML' });
  try {
    const [intel, cryptos, bonds] = await Promise.allSettled([
      fetchMarketIntelligence(),
      fetchCryptoPrices(),
      fetchBondYields()
    ]);
    const report = generateLiveReport(
      intel.status === 'fulfilled' ? intel.value : null,
      cryptos.status === 'fulfilled' ? cryptos.value : [],
      bonds.status === 'fulfilled' ? bonds.value : [],
      usdInrRate
    );
    await safeSend(msg.chat.id, report);
  } catch (e) {
    await safeSend(msg.chat.id, `❌ Error: ${e.message}`);
  }
});

// ========================================
// /crypto — Crypto Market Report
// ========================================
bot.onText(/^\/crypto(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🪙 <b>Fetching crypto prices...</b>', { parse_mode: 'HTML' });
  try {
    const cryptos = await fetchCryptoPrices();
    const report = generateCryptoReport(cryptos, usdInrRate);
    await safeSend(msg.chat.id, report);
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
// /etf — ETF Portfolio Analysis
// ========================================
bot.onText(/^\/etf(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await refreshPrices();
  const report = generateETFReport(portfolio, livePrices, usdInrRate);
  await safeSend(msg.chat.id, report);
});

// ========================================
// /digest — Daily Market Digest
// ========================================
bot.onText(/^\/digest(@\w+)?$/i, async (msg) => {
  if (!isAuthorized(msg)) return;
  await safeSend(msg.chat.id, '🌅 <b>Generating daily digest...</b>', { parse_mode: 'HTML' });
  try {
    await refreshPrices();
    const [intel, cryptos, bonds] = await Promise.allSettled([
      fetchMarketIntelligence(),
      fetchCryptoPrices(),
      fetchBondYields()
    ]);
    const report = generateDigestReport(
      intel.status === 'fulfilled' ? intel.value : null,
      cryptos.status === 'fulfilled' ? cryptos.value : [],
      bonds.status === 'fulfilled' ? bonds.value : [],
      usdInrRate, portfolio, livePrices
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



// 🌅 8:00 AM IST Daily Digest — Morning Brief
cron.schedule('30 2 * * 1-5', async () => {
  // 2:30 UTC = 8:00 AM IST
  console.log(`🌅 Daily Digest triggered at ${getISTTime()} IST`);
  try {
    await refreshPrices();
    const [intel, cryptos, bonds] = await Promise.allSettled([
      fetchMarketIntelligence(),
      fetchCryptoPrices(),
      fetchBondYields()
    ]);
    const report = generateDigestReport(
      intel.status === 'fulfilled' ? intel.value : null,
      cryptos.status === 'fulfilled' ? cryptos.value : [],
      bonds.status === 'fulfilled' ? bonds.value : [],
      usdInrRate, portfolio, livePrices
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
// BOOT UP
// ========================================
initializeData().then(() => {
  console.log('🚀 All systems GO! Bot is listening for commands...');
  console.log(`📱 Chat ID: ${TG_CHAT_ID}`);
  console.log(`   Market Status: ${getMarketStatus()}`);
  console.log(`   Auto Alerts: ${autoAlerts ? 'ON' : 'OFF'}`);
  console.log(`   Groq AI: ${GROQ_KEY ? 'ONLINE' : 'OFFLINE (set via /setkey)'}`);
  console.log('');
  // Send boot notification
  safeSend(TG_CHAT_ID, `🟢 <b>Deep Mind AI Bot ONLINE</b>\n⏰ ${getISTTime()} IST\n💼 Portfolio: ${portfolio.length} positions\n📊 Market: ${getMarketStatus()}\n🧠 AI: ${GROQ_KEY ? 'Active (Groq)' : 'Inactive'}\n\nType /help for commands.`).catch(() => {});
}).catch(err => {
  console.error('❌ Boot error (non-fatal):', err.message);
  console.log('⚡ Bot is STILL listening for commands with limited data...');
  botReady = true; // Allow commands even if boot partially failed
});
