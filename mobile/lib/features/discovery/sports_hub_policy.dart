/// Normalizes the provider's flexible score payload without assuming a single
/// SportScore response schema. This is presentation policy, not score authority.
class SportsHubPolicy {
  static Map<String, dynamic>? _record(Object? value) =>
      value is Map ? Map<String, dynamic>.from(value) : null;

  static String display(Object? value) {
    if (value is String || value is num) return '$value';
    final map = _record(value);
    if (map == null) return '';
    for (final key in ['name', 'title', 'shortName', 'displayName', 'score', 'text', 'value']) {
      final item = map[key];
      if (item is String || item is num) return '$item';
    }
    return '';
  }

  static List<Map<String, dynamic>> flattenMatches(Object? data) {
    final root = _record(data);
    if (root == null) return const [];
    for (final key in ['matches', 'events', 'items']) {
      final value = root[key];
      if (value is List) {
        return value.map(_record).whereType<Map<String, dynamic>>().toList();
      }
    }
    final leagues = root['leagues'];
    if (leagues is List) {
      return leagues
          .map(_record)
          .whereType<Map<String, dynamic>>()
          .expand(
            (league) => league['matches'] is List
                ? (league['matches'] as List).map(_record).whereType<Map<String, dynamic>>()
                : const <Map<String, dynamic>>[],
          )
          .toList();
    }
    return const [];
  }

  static String team(Map<String, dynamic> match, String side) {
    final keys = side == 'home'
        ? ['homeTeam', 'home', 'home_team', 'homeTeamName', 'home_name']
        : ['awayTeam', 'away', 'away_team', 'awayTeamName', 'away_name'];
    for (final key in keys) {
      final value = match[key];
      if (value != null) {
        final text = display(value).trim();
        if (text.isNotEmpty) return text;
      }
    }
    return side == 'home' ? 'Home' : 'Away';
  }

  static String score(Map<String, dynamic> match, String side) {
    final keys = side == 'home'
        ? ['homeScore', 'home_score', 'homeGoals']
        : ['awayScore', 'away_score', 'awayGoals'];
    for (final key in keys) {
      if (match[key] != null) return display(match[key]);
    }
    final nested = _record(match['score']);
    return nested == null ? '' : display(nested[side]);
  }

  static String status(Map<String, dynamic> match) {
    for (final key in ['status', 'state', 'matchStatus', 'time', 'minute', 'date']) {
      final value = match[key];
      if (value != null && display(value).trim().isNotEmpty) {
        return display(value).trim();
      }
    }
    return 'Fixture';
  }

  static bool isLive(String status) => RegExp(
        r'live|in.?play|half.?time|\bht\b|1st half|2nd half|\b[12]h\b|quarter|\bq[1-4]\b|set [1-5]|innings',
        caseSensitive: false,
      ).hasMatch(status);

  static bool isFinished(String status) => RegExp(
        r'^(ft|aet|pen|finished|full.?time|completed|ended|final|after extra time|after penalties)$',
        caseSensitive: false,
      ).hasMatch(status.trim());

  static bool isUpcoming(Map<String, dynamic> match, DateTime now) {
    final current = status(match);
    if (isLive(current) || isFinished(current)) return false;
    if (RegExp(
      r'scheduled|fixture|upcoming|not started|kick.?off|\btbd\b|^ns$|pre.?match|time to start',
      caseSensitive: false,
    ).hasMatch(current)) {
      return true;
    }
    for (final key in [
      'startTime',
      'start_time',
      'kickoff',
      'kickoffTime',
      'matchDate',
      'dateTime',
      'datetime',
      'date',
      'timestamp',
    ]) {
      final raw = display(match[key]);
      final parsed = DateTime.tryParse(raw);
      if (parsed != null) return parsed.isAfter(now);
    }
    return false;
  }

  static Uri? safeArticleUri(Object? value) {
    final uri = Uri.tryParse(value is String ? value.trim() : '');
    if (uri == null ||
        !{'http', 'https'}.contains(uri.scheme.toLowerCase()) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return null;
    }
    final host = uri.host.toLowerCase();
    if (host == 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host == '::1' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        RegExp(r'^172\.(1[6-9]|2[0-9]|3[01])\.').hasMatch(host)) {
      return null;
    }
    return uri;
  }
}
