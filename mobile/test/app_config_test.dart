import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/app/testagram_app.dart';

void main() {
  testWidgets('unconfigured builds fail closed with an actionable setup screen', (tester) async {
    await tester.pumpWidget(const TestagramApp());
    await tester.pumpAndSettle();
    expect(find.text('Testagram is not configured'), findsOneWidget);
    expect(find.textContaining('SUPABASE_URL'), findsOneWidget);
  });
}
