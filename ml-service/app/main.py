from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import pandas as pd
import numpy as np
import joblib
import time
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.config import (
    MODEL_DIR, SIGNAL_MODEL_PATH, CALIBRATOR_PATH, HMM_MODEL_PATH,
    ALL_SYMBOLS, FEATURE_COLS
)
from pipeline.fetch_data import load_ohlcv, fetch_all_symbols
from pipeline.features import build_features, get_feature_columns
from pipeline.labels import build_labels
from models.pricepoints import calculate_exact_entry
from models.backtest import walk_forward_backtest

app = FastAPI(title="WealthAI ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache for predictions
prediction_cache = {}
CACHE_TTL = 300  # 5 minutes


class PredictionRequest(BaseModel):
    symbol: str
    market: str = "IN"


class TrainRequest(BaseModel):
    symbols: Optional[List[str]] = None


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": {
            "signal": SIGNAL_MODEL_PATH.exists(),
            "hmm": HMM_MODEL_PATH.exists(),
        },
    }


@app.post("/predict")
async def predict(req: PredictionRequest):
    cache_key = f"{req.symbol}_{req.market}"
    if cache_key in prediction_cache:
        cached = prediction_cache[cache_key]
        if time.time() - cached["ts"] < CACHE_TTL:
            return cached["data"]

    ohlcv = load_ohlcv()
    if ohlcv is None:
        raise HTTPException(status_code=503, detail="No OHLCV data. Train models first via /train.")

    sym = req.symbol.replace(".NS", "").replace(".BO", "")
    # Find matching symbol
    sym_data = ohlcv[ohlcv["symbol"].str.contains(sym, case=False, na=False)]
    if sym_data.empty:
        raise HTTPException(status_code=404, detail=f"No data for {req.symbol}")

    sym = sym_data["symbol"].unique()[0]
    sym_df = ohlcv[ohlcv["symbol"] == sym].tail(500)

    if len(sym_df) < 100:
        raise HTTPException(status_code=400, detail=f"Not enough data for {req.symbol}: {len(sym_df)} rows")

    feat = build_features(sym_df)
    labeled = build_labels(feat)
    feature_cols = get_feature_columns(labeled)

    # Signal model prediction
    signal_result = {"signal": "HOLD", "confidence": 50, "top_features": []}
    if SIGNAL_MODEL_PATH.exists():
        try:
            model = joblib.load(SIGNAL_MODEL_PATH)
            last_row = labeled[feature_cols].iloc[[-1]].values
            last_row = np.nan_to_num(last_row, nan=0.0)
            if np.isinf(last_row).any():
                last_row = np.clip(last_row, -1e10, 1e10)

            pred = model.predict(last_row)[0]
            proba = model.predict_proba(last_row)[0]
            classes = model.classes_
            confidence = float(max(proba)) * 100

            signal_result = {
                "signal": str(pred),
                "confidence": round(confidence, 1),
                "probabilities": {str(c): round(float(p) * 100, 1) for c, p in zip(classes, proba)},
            }

            # Top features (SHAP-like via feature importance)
            if hasattr(model, "estimators"):
                try:
                    base_model = model.estimators[0]
                    if hasattr(base_model, "feature_importances_"):
                        importances = base_model.feature_importances_
                        top_idx = np.argsort(importances)[::-1][:5]
                        signal_result["top_features"] = [
                            {"feature": feature_cols[i], "importance": round(float(importances[i]), 3)}
                            for i in top_idx
                        ]
                except Exception:
                    pass
        except Exception as e:
            signal_result["error"] = str(e)

    # Quantile targets
    targets = {}
    for q, fname in [("P10", "target_q10.pkl"), ("P50", "target_q50.pkl"), ("P90", "target_q90.pkl")]:
        model_path = MODEL_DIR / fname
        if model_path.exists():
            try:
                q_model = joblib.load(model_path)
                last_row = labeled[feature_cols].iloc[[-1]].values
                last_row = np.nan_to_num(last_row, nan=0.0)
                if np.isinf(last_row).any():
                    last_row = np.clip(last_row, -1e10, 1e10)
                fwd_ret = float(q_model.predict(last_row)[0])
                current_price = float(sym_df["close"].iloc[-1])
                target_price = current_price * (1 + fwd_ret)
                targets[q] = {
                    "expected_return": round(fwd_ret * 100, 2),
                    "target_price": round(target_price, 2),
                }
            except Exception:
                pass

    # Price points
    price_points = calculate_exact_entry(sym_df)

    # Current data
    last = sym_df.iloc[-1]
    current_data = {
        "symbol": req.symbol,
        "market": req.market,
        "price": round(float(last["close"]), 2),
        "change": round(float(sym_df["close"].pct_change().iloc[-1] * 100), 2) if len(sym_df) > 1 else 0,
        "rsi": round(float(feat["rsi"].iloc[-1]), 1) if "rsi" in feat.columns else 50,
        "volume": int(last.get("volume", 0)),
    }

    result = {
        **current_data,
        **signal_result,
        "price_targets": targets,
        "price_points": price_points,
        "timestamp": int(time.time() * 1000),
    }

    prediction_cache[cache_key] = {"data": result, "ts": time.time()}
    return result


