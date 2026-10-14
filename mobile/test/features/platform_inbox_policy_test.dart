import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/messages/platform_inbox_policy.dart';

void main() {
  group('PlatformInboxPolicy.matchesFilter', () {
    const unread = <String, dynamic>{'type': 'payment', 'read': false};
    const read = <String, dynamic>{'type': 'trending', 'read': true};

    test('all includes read and unread messages', () {
      expect(PlatformInboxPolicy.matchesFilter(unread, 'all'), isTrue);
      expect(PlatformInboxPolicy.matchesFilter(read, 'all'), isTrue);
    });

    test('unread and type filters are distinct', () {
      expect(PlatformInboxPolicy.matchesFilter(unread, 'unread'), isTrue);
      expect(PlatformInboxPolicy.matchesFilter(read, 'unread'), isFalse);
      expect(PlatformInboxPolicy.matchesFilter(unread, 'payment'), isTrue);
      expect(PlatformInboxPolicy.matchesFilter(unread, 'trending'), isFalse);
    });
  });

  test('counts unread only', () {
    expect(PlatformInboxPolicy.unreadCount([
      {'read': false}, {'read': true}, {},
    ]), 2);
  });

  group('safeInternalPath', () {
    test('accepts safe same-origin app routes and query strings', () {
      expect(PlatformInboxPolicy.safeInternalPath('/wallet'), '/wallet');
      expect(PlatformInboxPolicy.safeInternalPath('/profile/alex?tab=posts'), '/profile/alex?tab=posts');
    });

    test('rejects absolute, protocol-relative and malformed external paths', () {
      expect(PlatformInboxPolicy.safeInternalPath('https://attacker.example'), isNull);
      expect(PlatformInboxPolicy.safeInternalPath('//attacker.example/path'), isNull);
      expect(PlatformInboxPolicy.safeInternalPath('/\\\\attacker.example'), isNull);
      expect(PlatformInboxPolicy.safeInternalPath(null), isNull);
    });
  });
}
