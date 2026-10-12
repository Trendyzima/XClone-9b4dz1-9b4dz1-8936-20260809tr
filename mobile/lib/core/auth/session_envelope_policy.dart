import 'session_policy.dart';

/// Pure policy for preserving the original sign-in time across Supabase token
/// refreshes without carrying a session clock across accounts or expiry.
class SessionEnvelopePolicy {
  const SessionEnvelopePolicy._();

  static DateTime resolveStartedAt({
    required DateTime now,
    required DateTime? previousStartedAt,
    required Object? previousUserId,
    required Object? incomingUserId,
  }) {
    final sameKnownUser = incomingUserId != null &&
        previousUserId != null &&
        incomingUserId == previousUserId;
    if (sameKnownUser &&
        previousStartedAt != null &&
        !SessionPolicy.isExpired(startedAt: previousStartedAt, now: now)) {
      return previousStartedAt;
    }
    return now;
  }
}