@app.get("/signals")
async def get_all_signals(market: Optional[str] = None):
    ohlcv = load_ohlcv()
    if ohlcv is None:
        raise HTTPException(status_code=503, detail="No OHLCV data.")

    symbols = ohlcv["symbol"].unique()
    if market:
        market_filter = {"IN": ".NS|BEES|NIFTY|SMALLCAP|MOMENTUM", "US": None, "CRYPTO": "USD"}
        if market.upper() in market_filter and market_filter[market.upper()]:
            symbols = [s for s in symbols if any(k in s for k in ["USD"] if market.upper() == "CRYPTO")
                       or (market.upper() == "IN" and (".NS" in s or "BEES" in s or "NIFTY" in s or "SMALLCAP" in s or "MOMENTUM" in s))
                       or (market.upper() == "US" and ".NS" not in s and "USD" not in s)]

    signals = []
    for sym in list(symbols)[:50]:
        try:
            req = PredictionRequest(symbol=sym, market=market or "IN")
            sig = await predict(req)
            signals.append(sig)
        except Exception:
            continue

    signals.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    return {"signals": signals, "count": len(signals), "timestamp": int(time.time() * 1000)}


@app.post("/train")
async def train_models(req: TrainRequest = None, background_tasks: BackgroundTasks = None):
    results = {}

    # Step 1: Fetch data
    print("Fetching OHLCV data...")
    symbols = req.symbols if req and req.symbols else ALL_SYMBOLS
    ohlcv = fetch_all_symbols(symbols)
    results["fetch"] = {"symbols": int(ohlcv["symbol"].nunique()), "rows": len(ohlcv)}

    # Step 2: Train signal model
    print("Training signal model...")
    from models.train_signal import train_signal_model
    results["signal_model"] = train_signal_model(ohlcv)

    # Step 3: Train quantile targets
    print("Training quantile models...")
    from models.train_target import train_target_models
    results["target_models"] = train_target_models(ohlcv)

    # Step 4: Train regime model
    print("Training regime model...")
    from models.train_regime import train_regime_model
    results["regime_model"] = train_regime_model(ohlcv)

    # Step 5: Backtest
    print("Running walk-forward backtest...")
    feat_list = []
    for sym in ohlcv["symbol"].unique():
        sdf = ohlcv[ohlcv["symbol"] == sym]
        if len(sdf) < 300:
            continue
        feat = build_features(sdf)
        labeled = build_labels(feat)
        feat_list.append(labeled)

    if feat_list:
        combined = pd.concat(feat_list, ignore_index=True)
        feature_cols = get_feature_columns(combined)
        results["backtest"] = walk_forward_backtest(combined, feature_cols)

    # Clear prediction cache
    prediction_cache.clear()

    return {"status": "complete", "results": results, "timestamp": int(time.time() * 1000)}


@app.get("/backtest")
async def get_backtest(symbol: Optional[str] = None):
    ohlcv = load_ohlcv()
    if ohlcv is None:
        raise HTTPException(status_code=503, detail="No data.")

    if symbol:
        sym_data = ohlcv[ohlcv["symbol"].str.contains(symbol, case=False, na=False)]
        if sym_data.empty:
            raise HTTPException(status_code=404, detail=f"No data for {symbol}")
        ohlcv = sym_data

    feat_list = []
    for sym in ohlcv["symbol"].unique():
        sdf = ohlcv[ohlcv["symbol"] == sym]
        if len(sdf) < 300:
            continue
        feat = build_features(sdf)
        labeled = build_labels(feat)
        feat_list.append(labeled)

    if not feat_list:
        raise HTTPException(status_code=400, detail="Not enough data for backtest.")

    combined = pd.concat(feat_list, ignore_index=True)
    feature_cols = get_feature_columns(combined)
    return walk_forward_backtest(combined, feature_cols)


@app.get("/pricepoints/{symbol}")
async def get_pricepoints(symbol: str):
    ohlcv = load_ohlcv()
    if ohlcv is None:
        raise HTTPException(status_code=503, detail="No data.")

    sym_data = ohlcv[ohlcv["symbol"].str.contains(symbol, case=False, na=False)]
    if sym_data.empty:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    sym = sym_data["symbol"].unique()[0]
    sym_df = ohlcv[ohlcv["symbol"] == sym].tail(300)
    result = calculate_exact_entry(sym_df)
    result["symbol"] = symbol
    return result


@app.post("/refresh")
async def refresh_data():
    ohlcv = fetch_all_symbols()
    prediction_cache.clear()
    return {"status": "refreshed", "symbols": int(ohlcv["symbol"].nunique()), "rows": len(ohlcv)}


