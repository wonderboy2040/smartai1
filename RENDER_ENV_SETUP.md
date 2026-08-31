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

---

# 📈 PAPER-TRADE HISTORY — DURABLE BACKUP SETUP (2 minutes)

## Why This Is Needed
Render's **free plan** ships an **ephemeral filesystem**: every spin-down /
restart / redeploy re-checks-out the git repo, and `server/data/paper-trades.json`
(runtime-written, gitignored) gets **wiped**. That is why the paper-trading
history was resetting to 0. Two protections now ship with the app:

1. **Device mirror (automatic, zero setup)** — the browser saves the full trade
   history in IndexedDB; if the server loses it, the client silently POSTs its
   mirror back to `/api/intraday-paper/restore` and rebuilds it. Works on every
   device where the tab was opened — but NOT after "Clear cookies AND site data"
   (that wipes IndexedDB too).
2. **GitHub durable backup (recommended — survives EVERYTHING)** — the engine
   mirrors `paper-trades.json` to a branch of your repo and restores it on boot.

## Enable the GitHub Backup (recommended)

### Step 1 — Create a fine-grained Personal Access Token
https://github.com/settings/personal-access-tokens/new

- **Repository access**: Only select repositories → `smartai1` (your repo)
- **Permissions**: Repository permissions → **Contents → Read and write**
- Generate & copy the token

### Step 2 — Add env vars in Render (Environment tab)

```
GITHUB_BACKUP_TOKEN=github_pat_xxxxxxxxxxxxxxxx
GITHUB_BACKUP_REPO=YOUR_GITHUB_USERNAME/smartai1
GITHUB_BACKUP_BRANCH=data-backup
```

⚠️ **IMPORTANT**: `GITHUB_BACKUP_BRANCH` MUST be different from your deploy
branch (`live-sync`) — pushes to the deploy branch trigger auto-deploys and
would restart the server on every trade close. `data-backup` is safe.

### Step 3 — Save + Manual Redeploy
Deploy latest commit → on boot, logs show `[backup]` only when pushing/restoring.

### How to verify
- Open a paper trade on the site → within ~1 min, check the `data-backup`
  branch on GitHub → `backups/paper-trades.json` appears with your trade.
- Restart the service (Render dashboard → Manual deploy) → history intact.

## Recovery matrix

| Scenario | History survives? |
|---|---|
| Browser refresh / logout / cookie clear only | ✅ server file intact |
| Render restart/spin-down, browser untouched | ✅ device mirror auto-restores |
| Render restart + full site-data clear | ✅ GitHub backup (if enabled) |
| Nothing enabled + everything cleared | ❌ (enable the GitHub backup!) |
