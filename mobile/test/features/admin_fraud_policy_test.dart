import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/admin/admin_fraud_policy.dart';

void main() {
  group('AdminFraudPolicy', () {
    test('fraud resolution requires owner access', () {
      expect(AdminFraudPolicy.canAccess(isOwner: true), isTrue);
      expect(AdminFraudPolicy.canAccess(isOwner: false), isFalse);
    });

    test('severity labels are normalized without guessing a severity', () {
      expect(AdminFraudPolicy.severityLabel('high'), 'High');
      expect(AdminFraudPolicy.severityLabel('CRITICAL'), 'Critical');
      expect(AdminFraudPolicy.severityLabel(null), 'Unclassified');
    });

    test('only explicit true is resolved', () {
      expect(AdminFraudPolicy.isResolved({'resolved': true}), isTrue);
      expect(AdminFraudPolicy.isResolved({'resolved': false}), isFalse);
      expect(AdminFraudPolicy.isResolved({'resolved': 'true'}), isFalse);
    });
  });
}
