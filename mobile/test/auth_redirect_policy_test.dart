import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/core/auth/auth_redirect_policy.dart';

void main() {
  group('AuthRedirectPolicy', () {
    test('preserves an internal deep route and query after sign-in', () {
      expect(AuthRedirectPolicy.safeReturnPath('/messages?thread=abc'), '/messages?thread=abc');
    });

    test('falls back for empty or non-internal targets', () {
      expect(AuthRedirectPolicy.safeReturnPath(null), '/');
      expect(AuthRedirectPolicy.safeReturnPath(''), '/');
      expect(AuthRedirectPolicy.safeReturnPath('https://evil.test/path'), '/');
      expect(AuthRedirectPolicy.safeReturnPath('//evil.test/path'), '/');
      expect(AuthRedirectPolicy.safeReturnPath('javascript:alert(1)'), '/');
    });

    test('allows public Android shared-link routes before sign-in', () {
      const publicRoutes = [
        '/',
        '/post/123',
        '/post-remote',
        '/post-remote/replies',
        '/profile/alice',
        '/thread/thread-1',
        '/channel/news',
        '/stream/live-1',
        '/space/space-1',
        '/spaces',
        '/videos',
        '/shorts',
        '/hashtag/flutter',
        '/c/community',
        '/p/product-1',
        '/search?q=test',
      ];

      for (final route in publicRoutes) {
        final path = Uri.parse(route).path;
        expect(
          AuthRedirectPolicy.isPublicRoute(path),
          isTrue,
          reason: '$route should be accessible before sign-in',
        );
      }
    });

    test('keeps private routes and similarly named paths protected', () {
      const privateRoutes = ['/messages', '/wallet', '/settings', '/channel-admin', '/streaming'];

      for (final route in privateRoutes) {
        expect(
          AuthRedirectPolicy.isPublicRoute(route),
          isFalse,
          reason: '$route must not become public accidentally',
        );
      }
    });

    test('prevents auth and setup redirect loops', () {
      expect(AuthRedirectPolicy.safeReturnPath('/auth?returnTo=/messages'), '/');
      expect(AuthRedirectPolicy.safeReturnPath('/setup'), '/');
    });
  });
}
