/// Keeps post-auth navigation inside the Flutter application and prevents
/// redirects back into auth/setup loops or external URLs.
class AuthRedirectPolicy {
  const AuthRedirectPolicy._();

  /// Routes that can safely be opened before authentication.
  ///
  /// Keep public shared-link destinations here so Android App Links and web
  /// navigation behave consistently for signed-out users.
  static bool isPublicRoute(String path) {
    return path == '/' ||
        path == '/explore' ||
        path == '/search' ||
        path == '/discover' ||
        path.startsWith('/discover/') ||
        path == '/tv' ||
        path == '/iptv' ||
        path == '/tv/channels' ||
        path == '/tv/reels' ||
        path.startsWith('/channel/') ||
        path.startsWith('/stream/') ||
        path == '/shop' ||
        path == '/fediverse/feed' ||
        path == '/fediverse/discover' ||
        path == '/fediverse/organic-discovery' ||
        path == '/videos' ||
        path == '/shorts' ||
        path == '/videos/watchlater' ||
        path == '/hashtags' ||
        path.startsWith('/hashtag/') ||
        path == '/leaderboard' ||
        path == '/leaderboard/creators' ||
        path == '/news' ||
        path.startsWith('/news/') ||
        path == '/sports' ||
        path.startsWith('/post/') ||
        path == '/post-remote' ||
        path.startsWith('/post-remote/') ||
        path == '/fediverse' ||
        path == '/fediverse/instances' ||
        path == '/spaces' ||
        path.startsWith('/spaces/') ||
        path.startsWith('/space/') ||
        path.startsWith('/space-recording/') ||
        path == '/products' ||
        path == '/marketplace' ||
        path.startsWith('/p/') ||
        path == '/threads' ||
        path == '/communities' ||
        path.startsWith('/thread/') ||
        path.startsWith('/c/') ||
        path.startsWith('/profile/');
  }

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
