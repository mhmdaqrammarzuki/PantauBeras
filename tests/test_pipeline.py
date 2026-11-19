"""Verification suite for ETL (R1-R7) and forecasting models."""

from __future__ import annotations

import json
import sqlite3
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / "data" / "pantau_beras.db"
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
SNAPSHOT_PATH = ROOT_DIR / "data" / "verified_figma_snapshot.json"


class TestPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.conn = sqlite3.connect(DB_PATH)
        cls.conn.row_factory = sqlite3.Row

    @classmethod
    def tearDownClass(cls) -> None:
        cls.conn.close()

    def test_etl_counts_all_segments(self) -> None:
        runs = {
            r["slug"]: dict(r)
            for r in self.conn.execute(
                """
                SELECT ms.slug, er.raw_rows, er.calendar_days, er.rows_long,
                       er.rows_imputed, er.rows_anomaly, er.min_date, er.max_date
                FROM etl_runs er
                JOIN market_segments ms ON ms.id = er.market_segment_id
                """
            ).fetchall()
        }
        self.assertEqual(set(runs.keys()), {"modern", "tradisional", "produsen"})

        self.assertEqual(runs["modern"]["raw_rows"], 1493)
        self.assertEqual(runs["modern"]["calendar_days"], 1504)
        self.assertEqual(runs["modern"]["rows_long"], 9024)
        self.assertEqual(runs["modern"]["rows_imputed"], 66)
        self.assertEqual(runs["modern"]["rows_anomaly"], 12)

        self.assertEqual(runs["tradisional"]["raw_rows"], 1415)
        self.assertEqual(runs["tradisional"]["rows_long"], 9024)
        self.assertEqual(runs["tradisional"]["rows_imputed"], 534)
        self.assertEqual(runs["tradisional"]["rows_anomaly"], 1)

        self.assertEqual(runs["produsen"]["raw_rows"], 1493)
        self.assertEqual(runs["produsen"]["rows_long"], 9024)
        self.assertEqual(runs["produsen"]["rows_imputed"], 66)
        self.assertEqual(runs["produsen"]["rows_anomaly"], 27)

    def test_modern_latest_prices_and_disparity(self) -> None:
        rows = self.conn.execute(
            """
            SELECT p.name, o.price_idr
            FROM price_observations o
            JOIN provinces p ON p.id = o.province_id
            JOIN market_segments ms ON ms.id = o.market_segment_id
            WHERE ms.slug = 'modern' AND o.price_date = '2026-02-12'
            """
        ).fetchall()
        actual = {r["name"]: r["price_idr"] for r in rows}
        expected = {
            "Sulawesi Barat": 14300,
            "Sulawesi Selatan": 14950,
            "Sulawesi Utara": 15450,
            "Sulawesi Tenggara": 15750,
            "Gorontalo": 16750,
            "Sulawesi Tengah": 17700,
        }
        self.assertEqual(actual, expected)
        self.assertEqual(max(actual.values()) - min(actual.values()), 3400)

    def test_tradisional_and_produsen_disparity(self) -> None:
        for slug, expected_disp in [("tradisional", 1200), ("produsen", 1750)]:
            row = self.conn.execute(
                """
                SELECT MAX(o.price_idr) - MIN(o.price_idr) AS disp
                FROM price_observations o
                JOIN market_segments ms ON ms.id = o.market_segment_id
                WHERE ms.slug = ? AND o.price_date = '2026-02-12'
                """,
                (slug,),
            ).fetchone()
            self.assertEqual(row["disp"], expected_disp)

    def test_r4_positive_integers_and_r5_sultra_spike(self) -> None:
        bad = self.conn.execute("SELECT COUNT(*) AS c FROM price_observations WHERE price_idr <= 0").fetchone()
        self.assertEqual(bad["c"], 0)
        sultra = self.conn.execute(
            """
            SELECT o.price_idr, o.pct_change_daily, o.is_anomaly, o.anomaly_status
            FROM price_observations o
            JOIN provinces p ON p.id = o.province_id
            JOIN market_segments ms ON ms.id = o.market_segment_id
            WHERE ms.slug = 'modern' AND p.name = 'Sulawesi Tenggara' AND o.price_date = '2023-11-01'
            """
        ).fetchone()
        self.assertEqual(sultra["price_idr"], 14600)
        self.assertEqual(sultra["is_anomaly"], 1)
        self.assertEqual(sultra["anomaly_status"], "perlu_verifikasi")
        self.assertAlmostEqual(sultra["pct_change_daily"], -24.9357, places=2)

    def test_forecasts_complete_and_bounded(self) -> None:
        count = self.conn.execute("SELECT COUNT(*) AS c FROM price_forecasts").fetchone()["c"]
        # 3 segments x 6 provinces x 3 models x (4 + 8) steps = 648
        self.assertEqual(count, 648)
        bad_fc = self.conn.execute(
            """
            SELECT COUNT(*) AS c FROM price_forecasts
            WHERE predicted_idr <= 0 OR eval_mae <= 0 OR eval_mape <= 0 OR eval_mape >= 50
            """
        ).fetchone()
        self.assertEqual(bad_fc["c"], 0)

    def test_csv_and_snapshot_artifacts_exist(self) -> None:
        for slug in ("modern", "tradisional", "produsen"):
            self.assertTrue((PROCESSED_DIR / f"beras_sulawesi_{slug}_long.csv").exists())
            self.assertTrue((PROCESSED_DIR / f"beras_sulawesi_{slug}_wide.csv").exists())
        snap = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        self.assertEqual(len(snap["modern_imputed_dates_r3"]), 11)
        self.assertEqual(len(snap["modern_anomalies_r5"]), 12)


if __name__ == "__main__":
    unittest.main()
