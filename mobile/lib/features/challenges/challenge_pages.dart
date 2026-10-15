import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ChallengeLeaderboardPage extends StatefulWidget {
  const ChallengeLeaderboardPage({super.key});

  @override
  State<ChallengeLeaderboardPage> createState() =>
      _ChallengeLeaderboardPageState();
}

class _ChallengeLeaderboardPageState extends State<ChallengeLeaderboardPage> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  String _sort = 'entry_count';

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearch);
    _load();
  }

  void _onSearch() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _search.removeListener(_onSearch);
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await Supabase.instance.client
          .from('hashtag_challenges')
          .select(
            'id,title,description,prize,entry_count,end_date,created_at,'
            'hashtags(tag),user_profiles!created_by(username,avatar_url,verified)',
          )
          .eq('is_active', true)
          .order(_sort, ascending: _sort == 'end_date')
          .range(0, 49);
      if (!mounted) return;
      setState(() {
        _items = List<Map<String, dynamic>>.from(rows);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Challenges could not be loaded. Check your connection and retry.';
        _loading = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final query = _search.text.trim().toLowerCase();
    if (query.isEmpty) return _items;
    return _items.where((item) {
      final hashtag = item['hashtags'];
      final tag = hashtag is Map ? (hashtag['tag']?.toString() ?? '') : '';
      return (item['title']?.toString() ?? '').toLowerCase().contains(query) ||
          (item['description']?.toString() ?? '').toLowerCase().contains(query) ||
          tag.toLowerCase().contains(query);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = _filtered;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Hashtag challenges'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Discover and follow community challenges.',
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _search,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: 'Search challenges or hashtags',
                border: const OutlineInputBorder(),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        onPressed: _search.clear,
                        icon: const Icon(Icons.clear),
                      ),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _sort,
              decoration: const InputDecoration(
                labelText: 'Sort by',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(
                  value: 'entry_count',
                  child: Text('Most popular'),
                ),
                DropdownMenuItem(
                  value: 'end_date',
                  child: Text('Ending soon'),
                ),
                DropdownMenuItem(
                  value: 'created_at',
                  child: Text('Newest'),
                ),
              ],
              onChanged: _loading
                  ? null
                  : (value) {
                      if (value == null) return;
                      setState(() => _sort = value);
                      _load();
                    },
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(36),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              _ChallengeState(
                icon: Icons.cloud_off_outlined,
                title: 'Unable to load challenges',
                message: _error!,
                action: FilledButton(
                  onPressed: _load,
                  child: const Text('Retry'),
                ),
              )
            else if (items.isEmpty)
              const _ChallengeState(
                icon: Icons.emoji_events_outlined,
                title: 'No challenges found',
                message: 'Try a different search or check back later.',
              )
            else
              ...items.map((item) {
                final hashtag = item['hashtags'];
                final tag =
                    hashtag is Map ? (hashtag['tag']?.toString() ?? '') : '';
                final creatorData = item['user_profiles'];
                final creator = creatorData is Map
                    ? (creatorData['username']?.toString() ?? '')
                    : '';
                final end = DateTime.tryParse(
                  item['end_date']?.toString() ?? '',
                );
                final ended = end != null && end.isBefore(DateTime.now());
                final id = item['id']?.toString() ?? '';
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: id.isEmpty
                        ? null
                        : () => context.push(
                              '/challenge/${Uri.encodeComponent(id)}',
                            ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              CircleAvatar(
                                backgroundColor:
                                    theme.colorScheme.primaryContainer,
                                child: Icon(
                                  Icons.emoji_events_outlined,
                                  color: theme.colorScheme.onPrimaryContainer,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item['title']?.toString() ?? 'Challenge',
                                      style: theme.textTheme.titleMedium
                                          ?.copyWith(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    if (tag.isNotEmpty)
                                      Text(
                                        '#$tag',
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                          color: theme.colorScheme.primary,
                                        ),
                                      ),
                                    if (creator.isNotEmpty)
                                      Text(
                                        'By @$creator',
                                        style: theme.textTheme.bodySmall,
                                      ),
                                  ],
                                ),
                              ),
                              Chip(label: Text(ended ? 'Ended' : 'Active')),
                            ],
                          ),
                          if ((item['description']?.toString() ?? '')
                              .trim()
                              .isNotEmpty) ...[
                            const SizedBox(height: 12),
                            Text(
                              item['description'].toString(),
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _ChallengeMetric(
                                icon: Icons.people_outline,
                                label: '${item['entry_count'] ?? 0} entries',
                              ),
                              if ((item['prize']?.toString() ?? '')
                                  .trim()
                                  .isNotEmpty)
                                _ChallengeMetric(
                                  icon: Icons.card_giftcard_outlined,
                                  label: item['prize'].toString(),
                                ),
                              _ChallengeMetric(
                                icon: Icons.event,
                                label: end == null
                                    ? 'End date unavailable'
                                    : 'Ends ${end.toLocal().toIso8601String().substring(0, 10)}',
                              ),
                            ],
                          ),
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton.icon(
                              onPressed: id.isEmpty
                                  ? null
                                  : () => context.push(
                                        '/challenge/${Uri.encodeComponent(id)}',
                                      ),
                              icon: const Icon(Icons.arrow_forward),
                              label: Text(
                                ended ? 'View results' : 'View challenge',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

class ChallengeDetailPage extends StatefulWidget {
  const ChallengeDetailPage({required this.challengeId, super.key});

  final String challengeId;

  @override
  State<ChallengeDetailPage> createState() => _ChallengeDetailPageState();
}

class _ChallengeDetailPageState extends State<ChallengeDetailPage> {
  Map<String, dynamic>? _challenge;
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  bool _newest = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final client = Supabase.instance.client;
      final row = await client
          .from('hashtag_challenges')
          .select(
            'id,title,description,prize,entry_count,end_date,'
            'hashtags(id,tag,usage_count),'
            'user_profiles!created_by(username,avatar_url,verified)',
          )
          .eq('id', widget.challengeId)
          .maybeSingle();
      if (row == null) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = 'This challenge is unavailable or no longer visible.';
        });
        return;
      }
      final hashtag = row['hashtags'];
      final tag =
          hashtag is Map ? (hashtag['tag']?.toString() ?? '') : '';
      List<Map<String, dynamic>> posts = [];
      if (tag.isNotEmpty) {
        final result = await client
            .from('posts')
            .select(
              'id,content,created_at,likes_count,comments_count,'
              'user_profiles:profiles!posts_user_id_fkey(username,avatar_url,verified)',
            )
            .ilike('content', '%#$tag%')
            .order(
              _newest ? 'created_at' : 'likes_count',
              ascending: false,
            )
            .limit(30);
        posts = List<Map<String, dynamic>>.from(result);
      }
      if (!mounted) return;
      setState(() {
        _challenge = Map<String, dynamic>.from(row);
        _posts = posts;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Challenge details could not be loaded. Please retry.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final challenge = _challenge;
    final hashtag = challenge?['hashtags'];
    final tag = hashtag is Map ? (hashtag['tag']?.toString() ?? '') : '';
    final creatorData = challenge?['user_profiles'];
    final creator = creatorData is Map
        ? (creatorData['username']?.toString() ?? '')
        : '';
    final end = DateTime.tryParse(challenge?['end_date']?.toString() ?? '');
    final ended = end != null && end.isBefore(DateTime.now());

    return Scaffold(
      appBar: AppBar(
        title: const Text('Challenge'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ChallengeState(
                  icon: Icons.info_outline,
                  title: 'Challenge unavailable',
                  message: _error!,
                  action: FilledButton(
                    onPressed: _load,
                    child: const Text('Retry'),
                  ),
                )
              : challenge == null
                  ? const _ChallengeState(
                      icon: Icons.info_outline,
                      title: 'Challenge unavailable',
                      message: 'This challenge is not available.',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(20),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(
                                    Icons.emoji_events,
                                    size: 42,
                                    color: theme.colorScheme.primary,
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    challenge['title']?.toString() ??
                                        'Challenge',
                                    style: theme.textTheme.headlineSmall
                                        ?.copyWith(
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  if (tag.isNotEmpty)
                                    Text(
                                      '#$tag',
                                      style: theme.textTheme.titleMedium
                                          ?.copyWith(
                                        color: theme.colorScheme.primary,
                                      ),
                                    ),
                                  const SizedBox(height: 12),
                                  if ((challenge['description']?.toString() ??
                                          '')
                                      .trim()
                                      .isNotEmpty)
                                    Text(challenge['description'].toString()),
                                  const SizedBox(height: 16),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: [
                                      _ChallengeMetric(
                                        icon: Icons.people_outline,
                                        label:
                                            '${challenge['entry_count'] ?? 0} entries',
                                      ),
                                      _ChallengeMetric(
                                        icon: Icons.event,
                                        label: end == null
                                            ? 'End date unavailable'
                                            : 'Ends ${end.toLocal().toIso8601String().substring(0, 10)}',
                                      ),
                                      if (creator.isNotEmpty)
                                        _ChallengeMetric(
                                          icon: Icons.person_outline,
                                          label: '@$creator',
                                        ),
                                    ],
                                  ),
                                  if ((challenge['prize']?.toString() ?? '')
                                      .trim()
                                      .isNotEmpty) ...[
                                    const SizedBox(height: 12),
                                    ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      leading: const Icon(
                                        Icons.card_giftcard_outlined,
                                      ),
                                      title: const Text('Prize'),
                                      subtitle: Text(
                                        challenge['prize'].toString(),
                                      ),
                                    ),
                                  ],
                                  const SizedBox(height: 12),
                                  FilledButton.icon(
                                    onPressed: tag.isEmpty
                                        ? null
                                        : () => context.go(
                                              '/hashtag/${Uri.encodeComponent(tag)}',
                                            ),
                                    icon: const Icon(Icons.tag),
                                    label: Text(
                                      ended ? 'Explore entries' : 'Open #$tag',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 20),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'Challenge entries',
                                  style: theme.textTheme.titleLarge,
                                ),
                              ),
                              DropdownButton<bool>(
                                value: _newest,
                                items: const [
                                  DropdownMenuItem(
                                    value: false,
                                    child: Text('Top'),
                                  ),
                                  DropdownMenuItem(
                                    value: true,
                                    child: Text('Newest'),
                                  ),
                                ],
                                onChanged: (value) {
                                  if (value == null) return;
                                  setState(() => _newest = value);
                                  _load();
                                },
                              ),
                            ],
                          ),
                          if (_posts.isEmpty)
                            const _ChallengeState(
                              icon: Icons.forum_outlined,
                              title: 'No entries yet',
                              message:
                                  'Posts containing this challenge hashtag will appear here.',
                            )
                          else
                            ..._posts.map((post) {
                              final profile = post['user_profiles'];
                              final username = profile is Map
                                  ? (profile['username']?.toString() ?? 'user')
                                  : 'user';
                              return Card(
                                child: ListTile(
                                  onTap: () => context.push(
                                    '/post/${Uri.encodeComponent(post['id'].toString())}',
                                  ),
                                  leading: const CircleAvatar(
                                    child: Icon(Icons.person_outline),
                                  ),
                                  title: Text('@$username'),
                                  subtitle: Text(
                                    post['content']?.toString() ?? '',
                                    maxLines: 4,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  trailing: Text(
                                    '♥ ${post['likes_count'] ?? 0}',
                                  ),
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
    );
  }
}

class _ChallengeMetric extends StatelessWidget {
  const _ChallengeMetric({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Chip(
        avatar: Icon(icon, size: 16),
        label: Text(label, overflow: TextOverflow.ellipsis),
      );
}

class _ChallengeState extends StatelessWidget {
  const _ChallengeState({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 12),
        child: Column(
          children: [
            Icon(icon, size: 42),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            if (action != null) ...[
              const SizedBox(height: 16),
              action!,
            ],
          ],
        ),
      );
}
