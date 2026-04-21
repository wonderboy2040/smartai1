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
import { TG_TOKEN, TG_CHAT_ID, AI_KEYS } from './config.mjs';
import { batchFetchPrices, fetchForexRate, fetchMarketIntelligence, fetchSingleSymbol, trackVixChange, isAnyMarketOpen, getMarketStatus, getISTTime, isIndiaMarketOpen, isUSMarketOpen } from './market.mjs';
import { loadPortfolioFromCloud, loadAIKeysFromCloud } from './cloud.mjs';
import {
  generatePortfolioReport, generateMarketReport, generateSignalsReport,
  generateAllocationReport, generateRiskReport, generateAutoReport,
  generateForexReport, calculateMetrics, generateScanReport,
  generateHeatmapReport, generateCompareReport, analyzeAsset
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

  // Step 2: AI Keys (non-blocking)
  try {
    console.log('🔑 Loading AI Super Intelligence keys...');
    await loadAIKeysFromCloud();
    const activeKeys = Object.values(AI_KEYS).filter(k => k && k.length > 10).length;
    console.log(`✅ AI Keys: ${activeKeys}/${3} loaded from cloud`);
  } catch (e) {
    console.warn('⚠️  AI keys load failed:', e.message);
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
  console.log(`   BOT FULLY ONLINE — ${getISTTime()} IST`);
  console.log(`   Portfolio: ${portfolio.length} positions`);
  console.log(`   AI: ${Object.values(AI_KEYS).some(k => k && k.length > 10) ? 'ONLINE (Neural System)' : 'OFFLINE (no keys)'}`);
  console.log(`   Market: ${getMarketStatus()}`);
  console.log('🟢 ════════════════════════════════════════');
  console.log('');

  // Step 6: Set Persistent Telegram Menu Commands
  try {
  await bot.setMyCommands([
        { command: 'start', description: 'Main Menu & Overview' },
        { command: 'portfolio', description: 'Full Portfolio Analysis' },
        { command: 'market', description: 'Global Market Snapshot' },
        { command: 'premarket', description: 'Pre-market Intelligence' },
        { command: 'options', description: 'Options Analysis (PCR/IV)' },
        { command: 'strategy', description: 'AI Option Strategies' },
        { command: 'news', description: 'Global Market Sentiment' },
        { command: 'fundamental', description: 'Deep Fundamental Analysis' },
        { command: 'signals', description: 'AI Buy/Sell Signals' },
        { command: 'allocation', description: 'Smart SIP Matrix' },
        { command: 'risk', description: 'Risk & VIX Assessment' },
        { command: 'trim', description: 'Trim + Re-Entry Rules Card' },
        { command: 'scan', description: 'Deep scan any symbol' },
        { command: 'compare', description: 'Head-to-head comparison' },
        { command: 'heatmap', description: 'Visual Heatmap' },
        { command: 'correlate', description: 'Portfolio Correlation Matrix' },
        { command: 'orderflow', description: 'Smart Money Order Flow' },
        { command: 'gap', description: 'Gap Up/Down Scanner' },
        { command: 'backtest', description: 'AI Signal Accuracy Check' },
        { command: 'streak', description: 'Performance streak tracker' },
        { command: 'forex', description: 'Live Forex (USD/INR)' },
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

  const welcome = `🧠 <b>DEEP MIND AI — Trading Bot v3.0</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

Nagraj Bhai, main tumhara personal AI Trading assistant hoon! 24x7 tumhare portfolio ko monitor kar raha hoon aur market hours me automatic analysis bhejta hoon.

⚡ <b>Available Commands:</b>

📊 /portfolio — Full portfolio analysis + P&L
🌍 /market — Global market snapshot
🌅 /premarket — Pre-market intelligence (GIFT Nifty + Futures)
🎯 /signals — AI buy/sell signals
📈 /allocation — Smart SIP allocation matrix
🛡️ /risk — Risk assessment + VIX analysis
🔍 /scan &lt;SYMBOL&gt; — Deep scan any symbol
 ⚖️ /compare &lt;SYM1&gt; &lt;SYM2&gt; — Head-to-head comparison
 🗺️ /heatmap — Visual portfolio heatmap
 🔗 /correlate — Portfolio Correlation Matrix
 🏦 /orderflow — Smart Money Order Flow
 📊 /gap — Gap Up/Down Scanner
 🧪 /backtest — AI Signal Accuracy Check
 📊 /streak — Performance streak tracker
💱 /forex — Live USD/INR rate
✂️ /trim — Trim + Re-Entry Rules Card
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
⚡ <b>Superintelligent AI Tools:</b>
🧠 /options — Live PCR & IV Options Analysis
🎯 /strategy — Executable Option Strategies
🌍 /news — Global Market News Sentiment
💼 /fundamental — Deep Balance Sheet Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Status: <b>${getMarketStatus()}</b>
💼 Portfolio: <b>${portfolio.length} positions</b>
🔔 Auto Alerts: <b>${autoAlerts ? 'ON ✅' : 'OFF ❌'}</b>
━━━━━━━━━━━━━━━━━━━━━━━━━
💎 <i>Powered by Deep Mind AI Pro Trading Terminal v3.0</i>`;

  await safeSend(chatId, welcome);
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
// COMMAND: /options — AI Options Analysis
// ========================================
bot.onText(/^\/options?(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /options from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🧠 <i>Scanning live Option Chain for NIFTY/BankNIFTY... analyzing PCR & Max Pain...</i>\n\nThis is a Superintelligent Deep AI Feature.');
    await refreshPrices();
    const response = await chatWithAI(chatId, 'Scan live Option Chain for NIFTY. Analyze Put-Call Ratio (PCR), Max Pain, and Implied Volatility to find strong support and resistance levels. Provide an actionable conclusion.', portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ /options error:', e.message);
    await safeSend(chatId, `❌ /options fetch me error: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /strategy — AI Option Strategist
// ========================================
bot.onText(/^\/strateg(?:y|ies)(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /strategy from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🎯 <i>Building optimal Option Strategies based on VIX and current trend...</i>\n\nThis is a Superintelligent Deep AI Feature.');
    await refreshPrices();
    const response = await chatWithAI(chatId, 'Based on current market volatility and trend, build 2 optimal actionable Option Strategies (e.g. Bull Call Spread, Iron Condor) with exact strikes, target, SL, and Risk:Reward.', portfolio, livePrices, usdInrRate);
    await safeSend(chatId, response);
  } catch (e) {
    console.error('❌ /strategy error:', e.message);
    await safeSend(chatId, `❌ /strategy fetch me error: ${e.message}\n\nPlease try again.`);
  }
});

// ========================================
// COMMAND: /news — News Sentiment
// ========================================
bot.onText(/^\/news(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /news from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🌍 <i>Synthesizing latest global market news... extracting sentiment score...</i>\n\nThis is a Superintelligent Deep AI Feature.');
    const response = await chatWithAI(chatId, 'Summarize the latest financial market news and calculate a collective Bullish/Bearish sentiment score (1-100) affecting Indian and US markets today.', portfolio, livePrices, usdInrRate);
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
// COMMAND: /premarket — Pre-Market Intelligence
// ========================================
bot.onText(/^\/premarket(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /premarket from ${msg.from?.first_name || chatId}`);
  try {
    await safeSend(chatId, '🌅 <i>Fetching global pre-market data...</i>');
    
    const tickers = [
      'NSE:GIFT_NIFTY', 'NSE:GIFTYNIFTY',
      'CME_MINI:ES1!', 'CME_MINI:NQ1!',
      'TVC:NI225', 'TVC:HSI', 'XETR:DAX',
      'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!'
    ];
    
    const nameMap = {
      'NSE:GIFT_NIFTY':  '🎯 GIFT Nifty',
      'NSE:GIFTYNIFTY':  '🎯 GIFT Nifty',
      'CME_MINI:ES1!':   '🇺🇸 S&P 500 Fut',
      'CME_MINI:NQ1!':   '📱 NASDAQ Fut',
      'TVC:NI225':       '🇯🇵 Nikkei 225',
      'TVC:HSI':         '🇭🇰 Hang Seng',
      'XETR:DAX':        '🇩🇪 DAX',
      'TVC:DXY':         '💵 DXY Dollar',
      'COMEX:GC1!':      '🥇 Gold',
      'NYMEX:CL1!':      '🛢️ Crude Oil',
    };
    
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ symbols: { tickers }, columns: ['close', 'change'] }),
      signal: AbortSignal.timeout(10000)
    });
    
    let report = `🌅 <b>PRE-MARKET INTELLIGENCE</b>\n`;
    report += `⏰ <i>${getISTTime()} IST</i>\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const seen = new Set();
    let giftChange = 0;
    let esChange = 0;
    let nqChange = 0;
    
    if (res.ok) {
      const data = await res.json();
      if (data?.data) {
        for (const item of data.data) {
          const name = nameMap[item.s];
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const price = parseFloat(item.d?.[0]) || 0;
          const change = parseFloat(item.d?.[1]) || 0;
          if (price <= 0) continue;
          
          if (item.s.includes('GIFT')) giftChange = change;
          if (item.s === 'CME_MINI:ES1!') esChange = change;
          if (item.s === 'CME_MINI:NQ1!') nqChange = change;
          
          const arrow = change >= 0 ? '▲' : '▼';
          const sign  = change >= 0 ? '+' : '';
          report += `${name}\n`;
          report += `  ${arrow} <b>${sign}${change.toFixed(2)}%</b> | ${price > 1000 ? price.toFixed(0) : price.toFixed(2)}\n\n`;
        }
      }
    }
    
    // AI Verdict
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🧠 <b>AI Pre-Market Verdict:</b>\n`;
    const avgUS = (esChange + nqChange) / 2;
    if (giftChange > 0.5 || avgUS > 0.5) {
      report += `🟢 Strong pre-market! GIFT ${giftChange >= 0 ? '+' : ''}${giftChange.toFixed(2)}% — Gap-Up expected. Bullish open ho sakta hai!`;
    } else if (giftChange < -0.5 || avgUS < -0.5) {
      report += `🔴 Weak pre-market — GIFT ${giftChange.toFixed(2)}%. Gap-Down risk! First 15-min candle break karo phir entry lo.`;
    } else {
      report += `🟡 Mixed signals — Flat to rangebound open expected. Wait for direction.`;
    }
    
    report += `\n\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, report);
    
  } catch (e) {
    console.error('❌ /premarket error:', e.message);
    await safeSend(chatId, `❌ Pre-market data fetch me error: ${e.message}\n\nPlease try again.`);
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
// COMMAND: /signals
// ========================================
bot.onText(/^\/signals(@\w+)?$/i, async (msg) => {
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
    await safeSend(chatId, report);
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
// COMMAND: /setkey (set AI API keys)
// Usage: /setkey gemini YOUR_KEY
//        /setkey perplexity YOUR_KEY
//        /setkey deepseek YOUR_KEY
// ========================================
bot.onText(/^\/setkey(?:@\w+)?\s+(gemini|perplexity|deepseek)\s+(.+)/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const provider = match[1].toUpperCase();
  const key = match[2].trim();
  console.log(`📥 /setkey ${provider} from ${msg.from?.first_name || chatId}`);
  try {
    const { setAIKeys, API_URL, AI_ENDPOINTS } = await import('./config.mjs');
    setAIKeys({ [provider]: key });

    // Sync to cloud
    try {
      const payload = provider === 'GEMINI' ? { geminiKey: key } :
                      provider === 'PERPLEXITY' ? { perplexityKey: key } :
                      { deepseekKey: key };
      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...payload, action: 'saveKey', timestamp: Date.now() })
      });
    } catch (e) {}

    const providerName = provider === 'GEMINI' ? 'Gemini 1.5 Pro' :
                         provider === 'PERPLEXITY' ? 'Perplexity Sonar' :
                         'DeepSeek V3';
    await safeSend(chatId, `✅ <b>${providerName} API Key Set!</b>\n\nAI Neural Engine ab <b>ONLINE</b> 🧠⚡️\nProvider: ${providerName}\nTum abhi kisi bhi sawal ka answer AI se le sakte ho!`);
  } catch (e) {
    console.error('❌ /setkey error:', e.message);
    await safeSend(chatId, `❌ Key set me error: ${e.message}\n\nUse: <code>/setkey gemini YOUR_KEY</code>`);
  }
});

// ========================================
// COMMAND: /showkeys (show configured providers)
// ========================================
bot.onText(/^\/showkeys(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /showkeys from ${msg.from?.first_name || chatId}`);
  const keys = Object.entries(AI_KEYS).filter(([_, v]) => v && v.length > 10);
  if (keys.length === 0) {
    await safeSend(chatId, '❌ <b>No AI keys configured!</b>\n\nSet keys via:\n<code>/setkey gemini YOUR_GEMINI_KEY</code>\n<code>/setkey perplexity YOUR_PERPLEXITY_KEY</code>\n<code>/setkey deepseek YOUR_DEEPSEEK_KEY</code>');
    return;
  }
  const list = keys.map(([k]) => `• ${k === 'GEMINI' ? 'Gemini 1.5 Pro' : k === 'PERPLEXITY' ? 'Perplexity Sonar' : 'DeepSeek V3'}`).join('\n');
  await safeSend(chatId, `✅ <b>AI Providers Configured:</b>\n\n${list}\n\nUse /clearchat to reset conversation and start fresh!`);
});

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
// COMMAND: /heatmap — Portfolio Heatmap
// ========================================
bot.onText(/^\/heatmap(@\w+)?$/i, async (msg) => {
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
// COMMAND: /streak — Performance Streak
// ========================================
bot.onText(/^\/streak(@\w+)?$/i, async (msg) => {
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

    let msg = `🔗 <b>CORRELATION MATRIX</b>\n`;
    msg += `⏰ <i>${getISTTime()} IST</i>\n\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;

    for (let i = 0; i < changes.length; i++) {
      for (let j = i + 1; j < changes.length; j++) {
        const a = changes[i];
        const b = changes[j];
        const corr = a.change * b.change > 0 ? '🟢' : a.change * b.change < 0 ? '🔴' : '⚪';
        const strength = Math.abs(a.change - b.change);
        const label = strength < 0.5 ? 'STRONG' : strength < 1.5 ? 'MODERATE' : 'WEAK';
        msg += `${corr} <b>${a.sym}</b> ↔ <b>${b.sym}</b>: ${label}\n`;
        msg += `  ${a.sym}: ${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}% | ${b.sym}: ${b.change >= 0 ? '+' : ''}${b.change.toFixed(2)}%\n`;
      }
    }

    const allPositive = changes.every(c => c.change > 0);
    const allNegative = changes.every(c => c.change < 0);
    const mixed = !allPositive && !allNegative;

    msg += `\n🧠 <b>Correlation Verdict:</b>\n`;
    if (allPositive) msg += `🟢 Sab same direction me move kar rahe — strong positive correlation. Diversification LOW.`;
    else if (allNegative) msg += `🔴 Sab neeche ja rahe — systematic risk HIGH. Hedge karo!`;
    else msg += `🟡 Mixed movement — good diversification. Portfolio balanced hai.`;

    msg += `\n\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, msg);
  } catch (e) {
    console.error('❌ /correlate error:', e.message);
    await safeSend(chatId, `❌ Correlation error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /orderflow — Smart Money Order Flow
// ========================================
bot.onText(/^\/orderflow(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /orderflow from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai.');
      return;
    }
    await safeSend(chatId, '🏦 <i>Detecting Smart Money flow... analyzing volume & price action...</i>');
    await refreshPrices();

    let msg = `🏦 <b>SMART MONEY ORDER FLOW</b>\n`;
    msg += `⏰ <i>${getISTTime()} IST</i>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    let accumulation = [];
    let distribution = [];
    let neutral = [];

    for (const p of portfolio) {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const change = data?.change || 0;
      const volume = data?.volume || 0;
      const rsi = data?.rsi || 50;
      const sym = p.symbol.replace('.NS', '');

      const isVolumeSpike = volume > 1000000 && Math.abs(change) > 1.5;
      const isAccumulation = isVolumeSpike && change > 0 && rsi < 50;
      const isDistribution = isVolumeSpike && change < 0 && rsi > 50;

      if (isAccumulation) accumulation.push({ sym, change, volume, rsi, price: data?.price || p.avgPrice, market: p.market });
      else if (isDistribution) distribution.push({ sym, change, volume, rsi, price: data?.price || p.avgPrice, market: p.market });
      else neutral.push({ sym, change, volume, rsi, price: data?.price || p.avgPrice, market: p.market });
    }

    if (accumulation.length > 0) {
      msg += `🟢 <b>ACCUMULATION DETECTED</b>\n`;
      for (const a of accumulation) {
        const cur = a.market === 'IN' ? '₹' : '$';
        msg += `• <b>${a.sym}</b>: ${cur}${a.price.toFixed(2)} (${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}%)\n`;
        msg += `  Vol: ${(a.volume/1000000).toFixed(1)}M | RSI: ${a.rsi.toFixed(0)} | 🏦 Institutional BUYING\n`;
      }
      msg += '\n';
    }

    if (distribution.length > 0) {
      msg += `🔴 <b>DISTRIBUTION DETECTED</b>\n`;
      for (const d of distribution) {
        const cur = d.market === 'IN' ? '₹' : '$';
        msg += `• <b>${d.sym}</b>: ${cur}${d.price.toFixed(2)} (${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)}%)\n`;
        msg += `  Vol: ${(d.volume/1000000).toFixed(1)}M | RSI: ${d.rsi.toFixed(0)} | 🏦 Institutional SELLING\n`;
      }
      msg += '\n';
    }

    msg += `⚪ <b>NEUTRAL:</b> ${neutral.map(n => n.sym).join(', ') || 'None'}\n\n`;

    msg += `🧠 <b>Order Flow Verdict:</b>\n`;
    if (accumulation.length > distribution.length) msg += `🟢 Smart Money BUYING dominant — bullish institutional bias.`;
    else if (distribution.length > accumulation.length) msg += `🔴 Smart Money DISTRIBUTION — institutional exit detected. Caution!`;
    else msg += `🟡 Mixed flow — no clear institutional direction.`;

    msg += `\n\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, msg);
  } catch (e) {
    console.error('❌ /orderflow error:', e.message);
    await safeSend(chatId, `❌ Order flow error: ${e.message}`);
  }
});

// ========================================
// COMMAND: /gap — Gap Scanner
// ========================================
bot.onText(/^\/gap(@\w+)?$/i, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /gap from ${msg.from?.first_name || chatId}`);
  try {
    if (portfolio.length === 0) {
      await safeSend(chatId, '⚠️ Portfolio empty hai.');
      return;
    }
    await safeSend(chatId, '📊 <i>Scanning for gap openings...</i>');
    await refreshPrices();

    let msg = `📊 <b>GAP SCANNER</b>\n`;
    msg += `⏰ <i>${getISTTime()} IST</i>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

    for (const p of portfolio) {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      if (!data) continue;
      const cur = p.market === 'IN' ? '₹' : '$';
      const price = data.price;
      const open = data.open || price;
      const prevClose = open / (1 + (data.change || 0) / 100);
      const gapPct = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
      const sym = p.symbol.replace('.NS', '');

      if (Math.abs(gapPct) > 0.3) {
        const emoji = gapPct > 0 ? '🟢' : '🔴';
        const gapType = gapPct > 1 ? 'GAP UP STRONG' : gapPct > 0.3 ? 'GAP UP' : gapPct < -1 ? 'GAP DOWN STRONG' : 'GAP DOWN';
        msg += `${emoji} <b>${sym}</b>: ${gapType}\n`;
        msg += `  Open: ${cur}${open.toFixed(2)} | Prev: ${cur}${prevClose.toFixed(2)} | Gap: <b>${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%</b>\n`;
        if (gapPct > 0.5) msg += `  ⚡ Gap-up — likely buying pressure at open. Watch for gap fill.\n`;
        else if (gapPct < -0.5) msg += `  ⚠️ Gap-down — selling pressure. Wait for reversal candle.\n`;
        msg += '\n';
      }
    }

    if (msg.includes('GAP UP') || msg.includes('GAP DOWN')) {
      msg += `🧠 <b>Gap Strategy:</b>\n`;
      msg += `<i>Gap-up stocks: Fade the gap if volume is low. Ride the gap if volume confirms.\n`;
      msg += `Gap-down stocks: Wait for first 15-min candle. Buy if hammer/reversal pattern forms.</i>\n`;
    } else {
      msg += `⚪ No significant gaps detected today.\n`;
    }

    msg += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, msg);
  } catch (e) {
    console.error('❌ /gap error:', e.message);
    await safeSend(chatId, `❌ Gap scan error: ${e.message}`);
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

    let msg = `🧪 <b>AI SIGNAL ACCURACY — Backtest</b>\n`;
    msg += `⏰ <i>${getISTTime()} IST</i>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

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

    msg += `📊 <b>Signal Summary:</b>\n`;
    msg += `BUY: ${buyCount} | SELL: ${sellCount} | HOLD: ${holdCount}\n`;
    msg += `Avg Confidence: <b>${avgConfidence.toFixed(1)}%</b>\n\n`;

    msg += `📈 <b>Accuracy Check (vs Today's Move):</b>\n`;
    msg += `BUY signals that went UP: <b>${buyCorrect}/${buyCount}</b>\n`;
    msg += `SELL signals that went DOWN: <b>${sellCorrect}/${sellCount}</b>\n`;
    msg += `HOLD signals that stayed flat: <b>${holdCorrect}/${holdCount}</b>\n\n`;

    const accBar = '🟩'.repeat(Math.round(parseFloat(accuracy) / 10)) + '⬜'.repeat(10 - Math.round(parseFloat(accuracy) / 10));
    msg += `<code>[${accBar}] ${accuracy}%</code>\n\n`;

    if (parseFloat(accuracy) > 70) msg += `🟢 <b>Excellent!</b> AI signals are highly accurate today.`;
    else if (parseFloat(accuracy) > 50) msg += `🟡 <b>Decent.</b> AI signals are reasonable. Always use SL.`;
    else msg += `🔴 <b>Caution!</b> Low signal accuracy today — market may be choppy. Reduce position sizes.`;

    msg += `\n\n<i>Based on today's price action vs AI signals. Past accuracy ≠ future guarantee.</i>`;
    msg += `\n💎 <i>Deep Mind AI Pro Terminal</i>`;
    await safeSend(chatId, msg);
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
  r += `5. ROTATE: SMH or XLK\n\n`;

  r += `⚡ <b>XLK</b> (Semi-Core)\n`;
  r += `1. TRIM: Weight >27% OR rally 22%+ in 3mo\n`;
  r += `2. SIZE: 10-12% of position\n`;
  r += `3. RE-ENTRY: Wait for 7-9% dip\n`;
  r += `4. STYLE: 2-3 equal parts\n`;
  r += `5. ROTATE: QQQM\n\n`;

  await safeSend(chatId, r);

  // Part 2: India ETFs
  let r2 = `🇮🇳 <b>INDIA ETFs:</b>\n\n`;

  r2 += `🇮🇳 <b>MOMOMENTUM</b> (Aggressive)\n`;
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
  console.log(`   AI: ${Object.values(AI_KEYS).some(k => k && k.length > 10) ? 'ONLINE (Neural System)' : 'OFFLINE (no keys)'}`);
  console.log('');
  // Send boot notification
  safeSend(TG_CHAT_ID, `🟢 <b>Deep Mind AI Bot ONLINE</b>\n⏰ ${getISTTime()} IST\n💼 Portfolio: ${portfolio.length} positions\n📊 Market: ${getMarketStatus()}\n🧠 AI: ${Object.values(AI_KEYS).some(k => k && k.length > 10) ? 'Active (Neural)' : 'Inactive'}\n\nType /help for commands.`).catch(() => {});
}).catch(err => {
  console.error('❌ Boot error (non-fatal):', err.message);
  console.log('⚡ Bot is STILL listening for commands with limited data...');
  botReady = true; // Allow commands even if boot partially failed
});
