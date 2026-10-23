-- security-e2e synthetic databases (Spec §6.2). Schema, least-privilege role and masked views only.
-- Rows are rendered per run by examples/security-e2e/gold/compute-gold.mjs (seed-data.sql) and are
-- applied AFTER this file. Nothing here is copied from a private or production database.
--
-- Two logical databases hold a source with the same name (analytics.orders) so connection-alias,
-- physical-name and same-name-source variants can be exercised. Roles are created with a placeholder
-- password that the runner replaces through `ALTER ROLE ... PASSWORD` using a per-run secret that
-- never touches the repository.

\set ON_ERROR_STOP on

CREATE DATABASE lucy_e2e_fin;
CREATE DATABASE lucy_e2e_sales;

-- Read-only account used by the Lucy connections. No DDL, no write, no access to base tables with PII.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lucy_e2e_reader') THEN
    CREATE ROLE lucy_e2e_reader LOGIN PASSWORD 'rotated-by-prepare-environment' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

\connect lucy_e2e_fin

CREATE SCHEMA analytics;

CREATE TABLE analytics.marketing_daily (
  day           DATE    NOT NULL,
  region        TEXT    NOT NULL CHECK (region IN ('East', 'West')),
  channel       TEXT    NOT NULL,
  spend_cents   BIGINT  NOT NULL,
  new_customers INTEGER,                      -- NULL = source field missing (not zero)
  PRIMARY KEY (day, region, channel)
);

CREATE TABLE analytics.orders (
  order_id       TEXT   PRIMARY KEY,
  region         TEXT   NOT NULL CHECK (region IN ('East', 'West')),
  amount_cents   BIGINT NOT NULL,
  customer_email TEXT   NOT NULL,             -- synthetic PII: never exposed to the reader role
  note           TEXT
);

-- Masked view: the only orders relation the reader may select (PII column excluded).
CREATE VIEW analytics.orders_masked AS
  SELECT order_id, region, amount_cents, note FROM analytics.orders;

REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO lucy_e2e_reader;
GRANT SELECT ON analytics.marketing_daily, analytics.orders_masked TO lucy_e2e_reader;

\connect lucy_e2e_sales

CREATE SCHEMA analytics;

-- Same relation name as in lucy_e2e_fin on purpose.
CREATE TABLE analytics.orders (
  order_id       TEXT   PRIMARY KEY,
  region         TEXT   NOT NULL CHECK (region IN ('East', 'West')),
  amount_cents   BIGINT NOT NULL,
  customer_email TEXT   NOT NULL,
  note           TEXT
);

CREATE VIEW analytics.orders_masked AS
  SELECT order_id, region, amount_cents, note FROM analytics.orders;

REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO lucy_e2e_reader;
GRANT SELECT ON analytics.orders_masked TO lucy_e2e_reader;
