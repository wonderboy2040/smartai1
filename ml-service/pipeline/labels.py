import pandas as pd
import numpy as np
from typing import Tuple
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.config import HORIZON_DAYS


def build_labels(df: pd.DataFrame, horizon: int = HORIZON_DAYS) -> pd.DataFrame:
    result = df.copy()
    close = result["close"]

    # Forward return over horizon
    result["fwd_return"] = close.shift(-horizon) / close - 1

    # Forward max drawdown within horizon (worst dip before the end)
    fwd_min = close.rolling(horizon, min_periods=1).min().shift(-horizon)
    result["fwd_max_dd"] = fwd_min / close - 1

    # Forward minimum price during horizon
    result["fwd_min_price"] = close.rolling(horizon, min_periods=1).min().shift(-horizon)

    # Classify: STRONG_BUY / BUY / HOLD / SELL
    # STRONG_BUY: high return AND limited downside
    strong_buy = (result["fwd_return"] > 0.15) & (result["fwd_max_dd"] > -0.08)
    buy = (result["fwd_return"] > 0.07) & ~strong_buy
    sell = result["fwd_return"] < -0.05
    hold = ~strong_buy & ~buy & ~sell

    result["label"] = np.select(
        [strong_buy, buy, sell],
        ["STRONG_BUY", "BUY", "SELL"],
        default="HOLD"
    )

    return result


def get_label_distribution(df: pd.DataFrame) -> dict:
    if "label" not in df.columns:
        return {}
    counts = df["label"].value_counts()
    total = len(df)
    return {
        label: {"count": int(counts.get(label, 0)), "pct": round(counts.get(label, 0) / total * 100, 1)}
        for label in ["STRONG_BUY", "BUY", "HOLD", "SELL"]
    }


if __name__ == "__main__":
    from pipeline.fetch_data import load_ohlcv
    from pipeline.features import build_features
    df = load_ohlcv()
    if df is not None:
        sym = df[df["symbol"] == df["symbol"].unique()[0]]
        feat = build_features(sym)
        labeled = build_labels(feat)
        print("Label distribution:")
        print(get_label_distribution(labeled))
        print(f"\nTotal rows: {len(labeled)}")
    else:
        print("No data.")
