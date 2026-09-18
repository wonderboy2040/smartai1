"""
META-ENSEMBLE RETRAIN SCHEDULER (Upgrade 4)
------------------------------------------------
Weekly retrain of the stacked meta-learner so it never goes stale
as new market data lands. Stale training data = silently degraded
accuracy — the exact thing the meta layer exists to fix.

Run modes:
  1. Standalone daemon (default):
       python -m models.retrain_scheduler
     Retrains immediately on boot, then every RETRAIN_INTERVAL_HOURS
     (default 168 = weekly). APScheduler when available, else a
     plain sleep-loop (zero hard deps).
  2. One-shot (Render cron / CI):
       python -m models.retrain_scheduler --once
  3. Import + call:
       from models.retrain_scheduler import retrain_now
       result = retrain_now()

Environment:
  META_RETRAIN_INTERVAL_HOURS  (default 168 — weekly)
  META_RETRAIN_FETCH           ('true' = re-fetch fresh OHLCV first)
"""

import os
import sys
import time
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [meta-retrain] %(message)s")
logger = logging.getLogger("meta-retrain")

RETRAIN_INTERVAL_HOURS = float(os.getenv("META_RETRAIN_INTERVAL_HOURS", "168") or 168)


def retrain_now(fetch_fresh: bool = False) -> dict:
    """One full retrain cycle. Returns the train_meta_ensemble dict
    (or an error dict — never raises: a failed retrain keeps the
    previous pkl in place, which is exactly the graceful degrade
    the inference side expects)."""
    try:
        if fetch_fresh or os.getenv("META_RETRAIN_FETCH", "").strip().lower() in ("1", "true", "on", "yes"):
            logger.info("fetching fresh OHLCV data…")
            try:
                from pipeline.fetch_data import fetch_all
                fetch_all()
            except Exception as e:  # noqa: BLE001 — fetch is best-effort
                logger.warning("fresh fetch failed (%s) — training on stored data", e)

        from models.train_signal import train_meta_ensemble
        result = train_meta_ensemble()
        if result.get("error"):
            logger.warning("retrain skipped: %s", result["error"])
        else:
            logger.info(
                "retrained: %s samples, walk-forward F1 %s → %s",
                result.get("samples"), result.get("avg_weighted_f1"), result.get("artifact"),
            )
        return result
    except Exception as e:  # noqa: BLE001 — scheduler must never die
        logger.error("retrain failed: %s", e)
        return {"error": str(e)}


def _schedule_loop():
    interval_s = RETRAIN_INTERVAL_HOURS * 3600
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler

        sched = BlockingScheduler(timezone="UTC")
        sched.add_job(
            retrain_now, "interval", hours=RETRAIN_INTERVAL_HOURS,
            id="meta-ensemble-retrain", next_run_time=None, max_instances=1,
            kwargs={"fetch_fresh": True},
        )
        logger.info("APScheduler armed — retrain every %sh", RETRAIN_INTERVAL_HOURS)
        retrain_now()  # immediate boot train
        sched.start()
    except ImportError:
        logger.info("APScheduler not installed — plain loop every %sh", RETRAIN_INTERVAL_HOURS)
        retrain_now()
        while True:
            time.sleep(interval_s)
            retrain_now(fetch_fresh=True)


if __name__ == "__main__":
    if "--once" in sys.argv:
        print(retrain_now(fetch_fresh=True))
    else:
        _schedule_loop()
