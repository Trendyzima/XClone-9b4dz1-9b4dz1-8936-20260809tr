/// Converts untrusted ActivityPub/Mastodon HTML into safe display text.
///
/// Anchor destinations are retained as text so link-only posts do not lose the
/// actual article URL when HTML is normalized. The caller renders plain text,
/// never remote HTML.
String normalizeFederatedContent(String value) {
  final withLinks = value.replaceAllMapped(
    RegExp(
      r"""<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>""",
      caseSensitive: false,
      dotAll: true,
    ),
    (match) {
      final href = (match.group(1) ?? '').replaceAll('&amp;', '&').trim();
      final label = (match.group(2) ?? '')
          .replaceAll(RegExp(r'<[^>]*>'), '')
          .replaceAll('&amp;', '&')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&quot;', '"')
          .replaceAll('&#39;', "'")
          .trim();
      if (href.isEmpty) return label;
      if (label.isEmpty || label == href) return href;
      return '$label ($href)';
    },
  );
  return withLinks
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</p\s*>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]*>'), '')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&nbsp;', ' ')
      .trim();
}

/// Finds and canonicalizes a public HTTP(S) media URL in ActivityPub attachment
/// shapes. Servers commonly return a list of Link objects rather than a string;
/// try each candidate instead of letting an empty/invalid `href` mask a valid
/// `url` or `id`. The media proxy only fetches HTTPS, so HTTP and protocol-
/// relative links are upgraded rather than fetched insecurely.
String? normalizeFederatedMediaUrl(dynamic value) {
  if (value is String) {
    var candidate = value.trim();
    if (candidate.isEmpty) return null;
    if (candidate.startsWith('//')) candidate = 'https:$candidate';
    final parsed = Uri.tryParse(candidate);
    if (parsed == null || parsed.host.isEmpty || parsed.userInfo.isNotEmpty) {
      return null;
    }
    final scheme = parsed.scheme.toLowerCase();
    if (scheme != 'http' && scheme != 'https') return null;
    return parsed.replace(scheme: 'https').removeFragment().toString();
  }
  if (value is List) {
    for (final item in value) {
      final resolved = normalizeFederatedMediaUrl(item);
      if (resolved != null) return resolved;
    }
  }
  if (value is Map) {
    for (final key in const ['href', 'url', 'id', 'preview_url', 'mediaUrl']) {
      final resolved = normalizeFederatedMediaUrl(value[key]);
      if (resolved != null) return resolved;
    }
  }
  return null;
}
