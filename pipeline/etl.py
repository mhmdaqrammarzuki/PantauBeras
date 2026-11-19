"""ETL pipeline implementing rules R1 through R7 for Sulawesi rice price data."""

from __future__ import annotations

import csv
import hashlib
import io
import sqlite3
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
ARCHIVE_PATH = ROOT_DIR / "data" / "raw" / "archive.zip"
SCHEMA_PATH = ROOT_DIR / "pipeline" / "schema.sql"
DB_PATH = ROOT_DIR / "data" / "pantau_beras.db"
PROCESSED_DIR = ROOT_DIR / "data" / "processed"

PROVINCES = [
    ("GO", "Gorontalo"),
    ("SR", "Sulawesi Barat"),
    ("SN", "Sulawesi Selatan"),
    ("ST", "Sulawesi Tengah"),
    ("SG", "Sulawesi Tenggara"),
    ("SA", "Sulawesi Utara"),
]

SEGMENTS = [
    (
        "modern",
        "Pasar Modern",
        "data_komoditas_pangan/pasar_modern/Cleaned_After_Imputation/final_komoditas_modern_beras_2022_2026.csv",
    ),
    (
        "tradisional",
        "Pasar Tradisional",
        "data_komoditas_pangan/pasar_tradisional/Cleaned_After_Imputation/final_komoditas_tradisional_beras_2022_2026.csv",
    ),
    (
        "produsen",
        "Tingkat Produsen",
        "data_komoditas_pangan/produsen/Cleaned_After_Imputation/final_komoditas_produsen_beras_2022_2026.csv",
    ),
]


def parse_iso_date(value: str) -> datetime:
    """Parse YYYY-MM-DD date string strictly (R2)."""
    return datetime.strptime(value.strip(), "%Y-%m-%d")


