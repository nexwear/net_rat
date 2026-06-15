import 'package:flutter/material.dart';

import 'api.dart';
import 'push_service.dart';
import 'screens/shell_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiClient.instance.load();
  // Set up push (mobile only; no-op on desktop / before Firebase is configured).
  await PushService.instance.init();
  if (ApiClient.instance.isLoggedIn) {
    PushService.instance.onLogin();
  }
  runApp(const MonitorApp());
}

class MonitorApp extends StatelessWidget {
  const MonitorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nexwear Monitor',
      debugShowCheckedModeBanner: false,
      theme: NW.theme(),
      home: ApiClient.instance.isLoggedIn ? const ShellScreen() : const LoginScreen(),
    );
  }
}
