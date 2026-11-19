"""Time-series forecasting engine and verified Figma snapshot generator."""

from __future__ import annotations

import json
import math
import sqlite3
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / "data" / "pantau_beras.db"
SNAPSHOT_PATH = ROOT_DIR / "data" / "verified_figma_snapshot.json"

HOLDOUT_START = "2025-01-01"
HORIZONS = (4, 8)
MODELS = ("moving_average_4w", "seasonal_naive", "arima_110")


def aggregate_weekly(rows: list[tuple[str, int]]) -> list[tuple[str, float]]:
    """Aggregate daily (price_date, price_idr) into Monday-anchored weekly averages."""
    buckets: dict[str, list[int]] = {}
    for d_str, price in rows:
        dt = datetime.strptime(d_str, "%Y-%m-%d")
        monday = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
        buckets.setdefault(monday, []).append(price)
    ordered = sorted(buckets.items(), key=lambda kv: kv[0])
    return [(w, sum(vals) / len(vals)) for w, vals in ordered]


def forecast_moving_average_4w(history: list[float], horizon: int) -> list[float]:
    """Flat baseline: mean of last 4 weekly observations."""
    window = history[-4:] if len(history) >= 4 else history
    level = sum(window) / len(window)
    return [level for _ in range(horizon)]


def forecast_seasonal_naive(history: list[float], horizon: int) -> list[float]:
    """Seasonal naive: observation 52 weeks earlier, falling back to latest value."""
    preds: list[float] = []
    n = len(history)
    for step in range(1, horizon + 1):
        idx = n - 52 + (step - 1)
        if 0 <= idx < n:
            preds.append(history[idx])
        else:
            preds.append(history[-1])
    return preds


def forecast_arima_110(history: list[float], horizon: int) -> list[float]:
    """Fit ARIMA(1,1,0) via OLS on first differences with mild drift damping."""
    if len(history) < 8:
        return [history[-1] for _ in range(horizon)]

    diffs = [history[i] - history[i - 1] for i in range(1, len(history))]
    # Winsorize extreme >25% single-week step jumps only during parameter estimation
    # so data spikes (e.g. 2022 producer outlier) do not explode AR(1) slope.
    clean_diffs: list[float] = []
    for i, d in enumerate(diffs):
        base = max(history[i], 1.0)
        cap = 0.25 * base
        clean_diffs.append(max(-cap, min(cap, d)))

    x = clean_diffs[:-1]
    y = clean_diffs[1:]
    mx = sum(x) / len(x)
    my = sum(y) / len(y)
    denom = sum((xi - mx) ** 2 for xi in x)
    if denom > 1e-9:
        phi = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y)) / denom
    else:
        phi = 0.0
    phi = max(-0.85, min(0.85, phi))

    # Zero-mean difference assumption keeps multi-step drift bounded on step series
    last_diff = clean_diffs[-1]
    level = history[-1]
    preds: list[float] = []
    cur_diff = last_diff
    for _ in range(horizon):
        next_diff = phi * cur_diff
        level = max(1000.0, level + next_diff)
        preds.append(level)
        cur_diff = next_diff
    return preds


def run_model(model_name: str, history: list[float], horizon: int) -> list[float]:
    if model_name == "moving_average_4w":
        return forecast_moving_average_4w(history, horizon)
    if model_name == "seasonal_naive":
        return forecast_seasonal_naive(history, horizon)
    if model_name == "arima_110":
        return forecast_arima_110(history, horizon)
    raise ValueError(f"Unknown model {model_name}")


