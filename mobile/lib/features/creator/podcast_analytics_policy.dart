/// The web feature gate locks a feature only when a row explicitly says true.
/// A missing row is the unlocked default, not an authorization failure.
class PodcastAnalyticsPolicy {
  const PodcastAnalyticsPolicy._();

  static bool isLocked(dynamic record) => record is Map && record['is_locked'] == true;

  static int asCount(dynamic value) => int.tryParse('$value') ?? 0;

  static double asAmount(dynamic value) => double.tryParse('$value') ?? 0;

  static String formatDuration(dynamic seconds) {
    final value = asCount(seconds);
    if (value < 1) return '0m';
    final hours = value ~/ 3600;
    final minutes = (value % 3600) ~/ 60;
    return hours > 0 ? '${hours}h ${minutes}m' : '${minutes}m';
  }
}
