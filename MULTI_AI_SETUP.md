# 🧠 DEEP MIND AI — Multi-AI Setup Guide

## ✅ Fixes Applied

### 1. **Gemini API Fixed**
- ✅ Now uses `VITE_GEMINI_API_KEY` from environment
- ✅ Proper error handling and response validation
- ✅ Real-time market news routing working

### 2. **DeepSeek API Fixed**
- ✅ Now uses `VITE_DEEPSEEK_API_KEY` from environment
- ✅ Proper authentication with Bearer token
- ✅ Portfolio analysis & deep calculations working

### 3. **Groq Llama-3.3-70B Active**
- ✅ Fast responses for quick questions
- ✅ Model fallback (70b → 8b) for reliability
- ✅ Rate limiting handled

### 4. **AI Router Improved**
- ✅ Better intent detection (Gemini for news, DeepSeek for analysis, Groq for quick Q&A)
- ✅ Manual model selection available
- ✅ Auto-routing based on query patterns

---

## 🔑 API Key Setup

### Step 1: Get FREE API Keys

#### Groq (Llama-3.3-70B) - FAST responses
1. Visit: https://console.groq.com/keys
2. Click "Create API Key"
3. Copy the key (starts with `gsk_`)

#### Gemini 1.5 Pro - Real-time news & data
1. Visit: https://aistudio.google.com/apikey
2. Click "Get API Key"
3. Copy the key

#### DeepSeek V3 - Deep analysis
1. Visit: https://platform.deepseek.com
2. Sign up and get API key
3. Copy the key

### Step 2: Create `.env` File

Create a `.env` file in the root directory:

```env
# Telegram Bot Configuration
VITE_TG_TOKEN=your_bot_token_here
VITE_TG_CHAT_ID=your_chat_id_here

# Multi-AI API Keys
VITE_GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxx
VITE_GEMINI_API_KEY=xxxxxxxxxxxxxxxxxxxxx
VITE_DEEPSEEK_API_KEY=xxxxxxxxxxxxxxxxxxxxx

# Cloud Sync
VITE_API_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec

# Feature Flags
VITE_ENABLE_AUTO_ALERTS=true
VITE_ENABLE_TELEGRAM=true
```

### Step 3: Telegram Bot Setup

For the Telegram bot, set keys via commands:

```
/setkey gsk_xxxxxxxxxxxxxxxxx
/setgemini xxxxxxxxxxxxxxxxxxxxx
/setdeepseek xxxxxxxxxxxxxxxxxxxxx
```

---

## 🎯 AI Routing Logic

### Gemini (Real-time Market News)
- Keywords: `today`, `now`, `live`, `news`, `market`, `price`, `nifty`, `sensex`, `vix`
- Use case: Real-time data, breaking news, current market status
- Example queries:
  - "What's happening in the market today?"
  - "Nifty ka aaj ka kya haal hai?"
  - "Latest market news kya hai?"

### DeepSeek (Portfolio Analysis)
- Keywords: `analyze`, `portfolio`, `allocation`, `risk`, `compare`, `backtest`, `optimize`, `strategy`
- Use case: Deep analysis, portfolio optimization, quantitative calculations
- Example queries:
  - "Analyze my portfolio allocation"
  - "Compare SMH vs QQQM"
  - "Backtest this strategy"
  - "Optimize my SIP allocation"

### Groq (Fast Responses)
- Keywords: `what is`, `explain`, `quick`, `brief`, `simple`
- Use case: Quick explanations, concept clarity, simple Q&A
- Example queries:
  - "What is VIX?"
  - "Explain RSI in simple terms"
  - "Quick definition of CAGR"

---

## 🚀 Usage Examples

### Neural Chat (Web App)
```
1. Open the web app
2. Click the Brain icon (🧠)
3. Ask: "Market kaisa hai aaj?" → Routes to Gemini
4. Ask: "Portfolio analyze karo" → Routes to DeepSeek
5. Ask: "What is RSI?" → Routes to Groq
```

### Telegram Bot
```
1. /start - Main menu
2. /ai market kaisa hai? → Gemini
3. /ai portfolio analyze karo → DeepSeek
4. /ai what is VIX → Groq
```

### Manual Model Selection
In Neural Chat, you can manually select:
- `Auto-Route`: Automatic routing (default)
- `Gemini`: Force use Gemini
- `DeepSeek`: Force use DeepSeek
- `Groq`: Force use Groq
- `Multi-AI`: Compare all three

---

## 🧪 Testing

### Test Gemini
```
Query: "What's the latest market news?"
Expected: Real-time market update with current data
```

### Test DeepSeek
```
Query: "Analyze my portfolio and suggest optimal allocation"
Expected: Detailed portfolio analysis with numbers
```

### Test Groq
```
Query: "What is RSI?"
Expected: Quick, clear explanation
```

---

## 📊 Performance Metrics

| AI | Speed | Best For | Cost |
|----|-------|----------|------|
| Groq | ⚡⚡⚡ (Fastest) | Quick Q&A | FREE (limited) |
| Gemini | ⚡⚡ (Fast) | Real-time data | FREE (limited) |
| DeepSeek | ⚡ (Medium) | Deep analysis | FREE (limited) |

---

## 🛠️ Troubleshooting

### "API Key missing" error
- Check `.env` file exists
- Verify keys are correctly set
- Restart the development server

### "Gemini not responding"
- Check `VITE_GEMINI_API_KEY` is valid
- Ensure key has Gemini API access
- Check network connection

### "DeepSeek timeout"
- DeepSeek may take longer for complex analysis
- Check API key is valid
- Reduce query complexity

### "Groq rate limit"
- Wait 1 minute between requests
- Groq has rate limits on free tier
- Use fallback to 8b model

---

## 💡 Pro Tips

1. **Use Auto-Route**: Let the AI router choose the best model
2. **Manual Override**: Select specific model for critical queries
3. **Combine AIs**: Use Multi-AI mode for important decisions
4. **Context Matters**: Include portfolio context for better analysis

---

## 📈 Advanced: Intent Detection Patterns

### Gemini Triggers
- `today`, `aaj`, `abhi`, `now`, `live`, `latest`, `breaking`
- `price`, `rate`, `news`, `market`, `nifty`, `sensex`, `vix`
- `gift nifty`, `us markets`, `global markets`, `fii`, `dii`

### DeepSeek Triggers
- `analyze`, `analysis`, `portfolio`, `allocation`, `risk`
- `compare`, `backtest`, `calculate`, `optimize`, `strategy`
- `cagr`, `sharpe`, `monte carlo`, `projection`, `correlation`

### Groq Triggers
- `what is`, `kya hai`, `define`, `meaning`, `explain`
- `quick`, `fast`, `brief`, `simple`, `basic`
- `how does`, `kaise kaam`, `how to`

---

## 🎯 Next Steps

1. ✅ Set up all three API keys
2. ✅ Test each AI with sample queries
3. ✅ Verify routing is working correctly
4. ✅ Enable auto-alerts for scheduled updates
5. ✅ Share feedback for improvements

---

## 📞 Support

For issues or feature requests:
- Check `.env` setup
- Verify API keys are valid
- Test with simple queries first
- Review console logs for errors

**Deep Mind AI Pro Trading Terminal** 🚀