def evaluate_holdout(
    weekly: list[tuple[str, float]],
    model_name: str,
    horizon: int,
) -> tuple[float, float, list[float]]:
    """Chronological walk-forward evaluation for origins in HOLDOUT_START..end."""
    dates = [w for w, _ in weekly]
    vals = [v for _, v in weekly]
    start_idx = next((i for i, d in enumerate(dates) if d >= HOLDOUT_START), len(vals) // 2)
    start_idx = max(start_idx, 53)

    abs_errors: list[float] = []
    pct_errors: list[float] = []
    step_residuals: list[list[float]] = [[] for _ in range(horizon)]

    for origin in range(start_idx, len(vals) - horizon + 1):
        hist = vals[:origin]
        preds = run_model(model_name, hist, horizon)
        for s in range(horizon):
            actual = vals[origin + s]
            err = actual - preds[s]
            abs_errors.append(abs(err))
            pct_errors.append(abs(err) / actual * 100.0)
            step_residuals[s].append(err)

    mae = sum(abs_errors) / len(abs_errors)
    mape = sum(pct_errors) / len(pct_errors)
    step_stds: list[float] = []
    for res in step_residuals:
        if len(res) >= 2:
            rms = math.sqrt(sum(e * e for e in res) / len(res))
            step_stds.append(max(rms, 100.0))
        else:
            step_stds.append(max(mae * 1.25, 100.0))
    return round(mae, 2), round(mape, 2), step_stds


def run_forecasts() -> dict[str, list[dict]]:
    """Evaluate all models and store 4w/8w projections in price_forecasts."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("DELETE FROM price_forecasts")
        trained_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        commodity_id = conn.execute("SELECT id FROM commodities WHERE slug = 'beras'").fetchone()["id"]
        segments = conn.execute("SELECT id, slug, label FROM market_segments ORDER BY id").fetchall()
        provinces = conn.execute("SELECT id, name FROM provinces ORDER BY name").fetchall()

        summary_by_seg: dict[str, list[dict]] = {}
        insert_rows: list[tuple] = []

        for seg in segments:
            seg_list: list[dict] = []
            for prov in provinces:
                daily = conn.execute(
                    """
                    SELECT price_date, price_idr
                    FROM price_observations
                    WHERE market_segment_id = ? AND province_id = ?
                    ORDER BY price_date ASC
                    """,
                    (seg["id"], prov["id"]),
                ).fetchall()
                weekly = aggregate_weekly([(r["price_date"], r["price_idr"]) for r in daily])
                last_date = datetime.strptime(daily[-1]["price_date"], "%Y-%m-%d")
                vals = [v for _, v in weekly]

                for horizon in HORIZONS:
                    for model_name in MODELS:
                        mae, mape, step_stds = evaluate_holdout(weekly, model_name, horizon)
                        preds = run_model(model_name, vals, horizon)
                        for s_idx, pred in enumerate(preds):
                            step_week = s_idx + 1
                            target_dt = last_date + timedelta(days=7 * step_week)
                            margin = 1.645 * step_stds[s_idx]
                            pred_int = max(1000, round(pred))
                            lower_int = max(1000, round(pred - margin))
                            upper_int = max(pred_int, round(pred + margin))
                            insert_rows.append(
                                (
                                    commodity_id,
                                    seg["id"],
                                    prov["id"],
                                    model_name,
                                    horizon,
                                    step_week,
                                    target_dt.strftime("%Y-%m-%d"),
                                    pred_int,
                                    lower_int,
                                    upper_int,
                                    mae,
                                    mape,
                                    "2025-01-01..2026-02-12",
                                    trained_at,
                                )
                            )
                        if horizon == 4:
                            seg_list.append(
                                {
                                    "province": prov["name"],
                                    "model": model_name,
                                    "mae": mae,
                                    "mape": mape,
                                    "week4_pred": round(preds[-1]),
                                }
                            )
            summary_by_seg[seg["slug"]] = seg_list

        conn.executemany(
            """
            INSERT INTO price_forecasts (
                commodity_id, market_segment_id, province_id, model_name,
                horizon_weeks, step_week, target_date, predicted_idr,
                lower_idr, upper_idr, eval_mae, eval_mape, eval_period, trained_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            insert_rows,
        )
        conn.commit()
        build_verified_snapshot(conn)
        return summary_by_seg
    finally:
        conn.close()


def build_verified_snapshot(conn: sqlite3.Connection) -> None:
    """Write a complete verified JSON snapshot for Figma design authoring."""
    etl_rows = [
        dict(r)
        for r in conn.execute(
            """
            SELECT ms.slug, ms.label, er.min_date, er.max_date, er.raw_rows,
                   er.calendar_days, er.rows_long, er.rows_imputed, er.rows_anomaly
            FROM etl_runs er
            JOIN market_segments ms ON ms.id = er.market_segment_id
            ORDER BY ms.id
            """
        ).fetchall()
    ]

    latest_date = "2026-02-12"
    provinces = [r["name"] for r in conn.execute("SELECT name FROM provinces ORDER BY name").fetchall()]
    latest_by_segment: dict[str, list[dict]] = {}
    for seg_slug in ("modern", "tradisional", "produsen"):
        rows = conn.execute(
            """
            SELECT p.name AS province, o.price_idr
            FROM price_observations o
            JOIN provinces p ON p.id = o.province_id
            JOIN market_segments ms ON ms.id = o.market_segment_id
            WHERE ms.slug = ? AND o.price_date = ?
            ORDER BY o.price_idr ASC
            """,
            (seg_slug, latest_date),
        ).fetchall()

        enriched = []
        for r in rows:
            prov_name = r["province"]
            hist = conn.execute(
                """
                SELECT o.price_date, o.price_idr
                FROM price_observations o
                JOIN provinces p ON p.id = o.province_id
                JOIN market_segments ms ON ms.id = o.market_segment_id
                WHERE ms.slug = ? AND p.name = ?
                ORDER BY o.price_date ASC
                """,
                (seg_slug, prov_name),
            ).fetchall()
            prices = [h["price_idr"] for h in hist]
            p_now = prices[-1]
            p_7d = prices[-8]
            p_30d = prices[-31]
            change_days = sum(1 for i in range(1, len(prices)) if prices[i] != prices[i - 1])
            spark = [prices[i] for i in range(len(prices) - 90, len(prices), 3)]
            if spark[-1] != p_now:
                spark.append(p_now)
            enriched.append(
                {
                    "province": prov_name,
                    "price_idr": p_now,
                    "pct_7d": round((p_now - p_7d) / p_7d * 100.0, 2),
                    "pct_30d": round((p_now - p_30d) / p_30d * 100.0, 2),
                    "change_days": change_days,
                    "spark_90d": spark,
                }
            )
        latest_by_segment[seg_slug] = enriched

    margin_table = []
    for prov_name in provinces:
        p_mod = next(x["price_idr"] for x in latest_by_segment["modern"] if x["province"] == prov_name)
        p_trad = next(x["price_idr"] for x in latest_by_segment["tradisional"] if x["province"] == prov_name)
        p_prod = next(x["price_idr"] for x in latest_by_segment["produsen"] if x["province"] == prov_name)
        spread = p_mod - p_prod
        margin_table.append(
            {
                "province": prov_name,
                "produsen_idr": p_prod,
                "tradisional_idr": p_trad,
                "modern_idr": p_mod,
                "spread_idr": spread,
                "spread_pct": round(spread / p_prod * 100.0, 1),
            }
        )
    margin_table.sort(key=lambda x: x["spread_idr"], reverse=True)

    trend_provs = ["Sulawesi Tengah", "Gorontalo", "Sulawesi Selatan", "Sulawesi Barat"]
    monthly_series: dict[str, list[dict]] = {}
    for prov_name in trend_provs:
        mrows = conn.execute(
            """
            SELECT o.year, o.month, ROUND(AVG(o.price_idr)) AS avg_price
            FROM price_observations o
            JOIN provinces p ON p.id = o.province_id
            JOIN market_segments ms ON ms.id = o.market_segment_id
            WHERE ms.slug = 'modern' AND p.name = ?
              AND ((o.year = 2025 AND o.month >= 3) OR o.year = 2026)
            GROUP BY o.year, o.month
            ORDER BY o.year, o.month
            """,
            (prov_name,),
        ).fetchall()
        monthly_series[prov_name] = [
            {"label": f"{r['year']}-{r['month']:02d}", "price": int(r["avg_price"])} for r in mrows
        ]

    sulsel_daily = conn.execute(
        """
        SELECT o.price_date, o.price_idr
        FROM price_observations o
        JOIN provinces p ON p.id = o.province_id
        JOIN market_segments ms ON ms.id = o.market_segment_id
        WHERE ms.slug = 'modern' AND p.name = 'Sulawesi Selatan'
        ORDER BY o.price_date ASC
        """
    ).fetchall()
    sulsel_weekly = aggregate_weekly([(r["price_date"], r["price_idr"]) for r in sulsel_daily])[-16:]

    sulsel_forecasts: dict[str, dict] = {}
    for model_name in MODELS:
        fc_rows = conn.execute(
            """
            SELECT pf.step_week, pf.target_date, pf.predicted_idr, pf.lower_idr, pf.upper_idr,
                   pf.eval_mae, pf.eval_mape
            FROM price_forecasts pf
            JOIN provinces p ON p.id = pf.province_id
            JOIN market_segments ms ON ms.id = pf.market_segment_id
            WHERE ms.slug = 'modern' AND p.name = 'Sulawesi Selatan'
              AND pf.model_name = ? AND pf.horizon_weeks = 4
            ORDER BY pf.step_week ASC
            """,
            (model_name,),
        ).fetchall()
        sulsel_forecasts[model_name] = {
            "eval_mae": fc_rows[0]["eval_mae"],
            "eval_mape": fc_rows[0]["eval_mape"],
            "points": [dict(r) for r in fc_rows],
        }

    imputed_dates_modern = [
        dict(r)
        for r in conn.execute(
            """
            SELECT o.price_date,
                   MAX(CASE WHEN p.name = 'Sulawesi Selatan' THEN o.price_idr END) AS sulsel_idr,
                   MAX(CASE WHEN p.name = 'Sulawesi Tengah' THEN o.price_idr END) AS sulteng_idr
            FROM price_observations o
            JOIN provinces p ON p.id = o.province_id
            JOIN market_segments ms ON ms.id = o.market_segment_id
            WHERE ms.slug = 'modern' AND o.is_imputed = 1
            GROUP BY o.price_date
            ORDER BY o.price_date DESC
            """
        ).fetchall()
    ]

    anomalies_modern = [
        dict(r)
        for r in conn.execute(
            """
            SELECT o.price_date, p.name AS province, o.price_idr, o.pct_change_daily, o.anomaly_status
            FROM price_observations o
            JOIN provinces p ON p.id = o.province_id
            JOIN market_segments ms ON ms.id = o.market_segment_id
            WHERE ms.slug = 'modern' AND o.is_anomaly = 1
            ORDER BY o.price_date DESC
            """
        ).fetchall()
    ]

    snapshot = {
        "latest_date": latest_date,
        "etl_runs": etl_rows,
        "latest_by_segment": latest_by_segment,
        "margin_table_2026_02_12": margin_table,
        "modern_monthly_trend_12m": monthly_series,
        "sulsel_modern_weekly_16w": [
            {"week": w, "price": round(v)} for w, v in sulsel_weekly
        ],
        "sulsel_modern_forecasts_4w": sulsel_forecasts,
        "modern_imputed_dates_r3": imputed_dates_modern,
        "modern_anomalies_r5": anomalies_modern,
    }
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")


if __name__ == "__main__":
    out = run_forecasts()
    for slug, rows in out.items():
        print(f"=== Forecast Eval (4w) [{slug}] ===")
        for row in rows:
            print(
                f"  {row['province']:20s} | {row['model']:18s} | "
                f"MAE=Rp{row['mae']:.1f} | MAPE={row['mape']:.2f}% | W4=Rp{row['week4_pred']}"
            )
