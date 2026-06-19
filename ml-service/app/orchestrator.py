"""
AI ORCHESTRATOR — FastAPI Service
Powers both NeuralChat (web) and Telegram bot.
1) Collects real-time data
2) Runs Quant Brain (deterministic — always online)
3) Calls LLM Router (optional — narrates the numbers)
4) Returns combined result
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import time
import hashlib
import json
import logging

from app.quant_brain import analyze, brain_to_text
from app.llm_router import ask_llm, get_provider_status, anti_hallucination_check
from app.prompts import (
    get_7step_system_prompt,
    build_analysis_prompt,
    build_signals_prompt,
    build_portfolio_prompt,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orchestrator")

app = FastAPI(title="WealthAI Orchestrator", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# CACHE (60s TTL per symbol — cuts quota, survives outages)
# ============================================================
_analysis_cache = {}
CACHE_TTL = 60


def _cache_key(symbol: str, query: str = "") -> str:
    raw = f"{symbol}:{query}:{int(time.time() / CACHE_TTL)}"
    return hashlib.md5(raw.encode()).hexdigest()


# ============================================================
# REQUEST MODELS
# ============================================================
class AnalyzeRequest(BaseModel):
    symbol: str
    market: str = "IN"
    user_query: str = ""
    live_snapshot: str = ""
    ohlcv_data: Optional[List[dict]] = None


class SignalsRequest(BaseModel):
    symbols: Optional[List[str]] = None
    market: str = "IN"


class PortfolioRequest(BaseModel):
    positions: List[dict]
    live_prices: dict = {}
    usd_inr_rate: float = 85.5
    user_query: str = ""


# ============================================================
# ENDPOINTS
# ============================================================
@app.get("/health")
async def health():
    providers = get_provider_status()
    active = [p for p in providers if p["available"]]
    return {
        "status": "ok",
        "providers": providers,
        "active_count": len(active),
        "quant_brain": "always_online",
        "version": "2.0.0",
    }


@app.post("/analyze")
async def analyze_symbol(req: AnalyzeRequest):
    """Full deep analysis: Quant Brain + LLM narration."""
    cache_k = _cache_key(req.symbol, req.user_query)
    if cache_k in _analysis_cache:
        cached = _analysis_cache[cache_k]
        cached["from_cache"] = True
        return cached

    # 1) Build macro context
    macro = {"vix": 0, "regime": "UNKNOWN"}

    # 2) Run Quant Brain (deterministic — always works)
    import pandas as pd
    if req.ohlcv_data:
        df = pd.DataFrame(req.ohlcv_data)
    else:
        # Try loading from store
        try:
            from pipeline.fetch_data import load_ohlcv
            ohlcv = load_ohlcv()
            if ohlcv is not None:
                sym_data = ohlcv[ohlcv["symbol"].str.upper() == req.symbol.upper()]
                df = sym_data.tail(300) if not sym_data.empty else pd.DataFrame()
            else:
                df = pd.DataFrame()
        except Exception:
            df = pd.DataFrame()

    brain_result = analyze(req.symbol, df, macro)
    brain_result["market"] = req.market

    # 3) Try LLM narration (optional — falls back to brain_to_text)
    system_prompt = get_7step_system_prompt()
    user_prompt = build_analysis_prompt(brain_result, req.live_snapshot, req.user_query)
    llm_text = ask_llm(system_prompt, user_prompt)

    used_provider = "none"
    if llm_text:
        llm_text = anti_hallucination_check(llm_text, brain_result)
        used_provider = "llm"
    else:
        llm_text = brain_to_text(brain_result)
        used_provider = "quant_brain"

    result = {
        "data": brain_result,
        "text": llm_text,
        "used_provider": used_provider,
        "from_cache": False,
        "timestamp": time.time(),
    }

    _analysis_cache[cache_k] = result
    return result


@app.post("/signals")
async def get_signals(req: SignalsRequest):
    """Scan watchlist for STRONG_BUY/BUY signals."""
    import pandas as pd
    try:
        from pipeline.fetch_data import load_ohlcv
        ohlcv = load_ohlcv()
    except Exception:
        ohlcv = None

    symbols = req.symbols
    if not symbols and ohlcv is not None:
        symbols = ohlcv["symbol"].unique().tolist()[:20]

    if not symbols:
        return {"signals": [], "message": "No symbols to scan"}

    results = []
    for sym in symbols:
        df = pd.DataFrame()
        if ohlcv is not None:
            sym_data = ohlcv[ohlcv["symbol"].str.upper() == sym.upper()]
            if not sym_data.empty:
                df = sym_data.tail(300)

        brain = analyze(sym, df, {"vix": 0, "regime": "UNKNOWN"})
        brain["market"] = req.market
        results.append(brain)

    # Sort by confidence
    results.sort(key=lambda x: x.get("confidence", 0), reverse=True)

    # Try LLM for ranking
    system_prompt = get_7step_system_prompt()
    user_prompt = build_signals_prompt(results)
    llm_text = ask_llm(system_prompt, user_prompt)

    if not llm_text:
        llm_text = "\n".join([
            f"{r['symbol']}: {r['verdict']} ({r['confidence']}%) | Entry: {r['entry']} | SL: {r['sl']} | TP1: {r['tp1']} | R:R: {r['rr']}"
            for r in results if r['verdict'] in ('STRONG_BUY', 'BUY')
        ]) or "No strong signals currently."

    return {
        "signals": results,
        "text": llm_text,
        "count": len(results),
        "timestamp": time.time(),
    }


@app.post("/portfolio")
async def analyze_portfolio(req: PortfolioRequest):
    """Full portfolio analysis with Quant Brain per position."""
    import pandas as pd
    try:
        from pipeline.fetch_data import load_ohlcv
        ohlcv = load_ohlcv()
    except Exception:
        ohlcv = None

    results = []
    for pos in req.positions:
        sym = pos.get("symbol", "")
        df = pd.DataFrame()
        if ohlcv is not None:
            sym_data = ohlcv[ohlcv["symbol"].str.upper() == sym.upper()]
            if not sym_data.empty:
                df = sym_data.tail(300)

        macro = {"vix": 0, "regime": "UNKNOWN"}
        brain = analyze(sym, df, macro)
        brain["market"] = pos.get("market", "IN")
        brain["position"] = pos
        results.append(brain)

    # Build portfolio context
    portfolio_ctx = f"Total positions: {len(req.positions)}\n"
    for pos in req.positions:
        portfolio_ctx += f"{pos.get('symbol', '?')}: Qty={pos.get('qty', 0)} Avg={pos.get('avgPrice', 0)}\n"

    system_prompt = get_7step_system_prompt()
    user_prompt = build_portfolio_prompt(results, portfolio_ctx)
    llm_text = ask_llm(system_prompt, user_prompt)

    if not llm_text:
        llm_text = "\n".join([brain_to_text(r) for r in results])

    return {
        "data": results,
        "text": llm_text,
        "count": len(results),
        "timestamp": time.time(),
    }


@app.post("/ask")
async def ask_freeform(symbol: str = "", query: str = "", live_snapshot: str = ""):
    """Free-form question — Quant Brain + LLM."""
    import pandas as pd
    df = pd.DataFrame()
    try:
        from pipeline.fetch_data import load_ohlcv
        ohlcv = load_ohlcv()
        if ohlcv is not None and symbol:
            sym_data = ohlcv[ohlcv["symbol"].str.upper() == symbol.upper()]
            if not sym_data.empty:
                df = sym_data.tail(300)
    except Exception:
        pass

    brain = analyze(symbol or "UNKNOWN", df, {"vix": 0, "regime": "UNKNOWN"})
    brain_result = brain

    system_prompt = get_7step_system_prompt()
    user_prompt = build_analysis_prompt(brain_result, live_snapshot, query)
    llm_text = ask_llm(system_prompt, user_prompt)

    used_provider = "llm"
    if not llm_text:
        llm_text = brain_to_text(brain_result)
        used_provider = "quant_brain"

    return {
        "data": brain_result,
        "text": llm_text,
        "used_provider": used_provider,
        "timestamp": time.time(),
    }


@app.get("/providers")
async def providers():
    """List all LLM providers and their status."""
    return {"providers": get_provider_status()}
