# Nexwear Flutter Apps

Two Flutter applications for the Nexwear / Net Rat factory system.

| App | Platforms | Purpose |
|---|---|---|
| [`nexwear_flasher`](nexwear_flasher) | Windows | Flash node firmware onto ESP32 devices over USB **and configure** them (WiFi / server / module / label) over serial. Bundles the merged firmware image and drives `esptool`. |
| [`nexwear_monitor`](nexwear_monitor) | Android / iOS | Real-time factory dashboard for admins — KPIs, line & contractor output, node health, alerts — with **push notifications** ([setup](nexwear_monitor/PUSH_SETUP.md)). Talks to the existing backend API. (Desktop monitoring = web console.) |

Each app has its own README with build and usage instructions.

## Quick start

```powershell
# Flasher (Windows)
cd nexwear_flasher
flutter pub get
flutter run -d windows

# Monitor (Android / iOS)
cd ..\nexwear_monitor
flutter pub get
flutter run            # pick a connected device / emulator
```

Release Windows builds land in each app's `build\windows\x64\runner\Release\`.
The firmware build artifacts (`build/`, `.dart_tool/`) are git-ignored per project.
