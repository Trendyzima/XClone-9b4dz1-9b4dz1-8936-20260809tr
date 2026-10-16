import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/ads/ad_performance_policy.dart';

void main() {
  group('AdPerformancePolicy', () {
    test('CTR safely handles zero and malformed counts', () {
      expect(AdPerformancePolicy.ctr(impressions: 0, clicks: 0), 0);
      expect(AdPerformancePolicy.ctr(impressions: 10, clicks: 2), 20);
      expect(AdPerformancePolicy.ctr(impressions: 10, clicks: 20), 100);
      expect(AdPerformancePolicy.asInt('invalid'), 0);
      expect(AdPerformancePolicy.asInt(-9), 0);
    });

    test('aggregation uses recorded billable micros and click events only', () {
      final rows = AdPerformancePolicy.aggregate(
        slots: const [
          {'code': 'feed', 'kind': 'feed'},
          {'code': 'profile', 'kind': 'profile'},
        ],
        impressions: const [
          {'slot_code': 'feed', 'impression_id': 'i1', 'billable_micros': 50000},
          {'slot_code': 'feed', 'impression_id': 'i2', 'billable_micros': '150000'},
          {'slot_code': 'profile', 'impression_id': 'i3', 'billable_micros': 0},
          {'slot_code': 'unknown', 'impression_id': 'i4', 'billable_micros': 999},
        ],
        clickedImpressionIds: {'i2', 'not-an-impression'},
      );
      expect(rows.first['code'], 'feed');
      expect(rows.first['impressions'], 2);
      expect(rows.first['clicks'], 1);
      expect(rows.first['spend_micros'], 200000);
      expect(rows.first['revenue_kes'], 0.2);
      expect(rows.first['ctr'], 50.0);
      expect(rows.last['code'], 'profile');
      expect(rows.last['clicks'], 0);
    });

    test('empty slots and missing slot codes do not invent placements', () {
      expect(
        AdPerformancePolicy.aggregate(
          slots: const [
            {'kind': 'feed'},
          ],
          impressions: const [
            {'slot_code': 'feed', 'billable_micros': 100},
          ],
          clickedImpressionIds: const {},
        ),
        isEmpty,
      );
    });
  });
}
