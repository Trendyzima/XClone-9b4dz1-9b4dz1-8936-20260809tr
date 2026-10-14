import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/discovery/unified_search_policy.dart';

void main() {
  group('UnifiedSearchPolicy', () {
    test('normalizes all unified result groups and ignores malformed rows', () {
      final result = UnifiedSearchPolicy.normalize({
        'users': [
          {'id': 'user-1', 'username': 'trendy'},
          'bad',
        ],
        'posts': [
          {'id': 'post-1', 'content': 'Hello'},
        ],
        'hashtags': null,
        'next_cursor': 42,
      });
      expect(result['users'], hasLength(1));
      expect(result['posts'], hasLength(1));
      expect(result['hashtags'], isEmpty);
      expect(result['threads'], isEmpty);
      expect(result['next_cursor'], isNull);
    });

    test('preserves server pagination cursors returned as numbers or strings', () {
      expect(UnifiedSearchPolicy.normalize({'next_cursor': 40})['next_cursor'], '40');
      expect(UnifiedSearchPolicy.normalize({'next_cursor': '80'})['next_cursor'], '80');
      expect(UnifiedSearchPolicy.normalize({'next_cursor': {'bad': true}})['next_cursor'], isNull);
    });

    test('merges search pages without duplicating canonical remote objects', () {
      final first = UnifiedSearchPolicy.normalize({
        'posts': [
          {'id': 'local-1', 'content': 'Local post'},
          {'id': 'remote-1', 'uri': 'https://social.example/@a/1', 'content': 'Remote post'},
        ],
        'next_cursor': '40',
      });
      final second = UnifiedSearchPolicy.normalize({
        'posts': [
          {'id': 'remote-duplicate', 'uri': 'https://social.example/@a/1', 'content': 'Duplicate'},
          {'id': 'local-2', 'content': 'Second local post'},
        ],
        'next_cursor': null,
      });

      final merged = UnifiedSearchPolicy.mergePage(first, second);
      expect(merged['posts'], hasLength(3));
      expect(merged['next_cursor'], isNull);
    });

    test('maps every tab to the server supported kind', () {
      expect(UnifiedSearchPolicy.kinds['Top'], 'all');
      expect(UnifiedSearchPolicy.kinds['People'], 'people');
      expect(UnifiedSearchPolicy.kinds['Latest'], 'latest');
      expect(UnifiedSearchPolicy.kinds['Replies'], 'replies');
      expect(UnifiedSearchPolicy.kinds['Fediverse'], 'fediverse');
      expect(UnifiedSearchPolicy.groupForTab('Communities'), 'communities');
    });

    test(
      'normalizes whitespace but preserves meaningful search characters',
      () {
        expect(
          UnifiedSearchPolicy.normalizeQuery('  #Nairobi   food  '),
          '#Nairobi food',
        );
        expect(
          UnifiedSearchPolicy.normalizeQuery('  @testagram  '),
          '@testagram',
        );
      },
    );

    test(
      'returns actionable auth, timeout, and missing-migration messages',
      () {
        expect(
          UnifiedSearchPolicy.errorMessage(Exception('JWT expired')),
          contains('session has expired'),
        );
        expect(
          UnifiedSearchPolicy.errorMessage(Exception('Request timed out')),
          contains('too long'),
        );
        expect(
          UnifiedSearchPolicy.errorMessage(
            Exception(
              'Could not find function public.testagram_search_unified',
            ),
          ),
          contains('migration must be applied'),
        );
      },
    );

    test('uses result names without assuming all fields are present', () {
      expect(
        UnifiedSearchPolicy.firstText(
          {'display_name': 'Test'},
          ['display_name', 'username'],
        ),
        'Test',
      );
      expect(
        UnifiedSearchPolicy.firstText({}, [
          'display_name',
        ], fallback: 'Unknown'),
        'Unknown',
      );
    });
  });
}
