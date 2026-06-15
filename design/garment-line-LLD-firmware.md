# Firmware LLD — ESP32 Garment-Line Nodes

**Level:** Low-Level Design · **Status:** v2 (incorporates **ADR-001** — card = identity UID; no write/codec) · **Parents:** HLD, detailed design doc · **Companion:** Backend-Contracts LLD

Specifies the firmware for all node types from **one universal binary**, with sensor drivers and run-mode selected at runtime from NVS config. This is a spec (structures, state machines, algorithms), not the final source.

---

## A0. Key decisions

- **One universal binary.** Module behavior (`INPUT` / `OUTPUT_1` / `OUTPUT_2` / `ADMIN`) is chosen from NVS `moduleType`, not compile flags. OTA `moduleType` targeting is retained for future divergence.
- **Card = identity (ADR-001).** The node reads only the **native tag UID** and frames sessions by it. **Nothing is written or parsed on the card** — no record, no codec, no CRC. The backend resolves `cardUid → bundle`.
- **Dual-core split.** Time-critical sensing on core 1; all network/flash I/O on core 0. They communicate only through FreeRTOS queues — no blocking call ever runs on the sensing path.
- **Counts are session-scoped via baseline-delta.** Drivers keep free-running totals; the session manager snapshots a baseline at tap-in and attributes `(total − baseline)`. No driver ever resets mid-run.
- **Everything that leaves the node is idempotent.** Each telemetry record carries an `eventId` (UUID) + monotonic `seq`; the backend dedups. Makes offline replay safe.

---

## A1. Task & module architecture

```
            ┌────────────────────────── CORE 1 (app) ───────────────────────────┐
            │  SensingTask  (10 ms tick)                                          │
            │   ├─ CounterDriver[0..1].poll()      (horseshoe / current / hall…)  │
            │   ├─ NfcSubsystem.pollRead()         (UID transition → TAP event)   │
            │   └─ SessionManager.tick()           (open/close by UID, emit telem) │
            └───────────┬───────────────────────────────────────▲────────────────┘
              telemetryQ │ (SCAN, SESSION_UPDATE, SESSION_CLOSE,  │ commandQ
                         │  HEARTBEAT, UNASSIGNED)                │ (REPROVISION)
            ┌────────────▼───────────────────────────────────────┴────────────────┐
            │  NetTask  (core 0)                                                    │
            │   ├─ WiFiManagerTask: connect (WiFiMulti) + backoff                   │
            │   ├─ TelemetrySender: drain telemetryQ → HTTPS POST; on fail → store  │
            │   ├─ OfflineStore: LittleFS ring buffer; drain when online            │
            │   ├─ Heartbeat timer (15 s) · OTA check timer (6 h)                   │
            │   └─ CommandPoll / WS: receive REPROVISION                            │
            └───────────────────────────────────────────────────────────────────┘
```

- `telemetryQ`: depth 32, item = `TelemetryEvent` (A5). Sensing produces, Net consumes.
- `commandQ`: depth 8, item = `Command`. Net produces, Sensing consumes at safe points.
- `g_config`: `DeviceConfig`, set once at boot, read-only thereafter.
- `g_state`: `NodeState` (atomic).

**ADMIN mode:** SensingTask runs the **UID-reader** routine — on each card read it emits the UID (SCAN with `kind=ASSIGN_SCAN`) so the web app can map it to the bundle being created. **No writer task, no card writes.**

---

## A2. Pin map (per module type)

PN5180 on VSPI; per-node sensor pins below. **ESP32 constraints baked in:** analog sensors only on **ADC1 (GPIO32–39)** (ADC2 unusable while WiFi on); input-only pins 34–39 have **no internal pull-ups**; avoid strapping pins (0, 2, 12, 15) for sensor logic.

| Function | INPUT | OUTPUT_1 | OUTPUT_2 | ADMIN | Notes |
|----------|------:|---------:|---------:|------:|-------|
| PN5180 SCK | 18 | 18 | 18 | 18 | VSPI |
| PN5180 MISO | 19 | 19 | 19 | 19 | VSPI |
| PN5180 MOSI | 23 | 23 | 23 | 23 | VSPI |
| PN5180 NSS | 16 | 16 | 16 | 16 | |
| PN5180 BUSY | 5 | 5 | 5 | 5 | strapping; input only, OK |
| PN5180 RST | 17 | 17 | 17 | 17 | |
| Horseshoe IR | 27 | 27 | — | — | `INPUT_PULLUP`, active-LOW |
| Current sensor | 34 | — | — | — | **ADC1_CH6**, analog |
| Hall sensor | — | 32 | — | — | digital `INPUT_PULLUP` (or ADC1 if analog) |
| Press sensor A (down) | — | — | 25 | — | `INPUT_PULLUP` |
| Press sensor B (up) | — | — | 26 | — | `INPUT_PULLUP` |
| Config button | 0 | 0 | 0 | 0 | BOOT btn, long-press = reprovision |
| Status LED | 2 | 2 | 2 | 2 | onboard |

