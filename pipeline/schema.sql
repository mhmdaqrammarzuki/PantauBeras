PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS provinces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    island TEXT NOT NULL DEFAULT 'Sulawesi'
);

CREATE TABLE IF NOT EXISTS market_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    source_file TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commodities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit_label TEXT NOT NULL,
    grade_note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commodity_id INTEGER NOT NULL,
    market_segment_id INTEGER NOT NULL,
    province_id INTEGER NOT NULL,
    price_date TEXT NOT NULL,
    price_idr INTEGER NOT NULL CHECK (price_idr > 0),
    pct_change_daily REAL,
    is_imputed INTEGER NOT NULL CHECK (is_imputed IN (0, 1)),
    is_anomaly INTEGER NOT NULL CHECK (is_anomaly IN (0, 1)),
    anomaly_status TEXT NOT NULL DEFAULT 'normal',
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    iso_week INTEGER NOT NULL,
    FOREIGN KEY (commodity_id) REFERENCES commodities(id),
    FOREIGN KEY (market_segment_id) REFERENCES market_segments(id),
    FOREIGN KEY (province_id) REFERENCES provinces(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_lookup
    ON price_observations(commodity_id, market_segment_id, province_id, price_date);

CREATE INDEX IF NOT EXISTS idx_obs_seg_date
    ON price_observations(market_segment_id, price_date);

CREATE INDEX IF NOT EXISTS idx_obs_prov_date
    ON price_observations(province_id, price_date);

CREATE TABLE IF NOT EXISTS price_forecasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commodity_id INTEGER NOT NULL,
    market_segment_id INTEGER NOT NULL,
    province_id INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    horizon_weeks INTEGER NOT NULL,
    step_week INTEGER NOT NULL,
    target_date TEXT NOT NULL,
    predicted_idr INTEGER NOT NULL,
    lower_idr INTEGER NOT NULL,
    upper_idr INTEGER NOT NULL,
    eval_mae REAL NOT NULL,
    eval_mape REAL NOT NULL,
    eval_period TEXT NOT NULL,
    trained_at TEXT NOT NULL,
    FOREIGN KEY (commodity_id) REFERENCES commodities(id),
    FOREIGN KEY (market_segment_id) REFERENCES market_segments(id),
    FOREIGN KEY (province_id) REFERENCES provinces(id)
);

CREATE INDEX IF NOT EXISTS idx_fc_lookup
    ON price_forecasts(market_segment_id, province_id, model_name, horizon_weeks);

CREATE TABLE IF NOT EXISTS etl_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_segment_id INTEGER NOT NULL,
    source_file TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    min_date TEXT NOT NULL,
    max_date TEXT NOT NULL,
    raw_rows INTEGER NOT NULL,
    calendar_days INTEGER NOT NULL,
    rows_long INTEGER NOT NULL,
    rows_imputed INTEGER NOT NULL,
    rows_anomaly INTEGER NOT NULL,
    executed_at TEXT NOT NULL,
    FOREIGN KEY (market_segment_id) REFERENCES market_segments(id)
);
