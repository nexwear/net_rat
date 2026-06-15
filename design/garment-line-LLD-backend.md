# Backend-Contracts LLD — Garment-Line System

**Level:** Low-Level Design · **Status:** v2 (incorporates **ADR-001** — UUID keys; card UID→bundle mapping) · **Companion:** Firmware LLD · **Stack:** Node.js/Express + PostgreSQL + FCM + object store

Specifies the backend surfaces the firmware depends on plus the server-side algorithms. OTA management routes live in `ota_backend.js`; this doc is the canonical contract for everything else.

---

## B1. Database schema (PostgreSQL DDL)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid()

-- enums
CREATE TYPE module_type   AS ENUM ('INPUT','OUTPUT_1','OUTPUT_2','ADMIN');
CREATE TYPE node_status   AS ENUM ('PENDING','ACTIVE','OFFLINE','DECOMMISSIONED');
CREATE TYPE bundle_status AS ENUM ('ISSUED','IN_PROGRESS','COMPLETED','LOST');
CREATE TYPE card_status   AS ENUM ('AVAILABLE','IN_USE','LOST');
CREATE TYPE scan_kind     AS ENUM ('TAP_IN','TAP_OUT','AUTO_CLOSE','ASSIGN_SCAN');
CREATE TYPE close_reason  AS ENUM ('NEXT_TAP','TAP_OUT','QUANTITY','TIMEOUT','SHIFT_END');
CREATE TYPE user_role     AS ENUM ('SUPER_ADMIN','FACTORY_ADMIN','LINE_SUPERVISOR',
                                   'ADMIN_OPERATOR','AUDITOR','CONTRACTOR');

CREATE TABLE factories (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, timezone TEXT DEFAULT 'Asia/Kolkata'
);
CREATE TABLE lines (
  id SERIAL PRIMARY KEY, factory_id INT REFERENCES factories(id),
  name TEXT NOT NULL, shift_start TIME, shift_end TIME
);

