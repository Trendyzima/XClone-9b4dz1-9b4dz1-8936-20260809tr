/// Canonical media URLs for feed rendering.
///
/// User-uploaded assets should travel through Testagram's first-party CDN;
/// this normalizer repairs the legacy CDN path without rewriting unrelated
/// external media hosts or inventing storage keys.
class FeedMediaUrl {
  const FeedMediaUrl._();

  static const cdnHost = 'media.testagram.site';

  static String? normalize(dynamic value) {
    if (value is! String) return null;
    final raw = value.trim();
    if (raw.isEmpty) return null;
    final parsed = Uri.tryParse(raw);
    if (parsed == null ||
        !parsed.hasAuthority ||
        (parsed.scheme != 'https' && parsed.scheme != 'http') ||
        parsed.userInfo.isNotEmpty) {
      return null;
    }

    var uri = parsed;
    if (uri.scheme == 'http') uri = uri.replace(scheme: 'https');
    if (uri.host.toLowerCase() == cdnHost && uri.path.startsWith('/users/')) {
      uri = uri.replace(path: '/media${uri.path}');
    }
    return uri.toString();
  }
}