ADMIN needs only the PN5180 (a reader). Output-2's two pins assume **down-limit + up-limit**; other sensor pairs only change `PressCycleDriver` thresholds (A6.4).

---

## A3. NVS configuration schema

Namespace `cfg` (via `Preferences`). Written by provisioning, read at boot.

| Key | Type | Example | Notes |
|-----|------|---------|-------|
| `wifi` | string (JSON) | `[{"s":"FloorAP","p":"…"},{"s":"BackupAP","p":"…"}]` | WiFiMulti list |
| `server` | string | `https://api.grewbie.in` | base URL, no trailing slash |
| `nodeId` | string | `LINE1-INPUT-01` | |
| `moduleType` | string | `INPUT` | drives drivers + mode |
| `lineId` / `factoryId` | string | `LINE_001` / `FACTORY_001` | |
| `token` | string | `tok_…` | issued at claim approval |
| `fwVersion` | string | `1.0.0` | **actual running version** (updated post-OTA) |
| `otaHrs` | uint16 | `6` | OTA check interval |
| `provDone` | bool | `true` | config-valid flag |

```cpp
struct DeviceConfig {
  std::vector<WifiCred> wifi;     // {ssid, pass}
  String  serverUrl, nodeId, moduleType, lineId, factoryId, token, fwVersion;
  uint16_t otaHrs = 6;
  bool     valid = false;         // provDone && wifi non-empty && nodeId set
};
```
`loadConfig()` returns `valid=false` if `provDone` unset or required keys missing → boot into provisioning (A9).

---

## A4. Enums

```cpp
enum class ModuleType   : uint8_t { INPUT, OUTPUT_1, OUTPUT_2, ADMIN };
enum class DriverId     : uint8_t { HORSESHOE, CURRENT, HALL, PRESS };
enum class NodeState    : uint8_t { PROVISIONING, ACTIVE, REPROVISIONING };
enum class CloseReason  : uint8_t { NEXT_TAP, TAP_OUT, QUANTITY, TIMEOUT, SHIFT_END };
enum class TelemetryType: uint8_t { HEARTBEAT, SCAN, SESSION_UPDATE, SESSION_CLOSE, UNASSIGNED };
enum class ScanKind     : uint8_t { TAP_IN, TAP_OUT, AUTO_CLOSE, ASSIGN_SCAN };  // ASSIGN_SCAN = admin
enum class CmdType      : uint8_t { REPROVISION };
```

---

## A5. Core data structures

No `BundleRecord` — the card carries no data. The node's key is `cardUid`.

```cpp
struct TelemetryEvent {               // POD; passes through telemetryQ
  TelemetryType type;
  char     eventId[37];               // UUIDv4 — idempotency key
  uint32_t seq;                       // monotonic per node (NVS-persisted)
  char     cardUid[24];               // ← node's key; backend maps to bundle
  char     sessionId[37];             // "" if N/A
  uint32_t countPass, countCycle;     // per-driver deltas for the bundle/window
  float    currentAmps;               // INPUT only
  uint8_t  scanKind;                  // SCAN only
  uint8_t  closeReason;               // SESSION_CLOSE only
  uint64_t tsEpochMs;                 // NTP-derived
};

struct Command { CmdType type; };
```
`seq` is loaded from NVS at boot, incremented per event, persisted every 32 events + on clean shutdown so it never repeats across reboots.

---

## A6. Counter drivers

Common interface; a node instantiates 0–2 by `moduleType`. Each owns a free-running `_total`; never reset during a session.

```cpp
class CounterDriver {
 public:
  virtual void     begin() = 0;
  virtual void     poll() = 0;          // every SensingTask tick, non-blocking
  virtual uint32_t total() const = 0;
  virtual DriverId id() const = 0;
  virtual float    aux() const { return 0; }   // live amps for CURRENT
};
```
Driver set: INPUT → {Horseshoe, Current}; OUTPUT_1 → {Horseshoe, Hall}; OUTPUT_2 → {Press}; ADMIN → none.
Mapping: `countPass = HORSESHOE.total` (or PRESS for Output-2); `countCycle = CURRENT|HALL.total`.

