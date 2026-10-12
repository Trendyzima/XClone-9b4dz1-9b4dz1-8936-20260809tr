import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'session_policy.dart';
import 'session_envelope_policy.dart';

/// Secure session persistence on Android; browser localStorage on Flutter Web.
/// The original sign-in timestamp is preserved across refresh-token writes so
/// auto-refresh cannot silently extend the app session past the 24-hour limit.
class TestagramSessionStorage extends LocalStorage {
  static Object? _userIdOf(Object? session) {
    if (session is Map) {
      final user = session['user'];
      if (user is Map) return user['id'];
    }
    return null;
  }

  TestagramSessionStorage({FlutterSecureStorage? secureStorage})
      : _secure = secureStorage ?? const FlutterSecureStorage();

  static const _key = 'testagram-flutter-session-v1';
  final FlutterSecureStorage _secure;
  final SharedPreferencesLocalStorage _web =
      SharedPreferencesLocalStorage(persistSessionKey: _key);

  Future<String?> _read() async {
    if (kIsWeb) return _web.accessToken();
    return _secure.read(key: _key);
  }

  Future<void> _write(String value) async {
    if (kIsWeb) {
      await _web.persistSession(value);
    } else {
      await _secure.write(key: _key, value: value);
    }
  }

  @override
  Future<void> initialize() async {
    if (kIsWeb) await _web.initialize();
  }

  @override
  Future<bool> hasAccessToken() async => await accessToken() != null;

  @override
  Future<String?> accessToken() async {
    final raw = await _read();
    if (raw == null || raw.isEmpty) return null;
    try {
      final envelope = jsonDecode(raw) as Map<String, dynamic>;
      final startedAt = DateTime.fromMillisecondsSinceEpoch(
        (envelope['started_at_ms'] as num).toInt(),
      );
      if (SessionPolicy.isExpired(startedAt: startedAt)) {
        await removePersistedSession();
        return null;
      }
      final session = envelope['session'];
      return session is String ? session : jsonEncode(session);
    } catch (_) {
      // Remove corrupt/legacy values instead of repeatedly failing startup.
      await removePersistedSession();
      return null;
    }
  }

  Future<DateTime?> sessionStartedAt() async {
    final raw = await _read();
    if (raw == null || raw.isEmpty) return null;
    try {
      final envelope = jsonDecode(raw) as Map<String, dynamic>;
      final startedAt = DateTime.fromMillisecondsSinceEpoch(
        (envelope['started_at_ms'] as num).toInt(),
      );
      if (SessionPolicy.isExpired(startedAt: startedAt)) {
        await removePersistedSession();
        return null;
      }
      return startedAt;
    } catch (_) {
      await removePersistedSession();
      return null;
    }
  }

  @override
  Future<void> persistSession(String persistSessionString) async {
    final now = DateTime.now();
    final incoming = jsonDecode(persistSessionString);
    final incomingUserId = _userIdOf(incoming);
    DateTime? previousStartedAt;
    Object? previousUserId;
    final existingRaw = await _read();
    if (existingRaw != null) {
      try {
        final existing = jsonDecode(existingRaw) as Map<String, dynamic>;
        final previousSession = existing['session'];
        final previous = previousSession is String
            ? jsonDecode(previousSession)
            : previousSession;
        previousUserId = _userIdOf(previous);
        previousStartedAt = DateTime.fromMillisecondsSinceEpoch(
          (existing['started_at_ms'] as num).toInt(),
        );
      } catch (_) {
        // A malformed previous envelope starts a clean, new session clock.
      }
    }
    final startedAt = SessionEnvelopePolicy.resolveStartedAt(
      now: now,
      previousStartedAt: previousStartedAt,
      previousUserId: previousUserId,
      incomingUserId: incomingUserId,
    );
    if (SessionPolicy.isExpired(startedAt: startedAt, now: now)) {
      await removePersistedSession();
      return;
    }
    await _write(jsonEncode({
      'started_at_ms': startedAt.millisecondsSinceEpoch,
      'session': persistSessionString,
    }));
  }

  @override
  Future<void> removePersistedSession() async {
    if (kIsWeb) {
      await _web.removePersistedSession();
    } else {
      await _secure.delete(key: _key);
    }
  }
}
