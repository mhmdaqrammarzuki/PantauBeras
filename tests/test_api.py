"""API integration tests for Pantau Beras Sulawesi backend server."""

from __future__ import annotations

import csv
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request

os.environ["PANTAU_BERAS_QUIET"] = "1"

from backend.server import create_server  # noqa: E402


class TestApiServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = create_server(host="127.0.0.1", port=0)
        cls.port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def get_json(self, path: str) -> tuple[int, dict]:
        try:
            with urllib.request.urlopen(self.base + path) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read().decode("utf-8"))

    def test_health_and_meta(self) -> None:
        code, health = self.get_json("/api/health")
        self.assertEqual(code, 200)
        self.assertEqual(health["status"], "ok")

        with urllib.request.urlopen(self.base + "/favicon.ico") as fav_resp:
            self.assertEqual(fav_resp.status, 204)

        code, meta = self.get_json("/api/meta")
        self.assertEqual(code, 200)
        self.assertEqual(meta["commodity"]["name"], "Beras (jenis tidak dirinci)")
        self.assertEqual(len(meta["provinces"]), 6)
        self.assertEqual(len(meta["segments"]), 3)

    def test_overview_modern_tradisional_produsen(self) -> None:
        code, mod = self.get_json("/api/overview?segment=modern")
        self.assertEqual(code, 200)
        self.assertEqual(mod["latest_date"], "2026-02-12")
        self.assertEqual(mod["disparity"]["gap_idr"], 3400)
        self.assertEqual(mod["disparity"]["cheapest"]["province"], "Sulawesi Barat")
        self.assertEqual(mod["disparity"]["cheapest"]["price_idr"], 14300)
        self.assertEqual(mod["disparity"]["most_expensive"]["province"], "Sulawesi Tengah")
        self.assertEqual(mod["disparity"]["most_expensive"]["price_idr"], 17700)

        code, trad = self.get_json("/api/overview?segment=tradisional")
        self.assertEqual(code, 200)
        self.assertEqual(trad["disparity"]["gap_idr"], 1200)

        code, prod = self.get_json("/api/overview?segment=produsen")
        self.assertEqual(code, 200)
        self.assertEqual(prod["disparity"]["gap_idr"], 1750)

    def test_trends_daily_weekly_monthly(self) -> None:
        for agg in ("daily", "weekly", "monthly"):
            code, data = self.get_json(f"/api/trends?segment=modern&provinces=Sulawesi+Tengah,Sulawesi+Selatan&agg={agg}&range=1y")
            self.assertEqual(code, 200)
            self.assertEqual(data["agg"], agg)
            self.assertEqual(len(data["series"]), 2)
            self.assertTrue(len(data["series"][0]["points"]) >= 12)

    def test_compare_and_imputed_date(self) -> None:
        code, cmp_latest = self.get_json("/api/compare?segment=modern&date=2026-02-12")
        self.assertEqual(code, 200)
        self.assertFalse(cmp_latest["is_imputed_date"])
        self.assertEqual(cmp_latest["disparity_idr"], 3400)
        self.assertEqual(cmp_latest["supply_chain_margins"][0]["province"], "Sulawesi Tengah")
        self.assertEqual(cmp_latest["supply_chain_margins"][0]["spread_idr"], 5250)

        code, cmp_imp = self.get_json("/api/compare?segment=modern&date=2024-04-13")
        self.assertEqual(code, 200)
        self.assertTrue(cmp_imp["is_imputed_date"])

    def test_forecasts_endpoint(self) -> None:
        code, fc = self.get_json("/api/forecasts?segment=modern&province=Sulawesi+Selatan&horizon=4&model=arima_110")
        self.assertEqual(code, 200)
        self.assertEqual(len(fc["forecast_points"]), 4)
        self.assertEqual(len(fc["model_comparison"]), 3)
        self.assertAlmostEqual(fc["model_comparison"][0]["eval_mae"], 2.23, places=2)

        code2, fc_st = self.get_json("/api/forecasts?segment=modern&province=Sulawesi+Tengah&horizon=4&model=arima_110")
        self.assertEqual(code2, 200)
        by_model = {m["model_name"]: m for m in fc_st["model_comparison"]}
        self.assertAlmostEqual(by_model["arima_110"]["eval_mae"], 94.41, places=2)
        self.assertAlmostEqual(by_model["moving_average_4w"]["eval_mae"], 143.08, places=2)
        self.assertAlmostEqual(by_model["seasonal_naive"]["eval_mae"], 1282.66, places=2)

    def test_quality_and_empty_state_filter(self) -> None:
        code, q_mod = self.get_json("/api/quality?segment=modern&province=all")
        self.assertEqual(code, 200)
        self.assertEqual(q_mod["imputed_dates_count"], 11)
        self.assertEqual(q_mod["anomalies_count"], 12)

        code, q_empty = self.get_json("/api/quality?segment=tradisional&province=Sulawesi+Selatan")
        self.assertEqual(code, 200)
        self.assertEqual(q_empty["anomalies_count"], 0)

    def test_export_preview_and_csv_download(self) -> None:
        code, prev = self.get_json("/api/export?segment=modern&provinces=all&shape=long&preview=1")
        self.assertEqual(code, 200)
        self.assertEqual(prev["total_rows"], 9024)
        self.assertEqual(len(prev["rows"]), 5)

        with urllib.request.urlopen(self.base + "/api/export?segment=modern&provinces=all&shape=wide&preview=0") as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("text/csv", resp.headers.get("Content-Type", ""))
            csv_rows = list(csv.reader(io.StringIO(resp.read().decode("utf-8"))))
            self.assertEqual(len(csv_rows), 1505)  # header + 1504 calendar days
            self.assertIn("Sulawesi Selatan", csv_rows[0])

    def test_invalid_params_return_400(self) -> None:
        code, err = self.get_json("/api/overview?segment=invalid")
        self.assertEqual(code, 400)
        self.assertIn("error", err)

        code, err2 = self.get_json("/api/compare?segment=modern&date=1999-01-01")
        self.assertEqual(code, 400)
        self.assertIn("error", err2)


if __name__ == "__main__":
    unittest.main()
