/// Keeps post-auth navigation inside the Flutter application and prevents
/// redirects back into auth/setup loops or external URLs.
class AuthRedirectPolicy {
  const AuthRedirectPolicy._();

  static String safeReturnPath(String? candidate) {
    if (candidate == null || candidate.isEmpty || !candidate.startsWith('/')) {
      return '/';
    }
    if (candidate.startsWith('//') ||
        candidate.contains('\\') ||
        candidate.contains('\u0000')) {
      return '/';
    }
    final uri = Uri.tryParse(candidate);
    if (uri == null || uri.hasScheme || uri.hasAuthority) return '/';
    if (uri.path == '/auth' || uri.path == '/setup') return '/';
    return uri.toString();
  }
}
