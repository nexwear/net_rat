# Garment Line Traceability & Productivity System — High-Level Design (HLD)

**Status:** v2 (incorporates **ADR-001** — card = identity token; native UID → backend; data keyed by UUID) · **Companion:** `garment-line-traceability-design.md` (detailed design), `garment-line-ADR-001-uuid-card.md`

This HLD is the architecture-level blueprint: system context, layers, components, provisioning, key flows, tech stack, interfaces, deployment, and non-functional requirements. Implementation-level specifics live in the LLDs; this document references rather than repeats them.

---

## 1. Purpose & scope

Track every cut-fabric **bundle** through a tailoring line (Input → Output-1 → Output-2) using NFC cards as **identity tokens** (the card's native UID maps to a backend bundle keyed by UUID) and automatic sensor counting, and turn that into traceability, yield/loss, and productivity data — delivered to a **web** app (admin/management) and a **mobile** app (floor/alerts). Nodes are field-provisioned (dynamic WiFi + identity) and updated over-the-air.

In scope: edge nodes, provisioning, backend, analytics, alerting, RBAC, OTA, both apps.
Out of scope (for now): payroll integration, ERP/Tally sync, multi-factory federation (designed-for, not built).

---

## 2. System context

```
        ┌────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────┐
        │ Admin-Room │   │ Line         │   │ Factory     │   │ Contractor   │
        │ Operator   │   │ Supervisor   │   │ Manager     │   │ (optional)   │
        └─────┬──────┘   └──────┬───────┘   └──────┬──────┘   └──────┬───────┘
              │ assign cards    │ monitor+alerts   │ analytics       │ self-view
              ▼                 ▼                  ▼                 ▼
        ╔══════════════════════════════════════════════════════════════════╗
        ║       GARMENT LINE TRACEABILITY & PRODUCTIVITY SYSTEM             ║
        ╚══════════════════════════════════════════════════════════════════╝
              ▲                 ▲                  ▲                 ▲
              │ counts/taps     │ heartbeats       │ OTA pulls       │ push
        ┌─────┴──────┐   ┌──────┴───────┐   ┌──────┴──────┐   ┌──────┴───────┐
        │ Line Nodes │   │ Factory WiFi │   │ Firmware    │   │ FCM / Push   │
        │ (ESP32)    │   │ Infra        │   │ Object Store│   │ Service      │
        └────────────┘   └──────────────┘   └─────────────┘   └──────────────┘
```

**Human actors:** Admin-Room Operator (creates bundles, **assigns** cards), Line Supervisor (monitors, gets alerts), Factory Manager (analytics), Contractor (optional self-view).
**External systems:** factory WiFi infrastructure, firmware object store (S3/R2), push service (FCM).

---

## 3. Architecture overview (layered)

```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENT LAYER      Web app (admin / management)  │  Flutter app (floor)  │
├──────────────────────────────────────────────────────────────────────┤
│ BACKEND LAYER     API gateway · Session engine · Offline watcher ·      │
│                   OTA release server · Alert/Push · Provisioning/Claim   │
│                   Card↔Bundle mapping · Datastores: Postgres + Firestore │
├──────────────────────────────────────────────────────────────────────┤
│ CONNECTIVITY      HTTPS/JSON · WebSocket|MQTT (commands) · FCM · BLE/AP   │
├──────────────────────────────────────────────────────────────────────┤
│ EDGE LAYER        Input · Output-1 · Output-2 · Admin reader             │
│                   ESP32 + PN5180 + sensors · NVS config · OTA agent       │
└──────────────────────────────────────────────────────────────────────┘
```

- **Edge** counts pieces, reads the NFC **UID**, frames counting by tap sessions (keyed by UID), queues offline, self-updates.
- **Connectivity** carries telemetry up and commands/updates down; provisioning happens over BLE/SoftAP locally.
- **Backend** is the brain: ingests, **resolves card UID → bundle**, attributes counts, detects node outages, serves analytics, manages OTA + device enrollment, pushes alerts.
- **Clients** are role-scoped views: web for setup/analytics, mobile for live monitoring + alerts.

---

## 4. Component view

| Component | Responsibility | Tech |
|-----------|----------------|------|
| **Input node** | Horseshoe IR + Current as two independent session-scoped counters; NFC UID read; heartbeat; offline queue; OTA | ESP32 + PN5180 |
| **Output-1 node** | Horseshoe IR + Hall as two counters; same platform | ESP32 + PN5180 |
| **Output-2 node** | Two heat-press sensors → press-cycle count; same platform | ESP32 + PN5180 |
| **Admin reader node (or phone)** | Reads a card's UID so the backend can **assign** it to a bundle; **no writing** | ESP32 + PN5180 / Web NFC |
| **Provisioning subsystem** | Field config of WiFi + identity + server + token; claim/enrollment | SoftAP/BLE + backend claim API |
| **Card↔Bundle mapping** | `cardUid → bundleId` (assign/release); resolves UID at ingest | Backend + Postgres |
| **Ingest + Session engine** | Resolve UID→bundle; open/close sessions; attribute per-sensor counts; idempotent | Node.js + Postgres |
| **Offline watcher** | Compare heartbeats vs expected-node registry; raise NODE_DOWN/RECOVERED | Scheduled job (always-on) |
| **OTA release server** | Releases, staged rollout buckets, signed binary URLs, event log | Node.js + object store |
| **Alert + Push** | Anomaly detection → FCM, escalation, ack tracking | Node.js + FCM |
| **API + Auth (RBAC)** | REST/WS for apps; device token auth; user JWT + role scope | Node.js |
| **Datastores** | System of record (bundles/sessions/events/OTA) + realtime layer | Postgres + Firestore/WS |
| **Web app** | Bundle creation, **card assignment**, master data, RBAC admin, OTA console, analytics | React + Tailwind |
| **Mobile app** | Live line, alerts/push, bundle lookup, provisioning | Flutter + FCM |

---

## 5. Device provisioning & lifecycle (dynamic WiFi)

"Dynamic WiFi" is really **field provisioning**: a node ships with no credentials and is configured on site — and re-configured later when the WiFi changes — without reflashing.

### What gets provisioned (stored in NVS)
- **WiFi**: a *list* of `{ssid, password}` (primary + backup) → WiFiMulti picks the strongest known network.
- **Server**: backend base URL.
- **Identity**: `nodeId`, `moduleType`, `lineId`, `factoryId`.
- **Auth**: `apiToken` (issued by the backend at claim time, not hardcoded).
- **OTA**: check interval.

### Provisioning transports
- **MVP — SoftAP captive portal.** Node with no/invalid config raises a password-protected AP (`Grewbie-<moduleType>-<MAC4>`). Operator connects from any phone browser, picks SSID + enters password + confirms config, node validates by connecting, saves to NVS, reboots. No app dependency.
- **Production — BLE provisioning via the Flutter app.** ESP-IDF unified provisioning over BLE with **proof-of-possession** (per-device secret printed as QR/label). The same app supervisors use provisions and **claims** the node in one flow.

### Device lifecycle

```
 [Unprovisioned] ──provision (WiFi + id + server)──► [Provisioning]
                                                          │ validate WiFi + claim to backend
                                                          ▼
                                                   [Pending approval]
                                                          │ admin assigns module/line, issues token (RBAC)
                                                          ▼
   button-hold / remote cmd ◄──────────────────────── [Active] ──► count · sync · heartbeat · OTA
            │                                              ▲
            ▼                                              │ creds OK
     [Re-provisioning] ──new WiFi only──► validate ────────┘
            │ factory reset (full NVS wipe)
            ▼
     [Decommissioned]
```

### Claim / enrollment (security-critical)
A new node **claims** itself: `POST /api/devices/claim` with its hardware ID (eFuse/MAC) → backend creates a *pending* node and returns a temporary token. An admin sees "node pending" in the web console, assigns `moduleType`/`line`, approves, and the backend issues the real `apiToken`. This blocks rogue devices and ties enrollment into RBAC.

### Runtime resilience vs. provisioning (important rule)
Provisioning mode must **never interrupt counting**. At runtime, WiFi loss → exponential-backoff reconnect while the node keeps counting and queuing offline. The node only drops into provisioning on an **explicit trigger** (button-hold or a remote flag honored when no session is open).

---

## 6. Key flows

### 6.1 Provisioning & claim
1. Node boots unprovisioned → SoftAP/BLE provisioning.
2. Operator supplies WiFi + server (+ scans PoP QR for BLE).
3. Node connects, validates, `claim`s itself → pending.
4. Admin approves + assigns module/line → backend issues token.
5. Node fetches token, saves NVS, transitions to **Active**.

### 6.2 Bundle lifecycle (the core loop) — per ADR-001
1. Admin creates a bundle (web → backend UUID) → taps a **free card** on any reader → backend maps `cardUid → bundleId`, card → IN_USE. **Nothing is written to the tag.**
2. Bundle moves to Input → operator taps → node reads **UID** → session opens (keyed by UID) → **both sensors** count → next tap / done / timeout closes it.
3. Same at Output-1, Output-2.
4. Backend resolves UID→bundle at ingest and reconciles `declared ≥ Input ≥ Output-1 ≥ Output-2`, computing timing/yield.
5. At Output-2 close the bundle is COMPLETED and the card mapping is **cleared** (card returns to the pool).

### 6.3 Offline detection → push
1. Nodes heartbeat every ~15 s (carrying `fwVersion`).
2. Watcher (every 30–60 s) compares against the expected-node registry, shift-aware.
3. On online→offline transition → `NODE_DOWN` → FCM to line-scoped supervisors; escalate if unacked; `NODE_RECOVERED` on return.

### 6.4 OTA rollout
1. Admin uploads `.bin` (version + module type) → stored + SHA-256.
2. Activate at 10% → server buckets nodes deterministically by `nodeId`.
3. Nodes `/check` every ~6 h → eligible nodes download → flash spare partition → `/report` → reboot.
4. Watch dashboard → ramp 10→50→100%; **Pause** to halt; failed flashes roll back + raise `OTA_FAILED`.

---

## 7. Technology stack

| Layer | Choice | Why |
|-------|--------|-----|
| Edge MCU | ESP32 (Arduino core, ESP-IDF for BLE provisioning) | dual-partition OTA, BLE+WiFi, NVS, your existing stack |
| NFC | PN5180 — **read UID only** (write not required) | ISO14443A + ISO15693 UID read; any UID-readable tag works |
| Provisioning | SoftAP captive portal → ESP-IDF unified provisioning (BLE) | no-app MVP, app-driven at scale |
| Device↔Cloud | HTTPS/JSON + per-device token | simple, secure, debuggable |
| Commands/realtime | WebSocket or MQTT | remote reprovision, live dashboards |
| Backend | Node.js / Express, **always-on** host | matches your skills; watcher needs always-on |
| System of record | PostgreSQL (UUID keys; `pgcrypto`) | relational integrity for bundles/sessions/OTA |
| Realtime + push | Firestore + FCM (or WS + FCM) | you already use Flutter/Firebase |
| Firmware store | S3 / Cloudflare R2 (signed URLs) | cheap, scalable binary hosting |
| Web | React + Tailwind | fast admin/analytics UIs |
| Mobile | Flutter + FCM | one codebase, push, BLE provisioning |

---

## 8. Interfaces & protocols

- **Device → Backend (HTTPS/JSON, `X-Node-Token`):** `heartbeat`, `scan` (cardUid), `session` (cardUid), `card→bundle lookup`, `ota/check`, `ota/report`, `devices/claim`.
- **Backend → Device (WS/MQTT):** remote-reprovision flag. (No write-card jobs — assignment is a backend mapping.)
- **Backend ↔ Apps (REST + WS + FCM):** analytics/live data, bundle creation + **card assign/release**, OTA console, alert ack, push.
- **Provisioning (local):** SoftAP HTTP captive portal **or** BLE GATT (ESP-IDF provisioning service) with PoP.

Detailed payloads/schemas: LLDs.

---

## 9. Deployment view

```
  FACTORY FLOOR                         CLOUD
  ┌──────────────────────┐             ┌─────────────────────────────┐
  │ Line nodes (ESP32) ×N │  HTTPS/WS   │ Always-on API + Session eng. │
  │ Admin reader (or phone│ ──────────► │ Card↔Bundle mapping          │
  │ Factory WiFi (+ backup│             │ Scheduled offline watcher    │
  │ AP, ideally IoT VLAN) │             │ OTA server  → Object store    │
  └──────────────────────┘             │ Postgres (SoR) · Firestore+FCM│
                                        └─────────────────────────────┘
            ▲                                        │
            └────────── provisioning (BLE/AP) ◄──────┘ Flutter app + Web app
```

**Critical deployment note:** the **offline watcher requires an always-on backend** — Render free tier sleeps and cannot run it. OTA `/check` tolerates a sleepy server; node-down alerting does not. Recommend an always-on instance or a scheduled cloud function. Consider a dedicated AP / IoT VLAN for node traffic isolation.

---

## 10. Cross-cutting concerns (NFRs)

- **Security:** per-device tokens; HTTPS everywhere; provisioning PoP + password-protected AP; admin-approved device claim; server-side RBAC; no secrets in URLs; optional flash encryption + secure boot for high-value sites; SHA-256-verified OTA binaries. (Card UIDs are not secret — clonable; acceptable threat model for internal productivity, see ADR-001.)
- **Reliability / offline resilience:** NVS offline queue + replay on reconnect; **idempotent ingest** (dedup by `eventId`); WiFiMulti + backoff; OTA dual-partition rollback; provisioning never interrupts an active count. Counting needs **no bundle metadata** on the node (frames by UID) → more offline-robust.
- **Scalability:** stateless horizontally-scalable API; UUID keys; data partitioned by factory/line; deterministic per-node OTA buckets; designed for N lines × 3 nodes.
- **Data integrity:** card identified by **native UID**; backend `cardUid→bundle` mapping is **authoritative**; both sensor counts retained (no premature collapse); cross-stage reconciliation vs `declaredPieces`; NTP-synced timestamps.
- **Observability:** heartbeats + node-status dashboard; OTA event log; alert log with ack/escalation; structured backend logs.
- **Maintainability:** OTA fleet updates with module-type targeting; field config without reflash (dynamic provisioning).
- **Power/timing:** nodes mains-powered → no deep-sleep; reliable wall-clock via NTP.

---

## 11. Assumptions, risks & open items

- **Output-2 sensors** — exact pair (two Hall / down+up limit / IR+Hall) needed to finalize the press-cycle state machine.
- **Piece-truth** — undecided by design: both sensors logged, floor data picks the reliable one.
- **SAM/SMV** — availability determines whether we report true efficiency vs throughput-only.
- **Tag family** — *now low-impact*: any UID-readable tag works; family only affects reader-code simplicity (per ADR-001). Web NFC reads UIDs on Android for a phone-based admin station.
- **Hosting** — must move off sleepy free tier for reliable alerting.
- **Factory WiFi quality** — top field risk; backup SSID + offline queue mitigate; a dedicated IoT AP is recommended.
- **Card cloning** — native UIDs clonable; negligible incentive internally; revisit (signed written token) only if it ever matters.
- **Provisioning hardening** — flash encryption / secure boot add cost + complexity; decide per deployment tier.
- **BLE range** on a metal-heavy floor — validate; SoftAP is the fallback.

---

## 12. Build phasing (aligned to companion plan)

- **Phase 1 — prove the loop:** Input node merged firmware (two counters + UID-keyed NFC sessions + offline queue + heartbeat w/ `fwVersion`); **SoftAP provisioning**; **card assignment (UID→bundle)**; ingest + Postgres; node-down push; minimal dashboard.
- **Phase 2 — productize:** Output-1/2 nodes; **production OTA**; **BLE provisioning + device claim** via the Flutter app; RBAC; web master data + card pool; contractor/line dashboards + sensor-agreement view.
- **Phase 3 — insight & scale:** SAM efficiency + OEE; richer anomaly pushes; multi-line; shift rollups; app polish; optional contractor self-view.

---

*HLD for the Grewbie garment-line traceability system. Card model per ADR-001 (identity/UID→backend). Detailed schemas, payloads, and the OTA implementation files accompany this document.*
