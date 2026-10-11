import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import 'session_policy.dart';
import 'testagram_session_storage.dart';

/// Enforces the 24-hour maximum while the app stays open, not only on restart.
class SessionGuard {
  SessionGuard(this._client, this._storage);

  final SupabaseClient _client;
  final TestagramSessionStorage _storage;
  StreamSubscription<AuthState>? _subscription;
  Timer? _expiryTimer;
  bool _signingOut = false;

  void start() {
    _subscription = _client.auth.onAuthStateChange.listen((_) {
      unawaited(_scheduleExpiry());
    });
    unawaited(_scheduleExpiry());
  }

  Future<void> _scheduleExpiry() async {
    _expiryTimer?.cancel();
    if (_client.auth.currentSession == null) return;
    final startedAt = await _storage.sessionStartedAt();
    if (startedAt == null) return;
    final remaining =
        startedAt.add(SessionPolicy.maxAge).difference(DateTime.now());
    if (remaining <= Duration.zero) {
      await _expire();
      return;
    }
    _expiryTimer = Timer(remaining, () => unawaited(_expire()));
  }

  Future<void> _expire() async {
    if (_signingOut || _client.auth.currentSession == null) return;
    _signingOut = true;
    try {
      await _client.auth.signOut();
    } finally {
      _signingOut = false;
    }
  }

  Future<void> dispose() async {
    _expiryTimer?.cancel();
    await _subscription?.cancel();
  }
}
