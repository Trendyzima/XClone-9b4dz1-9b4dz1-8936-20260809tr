import 'dart:convert';

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
      expect(
        SponsoredAd.tryParse({'kind': 'no_fill', 'requestId': 'req-1'}),
        isNull,
      );
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
          'keywords': ['creator']
        },
      );
      expect(ad, isNotNull);
      expect(captured.url.path, '/functions/v1/zenad-decision');
      expect(captured.headers['apikey'], 'public-key');
      expect(jsonDecode(captured.body)['slotCode'], 'feed-inline');
      service.close();
    });

    test('fails closed on no-fill and HTTP failures', () async {
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: MockClient(
            (request) async => http.Response('{"kind":"no_fill"}', 200)),
      );
      expect(await service.requestAd(slotCode: 'feed-inline'), isNull);
      service.close();
    });

    test('posts signed viewable and click events to event endpoint', () async {
      late http.Request captured;
      final service = SponsoredAdService(
        supabaseUrl: 'https://project.supabase.co',
        publishableKey: 'public-key',
        httpClient: MockClient((request) async {
          captured = request;
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
      expect(
        await service.recordEvent(ad: ad, eventType: 'viewable'),
        isTrue,
      );
      expect(captured.url.path, '/functions/v1/zenad-event');
      expect(jsonDecode(captured.body)['eventToken'], 'signed-token');
      service.close();
    });
  });
}
