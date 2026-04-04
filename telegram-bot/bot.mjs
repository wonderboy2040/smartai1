// ============================================
// 🤖 DEEP MIND AI TRADING BOT — MAIN SERVER
// ============================================
// Telegram Command System + AI Chat + Auto Analysis
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { TG_TOKEN, TG_CHAT_ID, GROQ_KEY } from './config.mjs';
import { batchFetchPrices, fetchForexRate, fetchMarketIntelligence, isAnyMarketOpen, getMarketStatus, getISTTime, isIndiaMarketOpen, isUSMarketOpen } from './market.mjs';
import { loadPortfolioFromCloud, loadGroqKeyFromCloud } from './cloud.mjs';
import { 
  generatePortfolioReport, generateMarketReport, generateSignalsReport,
  generateAllocationReport, generateRiskReport, generateAutoReport,
  generateForexReport, calculateMetrics
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

const bot = new TelegramBot(TG_TOKEN, { polling: true });
console.log('📡 Telegram Bot polling started...');

// ========================================
// INITIAL DATA LOAD
// ========================================
async function initializeData() {
  console.log('☁️  Loading portfolio from cloud...');
  const cloudPortfolio = await loadPortfolioFromCloud();
  if (cloudPortfolio && cloudPortfolio.length > 0) {
    portfolio = cloudPortfolio;
    console.log(`✅ Portfolio loaded: ${portfolio.length} positions`);
  } else {
    console.log('⚠️  No portfolio data found in cloud');
  }

  console.log('🔑 Loading Groq API key...');
  await loadGroqKeyFromCloud();

  console.log('💱 Fetching forex rate...');
  usdInrRate = await fetchForexRate();
  console.log(`✅ USD/INR: ₹${usdInrRate.toFixed(2)}`);

  if (portfolio.length > 0) {
    console.log('📊 Fetching live prices...');
    livePrices = await batchFetchPrices(portfolio);
    console.log(`✅ Prices loaded: ${Object.keys(livePrices).length} symbols`);
  }

  console.log('🌍 Fetching market intelligence...');
  try {
    marketIntel = await fetchMarketIntelligence();
    console.log(`✅ Market intel: ${marketIntel.globalIndices.length} indices, ${marketIntel.sectors.length} sectors`);
  } catch (e) {
    console.log('⚠️  Market intelligence partial');
  }

  botReady = true;
  console.log('');
  console.log('🟢 ════════════════════════════════════════');
  console.log(`   BOT FULLY ONLINE — ${getISTTime()} IST`);
  console.log(`   Portfolio: ${portfolio.length} positions`);
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
        // Fallback: try without HTML
        try {
          await bot.sendMessage(chatId, chunk.replace(/<[^>]+>/g, ''), { disable_web_page_preview: true });
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
        await bot.sendMessage(chatId, text.replace(/<[^>]+>/g, ''), { disable_web_page_preview: true });
      } catch (e2) {
        console.error('Send fallback error:', e2.message);
      }
    }
  }
}

// ========================================
// COMMAND: /start
// ========================================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /start from ${msg.from?.first_name || chatId}`);

  const welcome = `🧠 <b>DEEP MIND AI — Trading Bot v1.0</b>
━━━━━━━━━━━━━━━━━━━━━━━━━

Nagraj Bhai, main tumhara personal AI Trading assistant hoon! 24x7 tumhare portfolio ko monitor kar raha hoon aur market hours me automatic analysis bhejta hoon.

⚡ <b>Available Commands:</b>

📊 /portfolio — Full portfolio analysis + P&L
🌍 /market — Global market snapshot
🎯 /signals — AI buy/sell signals
📈 /allocation — Smart SIP allocation matrix
🛡️ /risk — Risk assessment + VIX analysis
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
bot.onText(/\/help/, async (msg) => {
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

💎 <i>Deep Mind AI Pro Trading Terminal</i>`;

  await safeSend(chatId, help);
});

// ========================================
// COMMAND: /portfolio
// ========================================
bot.onText(/\/portfolio/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /portfolio from ${msg.from?.first_name || chatId}`);
  
  if (portfolio.length === 0) {
    await safeSend(chatId, '⚠️ Portfolio empty hai. Web app se positions add karo — automatic cloud sync hoga.');
    return;
  }

  await safeSend(chatId, '📊 <i>Scanning portfolio... ek second...</i>');
  await refreshPrices();
  const report = generatePortfolioReport(portfolio, livePrices, usdInrRate);
  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /market
// ========================================
bot.onText(/\/market/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /market from ${msg.from?.first_name || chatId}`);

  await safeSend(chatId, '🌍 <i>Scanning global markets... ek second...</i>');
  await Promise.all([refreshPrices(), refreshIntel()]);
  const report = generateMarketReport(livePrices, marketIntel);
  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /signals
