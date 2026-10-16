import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'sports_hub_policy.dart';

class SportsHubPage extends StatefulWidget {
  const SportsHubPage({super.key});

  @override
  State<SportsHubPage> createState() => _SportsHubPageState();
}

class _SportsHubPageState extends State<SportsHubPage> {
  static const _sports = <(String, String, String)>[
    ('football', 'Football', '⚽'),
    ('basketball', 'Basketball', '🏀'),
    ('cricket', 'Cricket', '🏏'),
    ('tennis', 'Tennis', '🎾'),
  ];

  SupabaseClient get _db => Supabase.instance.client;
  String _sport = 'football';
  String _matchFilter = 'all';
  String _storyFilter = 'all';
  String _query = '';
  List<Map<String, dynamic>> _matches = [];
  List<Map<String, dynamic>> _stories = [];
  bool _scoresLoading = true;
  bool _storiesLoading = true;
  bool _refreshing = false;
  String? _scoresError;
  String? _storiesError;
  Timer? _refreshTimer;
  int _scoresRequestId = 0;
  int _storiesRequestId = 0;

  @override
  void initState() {
    super.initState();
    _loadScores();
    _loadStories();
    _refreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) unawaited(_loadScores(manual: true));
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadScores({bool manual = false}) async {
    if (!mounted) return;
    final requestId = ++_scoresRequestId;
    setState(() {
      _scoresError = null;
      _scoresLoading = !manual && _matches.isEmpty;
      _refreshing = manual;
    });
    try {
      final response = await _db.functions
          .invoke(
            'testagram-sports',
            method: HttpMethod.get,
            queryParameters: {
              'kind': 'matches',
              'sport': _sport,
              'limit': '30',
            },
          )
          .timeout(const Duration(seconds: 12));
      final payload = response.data;
      if (response.status < 200 ||
          response.status >= 300 ||
          payload is! Map ||
          payload['ok'] != true) {
        throw const FormatException('Scores are temporarily unavailable.');
      }
      final next = SportsHubPolicy.flattenMatches(payload['data']);
      if (mounted && requestId == _scoresRequestId) {
        setState(() => _matches = next);
      }
    } catch (_) {
      if (mounted && requestId == _scoresRequestId) {
        setState(
          () => _scoresError = 'Scores could not be refreshed. Your last loaded scores are kept; please retry.',
        );
      }
    } finally {
      if (mounted && requestId == _scoresRequestId) {
        setState(() {
          _scoresLoading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _loadStories() async {
    if (!mounted) return;
    final requestId = ++_storiesRequestId;
    setState(() {
      _storiesError = null;
      _storiesLoading = _stories.isEmpty;
    });
    try {
      final response = await _db.functions
          .invoke(
            'testagram-rss-feed',
            method: HttpMethod.get,
            queryParameters: {'limit': '20', 'category': 'sports'},
          )
          .timeout(const Duration(seconds: 15));
      final payload = response.data;
      if (response.status < 200 || response.status >= 300 || payload is! Map) {
        throw const FormatException(
          'Sports headlines are temporarily unavailable.',
        );
      }
      final raw = payload['items'];
      final next = raw is List
          ? raw.whereType<Map>().map(Map<String, dynamic>.from).toList()
          : <Map<String, dynamic>>[];
      if (mounted && requestId == _storiesRequestId) {
        setState(() => _stories = next);
      }
    } catch (_) {
      if (mounted && requestId == _storiesRequestId) {
        setState(
          () => _storiesError =
              'Sports headlines are temporarily unavailable. Please retry.',
        );
      }
    } finally {
      if (mounted && requestId == _storiesRequestId) {
        setState(() => _storiesLoading = false);
      }
    }
  }

  Future<void> _refreshAll() async {
    await Future.wait([_loadScores(manual: true), _loadStories()]);
  }

  List<Map<String, dynamic>> get _visibleMatches {
    final now = DateTime.now();
    final live = _matches
        .where((m) => SportsHubPolicy.isLive(SportsHubPolicy.status(m)))
        .toList();
    final upcoming =
        _matches.where((m) => SportsHubPolicy.isUpcoming(m, now)).toList()
          ..sort((a, b) => _date(a).compareTo(_date(b)));
    final results =
        _matches
            .where((m) => SportsHubPolicy.isFinished(SportsHubPolicy.status(m)))
            .toList()
          ..sort((a, b) => _date(b).compareTo(_date(a)));
    if (_matchFilter == 'upcoming') return upcoming;
    if (_matchFilter == 'results') return results;
    return [
      ...live,
      ...upcoming,
      ..._matches.where(
        (m) =>
            !live.contains(m) && !upcoming.contains(m) && !results.contains(m),
      ),
      ...results,
    ];
  }

  DateTime _date(Map<String, dynamic> match) {
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
      final value = match[key];
      final parsed = DateTime.tryParse(SportsHubPolicy.display(value));
      if (parsed != null) return parsed;
    }
    return DateTime.fromMillisecondsSinceEpoch(0);
  }

  List<Map<String, dynamic>> get _visibleStories => _stories.where((story) {
    final country = '${story['country_code'] ?? ''}';
    if (_storyFilter == 'kenya' && country != 'KE') return false;
    if (_storyFilter == 'world' && (country == 'KE' || country.isEmpty)) {
      return false;
    }
    final publisher = story['testagram_rss_source_profiles'];
    final publisherName = publisher is Map
        ? '${publisher['display_name'] ?? ''}'
        : '';
    final haystack =
        '${story['title'] ?? ''} ${story['excerpt'] ?? ''} $publisherName'
            .toLowerCase();
    return haystack.contains(_query.trim().toLowerCase());
  }).toList();

  @override
  Widget build(BuildContext context) {
    final liveCount = _matches
        .where((m) => SportsHubPolicy.isLive(SportsHubPolicy.status(m)))
        .length;
    final upcomingCount = _matches
        .where((m) => SportsHubPolicy.isUpcoming(m, DateTime.now()))
        .length;
    final resultCount = _matches
        .where((m) => SportsHubPolicy.isFinished(SportsHubPolicy.status(m)))
        .length;
    final stories = _visibleStories;
    return RefreshIndicator(
      onRefresh: _refreshAll,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
        children: [
          Card(
            clipBehavior: Clip.antiAlias,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.emoji_events_outlined),
                      SizedBox(width: 8),
                      Text(
                        'TESTAGRAM SPORTS',
                        style: TextStyle(
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.2,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Every game has a story.',
                    style: Theme.of(context).textTheme.headlineMedium
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Live scores, upcoming fixtures and publisher-attributed sports headlines.',
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final item in _sports)
                        ChoiceChip(
                          label: Text('${item.$3} ${item.$2}'),
                          selected: _sport == item.$1,
                          onSelected: (_) {
                            setState(() => _sport = item.$1);
                            _loadScores();
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: _refreshing ? null : _refreshAll,
                      icon: _refreshing
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh),
                      label: const Text('Refresh feed'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _countCard(
                  'Live now',
                  liveCount,
                  Icons.sensors,
                  Colors.red,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _countCard(
                  'Upcoming',
                  upcomingCount,
                  Icons.calendar_month,
                  Theme.of(context).colorScheme.primary,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _countCard(
                  'Results',
                  resultCount,
                  Icons.check_circle_outline,
                  Colors.green,
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _sectionTitle(context, 'Scores & fixtures', Icons.sports_score),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            children: [
              for (final option in [
                ('all', 'All matches'),
                ('upcoming', 'Upcoming'),
                ('results', 'Results'),
              ])
                ChoiceChip(
                  label: Text(option.$2),
                  selected: _matchFilter == option.$1,
                  onSelected: (_) => setState(() => _matchFilter = option.$1),
                ),
            ],
          ),
          const SizedBox(height: 10),
          if (_scoresLoading && _matches.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(),
              ),
            )
          else if (_scoresError != null && _matches.isEmpty)
            _errorPanel(_scoresError!, () => _loadScores(manual: true))
          else if (_visibleMatches.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text(
                  'No score entries are available for this sport right now. Try another sport or refresh shortly.',
                ),
              ),
            )
          else
            ..._visibleMatches.take(30).map(_matchCard),
          if (_scoresError != null && _matches.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Showing cached scores because refresh failed.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'Scores and fixtures powered by SportScore.',
              style: TextStyle(fontSize: 12),
            ),
          ),
          const SizedBox(height: 24),
          _sectionTitle(
            context,
            'Latest sports headlines',
            Icons.newspaper_outlined,
          ),
          const SizedBox(height: 6),
          const Text(
            'Publisher-attributed stories, including coverage from Kenya.',
          ),
          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Search headlines, teams or publishers',
              border: OutlineInputBorder(),
            ),
            onChanged: (value) => setState(() => _query = value),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            children: [
              for (final option in [
                ('all', 'All stories'),
                ('kenya', 'Kenya'),
                ('world', 'International'),
              ])
                ChoiceChip(
                  label: Text(option.$2),
                  selected: _storyFilter == option.$1,
                  onSelected: (_) => setState(() => _storyFilter = option.$1),
                ),
            ],
          ),
          const SizedBox(height: 10),
          if (_storiesLoading && _stories.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(),
              ),
            )
          else if (_storiesError != null && _stories.isEmpty)
            _errorPanel(_storiesError!, _loadStories)
          else if (stories.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text(
                  'No recent sports headlines match these filters. Try another filter or refresh later.',
                ),
              ),
            )
          else
            ...stories.take(20).map(_storyCard),
          if (_storiesError != null && _stories.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Showing the last loaded headlines because refresh failed.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  Widget _countCard(String label, int count, IconData icon, Color color) =>
      Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: color, size: 19),
              const SizedBox(height: 8),
              Text(
                '$count',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
              Text(
                label,
                style: const TextStyle(fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      );

  Widget _sectionTitle(BuildContext context, String title, IconData icon) =>
      Row(
        children: [
          Icon(icon, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              title,
              style: Theme.of(context).textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
          ),
        ],
      );

  Widget _errorPanel(String message, Future<void> Function() retry) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.cloud_off_outlined),
          const SizedBox(height: 8),
          Text(message),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: retry,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _matchCard(Map<String, dynamic> match) {
    final status = SportsHubPolicy.status(match);
    final league = SportsHubPolicy.display(
      match['league'] ?? match['competition'] ?? match['tournament'],
    );
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    league.isEmpty ? _sport.toUpperCase() : league,
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ),
                const SizedBox(width: 8),
                Text(status, style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    SportsHubPolicy.team(match, 'home'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(
                    '${SportsHubPolicy.score(match, 'home').isEmpty ? '–' : SportsHubPolicy.score(match, 'home')} : ${SportsHubPolicy.score(match, 'away').isEmpty ? '–' : SportsHubPolicy.score(match, 'away')}',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Expanded(
                  child: Text(
                    SportsHubPolicy.team(match, 'away'),
                    textAlign: TextAlign.end,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _storyCard(Map<String, dynamic> story) {
    final title = '${story['title'] ?? 'Sports headline'}'.trim();
    final excerpt = '${story['excerpt'] ?? ''}'.trim();
    final source = story['testagram_rss_source_profiles'];
    final publisher = source is Map
        ? '${source['display_name'] ?? 'Sports publisher'}'
        : 'Sports publisher';
    final country = '${story['country_code'] ?? ''}' == 'KE'
        ? 'Kenya sports'
        : 'Sports news';
    final uri = SportsHubPolicy.safeArticleUri(story['canonical_url']);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              country.toUpperCase(),
              style: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                fontSize: 10,
                fontWeight: FontWeight.w900,
                letterSpacing: 1,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            if (excerpt.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(excerpt, maxLines: 4, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    publisher,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                if (uri != null)
                  TextButton.icon(
                    onPressed: () => _openArticle(uri),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('Source'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openArticle(Uri uri) async {
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open this publisher link.')),
      );
    }
  }
}