def run_etl() -> dict[str, dict[str, int | str]]:
    """Execute rules R1-R7 across all three rice market segments and populate SQLite + CSV exports."""
    if not ARCHIVE_PATH.exists():
        raise FileNotFoundError(f"Archive dataset not found at {ARCHIVE_PATH}")

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

        # Insert commodity metadata explicitly documenting unknown rice grade (per .docx section 1)
        conn.execute(
            """
            INSERT INTO commodities (slug, name, unit_label, grade_note)
            VALUES (?, ?, ?, ?)
            """,
            (
                "beras",
                "Beras (jenis tidak dirinci)",
                "Rp/kg",
                "Dataset Kaggle PIHPS tidak merinci varian medium/premium; tingkat pelaporan adalah agregat provinsi.",
            ),
        )
        commodity_id = conn.execute("SELECT id FROM commodities WHERE slug = 'beras'").fetchone()[0]

        province_ids: dict[str, int] = {}
        for code, name in PROVINCES:
            conn.execute(
                "INSERT INTO provinces (code, name, island) VALUES (?, ?, 'Sulawesi')",
                (code, name),
            )
            province_ids[name] = conn.execute(
                "SELECT id FROM provinces WHERE name = ?", (name,)
            ).fetchone()[0]

        executed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        summary: dict[str, dict[str, int | str]] = {}

        with zipfile.ZipFile(ARCHIVE_PATH, "r") as zf:
            for slug, label, inner_path in SEGMENTS:
                raw_bytes = zf.read(inner_path)
                sha256 = hashlib.sha256(raw_bytes).hexdigest()
                text_stream = io.StringIO(raw_bytes.decode("utf-8-sig"))
                reader = csv.DictReader(text_stream)
                if not reader.fieldnames:
                    raise ValueError(f"Empty header in {inner_path}")

                date_col = reader.fieldnames[0]
                raw_rows = list(reader)
                if not raw_rows:
                    raise ValueError(f"No rows in {inner_path}")

                # R1: Map strictly the 6 Sulawesi columns
                col_map: dict[str, str] = {}
                for _, prov_name in PROVINCES:
                    for field in reader.fieldnames:
                        if field.strip().lower() == prov_name.lower():
                            col_map[prov_name] = field
                            break
                    if prov_name not in col_map:
                        raise ValueError(f"Missing province {prov_name} in {inner_path}")

                by_date: dict[str, dict[str, str]] = {}
                for row in raw_rows:
                    d_str = parse_iso_date(row[date_col]).strftime("%Y-%m-%d")
                    by_date[d_str] = row

                min_dt = min(parse_iso_date(d) for d in by_date)
                max_dt = max(parse_iso_date(d) for d in by_date)

                # R3: Complete daily calendar sequence from min_date to max_date
                calendar_dates: list[datetime] = []
                cur = min_dt
                while cur <= max_dt:
                    calendar_dates.append(cur)
                    cur += timedelta(days=1)

                conn.execute(
                    "INSERT INTO market_segments (slug, label, source_file) VALUES (?, ?, ?)",
                    (slug, label, inner_path),
                )
                segment_id = conn.execute(
                    "SELECT id FROM market_segments WHERE slug = ?", (slug,)
                ).fetchone()[0]

                last_price: dict[str, int] = {}
                obs_records: list[tuple] = []
                wide_rows: list[dict[str, str | int]] = []
                long_csv_rows: list[list[str | int | float]] = []

                rows_imputed = 0
                rows_anomaly = 0

                for dt in calendar_dates:
                    date_str = dt.strftime("%Y-%m-%d")
                    iso_cal = dt.isocalendar()
                    raw_row = by_date.get(date_str)
                    wide_entry: dict[str, str | int] = {"tanggal": date_str}

                    for _, prov_name in PROVINCES:
                        is_imputed = 0
                        price_val: int | None = None

                        if raw_row is not None:
                            cell = (raw_row[col_map[prov_name]] or "").strip()
                            if cell and cell.lower() != "nan":
                                parsed = round(float(cell))
                                if parsed > 0:  # R4
                                    price_val = parsed

                        if price_val is None:
                            if prov_name not in last_price:
                                raise ValueError(
                                    f"Cannot forward-fill {prov_name} on initial date {date_str}"
                                )
                            price_val = last_price[prov_name]
                            is_imputed = 1

                        if price_val <= 0:
                            raise ValueError(
                                f"Rule R4 violation: non-positive price {price_val} for {prov_name} on {date_str}"
                            )

                        prev = last_price.get(prov_name)
                        pct_change: float | None = None
                        is_anomaly = 0
                        anomaly_status = "normal"

                        if prev is not None:
                            pct_change = round(((price_val - prev) / prev) * 100.0, 4)
                            if abs(pct_change) > 10.0:  # R5: mark without altering/deleting
                                is_anomaly = 1
                                anomaly_status = "perlu_verifikasi"

                        last_price[prov_name] = price_val
                        rows_imputed += is_imputed
                        rows_anomaly += is_anomaly

                        obs_records.append(
                            (
                                commodity_id,
                                segment_id,
                                province_ids[prov_name],
                                date_str,
                                price_val,
                                pct_change,
                                is_imputed,
                                is_anomaly,
                                anomaly_status,
                                dt.year,  # R6
                                dt.month,  # R6
                                iso_cal.week,
                            )
                        )
                        wide_entry[prov_name] = price_val
                        long_csv_rows.append(
                            [
                                date_str,
                                prov_name,
                                price_val,
                                "" if pct_change is None else f"{pct_change:.4f}",
                                is_imputed,
                                is_anomaly,
                                dt.year,
                                dt.month,
                            ]
                        )

                    wide_rows.append(wide_entry)

                conn.executemany(
                    """
                    INSERT INTO price_observations (
                        commodity_id, market_segment_id, province_id, price_date,
                        price_idr, pct_change_daily, is_imputed, is_anomaly,
                        anomaly_status, year, month, iso_week
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    obs_records,
                )

                conn.execute(
                    """
                    INSERT INTO etl_runs (
                        market_segment_id, source_file, source_sha256, min_date, max_date,
                        raw_rows, calendar_days, rows_long, rows_imputed, rows_anomaly, executed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        segment_id,
                        inner_path,
                        sha256,
                        min_dt.strftime("%Y-%m-%d"),
                        max_dt.strftime("%Y-%m-%d"),
                        len(raw_rows),
                        len(calendar_dates),
                        len(obs_records),
                        rows_imputed,
                        rows_anomaly,
                        executed_at,
                    ),
                )

                # R7: Export long and wide CSV artifacts
                long_path = PROCESSED_DIR / f"beras_sulawesi_{slug}_long.csv"
                with long_path.open("w", encoding="utf-8", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow(
                        [
                            "tanggal",
                            "provinsi",
                            "harga_rp_per_kg",
                            "pct_change_harian",
                            "is_imputed",
                            "is_anomaly",
                            "tahun",
                            "bulan",
                        ]
                    )
                    writer.writerows(long_csv_rows)

                wide_path = PROCESSED_DIR / f"beras_sulawesi_{slug}_wide.csv"
                prov_headers = [name for _, name in PROVINCES]
                with wide_path.open("w", encoding="utf-8", newline="") as f:
                    dict_writer = csv.DictWriter(f, fieldnames=["tanggal"] + prov_headers)
                    dict_writer.writeheader()
                    dict_writer.writerows(wide_rows)

                summary[slug] = {
                    "raw_rows": len(raw_rows),
                    "calendar_days": len(calendar_dates),
                    "rows_long": len(obs_records),
                    "rows_imputed": rows_imputed,
                    "rows_anomaly": rows_anomaly,
                    "min_date": min_dt.strftime("%Y-%m-%d"),
                    "max_date": max_dt.strftime("%Y-%m-%d"),
                }

        conn.commit()
        return summary
    finally:
        conn.close()


if __name__ == "__main__":
    result = run_etl()
    for seg_slug, stats in result.items():
        print(f"[{seg_slug}]", stats)
