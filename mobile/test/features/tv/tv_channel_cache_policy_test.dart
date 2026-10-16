import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/tv/tv_channel_cache_policy.dart';

void main() {
  final now = DateTime.utc(2026, 10, 14, 12);

  Map<String, dynamic> channel({
    String url = 'https://streams.example/live.m3u8',
    String id = 'channel-1',
    String sourceType = 'catalog',
  }) =>
      {
        'id': id,
        'title': 'Test channel',
        'description': 'Public channel',
        'playback_url': url,
        'thumbnail_url': 'https://images.example/logo.png',
        '_sourceType': sourceType,
      };

  test('persists only public HTTPS catalogue URLs without signed credentials', () {
    final safe = TvChannelCachePolicy.sanitizeChannels([
      channel(),
      channel(id: 'signed', url: 'https://streams.example/live.m3u8?token=secret'),
      channel(id: 'http', url: 'http://streams.example/live.m3u8'),
      channel(id: 'user', sourceType: 'testagram-live'),
    ]);
    expect(safe, hasLength(1));
    expect(safe.single['id'], 'channel-1');
    expect(jsonEncode(safe), isNot(contains('secret')));
  });

  test('round trips cached channels within the TTL', () {
    final encoded = TvChannelCachePolicy.encode([channel()], now: now);
    expect(encoded, isNotNull);
    final decoded = TvChannelCachePolicy.decode(encoded, now: now.add(const Duration(hours: 1)));
    expect(decoded, hasLength(1));
    expect(decoded.single['playback_url'], 'https://streams.example/live.m3u8');
  });

  test('rejects expired, future-dated, malformed and oversized cache entries', () {
    final encoded = TvChannelCachePolicy.encode([channel()], now: now)!;
    expect(TvChannelCachePolicy.decode(encoded, now: now.add(const Duration(hours: 25))), isEmpty);
    expect(
      TvChannelCachePolicy.decode(encoded, now: now.subtract(const Duration(hours: 1))),
      isEmpty,
    );
    expect(TvChannelCachePolicy.decode('{not json', now: now), isEmpty);
    expect(
      TvChannelCachePolicy.decode(
        List.filled(TvChannelCachePolicy.maxEncodedBytes + 1, 'x').join(),
        now: now,
      ),
      isEmpty,
    );
  });

  test('caps the number of persisted channels and rejects URL credentials', () {
    final rows = List.generate(300, (index) => channel(id: 'channel-$index'));
    expect(TvChannelCachePolicy.sanitizeChannels(rows), hasLength(250));
    expect(
      TvChannelCachePolicy.isPublicCacheUrl('https://user:pass@streams.example/live.m3u8'),
      isFalse,
    );
    expect(
      TvChannelCachePolicy.isPublicCacheUrl(
        'https://streams.example/live.m3u8?X-Amz-Signature=secret',
      ),
      isFalse,
    );
  });
}
