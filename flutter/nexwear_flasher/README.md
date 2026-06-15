# Nexwear ESP32 Flasher + Configurator

A Windows desktop tool to **flash** Nexwear node firmware onto ESP32 devices over
USB and **configure** them (WiFi, server URL, module type, label) over the same
cable — no SoftAP captive portal needed. The merged firmware image (bootloader +
partition table + app, flashable at offset `0x0`) is bundled in `assets/firmware/`.

## How it works

The app provides the GUI (COM-port picker, baud, progress log) and delegates the
actual flash to **esptool**, which it locates in this order:

1. `tools\esptool.exe` next to the built executable (recommended for distribution)
2. `esptool.exe` on `PATH`
3. `esptool.py` on `PATH` (run via `python`)
4. `python -m esptool`

### Bundling esptool for distribution

So end users don't need Python, drop a standalone `esptool.exe` next to the app:

```
nexwear_flasher.exe
tools\esptool.exe        <-- from https://github.com/espressif/esptool/releases
```

During development, esptool from PlatformIO/pip on `PATH` is used automatically.

## Run / build

```powershell
cd flutter\nexwear_flasher
flutter pub get
flutter run -d windows          # dev
flutter build windows           # release -> build\windows\x64\runner\Release\
```

## Updating the bundled firmware

After building new firmware, regenerate the merged image and copy it in, then
update `bundledVersion` / `bundledAsset` in `lib/flasher_service.dart`.

## Usage

1. Plug in the ESP32 over USB.
2. Pick the COM port (Refresh if missing — install CP210x/CH340 drivers if none appear).
3. **Step 1 – Device & Firmware:** leave **Bundled** selected (or pick a custom `.bin`).
4. **Step 2 – Node Configuration:** enter WiFi SSID/password, server URL, pick the
   module type (INPUT / OUTPUT_1 / OUTPUT_2 / ADMIN), and an optional label.
5. Press **Flash Device** (with *Configure automatically after flashing* ticked) to
   flash then push config in one go. Hold BOOT if it stalls at "Connecting…".

### Configuration over serial (CFG/STATUS protocol)

The firmware listens on USB serial (115200) for newline commands:

| Command | Effect |
|---|---|
| `CFG {"ssid","pass","server","module","label"}` | Save WiFi/server/module/label; node connects, claims, and prints its server-issued node ID |
| `STATUS` | Node replies `STATUS {json}` with current config + state |
| `RESET` | Factory-reset and reboot |

The app's buttons map to these:

- **Flash Device** — writes firmware, then (if ticked) opens serial and sends `CFG`.
- **Configure** — sends `CFG` to an already-flashed node (fresh *or* already active; an active node reboots and reconnects with the new settings).
- **Status** — sends `STATUS` and shows the node's current config.

**Node ID is server-issued**, not set here — it's derived from the chip and
assigned when the node claims itself. It appears in the output log after
configuring, and the node still needs **approving in the web console** before it
goes ACTIVE. The optional **Label** (e.g. "Line 1 – Elastic") is stored on the
node and shown next to the node ID in the console.