CREATE TABLE nodes (
  id            VARCHAR(64) PRIMARY KEY,        -- nodeId
  chip_id       VARCHAR(32) UNIQUE NOT NULL,    -- eFuse MAC, set at claim
  line_id       INT REFERENCES lines(id),
  module_type   module_type,
  fw_version    VARCHAR(20),
  api_token     VARCHAR(80) UNIQUE,             -- issued at approval; NULL while PENDING
  status        node_status NOT NULL DEFAULT 'PENDING',
  last_seen_at  TIMESTAMPTZ, rssi INT,
  flags         JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contractors (
  id SERIAL PRIMARY KEY, code TEXT UNIQUE, name TEXT NOT NULL,
  rate_per_piece NUMERIC(10,2), active BOOLEAN DEFAULT true
);
CREATE TABLE garment_models (
  id SERIAL PRIMARY KEY, style TEXT NOT NULL, sam NUMERIC(8,3), ops_count INT
);
CREATE TABLE sizes ( code SMALLINT PRIMARY KEY, label TEXT NOT NULL );

-- bundles: UUID primary key (ADR-001)
CREATE TABLE bundles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id          INT REFERENCES lines(id),
  contractor_id    INT REFERENCES contractors(id),
  garment_model_id INT REFERENCES garment_models(id),
  size_code        SMALLINT REFERENCES sizes(code),
  declared_pieces  INT NOT NULL CHECK (declared_pieces > 0),
  pickup_at        TIMESTAMPTZ,
  card_uid         VARCHAR(20),                 -- current card; mirror of cards.current_bundle_id
  status           bundle_status NOT NULL DEFAULT 'ISSUED',
  issued_by        INT REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON bundles(line_id, status);

-- cards: native UID is the key; maps to the current bundle (ADR-001)
CREATE TABLE cards (
  uid               VARCHAR(20) PRIMARY KEY,    -- native tag serial (hex)
  family            VARCHAR(12) NOT NULL,       -- ISO15693 | ISO14443A
  status            card_status NOT NULL DEFAULT 'AVAILABLE',
  current_bundle_id UUID REFERENCES bundles(id)
);

CREATE TABLE scan_events (
  id          BIGSERIAL PRIMARY KEY,
  event_id    UUID UNIQUE NOT NULL,             -- idempotency key from node
  node_id     VARCHAR(64) REFERENCES nodes(id),
  module_type module_type,
  card_uid    VARCHAR(20) NOT NULL,             -- node's key
  bundle_id   UUID REFERENCES bundles(id),      -- resolved server-side (nullable)
  kind        scan_kind NOT NULL,
  ts          TIMESTAMPTZ NOT NULL, recv_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id            UUID PRIMARY KEY,                -- sessionId from node
  bundle_id     UUID REFERENCES bundles(id),
  card_uid      VARCHAR(20),
  module_type   module_type, node_id VARCHAR(64),
  start_ts      TIMESTAMPTZ, end_ts TIMESTAMPTZ,
  count_pass    INT DEFAULT 0,                   -- horseshoe / press
  count_cycle   INT DEFAULT 0,                   -- current / hall
  close_reason  close_reason,
  primary_count INT GENERATED ALWAYS AS (count_pass) STORED,  -- swap once truth chosen
  UNIQUE (bundle_id, module_type)                -- one session per bundle per stage
);

CREATE TABLE count_samples (
  id BIGSERIAL PRIMARY KEY, session_id UUID REFERENCES sessions(id),
  count_pass INT, count_cycle INT, current_amps REAL, ts TIMESTAMPTZ
);
CREATE TABLE unassigned_counts (
  id BIGSERIAL PRIMARY KEY, event_id UUID UNIQUE,
  node_id VARCHAR(64), module_type module_type, card_uid VARCHAR(20),
  count_pass INT, count_cycle INT, ts TIMESTAMPTZ, resolved BOOLEAN DEFAULT false
);
CREATE TABLE heartbeats (
  id BIGSERIAL PRIMARY KEY, node_id VARCHAR(64),
  rssi INT, uptime BIGINT, fw_version VARCHAR(20),
  queue_depth INT, flags JSONB, ts TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON heartbeats(node_id, ts DESC);

CREATE TABLE alerts (
  id SERIAL PRIMARY KEY, type TEXT NOT NULL,
  line_id INT, node_id VARCHAR(64), severity TEXT, detail TEXT,
  raised_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_by INT, acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
  dedup_key TEXT UNIQUE
);
CREATE TABLE users (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE, name TEXT,
  password_hash TEXT, role user_role NOT NULL, factory_id INT, line_ids INT[]
);
-- firmware_releases + ota_events: see ota_backend.js (canonical)
```

---

## B2. Device & card API contracts

Device endpoints require `X-Node-Token` (except `claim`). All ingest endpoints are **idempotent on `eventId`** — a repeat returns `200 {duplicate:true}` with no side effects.

### Card assignment (app/web, RBAC: `cards.assign`)
```
POST /v1/cards/:uid/assign   {bundleId}   → set cards.current_bundle_id, status IN_USE;
                                            409 if card already IN_USE
POST /v1/cards/:uid/release               → clear mapping, status AVAILABLE
GET  /v1/card/:uid                         → {bundleId, declaredPieces, model, size,
                                              contractor, status} | 404 if unassigned
```
`GET /v1/card/:uid` is also what a node optionally calls (token-auth) to cache `declaredPieces` for quantity-based auto-close.

### POST /v1/devices/claim   (no token)
Req `{ chipId, moduleHint? }` → upsert `PENDING` node → `{ nodeId, tempToken }`.

### GET /v1/devices/:nodeId/config   (temp or real token)
PENDING → `{status:"PENDING"}`. Approved → `{status:"ACTIVE", nodeId, lineId, factoryId, moduleType, token, otaHrs}`.

### POST /v1/heartbeat
Req `{ nodeId, rssi, uptime, fwVersion, queueDepth, flags }` → update node row + insert `heartbeats`. Resp `{ ok, serverTimeMs }`. Side effect: clears open `NODE_DOWN` (→ `NODE_RECOVERED`).

### POST /v1/scan   (carries cardUid, not bundleId)
Req `{ eventId, seq, nodeId, moduleType, kind, cardUid, ts }`. Server **resolves `cardUid → current_bundle_id`** (B3). `kind=ASSIGN_SCAN` (admin) is not a session event — it's surfaced to the web app correlating the new bundle. Resp `{ ok, bundleId?, sessionId? }`.

### POST /v1/session   (carries cardUid)
Req `{ eventId, seq, nodeId, sessionId, cardUid, moduleType, type:"UPDATE|CLOSE", counts:{pass,cycle}, currentAmps?, closeReason?, ts }`. Server resolves bundle, upserts/finalizes the session. Resp `{ ok }`.

### POST /v1/unassigned
Req `{ eventId, nodeId, moduleType, cardUid?, counts:{pass,cycle}, ts }` → `unassigned_counts`.

### POST /v1/ota/check, /v1/ota/report
Canonical in `ota_backend.js`.

**Validation:** unknown token → 401; schema fail → 400; `seq` rollback beyond window → reject as replay; `ts` skew>24 h with `tsValid=false` → use `recv_at`; unknown/unassigned `cardUid` → still capture the count (resolvable later), don't 5xx.

---

## B3. Session-resolution algorithm (resolve UID → bundle first)

Keyed canonically by `(bundle_id, module_type)`; the node keys by `cardUid`.

```
resolveBundle(cardUid):
    return cards[cardUid].current_bundle_id   // NULL if unassigned

on SCAN(kind=TAP_IN, cardUid, ts, sessionId):
    bundleId = resolveBundle(cardUid)
    if bundleId == NULL:
        log scan_events(bundle_id=NULL); return   // count still captured, attributable later
    upsert sessions(id=sessionId, bundle_id, card_uid, module_type, start_ts=ts)
    if module_type==INPUT: bundle.status = IN_PROGRESS

on SESSION_UPDATE(sessionId, cardUid, counts):
    s = sessions[sessionId] (or create from cardUid→bundle); s.count_* = counts (last-write-wins)
    insert count_samples (if enabled)

on SESSION_CLOSE(sessionId, cardUid, counts, reason, ts):
    bundleId = resolveBundle(cardUid)
    s = sessions[sessionId]; s.count_* = counts; s.end_ts = ts; s.close_reason = reason
    runYieldChecks(s)                               // B6
    if module_type==OUTPUT_2:
        bundle.status = COMPLETED
        release card: cards[cardUid].status=AVAILABLE, current_bundle_id=NULL, bundle.card_uid=NULL
```
Out-of-order safety: UPDATE/CLOSE before TAP_IN → create the session from the close payload (`sessionId` + resolved bundle). Idempotency via `event_id` UNIQUE.

Reconciliation (on read or CLOSE):
```
declared ≥ INPUT.primary ≥ OUTPUT_1.primary ≥ OUTPUT_2.primary
loss_at_input/stitch/finish = successive primary deltas
```

---

## B4. Offline-detection watcher

Runs on an **always-on** scheduler (every 30 s) — not request-driven.
```
every 30s:
  expected = nodes ACTIVE whose line is within shift window now
  for n in expected:
      stale = now − n.last_seen_at > THRESHOLD(45s); open = exists open NODE_DOWN for n
      if stale and not open: raiseAlert(NODE_DOWN, dedup_key="down:"+n.id, HIGH) → push
      if not stale and open: resolve + raiseAlert(NODE_RECOVERED) → push
  for a in open NODE_DOWN older than ESCALATE_MIN(10m) and unacked:
      push to factory_admin scope; mark escalated
```
`dedup_key` UNIQUE → one open alert per (type,node). Shift-aware suppresses off-hours noise.

---

## B5. RBAC

```js
const PERMS = {
  SUPER_ADMIN:    ['*'],
  FACTORY_ADMIN:  ['users.manage','master.manage','cards.assign','cards.pool',
                   'line.view','alerts.manage','nodes.config','ota.view','reports.view'],
  LINE_SUPERVISOR:['line.view:own','alerts.manage:own','reports.view:own'],
  ADMIN_OPERATOR: ['cards.assign','cards.pool','line.view'],
  AUDITOR:        ['line.view','reports.view'],
  CONTRACTOR:     ['self.view'],
};   // ota.manage → SUPER_ADMIN only
```
Every app/web route: `auth(jwt) → requirePerm → scopeFilter(query by factory/line)`. Device routes use `X-Node-Token`, never user JWT. **Scope is applied in the query**, not just the UI.

---

## B6. Alerting & anomalies

| Type | Trigger | Severity |
|------|---------|----------|
| `NODE_DOWN` / `NODE_RECOVERED` | watcher (B4) | HIGH |
| `OTA_FAILED` | `/ota/report success=false` | HIGH |
| `DISCREPANCY` | stage loss > X% of declared on CLOSE | MED |
| `SENSOR_DISAGREE` | `|count_pass − count_cycle| / max > Y%` | MED |
| `UNASSIGNED_CARD` | tap on a card with no bundle mapping | LOW |
| `BUNDLE_STUCK` | session open > expected cycle time | LOW |
| `LINE_STALLED` | no counts + machine idle > T during shift | MED |
| `QUEUE_OVERFLOW` | heartbeat flag set | LOW |

Dedup via `dedup_key`; each raise → FCM to RBAC-scoped supervisors.

---

## B7. Push (FCM) payload

```json
{ "to": "<supervisor device tokens>",
  "notification": { "title": "Node down — Line 1 Input", "body": "No heartbeat for 48s" },
  "data": { "type":"NODE_DOWN", "lineId":"1", "nodeId":"LINE1-INPUT-01", "alertId":"123" } }
```
App routes on `data.type` → deep-link; ack → `POST /alerts/:id/ack`.

---

## B8. Idempotency & integrity rules

- Every ingest keyed by `event_id` (UNIQUE) → exactly-once apply under replay.
- `sessions` unique on `(bundle_id, module_type)` → one canonical session per stage.
- Monotonic `seq` per node guards gross replay/rollback.
- **Card identified by native UID; the `cards.current_bundle_id` mapping is authoritative** (no on-card data, no CRC). An unassigned-card tap still captures counts for later reconciliation.
- Bundle status transitions are monotonic (`ISSUED→IN_PROGRESS→COMPLETED`); `LOST` by reconciliation/manual.
- Timestamps: prefer node `ts`; fall back to `recv_at` when `tsValid=false` (pre-NTP).
