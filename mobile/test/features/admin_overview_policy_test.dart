import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/admin/admin_overview_policy.dart';

void main() {
  group('AdminOverviewPolicy', () {
    test('only the verified owner can access the command center', () {
      expect(AdminOverviewPolicy.canAccess(isOwner: true), isTrue);
      expect(AdminOverviewPolicy.canAccess(isOwner: false), isFalse);
    });

    test('count parsing rejects malformed and negative values', () {
      expect(AdminOverviewPolicy.safeCount(7), 7);
      expect(AdminOverviewPolicy.safeCount('12'), 12);
      expect(AdminOverviewPolicy.safeCount('unknown'), 0);
      expect(AdminOverviewPolicy.safeCount(-1), 0);
      expect(AdminOverviewPolicy.safeCount('-4'), 0);
    });
  });
}
