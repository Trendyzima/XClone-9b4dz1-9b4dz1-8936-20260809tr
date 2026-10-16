import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/migration_batch_policy.dart';

void main() {
  group('MigrationBatchPolicy', () {
    test('requires three unique interests', () {
      expect(
        MigrationBatchPolicy.hasEnoughInterests(['tech', 'music']),
        isFalse,
      );
      expect(
        MigrationBatchPolicy.hasEnoughInterests(['tech', 'music', 'tech']),
        isFalse,
      );
      expect(
        MigrationBatchPolicy.hasEnoughInterests(['tech', 'music', 'sport']),
        isTrue,
      );
    });

    test('daily claim is available once per UTC calendar day', () {
      final now = DateTime.utc(2026, 10, 13, 21);
      expect(MigrationBatchPolicy.canClaimDailyReward(now: now), isTrue);
      expect(
        MigrationBatchPolicy.canClaimDailyReward(
          lastClaimedAt: DateTime.utc(2026, 10, 13, 1),
          now: now,
        ),
        isFalse,
      );
      expect(
        MigrationBatchPolicy.canClaimDailyReward(
          lastClaimedAt: DateTime.utc(2026, 10, 12, 23, 59),
          now: now,
        ),
        isTrue,
      );
    });

    test('minor units are formatted safely and duration is bounded', () {
      expect(MigrationBatchPolicy.formatMinorPrice(12345), 'KES 123.45');
      expect(MigrationBatchPolicy.formatMinorPrice('bad'), 'KES 0.00');
      expect(MigrationBatchPolicy.formatMinorPrice(-200), 'KES 0.00');
      expect(MigrationBatchPolicy.formatDuration(0), 'Duration unavailable');
      expect(MigrationBatchPolicy.formatDuration(125), '2m');
      expect(MigrationBatchPolicy.formatDuration(3660), '1h 1m');
    });

    test('Premium approval URLs must use HTTPS and include a host', () {
      expect(
        MigrationBatchPolicy.isValidPremiumApprovalUrl(
          Uri.parse('https://paypal.example/approve'),
        ),
        isTrue,
      );
      expect(
        MigrationBatchPolicy.isValidPremiumApprovalUrl(
          Uri.parse('http://paypal.example/approve'),
        ),
        isFalse,
      );
      expect(
        MigrationBatchPolicy.isValidPremiumApprovalUrl(
          Uri.parse('https:///approve'),
        ),
        isFalse,
      );
      expect(MigrationBatchPolicy.isValidPremiumApprovalUrl(null), isFalse);
    });
  });
}
