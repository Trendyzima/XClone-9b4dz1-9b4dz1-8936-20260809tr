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
    'Instances': 'instances',
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
        'instances',
      ])
        key: raw[key] is List
            ? (raw[key] as List)
                  .whereType<Map>()
                  .map((row) => Map<String, dynamic>.from(row))
                  .toList(growable: false)
            : <Map<String, dynamic>>[],
      'next_cursor': raw['next_cursor'] is String || raw['next_cursor'] is num
          ? '${raw['next_cursor']}'
          : null,
    };
  }

  /// Merge a paginated response without repeating rows already rendered.
  /// Remote objects prefer their canonical URI; local rows fall back to IDs.
  static Map<String, dynamic> mergePage(
    Map<String, dynamic> current,
    Map<String, dynamic> page,
  ) {
    String identity(String group, Map<String, dynamic> row) {
      if (group == 'users' &&
          (row['origin'] == 'fediverse' ||
              row['actor_uri'] != null ||
              row['actor_url'] != null)) {
        final username = firstText(row, [
          'username',
          'preferredUsername',
        ]).replaceFirst(RegExp(r'^@'), '').toLowerCase();
        final actor = firstText(row, ['actor_uri', 'actor_url', 'url']);
        final host =
            Uri.tryParse(actor)?.host.toLowerCase() ??
            firstText(row, ['domain']).toLowerCase();
        if (username.isNotEmpty && host.isNotEmpty) {
          final canonicalHost = host.startsWith('www.')
              ? host.substring(4)
              : host;
          return '$group:remote:$username@$canonicalHost';
        }
      }
      final canonical = firstText(row, [
        'uri',
        'remote_status_uri',
        if (row['is_federated'] == true) 'id',
        if (group == 'users') 'actor_uri',
        if (group == 'users') 'actor_url',
      ]);
      if (canonical.isNotEmpty) return '$group:$canonical'.toLowerCase();
      if (group == 'users') {
        final username = firstText(row, ['username', 'preferredUsername']);
        if (username.isNotEmpty) return '$group:${username.toLowerCase()}';
      }
      if (group == 'hashtags') {
        final tag = firstText(row, [
          'tag',
          'name',
        ]).replaceFirst(RegExp(r'^#'), '');
        if (tag.isNotEmpty) return '$group:${tag.toLowerCase()}';
      }
      final id = firstText(row, ['id']);
      return id.isEmpty ? '$group:${row.hashCode}' : '$group:$id';
    }

    final merged = <String, dynamic>{};
    for (final group in const [
      'users',
      'hashtags',
      'posts',
      'threads',
      'communities',
      'replies',
      'fediverse',
      'instances',
    ]) {
      final rows = <Map<String, dynamic>>[];
      final seen = <String>{};
      for (final row in [
        ...((current[group] as List<Map<String, dynamic>>?) ?? const []),
        ...((page[group] as List<Map<String, dynamic>>?) ?? const []),
      ]) {
        if (seen.add(identity(group, row))) rows.add(row);
      }
      merged[group] = rows;
    }
    merged['next_cursor'] = page['next_cursor'];
    return merged;
  }

  static List<Map<String, dynamic>> sortRows(
    List<Map<String, dynamic>> rows,
    String sort, {
    bool forceLatest = false,
  }) {
    final sorted = List<Map<String, dynamic>>.of(rows);
    DateTime dateOf(Map<String, dynamic> row) {
      final value = firstText(row, [
        'created_at',
        'published_at',
        'updated_at',
      ]);
      return DateTime.tryParse(value)?.toUtc() ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
    }

    num numberOf(Map<String, dynamic> row, List<String> keys) {
      for (final key in keys) {
        final value = row[key];
        if (value is num) return value;
        if (value is String) {
          final parsed = num.tryParse(value);
          if (parsed != null) return parsed;
        }
      }
      return 0;
    }

    if (forceLatest || sort == 'Latest') {
      sorted.sort((a, b) => dateOf(b).compareTo(dateOf(a)));
    } else if (sort == 'Most liked') {
      sorted.sort(
        (a, b) => numberOf(b, [
          'likes_count',
          'like_count',
        ]).compareTo(numberOf(a, ['likes_count', 'like_count'])),
      );
    } else if (sort == 'Most viewed') {
      sorted.sort(
        (a, b) => numberOf(b, [
          'views_count',
          'view_count',
        ]).compareTo(numberOf(a, ['views_count', 'view_count'])),
      );
    }
    return sorted;
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
      case 'Instances':
        return 'instances';
      default:
        return 'all';
    }
  }
}
