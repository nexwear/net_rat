import 'package:flutter_test/flutter_test.dart';

import 'package:nexwear_flasher/main.dart';

void main() {
  testWidgets('Flasher renders core actions', (WidgetTester tester) async {
    await tester.pumpWidget(const FlasherApp());
    expect(find.text('Flash Device'), findsOneWidget);
    expect(find.text('2 · Node Configuration'), findsOneWidget);
  });
}
