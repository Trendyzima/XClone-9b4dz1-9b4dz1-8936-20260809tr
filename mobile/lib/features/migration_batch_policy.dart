/// Pure rules shared by the Flutter parity batch screens.
class MigrationBatchPolicy {
  const MigrationBatchPolicy._();

  static const minimumInterestSelections = 3;

  static bool hasEnoughInterests(Iterable<String> tags) =>
      tags.toSet().length >= minimumInterestSelections;

  static bool canClaimDailyReward({DateTime? lastClaimedAt, DateTime? now}) {
    if (lastClaimedAt == null) return true;
    final last = lastClaimedAt.toUtc();
    final current = (now ?? DateTime.now()).toUtc();
    return last.year != current.year ||
        last.month != current.month ||
        last.day != current.day;
  }

  static String formatMinorPrice(dynamic value, {String currency = 'KES'}) {
    final minor = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
    final safeMinor = minor < 0 ? 0 : minor;
    return '$currency ${(safeMinor / 100).toStringAsFixed(2)}';
  }

  static String formatDuration(dynamic value) {
    final seconds = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
    if (seconds < 1) return 'Duration unavailable';
    if (seconds >= 3600) {
      return '${seconds ~/ 3600}h ${(seconds % 3600) ~/ 60}m';
    }
    return '${seconds ~/ 60}m';
  }

  static bool isValidPremiumApprovalUrl(Uri? uri) =>
      uri != null && uri.scheme == 'https' && uri.host.isNotEmpty;
}