### A6.1 HorseshoeIrDriver (generalized from your pin-27 logic)
`IDLE → BLOCKED → CONFIRMED → clear ⇒ total++`. Debounce `DEBOUNCE_MS=30`; min-block `MIN_BLOCK_MS=150`. Direction-agnostic (single beam).

### A6.2 CurrentDriver (your `sampleCurrent` + `updateCurrentCycle`, non-blocking)
Burst-sample ADC1 `CUR_SAMPLE_WINDOW_MS=40` every `CUR_SAMPLE_INTERVAL_MS=200`; Vpp→Vrms→amps; EMA `(0.4·prev+0.6·new)`; noise floor 0.10 A. Cycle FSM `IDLE→RUNNING` at 0.80 A, back at `0.80−HYST(0.15)`; count only if RUNNING ≥ `CUR_MIN_RUN_MS=200`. `aux()` = live amps. The 40 ms burst runs inside `poll()` only when its cadence elapses; if it threatens the 10 ms tick, move to a dedicated core-1 sub-task feeding `_total` atomically.

### A6.3 HallDriver
Digital debounced edge on magnet pass + `MIN_INTERVAL_MS` guard (analog variant: threshold + hysteresis). `total++` per actuation.

### A6.4 PressCycleDriver (Output-2, A=down, B=up)
`OPEN → CLOSING(A) → DWELL(A held ≥ MIN_DWELL_MS) → OPENING(B) → OPEN ⇒ total++`. `MIN_DWELL_MS` (≈800–1500, tune) rejects bumps. Two-Hall / IR+Hall → A/B map to those edges; FSM unchanged.

---

## A7. SessionManager (the tap-framed core — keyed by cardUid)

State: `activeCardUid`, `sessionId`, `startMs`, `baseline[DriverId]`, `lastTapUid`, `lastEmitMs`.

```
on TAP(cardUid):                       // no record, no CRC — UID is the key
    if session open AND cardUid == lastTapUid AND within TAP_OUT_WINDOW:
        closeSession(TAP_OUT)          // double-tap same card = explicit done
    elif session open:
        closeSession(NEXT_TAP)         // new card implicitly closes previous
        openSession(cardUid)
    else:
        openSession(cardUid)

openSession(cardUid):
    activeCardUid = cardUid; sessionId = uuid()
    startMs = now; for each driver: baseline[d] = driver.total()
    emit SCAN(kind=TAP_IN, cardUid)
    // optional (online): GET /v1/card/<uid> → cache declaredPieces for QUANTITY close

tick():
    if session open:
        if (now − lastEmitMs > SESSION_UPDATE_MS=10000) OR deltaChangedBy(>=K):
            emit SESSION_UPDATE(cardUid, countPass, countCycle, amps); lastEmitMs = now
        if cachedDeclared>0 AND reachedQuantity(cachedDeclared) held flat for QTY_GRACE_MS:
            closeSession(QUANTITY)      // online-only: needs cachedDeclared
        if now − startMs > SESSION_TIMEOUT_MS:
            closeSession(TIMEOUT)
    else:
        accumulateUnassigned(); maybe emit UNASSIGNED

closeSession(reason):
    emit SESSION_CLOSE(cardUid, final countPass/countCycle, reason)
    activeCardUid = ""; sessionId = ""
```

**Quantity-based auto-close is online-only/optional** — the node learns `declaredPieces` only by fetching `GET /v1/card/<uid>` and caching it; offline it relies on NEXT_TAP / TAP_OUT / TIMEOUT. `reachedQuantity` uses the configured **primary sensor** (default `HORSESHOE`/`PRESS`). UNASSIGNED counts are never dropped — surfaced server-side.

---

## A8. NFC subsystem (UID only — no codec)

### Read path (all nodes)
- `pollRead()` checks card presence at ~150 ms cadence (interleaved, non-blocking). On **absent→present transition**, read the **UID** (ISO14443A `readCardSerial` / ISO15693 `getInventory`) → `TAP(cardUid)`. Debounce identical UID within `TAP_DEBOUNCE_MS=1500` (one physical tap = one event), except the deliberate double-tap (tap-out, handled in A7).
- Family abstraction: `readUid()` dispatches on tag type. **No block reads, no record decode, no CRC.**

### ADMIN path
On a card read, emit SCAN `kind=ASSIGN_SCAN` with the UID so the backend/web can map it to the bundle being created. **No write, no read-back.**

