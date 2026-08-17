# 🔧 RENDER ENVIRONMENT SETUP - FIX CHECKLIST

## Current Status
❌ Only ANTHROPIC_API_KEY is loaded
❌ All other keys missing: GEMINI, GROQ, OPENROUTER, CEREBRAS, HF, NVIDIA

## Step-by-Step Fix

### 1. Go to Render Dashboard
https://dashboard.render.com/

### 2. Select Your Service
Click on "smartai1" (or your service name)

### 3. Go to Environment Tab
Left sidebar → **Environment**

### 4. Add These EXACT Variable Names

Copy-paste these exact names (case-sensitive):

```
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXX
GROQ_API_KEY=gsk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
OPENROUTER_KEY=sk-or-v1-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
CEREBRAS_KEY=csk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
HF_API_KEY=hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NVIDIA_API_KEY=nvapi-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**IMPORTANT:** 
- No spaces before/after `=`
- No quotes around values
- Exact spelling (GEMINI_API_KEY, not GEMINI_KEY)

### 5. Save Changes
Click **"Save Changes"** button at bottom

### 6. Manual Redeploy (Important!)
Click **"Manual Deploy"** → **"Deploy latest commit"**

Environment variables don't auto-reload without redeploy!

### 7. Verify After Deploy

Check logs for this line:
```
🤖 AI Engines: Gemini=true Groq=true Claude=true OpenRouter=true Cerebras=true HF=true
```

### 8. Test in Telegram

```
/aitest
```

Should show all engines as ✅ ACTIVE

## If Still Not Working

### Check Variable Names in Render
Make sure no typos:
- ✅ `GEMINI_API_KEY` 
- ❌ `GEMINI_KEY`
- ❌ `GEMINI API KEY` (no spaces!)
- ❌ `gemini_api_key` (case matters!)

### Check for Hidden Characters
Sometimes copy-paste adds invisible characters. Type manually if needed.

### Check Key Format
- Gemini: starts with `AIzaSy`
- Groq: starts with `gsk_`
- OpenRouter: starts with `sk-or-v1-`
- Cerebras: starts with `csk-`
- HuggingFace: starts with `hf_`
- NVIDIA: starts with `nvapi-`

## Quick Test Locally

Add keys to `.env` file and test:

```bash
npm run start
```

Then test in Telegram. If works locally but not on Render → issue is Render env vars.

## Free API Keys (if you don't have them)

1. **Gemini**: https://aistudio.google.com/apikey
2. **Groq**: https://console.groq.com/keys
3. **OpenRouter**: https://openrouter.ai/keys
4. **Cerebras**: https://cloud.cerebras.ai/
5. **HuggingFace**: https://huggingface.co/settings/tokens
6. **NVIDIA**: https://build.nvidia.com/

All are FREE with generous limits!
