/// Defensive normalization for the JSONB payload returned by
/// public.testagram_search_unified. Never assumes that a result group exists.
class UnifiedSearchPolicy {
  static const kinds = <String, String>{
    'Top': 'all',
    'Latest': 'latest',
    'People': 'people',
    'Posts': 'posts',
    'Media': 'media',
    'Hashtags': 'hashtags',
    'Replies': 'replies',
    'Threads': 'threads',
    'Communities': 'communities',
    'Fediverse': 'fediverse',
  };

  static Map<String, dynamic> normalize(Object? value) {
    final raw = value is Map ? value : const <Object?, Object?>{};
    return <String, dynamic>{
      for (final key in const [
        'users',
        'hashtags',
        'posts',
        'threads',
        'communities',
        'replies',
        'fediverse',
      ])
        key: raw[key] is List
            ? (raw[key] as List)
                .whereType<Map>()
                .map((row) => Map<String, dynamic>.from(row))
                .toList(growable: false)
            : <Map<String, dynamic>>[],
      'next_cursor': raw['next_cursor'] is String ? raw['next_cursor'] : null,
    };
  }

  static String normalizeQuery(String raw) =>
      raw.trim().replaceAll(RegExp(r'\s+'), ' ');

  static String errorMessage(Object error) {
    final text = error.toString();
    final lower = text.toLowerCase();
    if (lower.contains('jwt') ||
        lower.contains('unauthorized') ||
        lower.contains('not authenticated') ||
        lower.contains('authentication required') ||
        lower.contains('401')) {
      return 'Your session has expired. Sign in again, then retry your search.';
    }
    if (lower.contains('permission denied') || lower.contains('403')) {
      return 'Your account cannot access search right now. Check your sign-in and try again.';
    }
    if (lower.contains('testagram_search_unified') &&
        (lower.contains('not found') ||
            lower.contains('could not find the function') ||
            lower.contains('could not find function') ||
            lower.contains('does not exist') ||
            lower.contains('404'))) {
      return 'Unified search is not available on the server yet. The search database migration must be applied.';
    }
    if (lower.contains('timeout') || lower.contains('timed out')) {
      return 'Search took too long. Check your connection and retry.';
    }
    if (lower.contains('socket') ||
        lower.contains('network') ||
        lower.contains('connection')) {
      return 'Could not connect to Testagram. Check your connection and retry.';
    }
    return 'Search could not be completed. Please retry. If this continues, the search service needs investigation.';
  }

  static String firstText(
    Map<String, dynamic> row,
    List<String> keys, {
    String fallback = '',
  }) {
    for (final key in keys) {
      final value = row[key];
      if (value is String && value.trim().isNotEmpty) return value.trim();
      if (value is num) return '$value';
    }
    return fallback;
  }

  static String groupForTab(String tab) {
    switch (tab) {
      case 'People':
        return 'users';
      case 'Posts':
      case 'Media':
      case 'Latest':
        return 'posts';
      case 'Hashtags':
        return 'hashtags';
      case 'Replies':
        return 'replies';
      case 'Threads':
        return 'threads';
      case 'Communities':
        return 'communities';
      case 'Fediverse':
        return 'fediverse';
      default:
        return 'all';
    }
  }
}
