import React from 'react';

function GuideItem({ title, emoji, desc, imp }: { title: string; emoji: string; desc: string; imp?: string }) {
  return (
    <div className="quantum-stat rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{emoji}</span>
        <span className="text-xs font-bold text-slate-200">{title}</span>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-1">{desc}</p>
      {imp && <p className="text-[11px] text-amber-400/80 leading-relaxed">💡 {imp}</p>}
    </div>
  );
}

function GuideCommand({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 quantum-stat rounded-xl px-4 py-3">
      <code className="text-cyan-400 font-mono text-[11px] font-bold whitespace-nowrap">/{cmd}</code>
      <span className="text-slate-500 text-[10px]">{desc}</span>
    </div>
  );
}

export const GuideTab = React.memo(function GuideTab() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="quantum-panel rounded-2xl p-5 border-cyan-500/10">
        <h1 className="text-xl font-bold text-white mb-2">📖 Wealth AI Pro — Complete Guide</h1>
        <p className="text-sm text-slate-400">Sab features ka detailed guide. Long-term investing ke liye banaya gaya hai. Sirf buy-on-dip strategy follow karta hai.</p>
      </div>

      <div className="quantum-panel rounded-2xl p-5">
        <h2 className="text-base font-bold text-cyan-400 mb-3">📊 DASHBOARD TAB</h2>
        <div className="space-y-3">
          <GuideItem title="Live Price Stats" emoji="📈" desc="Sab assets ka real-time price, 24h change, high/low. TradingView WebSocket + Binance WebSocket se data aata hai. Har 1.5 second me update hota hai." imp="Market hours me sabse zyada useful. Weekend me prices freeze dikhte hain — ye normal hai." />
          <GuideItem title="AI Signal Engine" emoji="🤖" desc="Har asset ke liye AI signal generate hota hai: STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL. RSI, SMA20/SMA50 crossover, MACD, aur CAGR proxy se calculate hota hai." imp="RSI < 30 = Deep Oversold (BUY karo). RSI > 75 = Overbought (mat karo). Signal confidence 0-100% hota hai — zyada confidence = zyada reliable." />
          <GuideItem title="Buy-the-Dip Intelligence" emoji="🎯" desc="Portfolio ke har asset ka dip depth track karta hai. SMA20/SMA50 se kitna niche hai, RSI oversold hai ya nahi. Dip Ladder dikhata hai — 5%, 10%, 15%, 20% pe kitna buy karna hai (pyramid buying)." imp="DEEP DIP = RSI < 30 ya SMA50 se 5%+ niche. MILD DIP = RSI < 40 ya SMA20 se 2%+ niche. Deep dip pe aggressive buy karo, mild dip pe normal SIP." />
          <GuideItem title="Multi-Factor Screener" emoji="📊" desc="Sab assets ka Alpha Score (0-100) calculate karta hai. 3 factors: Quality (40%) — CAGR aur drawdown. Momentum (30%) — RSI, SMA trend, price change. Value (30%) — PEG proxy, discount to SMA." imp="Alpha 75+ = STRONG BUY. Alpha 55+ = BUY. Alpha 35+ = HOLD. Below 35 = AVOID." />
          <GuideItem title="TradingView Chart" emoji="📉" desc="Interactive TradingView chart embedded hai. Candlestick, line, bar chart support. Indicators add kar sakte ho (RSI, MACD, Bollinger, etc)." imp="Chart pe click karke timeframe change karo (1D, 1W, 1M). Drawing tools support/resistance ke liye use karo." />
          <GuideItem title="Quantum Forensics" emoji="🔬" desc="Advanced technical analysis panel. Volume analysis, price action patterns, trend strength. Institutional-grade data." />
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5">
        <h2 className="text-base font-bold text-emerald-400 mb-3">💼 PORTFOLIO TAB</h2>
        <div className="space-y-3">
          <GuideItem title="Portfolio Table" emoji="📋" desc="Sab assets ka table: Symbol, Qty, Avg Price, LTP, Today's Change, P&L, Equity Value. INR aur USD dono me dikhta hai." imp="Green = profit me hai. Red = loss me hai. LTP real-time update hota hai WebSocket se." />
          <GuideItem title="Buy/Sell Actions" emoji="💱" desc="Buy button se naya asset add karte ho ya existing me quantity badhate ho. Sell button se quantity kam karte ho (partial profit booking)." imp="LONG-TERM STRATEGY: Sirf buy karo, sell mat karo. Dip pe buy karo aur hold karo." />
          <GuideItem title="Cloud Sync" emoji="☁️" desc="Portfolio data Google Apps Script pe sync hota hai. Multiple devices pe same data dikhta hai. Auto-save hota hai har change ke baad (3 second debounce)." imp="Agar data loss ho jaye to cloud se restore hota hai. Manual sync button bhi hai." />
          <GuideItem title="Allocation Bars" emoji="📊" desc="Har asset ka portfolio me kitna % hai — visual bar se dikhta hai. Concentration risk identify karta hai." imp="Kisi ek asset me 40%+ hai to overconcentrated hai. Diversify karo across sectors and markets." />
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5">
        <h2 className="text-base font-bold text-amber-400 mb-3">🎯 PLANNER TAB</h2>
        <div className="space-y-3">
          <GuideItem title="SIP Configuration" emoji="💰" desc="Monthly SIP set karo: India (₹10,000 default), US ($50 default), BTC (₹1,000), ETH (₹500). Investment horizon (3-30 years) aur risk appetite select karo." imp="SIP = Systematic Investment Plan. Har month fixed amount invest karo. Market up ho ya down — SIP chalne do." />
          <GuideItem title="Smart Dip Position Sizing" emoji="📐" desc="Monthly dip budget set karo. Kelly Criterion + Inverse Volatility se calculate karta hai ki har asset me kitna invest karo." imp="Kelly Criterion: Optimal bet size calculate karta hai win rate aur risk/reward se." />
          <GuideItem title="Monte Carlo Simulator" emoji="🎲" desc="Future portfolio value ka simulation. Worst case, Expected, Best case scenarios. CAGR-based compound growth formula." imp="15% CAGR expected hai Indian ETFs ke liye. 20%+ CAGR momentum/smallcap ETFs ke liye." />
          <GuideItem title="FIRE Calculator" emoji="🔥" desc="Financial Independence, Retire Early calculator. Monthly expenses + current age se FIRE number calculate karta hai (expenses × 12 × 25)." imp="FIRE Number = 25 years of expenses. Agar ₹50,000/month expenses hain to FIRE Number = ₹1.5 Crore." />
          <GuideItem title="Quantum Compound Growth" emoji="🚀" desc="Table dikhta hai: 15%, 20%, 25% CAGR pe 5/10/15/20 years me kitna banega." imp="₹10,000/month SIP at 20% CAGR for 15 years = ₹1 Crore+ (invested ₹18L)." />
          <GuideItem title="Core-Satellite Strategy" emoji="🛰️" desc="Rule of 100: Age ke hisaab se equity/debt split. Core (50-60%) = safe ETFs. Satellite (30-40%) = growth ETFs. Moonshot (5-10%) = crypto." imp="Age 30 = 70% equity, 30% debt. Core me NIFTY/Sensex ETFs, Satellite me Momentum/Smallcap." />
          <GuideItem title="SIP Step-Up Calculator" emoji="📈" desc="Har saal 10% SIP badhao. 15 years me total invested vs final wealth dikhta hai." imp="Step-up SIP se normal SIP se 2-3x zyada wealth banti hai." />
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5">
        <h2 className="text-base font-bold text-red-400 mb-3">🌍 RISK RADAR TAB</h2>
        <div className="space-y-3">
          <GuideItem title="Macro Regime Detector" emoji="🌐" desc="Market ka regime detect karta hai: RISK_ON, RISK_OFF, STAGFLATION, GOLDILOCKS." imp="RISK_OFF = Cash hoard karo, sirf deep dips buy karo. GOLDILOCKS = Full deployment." />
          <GuideItem title="Smart Money Flow (FII/DII)" emoji="💰" desc="FII aur DII ka buy/sell data. FII = Foreign big money. DII = Indian mutual funds." imp="FII + DII dono buying = STRONG BUY signal. FII selling + DII buying = support zone." />
          <GuideItem title="Sector Rotation Intelligence" emoji="🔄" desc="8 sectors track karta hai: US Tech, Finance, Energy, Healthcare, IN IT, Finance, Pharma. Relative strength aur momentum score." imp="LEADING sector me invest karo, LAGGING sector se nikalo. 5-10% annual alpha add kar sakta hai." />
          <GuideItem title="VIX (Fear Index)" emoji="😱" desc="CBOE VIX (US) aur India VIX. VIX < 15 = Greed. VIX 15-22 = Normal. VIX 22-30 = Fear. VIX 30+ = Extreme Fear." imp="High VIX = Buy opportunities. Low VIX = Caution." />
          <GuideItem title="Value at Risk (VaR)" emoji="📉" desc="3 methods: Parametric, Historical, Monte Carlo (2000 simulations). Ek din me kitna loss ho sakta hai." imp="95% VaR = 95% chance ki isse zyada loss nahi hoga." />
          <GuideItem title="Stress Testing" emoji="⚡" desc="6 historical scenarios: 2008 (-45%), COVID (-30%), Rate Shock (-15%), Geopolitical (-20%), Tech Selloff (-18%), India Crisis (-35%)." imp="Agar portfolio in scenarios me survive kar raha hai to long-term safe hai." />
          <GuideItem title="Concentration Risk" emoji="⚠️" desc="Har asset ka weight % aur risk contribution. Agar koi ek asset 35%+ hai to overconcentrated." imp="Diversify! Kisi ek asset/sector me 30% se zyada mat rakho." />
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5">
        <h2 className="text-base font-bold text-purple-400 mb-3">⚙️ BACKGROUND PROCESSES</h2>
        <div className="space-y-3">
          <GuideItem title="Portfolio Health Monitor" emoji="💊" desc="Floating badge me health score 0-100. Har 60 second me check. Drawdown, RSI extremes, VIX spikes monitor karta hai." imp="GREEN (70+) = Sab theek. YELLOW (45-70) = Caution. RED (<45) = Danger." />
          <GuideItem title="Price WebSocket" emoji="📡" desc="TradingView WebSocket stocks ke liye. Binance WebSocket crypto ke liye. Real-time streaming. Batch update har 2 second." imp="WebSocket connected = green dot. Disconnected = red dot (auto-reconnect)." />
          <GuideItem title="Telegram Alerts" emoji="📲" desc="Auto-alerts ON karo to har 30 minute me portfolio analysis Telegram pe bhejta hai." imp="Bot commands: /dip, /health, /regime, /smartmoney, /screener. Daily digest 8 AM IST." />
          <GuideItem title="Cloud Sync" emoji="☁️" desc="Portfolio data har 5 minute me cloud pe sync hota hai. API keys encrypted (AES-256)." imp="Internet band ho jaye to local data kaam karta hai." />
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5">
        <h2 className="text-base font-bold text-blue-400 mb-3">🤖 TELEGRAM BOT COMMANDS</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <GuideCommand cmd="/portfolio" desc="Full portfolio report with P&L" />
          <GuideCommand cmd="/market" desc="Market overview — indices, VIX, sectors" />
          <GuideCommand cmd="/live" desc="Live prices for all assets" />
          <GuideCommand cmd="/dip" desc="Buy-the-Dip scan for portfolio" />
          <GuideCommand cmd="/health" desc="Portfolio health score (0-100)" />
          <GuideCommand cmd="/regime" desc="Macro regime: Risk-On/Off/Stagflation/Goldilocks" />
          <GuideCommand cmd="/smartmoney" desc="FII/DII smart money flow" />
          <GuideCommand cmd="/screener" desc="Multi-factor screener (Alpha Score)" />
          <GuideCommand cmd="/allocation" desc="Smart allocation recommendations" />
          <GuideCommand cmd="/risk" desc="Risk analysis: VaR, stress tests" />
          <GuideCommand cmd="/scan SYMBOL" desc="Deep scan any symbol (e.g., /scan INFY)" />
          <GuideCommand cmd="/compare A B" desc="Compare two assets" />
          <GuideCommand cmd="/crypto" desc="Crypto prices (INR + USD)" />
          <GuideCommand cmd="/forex" desc="USD/INR forex rate" />
          <GuideCommand cmd="/sip" desc="SIP report and recommendations" />
          <GuideCommand cmd="/etf" desc="ETF analysis (Indian + US)" />
          <GuideCommand cmd="/fiidii" desc="FII/DII data via web search" />
          <GuideCommand cmd="/ipo" desc="Upcoming IPO data" />
          <GuideCommand cmd="/news" desc="Latest market news" />
          <GuideCommand cmd="/backtest" desc="Backtest AI signal accuracy" />
          <GuideCommand cmd="/taxloss" desc="Tax-loss harvesting pairs" />
          <GuideCommand cmd="/longterm" desc="Long-term investment report" />
          <GuideCommand cmd="/strategy" desc="Full strategy report" />
          <GuideCommand cmd="/digest" desc="Daily digest summary" />
          <GuideCommand cmd="/ai QUESTION" desc="AI chat (Groq/Gemini/Claude)" />
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5 border-amber-500/20">
        <h2 className="text-base font-bold text-amber-400 mb-3">💡 IMPORTANT TIPS FOR LONG-TERM INVESTING</h2>
        <div className="space-y-2 text-xs text-slate-300">
          <p>🎯 <b className="text-white">Sirf Buy-on-Dip Strategy:</b> Sell mat karo. Jab market gire (dip) tab buy karo. Time ke saath compounding ka magic hoga.</p>
          <p>📊 <b className="text-white">SIP Discipline:</b> Har month fixed amount invest karo. Market up ho ya down — SIP chalne do. 15+ years me 15-25% CAGR possible hai.</p>
          <p>🔄 <b className="text-white">Sector Rotation:</b> Leading sectors me zyada invest karo. Lagging sectors se shift karo. Sector rotation se 5-10% extra alpha milta hai.</p>
          <p>💰 <b className="text-white">Smart Money Follow Karo:</b> FII buying = market strong. FII selling = caution. DII usually counter-cyclical hai.</p>
          <p>📉 <b className="text-white">VIX = Opportunity:</b> High VIX (fear) = saste me buy karo. Low VIX (greed) = expensive prices.</p>
          <p>🛡️ <b className="text-white">Diversification:</b> India + US + Crypto mix karo. Kisi ek sector/asset me 30%+ mat rakho.</p>
          <p>⏰ <b className="text-white">Time over Timing:</b> Market time karna impossible hai. Time IN the market zyada important hai. 15+ years hold karo.</p>
          <p>🧠 <b className="text-white">AI Signals Trust Karo:</b> STRONG_BUY signal pe aggressive buy karo. AVOID signal pe mat buy karo.</p>
        </div>
      </div>

      <div className="quantum-panel rounded-2xl p-5 border-violet-500/20">
        <h2 className="text-base font-bold text-violet-400 mb-3">🧠 NEURAL CHAT (AI Assistant)</h2>
        <div className="space-y-2 text-xs text-slate-300">
          <p>Bottom-right corner me chat icon hai. Click karo aur kuch bhi pucho — market analysis, stock advice, portfolio review.</p>
          <p><b className="text-white">3 AI Engines:</b> Groq (fastest — general queries), Gemini (real-time news), Claude (deep analysis). Auto-detect karta hai.</p>
          <p><b className="text-white">Quick Actions:</b> Pre-built prompts hain — "Market Overview", "Buy Signals", "Portfolio Review", "Risk Analysis".</p>
          <p><b className="text-white">Context-Aware:</b> AI ko tumhara portfolio data, live prices, market intelligence sab pata hota hai.</p>
        </div>
      </div>
    </div>
  );
});
