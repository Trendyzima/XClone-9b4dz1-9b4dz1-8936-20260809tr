/// Shared session policy: a Flutter client must not keep a signed-in session
/// alive beyond 24 hours from the original sign-in, even if tokens refresh.
class SessionPolicy {
  const SessionPolicy._();

  static const maxAge = Duration(hours: 24);

  static bool isExpired({required DateTime startedAt, DateTime? now}) {
    final current = now ?? DateTime.now();
    return !current.isBefore(startedAt.add(maxAge));
  }
}
