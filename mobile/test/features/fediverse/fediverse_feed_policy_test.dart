import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/fediverse/fediverse_feed_policy.dart';
import 'package:testagram/features/fediverse/fediverse_content.dart';

Map<String, dynamic> post(String uri, String publishedAt, {String? content}) =>
    {
      'uri': uri,
      'published_at': publishedAt,
      if (content != null) 'content': content,
    };

void main() {
  group('reconcileFediverseFeed', () {
    test('keeps visible order and stages new posts during refresh', () {
      final current = [
        post('old-a', '2026-10-10T10:00:00Z'),
        post('old-b', '2026-10-09T10:00:00Z'),
      ];
      final result = reconcileFediverseFeed(current, [
        post('newest', '2026-10-12T10:00:00Z'),
        post('old-a', '2026-10-10T10:00:00Z', content: 'edited'),
      ]);

      expect(result.visible.map((p) => p['uri']), ['old-a', 'old-b']);
      expect(result.visible.first['content'], 'edited');
      expect(result.pending.map((p) => p['uri']), ['newest']);
    });

    test('deduplicates incoming posts and excludes tombstones', () {
      final result = reconcileFediverseFeed([], [
        post('same', '2026-10-12T10:00:00Z'),
        post('same', '2026-10-12T10:00:00Z', content: 'duplicate'),
        {
          'uri': 'deleted',
          'published_at': '2026-10-12T11:00:00Z',
          'tombstone': true,
        },
      ]);
      expect(result.pending, hasLength(1));
      expect(result.pending.single['uri'], 'same');
    });

    test('applies pending items newest-first without duplicating visible rows',
        () {
      final result = applyPendingFediversePosts(
        [post('visible', '2026-10-10T10:00:00Z')],
        [
          post('older-new', '2026-10-11T10:00:00Z'),
          post('newest', '2026-10-12T10:00:00Z'),
          post('visible', '2026-10-09T10:00:00Z'),
        ],
      );
      expect(result.map((p) => p['uri']), ['newest', 'older-new', 'visible']);
    });
  });

  group('normalizeFederatedMediaUrl', () {
    test('trims and upgrades HTTPS-capable HTTP and protocol-relative links', () {
      expect(
        normalizeFederatedMediaUrl('  https://cdn.example/media.jpg#preview  '),
        'https://cdn.example/media.jpg',
      );
      expect(
        normalizeFederatedMediaUrl('http://cdn.example/media.jpg'),
        'https://cdn.example/media.jpg',
      );
      expect(
        normalizeFederatedMediaUrl('//cdn.example/media.jpg'),
        'https://cdn.example/media.jpg',
      );
    });

    test('falls back through ActivityPub URL candidates', () {
      expect(
        normalizeFederatedMediaUrl({
          'href': '',
          'url': [
            {'type': 'Link', 'href': 'https://cdn.example/remote.webp'},
          ],
        }),
        'https://cdn.example/remote.webp',
      );
    });

    test('rejects non-web schemes and credential-bearing URLs', () {
      expect(normalizeFederatedMediaUrl('javascript:alert(1)'), isNull);
      expect(
        normalizeFederatedMediaUrl('https://user:pass@cdn.example/a.jpg'),
        isNull,
      );
    });
  });
}