// ========================================
bot.onText(/\/signals/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /signals from ${msg.from?.first_name || chatId}`);

  if (portfolio.length === 0) {
    await safeSend(chatId, '⚠️ Portfolio empty hai. Pehle web app se positions add karo.');
    return;
  }

  await safeSend(chatId, '🎯 <i>Running signal analysis... ek second...</i>');
  await refreshPrices();
  const report = generateSignalsReport(portfolio, livePrices);
  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /allocation
// ========================================
bot.onText(/\/allocation/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /allocation from ${msg.from?.first_name || chatId}`);

  await safeSend(chatId, '📈 <i>Calculating SIP matrix... ek second...</i>');
  await refreshPrices();
  const report = generateAllocationReport(livePrices, usdInrRate);
  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /risk
// ========================================
bot.onText(/\/risk/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /risk from ${msg.from?.first_name || chatId}`);

  await safeSend(chatId, '🛡️ <i>Analyzing risk factors... ek second...</i>');
  await Promise.all([refreshPrices(), refreshIntel()]);
  const report = generateRiskReport(livePrices, portfolio, usdInrRate);
  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /forex
// ========================================
bot.onText(/\/forex/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /forex from ${msg.from?.first_name || chatId}`);

  await refreshForex();
  const report = generateForexReport(usdInrRate);
  await safeSend(chatId, report);
});

// ========================================
// COMMAND: /alert (toggle auto-alerts)
// ========================================
bot.onText(/\/alert(.*)/, async (msg, match) => {
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
bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  clearChatHistory(chatId);
  console.log(`📥 /clear from ${msg.from?.first_name || chatId}`);
  await safeSend(chatId, '🧹 <b>Chat history cleared!</b>\n\nFresh start — ab naya sawaal pucho!');
});

// ========================================
// COMMAND: /setkey (set Groq API key)
// ========================================
bot.onText(/\/setkey (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const key = match[1].trim();
  console.log(`📥 /setkey from ${msg.from?.first_name || chatId}`);
  
  // Set dynamically
  const { setGroqKey, API_URL } = await import('./config.mjs');
  setGroqKey(key);
  
  // Sync to cloud so web app can also use it
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ groqKey: key, action: 'saveKey', timestamp: Date.now() })
    });
  } catch (e) {}

  await safeSend(chatId, '✅ <b>Groq API Key Set!</b>\n\nAI Engine is now <b>ONLINE</b> 🧠⚡️.\nTum abhi kisi bhi sawal ka answer AI se le sakte ho!');
});

// ========================================
// COMMAND: /ai <message> — Explicit AI chat
// ========================================
bot.onText(/\/ai (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  console.log(`📥 /ai "${query.substring(0, 50)}..." from ${msg.from?.first_name || chatId}`);

  await safeSend(chatId, '🧠 <i>Deep Mind analyzing...</i>');
  await refreshPrices();
  const response = await chatWithAI(chatId, query, portfolio, livePrices, usdInrRate);
  await safeSend(chatId, response);
});

// ========================================
// COMMAND: /chat <message> — Alias for /ai
// ========================================
bot.onText(/\/chat (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const query = match[1];
  console.log(`📥 /chat "${query.substring(0, 50)}..." from ${msg.from?.first_name || chatId}`);

  await safeSend(chatId, '🧠 <i>Deep Mind analyzing...</i>');
  await refreshPrices();
  const response = await chatWithAI(chatId, query, portfolio, livePrices, usdInrRate);
  await safeSend(chatId, response);
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

  await safeSend(chatId, '🧠 <i>Deep Mind processing...</i>');
  await refreshPrices();
  const response = await chatWithAI(chatId, text, portfolio, livePrices, usdInrRate);
  await safeSend(chatId, response);
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

// ========================================
// ERROR HANDLING
// ========================================
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.code, error.message);
});

bot.on('error', (error) => {
  console.error('❌ Bot error:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
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
  console.log(`📱 Open Telegram and message @YourBot or search for the bot`);
  console.log(`   Market Status: ${getMarketStatus()}`);
  console.log(`   Auto Alerts: ${autoAlerts ? 'ON' : 'OFF'}`);
  console.log('');
}).catch(err => {
  console.error('❌ Boot failed:', err.message);
  console.log('Bot will continue with limited data...');
});
