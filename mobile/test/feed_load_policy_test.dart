import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/feed/feed_load_policy.dart';

void main() {
  group('FeedLoadPolicy.shouldStart', () {
    test('allows initial and pagination requests when idle and more exists',
        () {
      expect(
        FeedLoadPolicy.shouldStart(
          loading: false,
          hasMore: true,
          reset: false,
        ),
        isTrue,
      );
    });

    test('blocks concurrent pagination requests', () {
      expect(
        FeedLoadPolicy.shouldStart(
          loading: true,
          hasMore: true,
          reset: false,
        ),
        isFalse,
      );
    });

    test('blocks pagination after the final page', () {
      expect(
        FeedLoadPolicy.shouldStart(
          loading: false,
          hasMore: false,
          reset: false,
        ),
        isFalse,
      );
    });

    test('allows refresh to supersede an in-flight pagination request', () {
      expect(
        FeedLoadPolicy.shouldStart(
          loading: true,
          hasMore: true,
          reset: true,
        ),
        isTrue,
      );
    });

    test('allows refresh after the feed reaches its end', () {
      expect(
        FeedLoadPolicy.shouldStart(
          loading: false,
          hasMore: false,
          reset: true,
        ),
        isTrue,
      );
    });
  });
}
