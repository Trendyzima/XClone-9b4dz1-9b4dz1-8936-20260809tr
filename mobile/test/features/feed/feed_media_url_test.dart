import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/feed/feed_media_url.dart';

void main() {
  group('FeedMediaUrl', () {
    test('preserves canonical Testagram CDN media URLs', () {
      expect(
        FeedMediaUrl.normalize(
          'https://media.testagram.site/media/users/u1/video.mp4',
        ),
        'https://media.testagram.site/media/users/u1/video.mp4',
      );
    });

    test('repairs legacy first-party CDN paths', () {
      expect(
        FeedMediaUrl.normalize(
          'https://media.testagram.site/users/u1/video.mp4',
        ),
        'https://media.testagram.site/media/users/u1/video.mp4',
      );
    });

    test('upgrades first-party media URLs to HTTPS', () {
      expect(
        FeedMediaUrl.normalize(
          'http://media.testagram.site/media/users/u1/video.mp4',
        ),
        'https://media.testagram.site/media/users/u1/video.mp4',
      );
    });

    test('does not rewrite unrelated external media hosts', () {
      expect(
        FeedMediaUrl.normalize('https://cdn.example/video.mp4'),
        'https://cdn.example/video.mp4',
      );
    });

    test('rejects unsafe or malformed media URLs', () {
      expect(FeedMediaUrl.normalize('javascript:alert(1)'), isNull);
      expect(FeedMediaUrl.normalize('file:///tmp/video.mp4'), isNull);
      expect(
        FeedMediaUrl.normalize('https://user:pass@cdn.example/a.mp4'),
        isNull,
      );
      expect(FeedMediaUrl.normalize('  '), isNull);
    });
  });
}
