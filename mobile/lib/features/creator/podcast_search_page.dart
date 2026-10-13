import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../migration_batch_policy.dart';

class PodcastSearchPage extends StatefulWidget {
  const PodcastSearchPage({super.key});
  @override
  State<PodcastSearchPage> createState() => _PodcastSearchPageState();
}

class _PodcastSearchPageState extends State<PodcastSearchPage> {
  final _db = Supabase.instance.client;
  final _query = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _error;
  String _category = 'all';
  String _duration = 'any';
  bool _videoOnly = false;
  int _page = 0;
  static const _pageSize = 20;
  static const _categories = [
    'all',
    'technology',
    'business',
    'entertainment',
    'education',
    'news',
    'comedy',
    'music',
    'health',
    'sports',
  ];

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _scheduleSearch() {
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 400),
      () => _load(reset: true),
    );
  }

  Future<void> _load({required bool reset}) async {
    final page = reset ? 0 : _page + 1;
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      var request = _db.from('space_recordings').select(
            'id,title,audio_url,video_url,has_video,duration,listener_count,created_at,profiles(id,username,avatar_url,verified_tier),spaces(title,description,category,artwork_url,episode_number,tags,subscriber_only)',
          );
      final q = _query.text.trim().replaceAll(',', ' ');
      if (q.isNotEmpty) request = request.or('title.ilike.%$q%');
      if (_category != 'all') {
        request = request.eq('spaces.category', _category);
      }
      if (_videoOnly) request = request.eq('has_video', true);
      final bounds = switch (_duration) {
        'short' => (0, 899),
        'medium' => (900, 3599),
        'long' => (3600, 999999),
        _ => (0, 999999),
      };
      if (_duration != 'any') {
        request = request.gte('duration', bounds.$1).lte('duration', bounds.$2);
      }
      final rows = await request
          .order('listener_count', ascending: false)
          .range(page * _pageSize, page * _pageSize + _pageSize - 1)
          .timeout(const Duration(seconds: 20));
      final list =
          rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      if (!mounted) return;
      setState(() {
        _items = reset ? list : [..._items, ...list];
        _page = page;
        _hasMore = list.length == _pageSize;
      });
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _error = 'Podcast search is unavailable. Retry or clear filters.',
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  String _durationLabel(dynamic value) =>
      MigrationBatchPolicy.formatDuration(value);

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Search podcasts')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                controller: _query,
                onChanged: (_) => _scheduleSearch(),
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _load(reset: true),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: 'Search recordings and episodes',
                  suffixIcon: IconButton(
                    onPressed: () {
                      _query.clear();
                      _load(reset: true);
                    },
                    icon: const Icon(Icons.clear),
                  ),
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final c in _categories)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: ChoiceChip(
                        label: Text(
                          c == 'all'
                              ? 'All'
                              : c[0].toUpperCase() + c.substring(1),
                        ),
                        selected: _category == c,
                        onSelected: (_) {
                          setState(() => _category = c);
                          _load(reset: true);
                        },
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  const Text('Length'),
                  const SizedBox(width: 8),
                  DropdownButton<String>(
                    value: _duration,
                    items: const [
                      DropdownMenuItem(value: 'any', child: Text('Any')),
                      DropdownMenuItem(
                          value: 'short', child: Text('Under 15 min')),
                      DropdownMenuItem(
                          value: 'medium', child: Text('15–60 min')),
                      DropdownMenuItem(value: 'long', child: Text('60+ min')),
                    ],
                    onChanged: (v) {
                      if (v != null) {
                        setState(() => _duration = v);
                        _load(reset: true);
                      }
                    },
                  ),
                  const Spacer(),
                  const Text('Video'),
                  Switch(
                    value: _videoOnly,
                    onChanged: (v) {
                      setState(() => _videoOnly = v);
                      _load(reset: true);
                    },
                  ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : RefreshIndicator(
                      onRefresh: () => _load(reset: true),
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          if (_items.isEmpty && _error == null)
                            const Padding(
                              padding: EdgeInsets.all(32),
                              child: Center(
                                child:
                                    Text('No recordings match these filters.'),
                              ),
                            ),
                          for (final item in _items)
                            Card(
                              child: ListTile(
                                leading: CircleAvatar(
                                  child: Icon(
                                    item['has_video'] == true
                                        ? Icons.video_library_outlined
                                        : Icons.headphones,
                                  ),
                                ),
                                title: Text(
                                  '${item['title'] ?? 'Untitled recording'}',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(
                                  '${(item['spaces'] is Map ? (item['spaces'] as Map)['title'] : null) ?? 'Audio space'} · ${_durationLabel(item['duration'])}\n${item['listener_count'] ?? 0} listeners',
                                  maxLines: 2,
                                ),
                                isThreeLine: true,
                                trailing: const Icon(Icons.play_circle_outline),
                                onTap: () {
                                  final id = '${item['id'] ?? ''}';
                                  if (id.isNotEmpty) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Open this recording from its space or podcast page.',
                                        ),
                                      ),
                                    );
                                  }
                                },
                              ),
                            ),
                          if (_hasMore)
                            Padding(
                              padding: const EdgeInsets.all(12),
                              child: OutlinedButton(
                                onPressed: _loadingMore
                                    ? null
                                    : () => _load(reset: false),
                                child: Text(
                                  _loadingMore ? 'Loading…' : 'Load more',
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      );
}
