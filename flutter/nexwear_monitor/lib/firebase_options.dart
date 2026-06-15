// Generated from google-services.json (project: natrat-apprals-tiruppur).
// Re-run `flutterfire configure` to refresh if you add iOS or change the Firebase app.
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Firebase is not configured for web.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        throw UnsupportedError('Run flutterfire configure and add iOS.');
      default:
        throw UnsupportedError('Firebase is only supported on Android/iOS.');
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBw075NrMoGq4rLok9MtNUUal72y4YkBxQ',
    appId: '1:678900636509:android:2046bb09069dbcedf466b4',
    messagingSenderId: '678900636509',
    projectId: 'natrat-apprals-tiruppur',
    storageBucket: 'natrat-apprals-tiruppur.firebasestorage.app',
  );
}
