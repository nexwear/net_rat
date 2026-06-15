# Garment-Line Firmware

Universal ESP32 firmware for **Input**, **Output-1**, **Output-2**, and **Admin** nodes. Module behavior is selected at runtime from NVS (`moduleType`), not compile flags.

Spec: [`../design/garment-line-LLD-firmware.md`](../design/garment-line-LLD-firmware.md)

## Hardware

- ESP32 dev board
- PN5180 NFC (VSPI: SCK 18, MISO 19, MOSI 23, NSS 16, BUSY 5, RST 17)
- Sensors per module type (see LLD A2 pin map)

## Build & flash

Requires [PlatformIO](https://platformio.org/).

**First flash (USB cable):**

```bash
cd firmware
python -m platformio run -e esp32dev -t upload
python -m platformio device monitor
```

**OTA update (after the node is on WiFi):**

1. Note the ESP32 IP from serial or your router.
2. Run:

```bash
python -m platformio run -e esp32dev-ota -t upload --upload-port 192.168.x.x
```

Or set `upload_port` in `[env:esp32dev-ota]` in `platformio.ini`.

Do **not** run bare `pio run -t upload` without `-e` if you only want one target — `default_envs` is set to `esp32dev` (USB) only.

First boot with empty NVS starts **SoftAP provisioning** (`Grewbie-INPUT-xxxx`, password `grewbie-setup`). Open the captive portal, enter WiFi + server URL, then approve the device claim in the backend console.

## Architecture

| Core | Task | Role |
|------|------|------|
| 1 | `SensingTask` | Counter drivers, NFC UID read, session manager |
| 0 | `NetTask` | WiFi, HTTPS telemetry, offline queue, heartbeat |

Queues: `telemetryQ` (32) sensing → net, `commandQ` (8) net → sensing.

## Backend endpoints used

- `POST /v1/devices/claim`
- `GET /v1/devices/:nodeId/config`
- `POST /v1/heartbeat`
- `POST /v1/scan`
- `POST /v1/session`
- `POST /v1/unassigned`

## Pin map vs legacy cloth-counter sketch

Your field-proven sketch wiring matches this firmware:

| Signal | GPIO | Legacy sketch | Garment-line LLD |
|--------|------|---------------|------------------|
| PN5180 NSS/BUSY/RST | 16 / 5 / 17 | same | same |
| Horseshoe IR | 27 | `count27` | INPUT / OUTPUT_1 `countPass` |
| Current (SEN0211) | 34 | `countCur` | INPUT `countCycle` |
| IR sequential A/B | 25 / 26 | `countAB` | OUTPUT_2 press cycle (different FSM) |

NFC read path uses the same **`reset()` → `setupRF()` → read** sequence as your UID sketch. Current sampling uses **SEN0211 sensitivity 50 mV/A** and the same Vpp/Vrms math.

The legacy `/api/machines/sync` payload is replaced by LLD telemetry (`/v1/scan`, `/v1/session`, `/v1/heartbeat`) once the backend ingest API is live.


| Type | Sensors |
|------|---------|
| INPUT | Horseshoe IR + current |
| OUTPUT_1 | Horseshoe IR + hall |
| OUTPUT_2 | Press down/up cycle |
| ADMIN | NFC UID only (assign scan) |

## Field ops

- **Long-press BOOT 3 s** — reprovision (when no open session)
- **Long-press BOOT 10 s** — factory reset (wipe NVS)
