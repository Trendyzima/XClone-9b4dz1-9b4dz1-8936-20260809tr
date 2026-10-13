import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/admin/admin_users_policy.dart';

void main() {
  group('AdminUsersPolicy', () {
    test('user mutations require owner access', () {
      expect(AdminUsersPolicy.canAccess(isOwner: true), isTrue);
      expect(AdminUsersPolicy.canAccess(isOwner: false), isFalse);
    });

    test('search matches username, email, and user id case-insensitively', () {
      const user = {
        'id': 'abc-123',
        'username': 'Trendy',
        'email': 't@example.com'
      };
      expect(AdminUsersPolicy.matchesSearch(user, 'trend'), isTrue);
      expect(AdminUsersPolicy.matchesSearch(user, 'EXAMPLE.COM'), isTrue);
      expect(AdminUsersPolicy.matchesSearch(user, 'ABC-'), isTrue);
      expect(AdminUsersPolicy.matchesSearch(user, 'missing'), isFalse);
      expect(AdminUsersPolicy.matchesSearch(user, '  '), isTrue);
    });

    test('only an explicit boolean marks an account blocked', () {
      expect(AdminUsersPolicy.isBlocked({'is_blocked': true}), isTrue);
      expect(AdminUsersPolicy.isBlocked({'is_blocked': false}), isFalse);
      expect(AdminUsersPolicy.isBlocked({'is_blocked': 'true'}), isFalse);
    });
  });
}
