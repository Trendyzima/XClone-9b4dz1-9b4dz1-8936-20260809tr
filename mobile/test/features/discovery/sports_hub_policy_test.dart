import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/discovery/sports_hub_policy.dart';

void main() {
  group('SportsHubPolicy', () {
    test('flattens direct match lists and ignores malformed entries', () {
      final matches = SportsHubPolicy.flattenMatches({
        'matches': [
          {'homeTeam': 'A', 'awayTeam': 'B'},
          'invalid',
          null,
        ],
      });
      expect(matches, hasLength(1));
      expect(SportsHubPolicy.team(matches.single, 'home'), 'A');
    });

    test('flattens league-nested match payloads', () {
      final matches = SportsHubPolicy.flattenMatches({
        'leagues': [
          {
            'matches': [
              {
                'home': {'name': 'Lions'},
                'away': 'Tigers',
              },
            ],
          },
        ],
      });
      expect(matches, hasLength(1));
      expect(SportsHubPolicy.team(matches.single, 'home'), 'Lions');
      expect(SportsHubPolicy.team(matches.single, 'away'), 'Tigers');
    });

    test('normalizes score and match status aliases', () {
      expect(
        SportsHubPolicy.score({
          'score': {'home': 2},
        }, 'home'),
        '2',
      );
      expect(SportsHubPolicy.status({'matchStatus': 'Live'}), 'Live');
      expect(SportsHubPolicy.isLive('1st half'), isTrue);
      expect(SportsHubPolicy.isFinished('FT'), isTrue);
    });

    test('uses deterministic upcoming classification and dates', () {
      final now = DateTime.utc(2026, 10, 14);
      expect(SportsHubPolicy.isUpcoming({'status': 'Fixture'}, now), isTrue);
      expect(SportsHubPolicy.isUpcoming({'status': 'FT'}, now), isFalse);
      expect(SportsHubPolicy.isUpcoming({'date': '2026-10-15T10:00:00Z'}, now), isTrue);
    });

    test('only allows safe absolute HTTP article URLs', () {
      expect(SportsHubPolicy.safeArticleUri('https://publisher.example/story'), isNotNull);
      expect(SportsHubPolicy.safeArticleUri('javascript:alert(1)'), isNull);
      expect(SportsHubPolicy.safeArticleUri('https://user:secret@publisher.example/'), isNull);
      expect(SportsHubPolicy.safeArticleUri('http://127.0.0.1/internal'), isNull);
      expect(SportsHubPolicy.safeArticleUri('/relative/story'), isNull);
    });
  });
}
