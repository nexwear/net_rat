# Push notifications setup (FCM)

The monitor app and backend already contain all the push code. It stays dormant
until Firebase is configured — once you add a Firebase project, pushes light up
automatically. Push is **mobile-only** (Android/iOS); desktop uses the web console.

## 1. Create a Firebase project (one time)

1. Go to <https://console.firebase.google.com> → **Add project** (free Spark plan is fine).
2. No need to add apps by hand — the FlutterFire CLI does it.

## 2. Wire the Flutter app to Firebase

```bash
dart pub global activate flutterfire_cli      # once
cd flutter/nexwear_monitor
flutterfire configure                          # pick your project; select Android + iOS
```

This generates `lib/firebase_options.dart`, drops `android/app/google-services.json`,
adds `ios/Runner/GoogleService-Info.plist`, and wires the Gradle plugins. A placeholder
`firebase_options.dart` ships in the repo until then — push stays disabled with a
`[push] disabled (not configured)` log line.

> iOS only: in the Firebase console upload your **APNs auth key** (Apple Developer →
> Keys), and enable Push Notifications + Background Modes in Xcode.

## 3. Give the backend a service account

> **Not the same file as `google-services.json`.** The Android app config is already
> in `android/app/google-services.json`. The backend needs a **service account private key**.

1. Firebase console → **Project settings → Service accounts → Generate new private key** → downloads a JSON with `"type": "service_account"`.
2. On the backend host, set **one** of:
   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`, or
   - `FIREBASE_SERVICE_ACCOUNT='<the full JSON as one line>'`
3. Install the SDK and restart:
   ```bash
   cd backend && npm install        # pulls firebase-admin (already in package.json)
   ```
   On boot you should see `[push] FCM enabled` (otherwise `[push] FCM disabled (no credentials set)`).

## How it works

- On login the app registers its FCM token via `POST /v1/notifications/register`; logout unregisters it.
- Every new alert (`raiseAlert` in `backend/src/services/alerts.js`) fires a push to all registered devices — title `SEVERITY · TYPE`, body = the alert detail. Deduped alerts don't re-notify.
- Foreground messages show a local notification (`alerts` channel); background/terminated are shown by the OS. Dead tokens are pruned automatically.

## Verify

1. Build/run on a real device: `flutter run` (emulators need Google Play services).
2. Log in → backend logs show a token registered.
3. Trigger an alert (e.g. take a node offline) → the phone gets a notification.
