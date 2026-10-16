import 'dart:convert';
import 'dart:ui' show Rect, Size;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:testagram/features/feed/sponsored_ad_service.dart';

void main() {
  group('SponsoredAd.tryParse', () {
    test('accepts a valid sponsored display decision', () {
      final ad = SponsoredAd.tryParse({
        'kind': 'display',
        'sponsored': true,
        'requestId': 'req-1',
        'impressionId': 'imp-1',
        'eventToken': 'signed-token',
        'headline': 'Testagram for creators',
        'body': 'Reach your community',
        'imageUrl': 'https://cdn.example/ad.png',
        'clickThroughUrl': 'https://testagram.site/advertise',
      });
      expect(ad, isNotNull);
      expect(ad!.impressionId, 'imp-1');
      expect(ad.sponsored, isTrue);
      expect(ad.imageUrl, 'https://cdn.example/ad.png');
    });

    test('treats no-fill as no ad', () {
      expect(SponsoredAd.tryParse({'kind': 'no_fill', 'requestId': 'req-1'}), isNull);
    });

    test('rejects an unsigned or malformed display payload', () {
      expect(
        SponsoredAd.tryParse({
          'kind': 'display',
          'sponsored': true,
          'requestId': 'req-1',
          'impressionId': 'imp-1',
          'headline': 'Missing token',
        }),
        isNull,
      );
    });

    test('rejects an image-only creative when its image URL is unsafe', () {
      expect(
        SponsoredAd.tryParse({
          'kind': 'display',
          'sponsored': true,
          'requestId': 'req-1',
          'impressionId': 'imp-1',
          'eventToken': 'signed-token',
          'imageUrl': 'javascript:alert(1)',
        }),
        isNull,
      );
    });

    test('rejects non-http creative and click URLs', () {
      final ad = SponsoredAd.tryParse({
        'kind': 'display',
        'sponsored': true,
        'requestId': 'req-1',
        'impressionId': 'imp-1',
        'eventToken': 'signed-token',
        'headline': 'Safe links',
        'imageUrl': 'javascript:alert(1)',
        'clickThroughUrl': 'file:///etc/passwd',
      });
      expect(ad, isNotNull);
      expect(ad!.imageUrl, isNull);
      expect(ad.clickThroughUrl, isNull);
    });
  });

  group('sponsoredAdVisibleFraction', () {
    const viewport = Size(400, 800);

    test('counts a fully visible creative as fully visible', () {
      expect(sponsoredAdVisibleFraction(const Rect.fromLTWH(20, 100, 100, 100), viewport), 1);
    });

    test('reports the actual fraction when clipped at the viewport edge', () {
      expect(sponsoredAdVisibleFraction(const Rect.fromLTWH(-50, 100, 100, 100), viewport), 0.5);
      expect(
        sponsoredAdVisibleFraction(const Rect.fromLTWH(-60, 100, 100, 100), viewport),
        closeTo(0.4, 0.0001),
      );
    });

    test('returns zero for an offscreen creative or empty viewport', () {
      expect(sponsoredAdVisibleFraction(const Rect.fromLTWH(0, -120, 100, 100), viewport), 0);
      expect(sponsoredAdVisibleFraction(const Rect.fromLTWH(0, 0, 100, 100), Size.zero), 0);
    });
  });

  group('SponsoredAdService', () {
    test('requests the selected slot and parses a display response', () async {
      late http.Request captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'kind': 'display',
            'sponsored': true,
            'requestId': 'req-1',
            'impressionId': 'imp-1',
            'eventToken': 'signed-token',
            'headline': 'A sponsored story',
            'body': 'Contextual ad',
          }),
          200,
        );
      });
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: client,
      );
      final ad = await service.requestAd(
        slotCode: 'feed-inline',
        content: {
          'keywords': ['creator'],
        },
      );
      expect(ad, isNotNull);
      expect(captured.url.path, '/functions/v1/zenad-decision');
      expect(captured.headers['apikey'], 'public-key');
      expect(jsonDecode(captured.body)['slotCode'], 'feed-inline');
      expect(jsonDecode(captured.body)['user']['device'], isNotEmpty);
      service.close();
    });

    test('fails closed on no-fill and HTTP failures', () async {
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: MockClient((request) async => http.Response('{"kind":"no_fill"}', 200)),
      );
      expect(await service.requestAd(slotCode: 'feed-inline'), isNull);
      service.close();
    });

    test('posts signed events once per impression and event type', () async {
      final requests = <http.Request>[];
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: MockClient((request) async {
          requests.add(request);
          return http.Response('{"ok":true}', 200);
        }),
      );
      const ad = SponsoredAd(
        requestId: 'req-1',
        impressionId: 'imp-1',
        eventToken: 'signed-token',
        headline: 'Sponsored',
        body: '',
        sponsored: true,
      );
      expect(await service.recordEvent(ad: ad, eventType: 'viewable'), isTrue);
      expect(await service.recordEvent(ad: ad, eventType: 'viewable'), isTrue);
      expect(requests, hasLength(1));
      expect(requests.single.url.path, '/functions/v1/zenad-event');
      expect(jsonDecode(requests.single.body)['eventToken'], 'signed-token');

      expect(await service.recordEvent(ad: ad, eventType: 'click'), isTrue);
      expect(requests, hasLength(2));
      expect(jsonDecode(requests.last.body)['eventType'], 'click');
      service.close();
    });

    test('coalesces concurrent duplicate events into one request', () async {
      var requestCount = 0;
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: MockClient((request) async {
          requestCount++;
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return http.Response('{"ok":true}', 200);
        }),
      );
      const ad = SponsoredAd(
        requestId: 'req-1',
        impressionId: 'imp-concurrent',
        eventToken: 'signed-token',
        headline: 'Sponsored',
        body: '',
        sponsored: true,
      );

      final results = await Future.wait([
        service.recordEvent(ad: ad, eventType: 'viewable'),
        service.recordEvent(ad: ad, eventType: 'viewable'),
        service.recordEvent(ad: ad, eventType: 'viewable'),
      ]);
      expect(results, everyElement(isTrue));
      expect(requestCount, 1);
      service.close();
    });

    test('allows retry after an event request fails', () async {
      var requestCount = 0;
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: MockClient((request) async {
          requestCount++;
          return http.Response('{"ok":true}', requestCount == 1 ? 503 : 200);
        }),
      );
      const ad = SponsoredAd(
        requestId: 'req-1',
        impressionId: 'imp-retry',
        eventToken: 'signed-token',
        headline: 'Sponsored',
        body: '',
        sponsored: true,
      );

      expect(await service.recordEvent(ad: ad, eventType: 'viewable'), isFalse);
      expect(await service.recordEvent(ad: ad, eventType: 'viewable'), isTrue);
      expect(requestCount, 2);
      service.close();
    });
  });
}
