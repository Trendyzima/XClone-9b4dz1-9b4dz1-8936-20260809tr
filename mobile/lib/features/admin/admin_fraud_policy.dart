/// Pure owner-access and fraud-alert presentation rules.
class AdminFraudPolicy {
  const AdminFraudPolicy._();

  static bool canAccess({required bool isOwner}) => isOwner;

  static String severityLabel(dynamic value) {
    final severity = '$value'.trim().toLowerCase();
    if (severity.isEmpty || severity == 'null') return 'Unclassified';
    return severity[0].toUpperCase() + severity.substring(1);
  }

  static bool isResolved(Map<String, dynamic> alert) => alert['resolved'] == true;
}
