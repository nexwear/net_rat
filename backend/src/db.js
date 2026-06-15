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
`;

async function initDb() {
  await pool.query(SCHEMA);

  const factory = await pool.query('SELECT id FROM factories LIMIT 1');
  if (factory.rowCount === 0) {
    const f = await pool.query(
      "INSERT INTO factories (name) VALUES ('Factory Pilot') RETURNING id"
    );
    await pool.query(
      "INSERT INTO lines (factory_id, name) VALUES ($1, 'Line 1')",
      [f.rows[0].id]
    );
  }
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, initDb, query };
