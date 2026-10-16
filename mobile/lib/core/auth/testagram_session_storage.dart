import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'session_persistence_policy.dart';

/// Persistent Supabase session storage shared by Flutter Web and Android.
/// Web uses browser storage; Android uses encrypted platform-backed storage.
/// Legacy session envelopes are migrated in-place to the canonical Supabase
/// session JSON format. This adapter never expires a session because a page
/// was refreshed; Supabase remains responsible for token refresh/revocation.
class TestagramSessionStorage extends LocalStorage {
  TestagramSessionStorage({FlutterSecureStorage? secureStorage})
    : _secure = secureStorage ?? const FlutterSecureStorage();

  static const _key = 'testagram-flutter-session-v1';
  final FlutterSecureStorage _secure;
  final SharedPreferencesLocalStorage _web = SharedPreferencesLocalStorage(persistSessionKey: _key);

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
    final persisted = await _read();
    if (persisted == null || persisted.isEmpty) return null;
    final normalized = SessionPersistencePolicy.normalize(persisted);
    if (normalized == null) {
      await removePersistedSession();
      return null;
    }
    if (SessionPersistencePolicy.isLegacyEnvelope(persisted)) {
      // One-time migration: retain existing users' sessions rather than
      // forcing everyone to authenticate again after this app upgrade.
      await _write(normalized);
    }
    return normalized;
  }

  @override
  Future<void> persistSession(String persistSessionString) async {
    final normalized = SessionPersistencePolicy.normalize(persistSessionString);
    if (normalized == null) {
      throw const FormatException('Refusing to persist an invalid auth session.');
    }
    await _write(normalized);
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