*(Removed from v1: the `BundleRecord` codec — `crc16_ccitt`, `encodeRecord`, `decodeRecord` — and the write path. Card carries no data.)*

---

## A9. Provisioning subsystem

Node state machine (A4 `NodeState`):

```
boot → loadConfig()
   valid && WiFi connects     → ACTIVE
   else                       → PROVISIONING
PROVISIONING:
   raise SoftAP "Grewbie-<MODTYPE>-<MAC4>" (WPA2, per-device pass from label/QR)
   captive portal:  GET /scan → SSIDs; POST /config {wifi[],serverUrl} → test → persist & claim
   (BLE alt: ESP-IDF wifi_provisioning, transport=BLE, PoP=label secret)
   connected → POST /v1/devices/claim {chipId,moduleHint} → temp token
   poll GET /v1/devices/<nodeId>/config until approved → store {ids, token, moduleType}
   set provDone=true → reboot → ACTIVE
ACTIVE:
   button ≥3 s  → REPROVISION-pending (honored when no open session)
   server REPROVISION cmd → same, deferred to safe moment
REPROVISIONING: keep identity+token, SoftAP for WiFi-only update → persist → reboot
factory reset (button ≥10 s): wipe namespace cfg → PROVISIONING
```

**Hard rule:** never enter (RE)PROVISIONING while a session is open or counts are unflushed if avoidable. Transient runtime WiFi loss → WiFiManagerTask backoff, *not* re-provisioning.

---

## A10. Telemetry & networking (NetTask)

- **Send:** drain `telemetryQ`; build JSON per Backend-LLD contract (carrying `cardUid`); `POST` with `X-Node-Token`. 2xx → done; else `OfflineStore.push`.
- **OfflineStore:** LittleFS append-log `/q.log`, fixed-size (~128 B) records + persisted `ackedSeq`; bounded ring (~4000 records); overflow → drop oldest + set `queue_overflow` flag in heartbeat. FIFO drain when online.
- **Idempotency:** `eventId`+`seq` let the backend dedup → safe replay.
- **Heartbeat:** every 15 s → `{nodeId, token, rssi, uptime, fwVersion, queueDepth, flags}`.
- **OTA:** `OTAMgr::handle()` on 6 h timer; `isSafeToUpdate = activeCardUid=="" && OfflineStore.empty()`. New image writes its `fwVersion` to NVS at first boot.
- **Commands:** lightweight WS / long-poll for `REPROVISION` → `commandQ`.

---

## A11. Timing budget

| Activity | Cadence | Worst-case | Where |
|----------|--------:|-----------:|-------|
| SensingTask tick | 10 ms | < 3 ms typical | core 1 |
| Horseshoe/Hall/Press poll | per tick | µs | core 1 |
| Current burst sample | 40 ms / 200 ms | own sub-task if needed | core 1 |
| NFC presence + UID read | 150 ms | ~3–5 ms | core 1 |
| Telemetry POST | event-driven | network-bound | core 0 |
| Heartbeat / OTA check | 15 s / 6 h | — | core 0 |

---

## A12. Error handling & resilience

- **Task watchdog (TWDT)** on both tasks; panic-reset on stall.
- **WiFi backoff:** 1→2→5→15→30 s capped; keep counting + buffering throughout.
- **PN5180 health:** `readEEprom(PRODUCT_VERSION)`==0xFF or N consecutive read failures → re-init reader; raise `nfc_fault` flag; counting continues.
- **NVS corruption / invalid config:** fall back to PROVISIONING, not a boot-loop.
- **OTA failure:** dual-partition auto-rollback; `/ota/report` failure → backend `OTA_FAILED`.
- **Clock:** NTP at boot + periodic resync; until first sync, tag events `tsValid=false` so backend uses receive-time.

---

## A13. Module bring-up checklist

1. Flash universal binary (no config) → SoftAP appears.
2. Provision via portal → WiFi + claim → approve in console → ACTIVE.
3. Verify heartbeat + correct `fwVersion`/`moduleType` server-side.
4. In web, create a bundle and **assign** a card (tap on admin reader) → card IN_USE.
5. Tap that card on the Input node → SCAN/SESSION_OPEN; run pieces → both counts; tap-out → SESSION_CLOSE; backend resolves UID→bundle.
6. Pull WiFi → counts buffer + replay on reconnect (no loss, no dupes).
7. Push dummy OTA at 10% → deferred-while-session, then flash + rollback test.
