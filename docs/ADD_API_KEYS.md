# 🔑 ADD MISSING API KEYS - FIX ISSUE

## Problem
Only Claude API key is configured. Other engines (Gemini, Groq, etc.) are missing keys, so they never respond.

## Solution
Add these FREE API keys to your Render environment variables:

### 1. GEMINI (Recommended - FREE & FAST)
```bash
# Get key: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_key_here
```

### 2. GROQ (Fastest - FREE)
```bash
# Get key: https://console.groq.com
GROQ_API_KEY=your_groq_key_here
# or
GROQ_KEY=your_groq_key_here
```

### 3. OPENROUTER (FREE MODELS)
```bash
# Get key: https://openrouter.ai/keys
OPENROUTER_KEY=your_openrouter_key_here
```

### 4. CEREBRAS (Super Fast - FREE)
```bash
# Get key: https://cloud.cerebras.ai
CEREBRAS_KEY=your_cerebras_key_here
```

### 5. HUGGINGFACE (FREE)
```bash
# Get key: https://huggingface.co/settings/tokens
HF_API_KEY=your_huggingface_key_here
```

### 6. NVIDIA (Optional)
```bash
# Get key: https://build.nvidia.com
NVIDIA_API_KEY=your_nvidia_key_here
```

## How to Add Keys on Render

1. Go to your Render dashboard
2. Select your service
3. Click "Environment" tab
4. Add each key as a new environment variable
5. Click "Save Changes"
6. Render will auto-redeploy

## How to Add Keys Locally

Add to `.env` file:
```bash
GEMINI_API_KEY=AIzaSy...
GROQ_API_KEY=gsk_...
OPENROUTER_KEY=sk-or-...
CEREBRAS_KEY=csk-...
HF_API_KEY=hf_...
NVIDIA_API_KEY=nvapi-...
```

## Priority Order (fastest first)
1. NVIDIA (if key exists)
2. GEMINI
3. GROQ
4. CLAUDE (already configured ✅)
5. OPENROUTER
6. CEREBRAS
7. HUGGINGFACE
8. Quant Brain (fallback - always works)

## After Adding Keys

Restart the bot and test:
```bash
npm run start
```

Then in Telegram, test each engine:
```
/model → select different engines
/aitest → check engine health
```

Or just use Auto mode (recommended) - it will try all engines automatically!
