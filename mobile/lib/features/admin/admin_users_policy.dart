/// Pure rules for owner-only user administration.
class AdminUsersPolicy {
  const AdminUsersPolicy._();

  static bool canAccess({required bool isOwner}) => isOwner;

  static bool matchesSearch(Map<String, dynamic> user, String query) {
    final normalized = query.trim().toLowerCase();
    if (normalized.isEmpty) return true;
    return <dynamic>[
      user['username'],
      user['email'],
      user['id'],
    ].any((value) => '$value'.toLowerCase().contains(normalized));
  }

  static bool isBlocked(Map<String, dynamic> user) => user['is_blocked'] == true;
}
