import pandas as pd
import numpy as np
from typing import Dict, List
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def walk_forward_backtest(
    df: pd.DataFrame,
    feature_cols: List[str],
    window: int = 756,
    step: int = 63,
) -> Dict:
    try:
        import lightgbm as lgb
    except ImportError:
        return {"error": "lightgbm not installed"}

    try:
        from sklearn.metrics import f1_score
    except ImportError:
        return {"error": "scikit-learn not installed"}

    if "label" not in df.columns or "fwd_return" not in df.columns:
        return {"error": "Labels not found. Run labels.py first."}

    df = df.dropna(subset=["label", "fwd_return"])
    df = df[~df[feature_cols].isin([np.inf, -np.inf]).any(axis=1)]

    if len(df) < window + step * 2:
        return {"error": f"Not enough data: {len(df)} rows, need {window + step * 2}"}

    results = []
    equity = 100000
    equity_curve = []

    for start in range(0, len(df) - window - step, step):
        train_end = start + window
        test_end = min(train_end + step, len(df))

        train = df.iloc[start:train_end]
        test = df.iloc[train_end:test_end]

        if len(test) == 0:
            break

        X_train = train[feature_cols].values
        y_train = train["label"].values
        X_test = test[feature_cols].values
        y_test = test["label"].values
        fwd_returns = test["fwd_return"].values

        valid_train = ~(np.isnan(X_train).any(axis=1) | np.isinf(X_train).any(axis=1))
        valid_test = ~(np.isnan(X_test).any(axis=1) | np.isinf(X_test).any(axis=1))

        if valid_train.sum() < 100 or valid_test.sum() == 0:
            continue

        X_train, y_train = X_train[valid_train], y_train[valid_train]
        X_test, y_test = X_test[valid_test], y_test[valid_test]
        fwd_returns = fwd_returns[valid_test]

        model = lgb.LGBMClassifier(
            n_estimators=200, learning_rate=0.05, num_leaves=31,
            subsample=0.8, colsample_bytree=0.8, class_weight="balanced",
            random_state=42, verbosity=-1, n_jobs=-1,
        )
        model.fit(X_train, y_train)
        preds = model.predict(X_test)

        # Map predictions to returns
        buy_mask = np.isin(preds, ["STRONG_BUY", "BUY"])
        sell_mask = preds == "SELL"

        period_return = 0
        if buy_mask.any():
            period_return = fwd_returns[buy_mask].mean()
        elif sell_mask.any():
            period_return = -abs(fwd_returns[sell_mask].mean())

        equity *= (1 + period_return)

        hit = (preds == y_test).mean()
        equity_curve.append({
            "equity": round(float(equity), 2),
            "return": round(float(period_return * 100), 2),
            "hit_rate": round(float(hit * 100), 1),
        })

        results.append({
            "period": f"{start}-{test_end}",
            "samples": len(X_test),
            "hit_rate": round(float(hit * 100), 1),
            "return_pct": round(float(period_return * 100), 2),
            "f1_weighted": round(float(f1_score(y_test, preds, average="weighted")), 3),
        })

    if not results:
        return {"error": "No valid backtest periods."}

    total_return = (equity - 100000) / 100000 * 100
    avg_hit = np.mean([r["hit_rate"] for r in results])
    avg_return = np.mean([r["return_pct"] for r in results])
    avg_f1 = np.mean([r["f1_weighted"] for r in results])
    win_count = sum(1 for r in results if r["return_pct"] > 0)
    win_rate = win_count / len(results) * 100

    returns = [r["return_pct"] for r in results]
    avg_r = np.mean(returns)
    std_r = np.std(returns) if len(returns) > 1 else 1
    sharpe = avg_r / std_r if std_r > 0 else 0

    gross_profit = sum(r for r in returns if r > 0)
    gross_loss = abs(sum(r for r in returns if r < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 99

    return {
        "total_periods": len(results),
        "total_return_pct": round(float(total_return), 2),
        "avg_hit_rate": round(float(avg_hit), 1),
        "avg_return_per_period": round(float(avg_return), 2),
        "avg_f1_weighted": round(float(avg_f1), 3),
        "period_win_rate": round(float(win_rate), 1),
        "sharpe_ratio": round(float(sharpe), 2),
        "profit_factor": round(float(profit_factor), 2),
        "equity_curve": equity_curve,
        "periods": results[-5:],
    }


if __name__ == "__main__":
    from pipeline.fetch_data import load_ohlcv
    from pipeline.features import build_features, get_feature_columns
    from pipeline.labels import build_labels

    df = load_ohlcv()
    if df is None:
        print("No data.")
    else:
        all_feat = []
        for sym in df["symbol"].unique():
            sdf = df[df["symbol"] == sym]
            if len(sdf) < 300:
                continue
            feat = build_features(sdf)
            labeled = build_labels(feat)
            all_feat.append(labeled)

        if all_feat:
            combined = pd.concat(all_feat, ignore_index=True)
            feature_cols = get_feature_columns(combined)
            result = walk_forward_backtest(combined, feature_cols)
            print(result)
