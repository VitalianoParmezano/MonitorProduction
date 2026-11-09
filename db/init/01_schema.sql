-- Схема Monitor Production. Виконується лише на порожньому томі pgdata.

CREATE TABLE product_types (
    id   BIGSERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE
);

CREATE TABLE products (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type_id         BIGINT NOT NULL REFERENCES product_types(id) ON DELETE RESTRICT,
    article         VARCHAR(100) NOT NULL UNIQUE,
    characteristics JSONB NOT NULL DEFAULT '{}'::jsonb,
    datasheet_path  VARCHAR(512)
);

CREATE TABLE workstations (
    id              BIGSERIAL PRIMARY KEY,
    number          INT NOT NULL UNIQUE CHECK (number > 0),
    name            VARCHAR(255),
    template        VARCHAR(64) NOT NULL,
    template_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_key      VARCHAR(64)
);

-- Один рядок = один екземпляр виробу, тому barcode UNIQUE
CREATE TABLE measurements (
    id           BIGSERIAL PRIMARY KEY,
    product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    barcode      VARCHAR(128) NOT NULL UNIQUE,
    q_tests_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    stage_times  JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes        TEXT,
    photo_path   VARCHAR(512),
    release_date DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX measurements_product_id_idx ON measurements (product_id);

CREATE TABLE settings (
    key   VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL
);
