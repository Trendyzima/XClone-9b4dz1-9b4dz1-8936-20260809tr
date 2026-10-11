import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/core/auth/session_policy.dart';

void main() {
  group('SessionPolicy', () {
    test('session is valid before the 24-hour boundary', () {
      final start = DateTime.utc(2026, 1, 1, 12);
      expect(
        SessionPolicy.isExpired(
          startedAt: start,
          now: start.add(const Duration(hours: 23, minutes: 59)),
        ),
        isFalse,
      );
    });

    test('session expires exactly at 24 hours', () {
      final start = DateTime.utc(2026, 1, 1, 12);
      expect(
        SessionPolicy.isExpired(
          startedAt: start,
          now: start.add(const Duration(hours: 24)),
        ),
        isTrue,
      );
    });
  });
}
