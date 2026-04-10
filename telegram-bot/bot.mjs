// ============================================
// 🤖 DEEP MIND AI TRADING BOT — MAIN SERVER
// ============================================
// Telegram Command System + AI Chat + Auto Analysis
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { TG_TOKEN, TG_CHAT_ID, GEMINI_KEY } from './config.mjs';
import { batchFetchPrices, fetchForexRate, fetchMarketIntelligence, fetchSingleSymbol, trackVixChange, isAnyMarketOpen, getMarketStatus, getISTTime, isIndiaMarketOpen, isUSMarketOpen } from './market.mjs';
import { loadPortfolioFromCloud, loadGeminiKeyFromCloud } from './cloud.mjs';
import { 
  generatePortfolioReport, generateMarketReport, generateSignalsReport,
  generateAllocationReport, generateRiskReport, generateAutoReport,
  generateForexReport, calculateMetrics, generateScanReport,
  generateHeatmapReport, generateCompareReport
} from './analysis.mjs';
import { chatWithAI, clearChatHistory } from './ai-chat.mjs';

// ========================================
// GLOBAL STATE
// ========================================
let portfolio = [];
let livePrices = {};
let usdInrRate = 85.5;
let marketIntel = null;
let autoAlerts = true;
let botReady = false;

// Performance streak tracking
let dailyPLHistory = []; // { date, pl, pct }
let consecutiveStreak = 0; // positive = green days, negative = red days

