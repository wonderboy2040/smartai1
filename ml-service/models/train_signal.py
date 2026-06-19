import pandas as pd
import numpy as np
import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import f1_score, classification_report
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.config import (
    LGBM_PARAMS, CALIBRATION_METHOD, CV_SPLITS,
    SIGNAL_MODEL_PATH, CALIBRATOR_PATH, MODEL_DIR
)
from pipeline.fetch_data import load_ohlcv
from pipeline.features import build_features, get_feature_columns
from pipeline.labels import build_labels, get_label_distribution


def train_signal_model(all_symbols_df: pd.DataFrame = None) -> dict:
    if all_symbols_df is None:
        all_symbols_df = load_ohlcv()
    if all_symbols_df is None or all_symbols_df.empty:
        return {"error": "No OHLCV data. Run fetch_data.py first."}

    all_features = []
    for sym in all_symbols_df["symbol"].unique():
        sym_df = all_symbols_df[all_symbols_df["symbol"] == sym]
        if len(sym_df) < 300:
            continue
        feat = build_features(sym_df)
        labeled = build_labels(feat)
        all_features.append(labeled)

    if not all_features:
        return {"error": "Not enough data per symbol for training."}

    combined = pd.concat(all_features, ignore_index=True)
    combined = combined.dropna(subset=["label", "fwd_return"])

    feature_cols = get_feature_columns(combined)
    X = combined[feature_cols].values
    y = combined["label"].values

    valid_mask = ~(np.isnan(X).any(axis=1) | np.isinf(X).any(axis=1))
    X = X[valid_mask]
    y = y[valid_mask]

    if len(X) < 500:
        return {"error": f"Not enough samples: {len(X)}"}

    print(f"Training on {len(X)} samples, {len(feature_cols)} features")
    print(f"Label distribution: {dict(zip(*np.unique(y, return_counts=True)))}")

    try:
        import lightgbm as lgb
        base = lgb.LGBMClassifier(**LGBM_PARAMS)
    except ImportError:
        return {"error": "lightgbm not installed. Run: pip install lightgbm"}

    tscv = TimeSeriesSplit(n_splits=min(CV_SPLITS, max(2, len(X) // 200)))

    clf = CalibratedClassifierCV(base, method=CALIBRATION_METHOD, cv=tscv)
    clf.fit(X, y)

    # Evaluate
    scores = []
    for train_idx, val_idx in tscv.split(X):
        X_train, X_val = X[train_idx], X[val_idx]
        y_train, y_val = y[train_idx], y[val_idx]
        base_temp = lgb.LGBMClassifier(**LGBM_PARAMS)
        base_temp.fit(X_train, y_train)
        pred = base_temp.predict(X_val)
        scores.append(f1_score(y_val, pred, average="weighted"))

    avg_f1 = np.mean(scores)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, SIGNAL_MODEL_PATH)

    # Also save feature columns for inference
    feature_cols_path = MODEL_DIR / "feature_cols.pkl"
    joblib.dump(feature_cols, feature_cols_path)

    print(f"Model saved. Avg weighted F1: {avg_f1:.3f}")
    return {
        "status": "trained",
        "samples": len(X),
        "features": len(feature_cols),
        "avg_weighted_f1": round(avg_f1, 3),
        "label_dist": {k: int(v) for k, v in zip(*np.unique(y, return_counts=True))},
    }


if __name__ == "__main__":
    result = train_signal_model()
    print(result)
