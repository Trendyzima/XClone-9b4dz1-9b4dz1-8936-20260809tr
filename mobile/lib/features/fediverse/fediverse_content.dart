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
