import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/core/auth/session_envelope_policy.dart';

void main() {
  group('SessionEnvelopePolicy.resolveStartedAt', () {
    final start = DateTime.utc(2026, 1, 1, 12);

    test('preserves original sign-in time for same-user token refresh', () {
      final now = start.add(const Duration(hours: 8));
      expect(
        SessionEnvelopePolicy.resolveStartedAt(
          now: now,
          previousStartedAt: start,
          previousUserId: 'user-1',
          incomingUserId: 'user-1',
        ),
        start,
      );
    });

    test('starts a new clock when the signed-in user changes', () {
      final now = start.add(const Duration(hours: 8));
      expect(
        SessionEnvelopePolicy.resolveStartedAt(
          now: now,
          previousStartedAt: start,
          previousUserId: 'user-1',
          incomingUserId: 'user-2',
        ),
        now,
      );
    });

    test('does not preserve an expired original session clock', () {
      final now = start.add(const Duration(hours: 24));
      expect(
        SessionEnvelopePolicy.resolveStartedAt(
          now: now,
          previousStartedAt: start,
          previousUserId: 'user-1',
          incomingUserId: 'user-1',
        ),
        now,
      );
    });

    test('starts a clean clock when previous session data is missing', () {
      final now = start.add(const Duration(minutes: 3));
      expect(
        SessionEnvelopePolicy.resolveStartedAt(
          now: now,
          previousStartedAt: null,
          previousUserId: null,
          incomingUserId: 'user-1',
        ),
        now,
      );
    });

    test('does not preserve a clock when identity is unknown', () {
      final now = start.add(const Duration(hours: 2));
      expect(
        SessionEnvelopePolicy.resolveStartedAt(
          now: now,
          previousStartedAt: start,
          previousUserId: null,
          incomingUserId: null,
        ),
        now,
      );
    });
  });
}
