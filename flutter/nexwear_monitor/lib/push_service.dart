import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api.dart';
import 'firebase_options.dart';

/// Background isolate handler — must be a top-level, entry-point function.
/// Notification messages are shown by the OS automatically; this is here for
/// completeness / future data-only messages.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Intentionally minimal — the system tray shows notification payloads.
}

/// FCM push notifications, mobile-only. Every method is a safe no-op on
/// unsupported platforms (Windows/Linux desktop) or when Firebase isn't
/// configured yet, so the app runs unchanged until you set up Firebase.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();
  bool _ready = false;
  String? _token;

  bool get supported => !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  static const _channel = AndroidNotificationChannel(
    'alerts',
    'Alerts',
    description: 'Production line alerts',
    importance: Importance.high,
  );

  /// Initialise Firebase + local notifications. Call once at startup.
  Future<void> init() async {
    if (!supported || _ready) return;
    try {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

      await _local.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
      );
      final androidPlugin = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(_channel);
      await androidPlugin?.requestNotificationsPermission();

      await FirebaseMessaging.instance.requestPermission();

      // Foreground messages don't pop a tray notification by default — show one.
      FirebaseMessaging.onMessage.listen(_showForeground);

      FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _token = t;
        _register(t);
      });

      _ready = true;
      debugPrint('[push] FCM ready');
    } catch (e) {
      // No google-services.json / GoogleService-Info.plist yet, etc.
      debugPrint('[push] disabled (not configured): $e');
    }
  }

  /// Register this device with the backend after a successful login.
  Future<void> onLogin() async {
    if (!supported) return;
    if (!_ready) await init();
    if (!_ready) return;
    try {
      _token = await FirebaseMessaging.instance.getToken();
      if (_token != null) await _register(_token!);
    } catch (e) {
      debugPrint('[push] token fetch failed: $e');
    }
  }

  /// Stop pushes to this device on logout.
  Future<void> onLogout() async {
    if (!supported || _token == null) return;
    try {
      await ApiClient.instance.unregisterDevice(_token!);
    } catch (_) {}
  }

  Future<void> _register(String token) async {
    try {
      await ApiClient.instance.registerDevice(token, Platform.isIOS ? 'ios' : 'android');
      debugPrint('[push] device registered');
    } catch (e) {
      debugPrint('[push] register failed: $e');
    }
  }

  void _showForeground(RemoteMessage m) {
    final notif = m.notification;
    final title = notif?.title ?? m.data['type'] ?? 'Alert';
    final body = notif?.body ?? m.data['detail'] ?? '';
    _local.show(
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
        iOS: const DarwinNotificationDetails(),
      ),
    );
  }
}
