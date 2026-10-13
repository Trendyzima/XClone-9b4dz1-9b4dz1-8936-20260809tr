/// Converts untrusted ActivityPub/Mastodon HTML into plain display text.
/// The UI renders the result as Text, never as executable HTML.
String normalizeFederatedContent(String value) => value
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
