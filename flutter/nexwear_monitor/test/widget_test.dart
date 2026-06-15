import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:nexwear_monitor/screens/login_screen.dart';

void main() {
  testWidgets('Login screen renders', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: LoginScreen()));
    expect(find.text('Sign in to Monitor'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });
}
