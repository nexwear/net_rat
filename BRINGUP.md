# Garment-Line Bring-Up (Phase 1)

End-to-end test after flashing firmware. Requires Docker (postgres + backend).

## Cloud (EC2 `15.206.16.137`)

| Service | URL |
|---------|-----|
| API (via nginx) | `http://15.206.16.137/api` |
| Health | `http://15.206.16.137/api` → backend `/health` via direct `:4000` on server |
| OTA public base | `http://15.206.16.137/api` (`OTA_PUBLIC_BASE_URL`) |

**Provision nodes** with server URL: `http://15.206.16.137/api`

**Publish OTA to cloud:**

```powershell
cd E:\netrat\scripts
.\publish-ota.ps1 -Version 1.0.9 -ApiBase "http://15.206.16.137/api" -RolloutPct 100
```

**GitHub deploy:** set repo secret `EC2_HOST` = `15.206.16.137`. Push to `main` runs `.github/workflows/deploy.yml`.

## 1. Start backend

```powershell
cd E:\netrat
Copy-Item .env.example .env -ErrorAction SilentlyContinue
docker compose up postgres backend -d
```

Check: `curl http://localhost:4000/health`

## 2. Provision the node

1. Flash firmware (USB): `python -m platformio run -e esp32dev -t upload`
2. Open serial monitor @ 115200
3. Connect phone/laptop to SoftAP **`Grewbie-INPUT-xxxx`** (password `grewbie-setup`)
4. Captive portal → enter WiFi + server URL:
   - Direct: `http://<pc-lan-ip>:4000`
   - Cloud: `http://15.206.16.137/api`
5. Node reboots; serial should show `[OTA] Ready` and heartbeats every 15s

`AUTO_APPROVE_DEVICES=true` auto-activates claims — no manual approve needed.

Verify node:

```powershell
curl http://localhost:4000/v1/devices
curl http://localhost:4000/v1/status
```

## 3. Create bundle + assign card

```powershell
# Create bundle (100 pieces)
$bundle = Invoke-RestMethod -Method POST -Uri http://localhost:4000/v1/bundles `
  -ContentType application/json -Body '{"declaredPieces":100}'
$bundleId = $bundle.id

# Tap card on ADMIN reader (or any node in ADMIN mode) — note UID from serial [NFC] tap uid=...
# Assign card to bundle (replace CARDUID):
Invoke-RestMethod -Method POST -Uri "http://localhost:4000/v1/cards/CARDUID/assign" `
  -ContentType application/json -Body "{`"bundleId`":`"$bundleId`"}"
```

Or poll admin scans:

```powershell
curl "http://localhost:4000/v1/scans/recent?kind=ASSIGN_SCAN"
```

## 4. Input node session test

1. Tap assigned card on **INPUT** node → serial: `[NFC] tap` → `[TELEM] SCAN TAP_IN`
2. Run pieces (horseshoe 27 + current 34) → `[TELEM] UPDATE pass=… cycle=…`
3. Double-tap same card (tap-out) → `[TELEM] CLOSE`

Verify backend:

```powershell
curl http://localhost:4000/v1/status
```

## 5. Offline replay (optional)

1. Disconnect WiFi (or stop backend)
2. Generate counts + tap events
3. Restore WiFi/backend — queued events drain from LittleFS

## Serial log cheat sheet

| Log | Meaning |
|-----|---------|
| `[NFC] tap uid=…` | Card read OK |
| `[TELEM] SCAN TAP_IN` | Session opening |
| `[TELEM] UPDATE pass=N cycle=M` | Periodic count sync |
| `[TELEM] CLOSE …` | Session closed |
| `[OTA] Ready as …` | WiFi OTA listener up |

## Production OTA (LLD `/v1/ota/check`)

Nodes check every `otaHrs` (default 6 h). Updates apply only when **no open session** and **offline queue empty**.

### Publish a new firmware

1. Bump version in `firmware/platformio.ini`: `-DFW_VERSION=\"1.0.1\"`
2. Build: `python -m platformio run -e esp32dev`
3. Register with backend:

```powershell
cd E:\netrat\scripts
.\publish-ota.ps1 -Version 1.0.1 -RolloutPct 100
```

4. Node checks `/v1/ota/check` → downloads `/v1/ota/bin/...` → SHA256 verify → flash → reboot → NVS `fwVersion` updated.

### Rollout controls

```powershell
# List releases
curl http://localhost:4000/v1/admin/ota/releases

# Pause or change rollout %
Invoke-RestMethod -Method PATCH -Uri http://localhost:4000/v1/admin/ota/releases/1 `
  -ContentType application/json -Body '{"rolloutPct":10,"paused":false}'
```

### Dev OTA check interval

Add to `platformio.ini` build_flags for faster testing: `-DOTA_CHECK_INTERVAL_MS=300000` (5 min).

### ArduinoOTA (PlatformIO dev upload)

Still available separately — see `firmware/README.md`.

## Next after bring-up

- Output-1 / Output-2 nodes (re-provision with different `moduleType`)
- Production OTA via `/v1/ota/check` (see `BRINGUP.md`)
- Web UI for bundle creation + card assign
