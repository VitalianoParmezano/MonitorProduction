-- Monitor Production: схема БД (4 таблиці).
-- Виконується лише на порожньому томі (docker-entrypoint-initdb.d).
-- Джерело правди про таблиці й поля: DATABASE.md, розділ 3.

CREATE TABLE products (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    insulation_min_mohm NUMERIC NOT NULL CONSTRAINT products_insulation_min_positive CHECK (insulation_min_mohm > 0),
    earth_max_ohm       NUMERIC NOT NULL CONSTRAINT products_earth_max_positive CHECK (earth_max_ohm > 0),
    datasheet_path      TEXT
);

CREATE TABLE batches (
    id          BIGSERIAL PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES products(id),
    planned_qty INT NOT NULL CONSTRAINT batches_planned_qty_nonnegative CHECK (planned_qty >= 0),
    status      TEXT NOT NULL DEFAULT 'open' CONSTRAINT batches_status_valid CHECK (status IN ('open','closed')),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- не більше однієї відкритої партії
CREATE UNIQUE INDEX one_open_batch ON batches ((true)) WHERE status = 'open';

CREATE TABLE units (
    id             BIGSERIAL PRIMARY KEY,
    barcode        TEXT NOT NULL UNIQUE,
    barcode_driver TEXT UNIQUE,   -- NULL, якщо драйвер перенесено на інший світильник
    batch_id       BIGINT NOT NULL REFERENCES batches(id),
    notes          TEXT,
    photo_path     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX units_batch_idx ON units(batch_id);

CREATE TABLE results (
    unit_id   BIGINT   NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    stage     SMALLINT NOT NULL CONSTRAINT results_stage_range CHECK (stage BETWEEN 1 AND 4),
    value     NUMERIC,    -- етап 2: МОм, етап 3: Ом, інакше NULL
    data      JSONB,      -- етап 4: електричні параметри, поки NULL
    tested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (unit_id, stage)
);
