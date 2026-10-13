import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/core/auth/session_persistence_policy.dart';

Map<String, dynamic> session(
        {String access = 'access-1', String refresh = 'refresh-1'}) =>
    {
      'access_token': access,
      'refresh_token': refresh,
      'token_type': 'bearer',
      'expires_in': 3600,
      'user': {'id': 'user-1', 'email': 'user@example.test'},
    };

void main() {
  group('SessionPersistencePolicy', () {
    test('restores a canonical Supabase session without changing its tokens',
        () {
      final raw = jsonEncode(session());
      expect(SessionPersistencePolicy.normalize(raw), raw);
      expect(SessionPersistencePolicy.isLegacyEnvelope(raw), isFalse);
    });

    test('migrates the previous envelope format without logging the user out',
        () {
      final original = jsonEncode(session());
      final envelope = jsonEncode({
        'started_at_ms': DateTime.utc(2026, 1, 1).millisecondsSinceEpoch,
        'session': original,
      });
      expect(SessionPersistencePolicy.isLegacyEnvelope(envelope), isTrue);
      expect(SessionPersistencePolicy.normalize(envelope), original);
    });

    test('also migrates an envelope whose session is a decoded map', () {
      final payload = session();
      expect(
        SessionPersistencePolicy.normalize(jsonEncode({
          'started_at_ms': 1,
          'session': payload,
        })),
        jsonEncode(payload),
      );
    });

    test('rejects corrupt or incomplete persisted values safely', () {
      expect(SessionPersistencePolicy.normalize('{not-json'), isNull);
      expect(
          SessionPersistencePolicy.normalize(jsonEncode({'user': {}})), isNull);
      expect(
          SessionPersistencePolicy.normalize(jsonEncode(session(refresh: ''))),
          isNull);
    });

    test('session restoration has no arbitrary 24-hour client expiry', () {
      final oldSession =
          session(access: 'still-valid-access', refresh: 'still-valid-refresh');
      final persisted = jsonEncode({
        'started_at_ms': DateTime.utc(2020, 1, 1).millisecondsSinceEpoch,
        'session': jsonEncode(oldSession),
      });
      expect(SessionPersistencePolicy.normalize(persisted),
          jsonEncode(oldSession));
    });
  });
}
