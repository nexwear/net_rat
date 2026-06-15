const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE module_type AS ENUM ('INPUT','OUTPUT_1','OUTPUT_2','ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE node_status AS ENUM ('PENDING','ACTIVE','OFFLINE','DECOMMISSIONED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE bundle_status AS ENUM ('ISSUED','IN_PROGRESS','COMPLETED','LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE card_status AS ENUM ('AVAILABLE','IN_USE','LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_kind AS ENUM ('TAP_IN','TAP_OUT','AUTO_CLOSE','ASSIGN_SCAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE close_reason AS ENUM ('NEXT_TAP','TAP_OUT','QUANTITY','TIMEOUT','SHIFT_END');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS factories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Kolkata'
);

CREATE TABLE IF NOT EXISTS lines (
  id SERIAL PRIMARY KEY,
  factory_id INT REFERENCES factories(id),
  name TEXT NOT NULL,
  shift_start TIME,
  shift_end TIME
);

CREATE TABLE IF NOT EXISTS nodes (
  id VARCHAR(64) PRIMARY KEY,
  chip_id VARCHAR(32) UNIQUE NOT NULL,
  line_id INT REFERENCES lines(id),
  module_type module_type,
  fw_version VARCHAR(20),
  api_token VARCHAR(80) UNIQUE,
  status node_status NOT NULL DEFAULT 'PENDING',
  last_seen_at TIMESTAMPTZ,
  rssi INT,
  flags JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
  uid VARCHAR(20) PRIMARY KEY,
  family VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN',
  status card_status NOT NULL DEFAULT 'AVAILABLE',
  current_bundle_id UUID
);

CREATE TABLE IF NOT EXISTS bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id INT REFERENCES lines(id),
  declared_pieces INT NOT NULL CHECK (declared_pieces > 0),
  card_uid VARCHAR(20),
  status bundle_status NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID UNIQUE NOT NULL,
  node_id VARCHAR(64) REFERENCES nodes(id),
  module_type module_type,
  card_uid VARCHAR(20) NOT NULL,
  bundle_id UUID REFERENCES bundles(id),
  kind scan_kind NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  recv_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  bundle_id UUID REFERENCES bundles(id),
  card_uid VARCHAR(20),
  module_type module_type,
  node_id VARCHAR(64),
  start_ts TIMESTAMPTZ,
  end_ts TIMESTAMPTZ,
  count_pass INT DEFAULT 0,
  count_cycle INT DEFAULT 0,
  close_reason close_reason,
  UNIQUE (bundle_id, module_type)
);

CREATE TABLE IF NOT EXISTS count_samples (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  count_pass INT,
  count_cycle INT,
  current_amps REAL,
  ts TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS unassigned_counts (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID UNIQUE NOT NULL,
  node_id VARCHAR(64),
  module_type module_type,
  card_uid VARCHAR(20),
  count_pass INT,
  count_cycle INT,
  ts TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id BIGSERIAL PRIMARY KEY,
  node_id VARCHAR(64),
  rssi INT,
  uptime BIGINT,
  fw_version VARCHAR(20),
  queue_depth INT,
  flags JSONB,
  ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS heartbeats_node_ts ON heartbeats(node_id, ts DESC);

CREATE TABLE IF NOT EXISTS firmware_releases (
  id SERIAL PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  module_type module_type,
  url TEXT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  rollout_pct INT NOT NULL DEFAULT 0 CHECK (rollout_pct >= 0 AND rollout_pct <= 100),
  paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (version, module_type)
);

CREATE TABLE IF NOT EXISTS ota_events (
  id BIGSERIAL PRIMARY KEY,
  node_id VARCHAR(64) REFERENCES nodes(id),
  from_version VARCHAR(20),
  to_version VARCHAR(20),
  success BOOLEAN NOT NULL,
  detail TEXT,
  ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ota_events_node_ts ON ota_events(node_id, ts DESC);

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS pending_op JSONB;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS pending_op_at TIMESTAMPTZ;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS label TEXT;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN','FACTORY_ADMIN','LINE_SUPERVISOR','ADMIN_OPERATOR','AUDITOR','CONTRACTOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS contractors (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE,
  name TEXT NOT NULL,
  rate_per_piece NUMERIC(10,2),
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS garment_models (
  id SERIAL PRIMARY KEY,
  style TEXT NOT NULL,
  sam NUMERIC(8,3),
  ops_count INT
);

CREATE TABLE IF NOT EXISTS sizes (
  code SMALLINT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  line_id INT,
  node_id VARCHAR(64),
  severity TEXT,
  detail TEXT,
  raised_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_by INT,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  dedup_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  password_hash TEXT,
  role user_role NOT NULL,
  factory_id INT,
  line_ids INT[]
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS
  primary_count INT GENERATED ALWAYS AS (count_pass) STORED;

ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_number INT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS cards_number_unique ON cards(card_number) WHERE card_number IS NOT NULL;

ALTER TABLE bundles ADD COLUMN IF NOT EXISTS contractor_id INT REFERENCES contractors(id);
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS garment_model_id INT REFERENCES garment_models(id);
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS size_code SMALLINT REFERENCES sizes(code);
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS pickup_at TIMESTAMPTZ;
ALTER TABLE bundles ADD COLUMN IF NOT EXISTS issued_by INT;

-- Pulses-per-piece calibration, learned per garment style + size + operation.
-- garment_model_id / size_code use 0 as a "not specified" sentinel so the
-- primary key never contains NULLs. pulses_per_piece is a rolling average,
-- reconciled against the OUTPUT_2 ground-truth count when a bundle completes.
-- Push-notification device tokens (FCM). One row per device; tied to the user
-- who registered it so we could later scope pushes by role/line.
CREATE TABLE IF NOT EXISTS device_tokens (
  token        TEXT PRIMARY KEY,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ppp_calibration (
  garment_model_id INT NOT NULL DEFAULT 0,
  size_code        INT NOT NULL DEFAULT 0,
  module_type      module_type NOT NULL,
  pulses_per_piece REAL NOT NULL,
  sample_count     INT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (garment_model_id, size_code, module_type)
);
`;

async function initDb() {
  await pool.query(SCHEMA);

  const factory = await pool.query('SELECT id FROM factories LIMIT 1');
  if (factory.rowCount === 0) {
    const f = await pool.query(
      "INSERT INTO factories (name, timezone) VALUES ('Net Rat', 'Asia/Kolkata') RETURNING id"
    );
    await pool.query(
      "INSERT INTO lines (factory_id, name, shift_start, shift_end) VALUES ($1, 'Line 1', '08:00', '17:00')",
      [f.rows[0].id]
    );
  }

  await pool.query(`
    INSERT INTO sizes (code, label) VALUES
      (1,'XS'),(2,'S'),(3,'M'),(4,'L'),(5,'XL'),(6,'XXL')
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    INSERT INTO contractors (code, name) VALUES ('DEFAULT','Default Contractor')
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    INSERT INTO garment_models (style, sam, ops_count) VALUES ('Basic Shirt', 15.5, 12)
    ON CONFLICT DO NOTHING
  `);
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, initDb, query };
