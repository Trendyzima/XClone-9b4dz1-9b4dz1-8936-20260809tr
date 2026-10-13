/// Small pure rules for the owner-only native admin overview.
class AdminOverviewPolicy {
  const AdminOverviewPolicy._();

  static bool canAccess({required bool isOwner}) => isOwner;

  static int safeCount(dynamic value) {
    if (value is int && value >= 0) return value;
    final parsed = int.tryParse('$value');
    return parsed != null && parsed >= 0 ? parsed : 0;
  }
}