@app.get("/regime")
async def get_regime():
    """Get current market regime from HMM model + SIP multiplier."""
    hmm_path = MODEL_DIR / "hmm_model.pkl"
    if not hmm_path.exists():
        raise HTTPException(status_code=503, detail="HMM model not trained yet. Call /train first.")

    model_data = joblib.load(hmm_path)
    hmm = model_data["model"]
    feature_cols = model_data["feature_cols"]
    regime_labels = model_data["regime_labels"]
    sip_multipliers = model_data["sip_multipliers"]

    ohlcv = load_ohlcv()
    if ohlcv is None:
        raise HTTPException(status_code=503, detail="No OHLCV data.")

    # Build same features used during training
    import numpy as np
    regime_symbols = ["SPY", "QQQ", "VIX"]
    available = [s for s in regime_symbols if s in ohlcv["symbol"].unique()]

    regime_data = []
    for sym in available:
        sdf = ohlcv[ohlcv["symbol"] == sym].copy().set_index("date")
        ret = sdf["close"].pct_change()
        vol = ret.rolling(20).std() * np.sqrt(252)
        feat = pd.DataFrame({
            f"{sym}_ret": ret,
            f"{sym}_vol": vol,
            f"{sym}_sma20_ratio": sdf["close"] / sdf["close"].rolling(20).mean() - 1,
        }, index=sdf.index)
        regime_data.append(feat)

    combined = pd.concat(regime_data, axis=1).dropna()
    X = combined[feature_cols].values
    X = np.nan_to_num(X, nan=0.0)

    # Predict current regime (last row)
    current_state = int(hmm.predict(X[-1:])[0])
    regime = regime_labels.get(current_state, "UNKNOWN")
    sip_mult = sip_multipliers.get(current_state, 1.0)

    # Get probability of current state
    probs = hmm.predict_proba(X[-1:])[0]
    probability = float(probs[current_state])

    # Last 10 states for sequence view
    last_states = hmm.predict(X[-10:])
    state_sequence = [regime_labels.get(int(s), "UNKNOWN") for s in last_states]

    return {
        "regime": regime,
        "probability": round(probability, 4),
        "sip_multiplier": sip_mult,
        "state_sequence": state_sequence,
        "current_state_id": current_state,
        "timestamp": pd.Timestamp.now().isoformat(),
    }


# ============================================================
# ORCHESTRATOR — 7-Step Pro-Trader Analysis + Multi-Provider LLM
# ============================================================
from app.quant_brain import analyze as quant_analyze, brain_to_text
from app.llm_router import ask_llm as router_ask_llm, get_provider_status, anti_hallucination_check
from app.prompts import get_7step_system_prompt, build_analysis_prompt, build_signals_prompt, build_portfolio_prompt

import time as _time
import hashlib as _hashlib

_orch_cache = {}
ORCH_CACHE_TTL = 60


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
async def analyze_symbol(req: PredictionRequest):
    """Full deep analysis: Quant Brain + LLM narration."""
    cache_key = _hashlib.md5(f"{req.symbol}:{_time.time() // ORCH_CACHE_TTL}".encode()).hexdigest()
    if cache_key in _orch_cache:
        cached = _orch_cache[cache_key]
        cached["from_cache"] = True
        return cached

    ohlcv = load_ohlcv()
    df = pd.DataFrame()
    if ohlcv is not None:
        sym_data = ohlcv[ohlcv["symbol"].str.upper() == req.symbol.upper()]
        if not sym_data.empty:
            df = sym_data.tail(300)

    brain_result = quant_analyze(req.symbol, df, {"vix": 0, "regime": "UNKNOWN"})
    brain_result["market"] = req.market

    system_prompt = get_7step_system_prompt()
    user_prompt = build_analysis_prompt(brain_result)
    llm_text = router_ask_llm(system_prompt, user_prompt)

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
        "timestamp": _time.time(),
    }
    _orch_cache[cache_key] = result
    return result


@app.post("/orchestrate/signals")
async def orchestrate_signals():
    """Scan watchlist for STRONG_BUY/BUY signals."""
    ohlcv = load_ohlcv()
    if ohlcv is None:
        return {"signals": [], "message": "No data"}

    symbols = ohlcv["symbol"].unique().tolist()[:20]
    results = []
    for sym in symbols:
        sym_data = ohlcv[ohlcv["symbol"] == sym]
        df = sym_data.tail(300) if not sym_data.empty else pd.DataFrame()
        brain = quant_analyze(sym, df, {"vix": 0, "regime": "UNKNOWN"})
        results.append(brain)

    results.sort(key=lambda x: x.get("confidence", 0), reverse=True)

    system_prompt = get_7step_system_prompt()
    user_prompt = build_signals_prompt(results)
    llm_text = router_ask_llm(system_prompt, user_prompt)

    if not llm_text:
        llm_text = "\n".join([
            f"{r['symbol']}: {r['verdict']} ({r['confidence']}%) | Entry: {r['entry']} | SL: {r['sl']} | TP1: {r['tp1']}"
            for r in results if r['verdict'] in ('STRONG_BUY', 'BUY')
        ]) or "No strong signals currently."

    return {"signals": results, "text": llm_text, "count": len(results)}


@app.get("/providers")
async def providers():
    return {"providers": get_provider_status()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
