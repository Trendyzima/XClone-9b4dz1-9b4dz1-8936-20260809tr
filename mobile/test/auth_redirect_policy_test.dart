import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/core/auth/auth_redirect_policy.dart';

void main() {
  group('AuthRedirectPolicy', () {
    test('preserves an internal deep route and query after sign-in', () {
      expect(
        AuthRedirectPolicy.safeReturnPath('/messages?thread=abc'),
        '/messages?thread=abc',
      );
    });

    test('falls back for empty or non-internal targets', () {
      expect(AuthRedirectPolicy.safeReturnPath(null), '/');
      expect(AuthRedirectPolicy.safeReturnPath(''), '/');
      expect(AuthRedirectPolicy.safeReturnPath('https://evil.test/path'), '/');
      expect(AuthRedirectPolicy.safeReturnPath('//evil.test/path'), '/');
      expect(AuthRedirectPolicy.safeReturnPath('javascript:alert(1)'), '/');
    });

    test('prevents auth and setup redirect loops', () {
      expect(
          AuthRedirectPolicy.safeReturnPath('/auth?returnTo=/messages'), '/');
      expect(AuthRedirectPolicy.safeReturnPath('/setup'), '/');
    });
  });
}
