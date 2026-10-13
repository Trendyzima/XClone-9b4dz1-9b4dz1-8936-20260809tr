import 'dart:convert';

/// Normalizes persisted Supabase sessions without applying a client-side age
/// limit. Supabase's refresh-token lifecycle and explicit sign-out determine
/// session validity; a page reload must not expire an otherwise valid session.
class SessionPersistencePolicy {
  const SessionPersistencePolicy._();

  /// Returns a normalized session JSON string, or null for corrupt/incomplete
  /// data. Also supports the legacy `{started_at_ms, session}` envelope.
  static String? normalize(String persistedValue) {
    try {
      final decoded = jsonDecode(persistedValue);
      Object? session = decoded;
      if (decoded is Map && decoded.containsKey('session')) {
        final wrapped = decoded['session'];
        session = wrapped is String ? jsonDecode(wrapped) : wrapped;
      }
      if (session is! Map) return null;
      if (session['access_token'] is! String ||
          (session['access_token'] as String).isEmpty ||
          session['refresh_token'] is! String ||
          (session['refresh_token'] as String).isEmpty ||
          session['user'] is! Map) {
        return null;
      }
      return jsonEncode(session);
    } catch (_) {
      return null;
    }
  }

  static bool isLegacyEnvelope(String persistedValue) {
    try {
      final decoded = jsonDecode(persistedValue);
      return decoded is Map &&
          decoded.containsKey('started_at_ms') &&
          decoded.containsKey('session');
    } catch (_) {
      return false;
    }
  }
}