// ========================================
// 🌐 FULL SITE + BOT SERVER (For Render deployment)
// ========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the compiled Vite React frontend
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Fallback to React Router or ping message
app.get('*', (req, res) => {
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
console.log('║  🧠 DEEP MIND AI TRADING BOT v1.0           ║');
console.log('║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║');
console.log('║  Telegram AI Trading Command System         ║');
console.log('║  24x7 Portfolio Analysis + Pro Signals       ║');
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

  // Step 2: Gemini Key (non-blocking)
  try {
    console.log('🔑 Loading Gemini API key...');
    await loadGeminiKeyFromCloud();
    console.log(`✅ Gemini key: ${GEMINI_KEY ? 'SET (' + GEMINI_KEY.substring(0, 8) + '...)' : 'NOT SET'}`);
  } catch (e) {
    console.warn('⚠️  Gemini key load failed:', e.message);
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
    console.warn('⚠️  Market intelligence partial:', e.message);
  }

  botReady = true;
  console.log('');
  console.log('🟢 ════════════════════════════════════════');
  console.log(`   BOT FULLY ONLINE — ${getISTTime()} IST`);
  console.log(`   Portfolio: ${portfolio.length} positions`);
  console.log(`   Gemini AI: ${GEMINI_KEY ? 'ACTIVE' : 'INACTIVE (no key)'}`);
  console.log(`   Market: ${getMarketStatus()}`);
  console.log('🟢 ════════════════════════════════════════');
  console.log('');
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
bot.onText(/^\/start(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /start from ${msg.from?.first_name || chatId}`);

  const welcome = `🧠 <b>DEEP MIND AI — Trading Bot v2.0</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

Nagraj Bhai, main tumhara personal AI Trading assistant hoon! 24x7 tumhare portfolio ko monitor kar raha hoon aur market hours me automatic analysis bhejta hoon.

⚡ <b>Available Commands:</b>

📊 /portfolio — Full portfolio analysis + P&L
🌍 /market — Global market snapshot
🎯 /signals — AI buy/sell signals
📈 /allocation — Smart SIP allocation matrix
🛡️ /risk — Risk assessment + VIX analysis
🔍 /scan &lt;SYMBOL&gt; — Deep scan any symbol
⚖️ /compare &lt;SYM1&gt; &lt;SYM2&gt; — Head-to-head comparison
🗺️ /heatmap — Visual portfolio heatmap
📊 /streak — Performance streak tracker
💱 /forex — Live USD/INR rate
🔔 /alert — Toggle auto alerts ON/OFF
🧹 /clear — Clear AI chat history
❓ /help — Full command reference

🧠 <b>AI Chat Mode:</b>
Simply type any question (without /) to chat with Deep Mind AI!

Examples:
• <i>market kaisa hai?</i>
• <i>kisme invest karu?</i>
• <i>NIFTY ka analysis do</i>
• <i>risk assessment karo</i>

━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Status: <b>${getMarketStatus()}</b>
💼 Portfolio: <b>${portfolio.length} positions</b>
🔔 Auto Alerts: <b>${autoAlerts ? 'ON ✅' : 'OFF ❌'}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
💎 <i>Powered by Deep Mind AI Pro Trading Terminal</i>`;

  await safeSend(chatId, welcome);
});

// ========================================
// COMMAND: /help
// ========================================
bot.onText(/^\/help(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /help from ${msg.from?.first_name || chatId}`);

  const help = `❓ <b>DEEP MIND AI — Command Reference</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

📊 <b>/portfolio</b>
Full portfolio breakdown — har position ka live price, P&L, RSI status.

🌍 <b>/market</b>
Global market radar — NIFTY, S&P 500, VIX, Sectors, Fear/Greed Index.

🎯 <b>/signals</b>
AI Buy/Sell signals — RSI + MACD + SMA analysis on all holdings.

📈 <b>/allocation</b>
Smart SIP allocation matrix — kaha kitna paisa lagana hai.

🛡️ <b>/risk</b>
Risk command center — VIX analysis, drawdown estimates, safety check.

🔍 <b>/scan &lt;SYMBOL&gt;</b>
Deep analysis of ANY symbol — RSI, MACD, SMA, Fib levels, performance.
Example: <code>/scan RELIANCE</code>, <code>/scan AAPL</code>

⚖️ <b>/compare &lt;SYM1&gt; &lt;SYM2&gt;</b>
Head-to-head comparison of two symbols.
Example: <code>/compare SMH QQQM</code>, <code>/compare TCS INFY</code>

🗺️ <b>/heatmap</b>
Visual portfolio heatmap — performance, RSI, weights at a glance.

📊 <b>/streak</b>
Performance streak tracker — consecutive green/red days history.

💱 <b>/forex</b>
Live USD/INR conversion rate.

🔔 <b>/alert</b>
Toggle scheduled auto-analysis ON/OFF.

🧠 <b>/ai &lt;question&gt;</b>
AI se direct kuch bhi pucho.

🧹 <b>/clear</b>
Chat history reset karo.

━━━━━━━━━━━━━━━━━━━━━━━━━
💬 <b>Pro Tip:</b> Bina command ke koi bhi message likho = AI chat mode automatic activate hoga!

💎 <i>Deep Mind AI Pro Trading Terminal v2.0</i>`;

  await safeSend(chatId, help);
});

// ========================================
// COMMAND: /portfolio
// ========================================
bot.onText(/^\/portfolio(@\w+)?$/, async (msg) => {
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
bot.onText(/^\/market(@\w+)?$/, async (msg) => {
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
// COMMAND: /signals
// ========================================
bot.onText(/^\/signals(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /signals from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai. Pehle web app se positions add karo.');
      return;
    }
    await safeSend(chatId, '🎯 <i>Running signal analysis... ek second...</i>');
    await refreshPrices();
    const report = generateSignalsReport(portfolio, livePrices);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /signals error:', e.message);
    await safeSend(chatId, `❌ Signal analysis me error aaya: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /allocation
// ========================================
bot.onText(/^\/allocation(@\w+)?$/, async (msg) => {
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
bot.onText(/^\/risk(@\w+)?$/, async (msg) => {
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
bot.onText(/^\/forex(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /forex from ${msg.from?.first_name || chatId}`);
  try {
    await refreshForex();
    const report = generateForexReport(usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /forex error:', e.message);
    await safeSend(chatId, `❌ Forex fetch me error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /alert (toggle auto-alerts)
// ========================================
bot.onText(/^\/alert(?:@\w+)?(?:\s+(.*))?$/, async (msg, match) => {
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
bot.onText(/^\/clear(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  clearChatHistory(chatId);
  console.log(`📥 /clear from ${msg.from?.first_name || chatId}`);
  await safeSend(chatId, '🧹 <b>Chat history cleared!</b>\n\nFresh start — ab naya sawaal pucho!');
});

// ========================================
// COMMAND: /setkey (set Gemini API key)
// ========================================
bot.onText(/^\/setkey(?:@\w+)?\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const key = match[1].trim();
  console.log(`📥 /setkey from ${msg.from?.first_name || chatId}`);
  try {
    // Set dynamically
    const { setGeminiKey, API_URL } = await import('./config.mjs');
    setGeminiKey(key);
    
    // Sync to cloud so web app can also use it
    try {
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ geminiKey: key, action: 'saveKey', timestamp: Date.now() })
      });
    } catch (e) {}

    await safeSend(chatId, '✅ <b>Gemini API Key Set!</b>\n\nAI Engine is now <b>ONLINE</b> 🧠⚡️ — Powered by Google Gemini Deep Analysis (FREE!).\nTum abhi kisi bhi sawal ka answer AI se le sakte ho!');
  } catch (e) {
    console.error('❌ /setkey error:', e.message);
    await safeSend(chatId, `❌ Key set me error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /ai <message> — Explicit AI chat
// ========================================
bot.onText(/^\/ai(?:@\w+)?\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  console.log(`📥 /ai "${query.substring(0, 50)}..." from ${msg.from?.first_name || chatId}`);
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
bot.onText(/^\/chat(?:@\w+)?\s+(.+)/, async (msg, match) => {
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
bot.onText(/^\/scan(?:@\w+)?\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
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
// COMMAND: /heatmap — Portfolio Heatmap
// ========================================
bot.onText(/^\/heatmap(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /heatmap from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai. Web app se positions add karo.');
      return;
    }
    await safeSend(chatId, '🗺️ <i>Generating heatmap... ek second...</i>');
    await refreshPrices();
    const report = generateHeatmapReport(portfolio, livePrices, usdInrRate);
    await safeSend(chatId, report);
  } catch (e) {
    console.error('❌ /heatmap error:', e.message);
    await safeSend(chatId, `❌ Heatmap me error aaya: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /compare <SYM1> <SYM2> — Side by Side
// ========================================
bot.onText(/^\/compare(?:@\w+)?\s+(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
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
// COMMAND: /streak — Performance Streak
// ========================================
bot.onText(/^\/streak(@\w+)?$/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /streak from ${msg.from?.first_name || chatId}`);
  try {
    let streakMsg = `📊 <b>Performance Streak Tracker</b>\n\n`;
    if (dailyPLHistory.length === 0) {
      streakMsg += `⚠️ Data abhi collect ho raha hai. Thodi der baad check karo.\n<i>Bot market close pe daily P&L record karta hai.</i>`;
    } else {
      const streak = consecutiveStreak;
      if (streak > 0) streakMsg += `🟢🔥 <b>${streak} consecutive GREEN days!</b>\n`;
      else if (streak < 0) streakMsg += `🔴 <b>${Math.abs(streak)} consecutive RED days</b>\n`;
      else streakMsg += `⚪ No streak active\n`;

      streakMsg += `\n<b>Recent History:</b>\n`;
      const recent = dailyPLHistory.slice(-7).reverse();
      for (const d of recent) {
        streakMsg += `${d.pl >= 0 ? '🟢' : '🔴'} ${d.date}: ${d.pl >= 0 ? '+' : ''}₹${Math.round(d.pl).toLocaleString('en-IN')} (${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%)\n`;
      }
    }
    streakMsg += `\n💎 <i>Deep Mind AI</i>`;
    await safeSend(chatId, streakMsg);
  } catch (e) {
    console.error('❌ /streak error:', e.message);
    await safeSend(chatId, `❌ Streak me error: ${e.message}`);
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

// Regular market hours scan: every 30 minutes (at :00 and :30)
cron.schedule('0,30 * * * *', async () => {
  if (!autoAlerts || portfolio.length === 0) return;
  if (!isAnyMarketOpen()) return;
  
  console.log(`📨 Scheduled scan at ${getISTTime()} IST`);
  await refreshPrices();
  const report = generateAutoReport(portfolio, livePrices, usdInrRate);
  await safeSend(TG_CHAT_ID, report);
});

// VIX Spike Emergency Alert: check every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  if (!autoAlerts || !isAnyMarketOpen()) return;
  const spike = trackVixChange(livePrices);
  if (spike) {
    const emoji = spike.severity === 'EXTREME' ? '🚨🚨🚨' : '⚠️⚠️';
    let msg = `${emoji} <b>VIX SPIKE ALERT!</b>\n\n`;
    msg += `US VIX: <b>${spike.usVix.toFixed(1)}</b> (${spike.usChange >= 0 ? '+' : ''}${spike.usChange.toFixed(1)}%)\n`;
    msg += `India VIX: <b>${spike.inVix.toFixed(1)}</b> (${spike.inChange >= 0 ? '+' : ''}${spike.inChange.toFixed(1)}%)\n\n`;
    msg += `<b>Severity:</b> ${spike.severity}\n`;
    if (spike.severity === 'EXTREME') {
      msg += `\n⚠️ <b>DANGER ZONE!</b> Institutional hedging massive. Protect your capital!`;
    } else {
      msg += `\n⚡ <i>Elevated volatility detected. Monitor positions closely.</i>`;
    }
    msg += `\n\n💎 <i>Deep Mind AI Auto Alert</i>`;
    await safeSend(TG_CHAT_ID, msg);
    console.log(`🚨 VIX spike alert sent: US ${spike.usChange.toFixed(1)}%, IN ${spike.inChange.toFixed(1)}%`);
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

bot.on('message', (msg) => {
  // Debug: log every incoming message to verify bot is receiving
  if (msg.text) {
    console.log(`📨 RAW MSG [${msg.chat.id}]: "${msg.text.substring(0, 60)}"`);
  }
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
  console.log(`   Gemini AI: ${GEMINI_KEY ? 'ONLINE' : 'OFFLINE (set via /setkey)'}`);
  console.log('');
  // Send boot notification
  safeSend(TG_CHAT_ID, `🟢 <b>Deep Mind AI Bot ONLINE</b>\n⏰ ${getISTTime()} IST\n💼 Portfolio: ${portfolio.length} positions\n📊 Market: ${getMarketStatus()}\n🧠 AI: ${GEMINI_KEY ? 'Active (Gemini)' : 'Inactive'}\n\nType /help for commands.`).catch(() => {});
}).catch(err => {
  console.error('❌ Boot error (non-fatal):', err.message);
  console.log('⚡ Bot is STILL listening for commands with limited data...');
  botReady = true; // Allow commands even if boot partially failed
});
