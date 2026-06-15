# Nexwear Factory Monitor

**Android / iOS** app for factory admins to monitor the Nexwear / Net Rat garment
line in real time, with **push notifications** for alerts. It talks to the same
backend as the web console. (Desktop monitoring uses the web console; this app is
mobile so push works — see [PUSH_SETUP.md](PUSH_SETUP.md).)

## Features

- **Login** against `POST /api/v1/auth/login` (JWT stored in shared_preferences). Server URL is configurable on the login screen (defaults to the production server).
- **Dashboard** (`GET /api/v1/admin/dashboard/stats`), auto-refreshing every 30 s + pull-to-refresh:
  - KPI cards — Active Bundles, Completed Today, Input Today, Today's Yield
  - Bundle Status & Node Health summary panels
  - Open Alerts (`GET /api/v1/admin/alerts?resolved=false`)
  - Line Performance — per line: active/done bundles, nodes online, in/out pieces, yield bar
  - Contractor Output — per contractor: bundles, declared/in/out pieces, yield bar
- **Push notifications** — every new alert pushes to logged-in devices via FCM. Needs a Firebase project (see [PUSH_SETUP.md](PUSH_SETUP.md)); works without it, just no push.

## Run / build

```powershell
cd flutter\nexwear_monitor
flutter pub get
flutter run                   # pick a connected device / emulator
flutter build apk             # Android
flutter build ipa             # iOS (on macOS)
```

## Configuration

The server URL defaults to `http://15.206.16.137`. Tap **Server settings** on the
login screen to point at a different backend (e.g. `http://localhost` in dev).
The app appends `/api` automatically and derives the WebSocket URL from it.

## Notes

- For Android release builds hitting an `http://` (non-TLS) backend, cleartext
  traffic must be allowed (debug builds permit it by default).
