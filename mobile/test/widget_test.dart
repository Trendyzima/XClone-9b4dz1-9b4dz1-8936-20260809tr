import 'package:flutter_test/flutter_test.dart';
import 'package:testagram_mobile/main.dart';

void main() {
  testWidgets('Testagram mobile shell renders', (tester) async {
    await tester.pumpWidget(const TestagramApp());
    expect(find.text('Testagram'), findsOneWidget);
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Explore'), findsOneWidget);
    expect(find.text('Messages'), findsOneWidget);
  });
}
