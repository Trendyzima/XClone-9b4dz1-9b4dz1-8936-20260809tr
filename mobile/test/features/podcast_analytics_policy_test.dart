import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/creator/podcast_analytics_policy.dart';

void main() {
  group('PodcastAnalyticsPolicy', () {
    test('locks only on an explicit true lock record', () {
      expect(PodcastAnalyticsPolicy.isLocked({'is_locked': true}), isTrue);
      expect(PodcastAnalyticsPolicy.isLocked({'is_locked': false}), isFalse);
      expect(PodcastAnalyticsPolicy.isLocked(null), isFalse);
      expect(PodcastAnalyticsPolicy.isLocked({'other': true}), isFalse);
    });

    test('parses invalid numeric values safely', () {
      expect(PodcastAnalyticsPolicy.asCount('12'), 12);
      expect(PodcastAnalyticsPolicy.asCount('bad'), 0);
      expect(PodcastAnalyticsPolicy.asAmount('2.75'), 2.75);
      expect(PodcastAnalyticsPolicy.asAmount(null), 0);
    });

    test('formats durations in minutes and hours', () {
      expect(PodcastAnalyticsPolicy.formatDuration(0), '0m');
      expect(PodcastAnalyticsPolicy.formatDuration(3599), '59m');
      expect(PodcastAnalyticsPolicy.formatDuration(3660), '1h 1m');
      expect(PodcastAnalyticsPolicy.formatDuration('invalid'), '0m');
    });
  });
}
