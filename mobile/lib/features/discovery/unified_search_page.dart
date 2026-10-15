import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/testagram_capability_client.dart';
import 'unified_search_policy.dart';

class UnifiedSearchPage extends StatefulWidget {
  const UnifiedSearchPage({
    super.key,
    this.initialQuery = '',
    this.initialTab = 'Top',
  });

  final String initialQuery;
  final String initialTab;

  @override
  State<UnifiedSearchPage> createState() => _UnifiedSearchPageState();
}

class _UnifiedSearchPageState extends State<UnifiedSearchPage> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  final _scrollController = ScrollController();
  SupabaseClient get _db => Supabase.instance.client;

  String _tab = 'Top';
  String _sort = 'Relevance';
  String _query = '';
  Map<String, dynamic> _results = UnifiedSearchPolicy.normalize(null);
  bool _loading = false;
  String? _error;
  String? _notice;
  int _requestGeneration = 0;
  int _offset = 0;
  bool _hasMore = false;
  bool _loadingMore = false;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _controller.text = widget.initialQuery;
    _query = widget.initialQuery;
    _tab = UnifiedSearchPolicy.kinds.containsKey(widget.initialTab)
        ? widget.initialTab
        : 'Top';
    if (_query.trim().isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _search());
    }
  }

  @override
  void dispose() {
    _requestGeneration++;
    _debounce?.cancel();
    _controller.dispose();
    _focusNode.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients ||
        _loading ||
        _loadingMore ||
        !_hasMore) {
      return;
    }
    if (_scrollController.position.extentAfter < 420) {
      _search(append: true);
    }
  }

  Future<void> _search({bool retryAuth = true, bool append = false}) async {
    final query = UnifiedSearchPolicy.normalizeQuery(_controller.text);
    final generation = ++_requestGeneration;
    if (query.isEmpty) {
      setState(() {
        _query = '';
        _results = UnifiedSearchPolicy.normalize(null);
        _loading = false;
        _error = null;
        _notice = null;
        _offset = 0;
        _hasMore = false;
        _loadingMore = false;
      });
      return;
    }
    if (_db.auth.currentUser == null) {
      setState(() {
        _query = query;
        _loading = false;
        _error = 'Sign in to search Testagram.';
        _notice = null;
        _results = UnifiedSearchPolicy.normalize(null);
        _hasMore = false;
        _loadingMore = false;
      });
      return;
    }

    setState(() {
      _query = query;
      _loading = !append;
      _loadingMore = append;
      _error = null;
      if (!append) {
        _notice = null;
        _results = UnifiedSearchPolicy.normalize(null);
        _offset = 0;
        _hasMore = false;
      }
    });
    try {
      // Call the same canonical RPC as the web client. Supabase supplies the
      // current JWT; the function's grants and RLS remain authoritative.
      final response = await _db.rpc(
        'testagram_search_unified',
        params: {
          'p_q': query,
          'p_kind': UnifiedSearchPolicy.kinds[_tab] ?? 'all',
          'p_limit': 40,
          'p_offset': append ? _offset : 0,
          'p_sort': _sort.toLowerCase().replaceAll(' ', '_'),
        },
      ).timeout(const Duration(seconds: 18));
      if (!mounted || generation != _requestGeneration) return;
      final normalized = UnifiedSearchPolicy.normalize(response);
      setState(() {
        _results = append
            ? UnifiedSearchPolicy.mergePage(_results, normalized)
            : normalized;
        _offset = int.tryParse('${normalized['next_cursor']}') ?? 0;
        _hasMore = normalized['next_cursor'] != null;
      });
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      final message = error.toString().toLowerCase();
      final authFailure = message.contains('jwt') ||
          message.contains('401') ||
          message.contains('unauthorized') ||
          message.contains('not authenticated');
      if (authFailure && retryAuth) {
        try {
          await _db.auth.refreshSession().timeout(const Duration(seconds: 12));
          if (_db.auth.currentSession != null &&
              mounted &&
              generation == _requestGeneration) {
            return _search(retryAuth: false, append: append);
          }
        } catch (_) {
          // Render the actionable auth error below rather than masking it.
        }
      }
      if (authFailure) {
        if (mounted && generation == _requestGeneration) {
          setState(() => _error = UnifiedSearchPolicy.errorMessage(error));
        }
        return;
      }
      if (append) {
        if (mounted && generation == _requestGeneration) {
          setState(() => _error = UnifiedSearchPolicy.errorMessage(error));
        }
        return;
      }
      final recovered = await _fallbackSearch(query, generation);
      if (!recovered && mounted && generation == _requestGeneration) {
        setState(() => _error = UnifiedSearchPolicy.errorMessage(error));
      }
    } finally {
      if (mounted && generation == _requestGeneration) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  Future<bool> _fallbackSearch(String query, int generation) async {
    final client = TestagramCapabilityClient.fromAppConfig(
      supabaseClient: _db,
      timeout: const Duration(seconds: 12),
    );
    Future<Map<String, dynamic>?> load(
      String capability,
      String term, {
      bool mediaOnly = false,
    }) async {
      try {
        return await client.call<Map<String, dynamic>>(
          capability,
          input: <String, Object?>{
            'q': term,
            'limit': 40,
            if (mediaOnly) 'media_only': true,
          },
        );
      } catch (_) {
        return null;
      }
    }

    List<Map<String, dynamic>> items(Map<String, dynamic>? payload) {
      final value = payload?['items'];
      if (value is! List) return <Map<String, dynamic>>[];
      return value
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList(growable: false);
    }

    try {
      final normalizedTerm = query.replaceFirst(RegExp(r'^[@#]'), '');
      final responses = await Future.wait([
        load('testagram.search.users', normalizedTerm),
        load('testagram.search.hashtags', normalizedTerm),
        load('testagram.search.posts', query, mediaOnly: _tab == 'Media'),
        load('testagram.search.communities', normalizedTerm),
      ]);
      if (responses.every((response) => response == null)) return false;
      if (!mounted || generation != _requestGeneration) return true;
      setState(() {
        _results = UnifiedSearchPolicy.normalize(<String, dynamic>{
          'users': items(responses[0]),
          'hashtags': items(responses[1]),
          'posts': items(responses[2]),
          'communities': items(responses[3]),
          'threads': <dynamic>[],
          'replies': <dynamic>[],
          'fediverse': <dynamic>[],
        });
        _notice =
            'Unified search is recovering. Showing available local results; some categories may be temporarily unavailable.';
        _error = null;
        _offset = 0;
        _hasMore = false;
      });
      return true;
    } finally {
      client.close();
    }
  }

  void _selectTab(String tab) {
    if (_tab == tab) return;
    setState(() => _tab = tab);
    if (_query.isNotEmpty) _search();
  }

  List<Map<String, dynamic>> _rowsForCurrentTab() {
    if (_tab != 'Top') {
      final group = UnifiedSearchPolicy.groupForTab(_tab);
      return UnifiedSearchPolicy.sortRows(
        (_results[group] as List<Map<String, dynamic>>?) ?? const [],
        _sort,
        forceLatest: _tab == 'Latest' && _sort == 'Relevance',
      );
    }
    final combined = <Map<String, dynamic>>[];
    final seen = <String>{};
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
      for (final row
          in (_results[group] as List<Map<String, dynamic>>?) ?? const []) {
        final canonical = row['uri'] ??
            row['remote_status_uri'] ??
            (_groupForRow(row) == 'users' ? row['actor_uri'] : null);
        final identity = canonical != null
            ? 'remote:${'$canonical'.toLowerCase()}'
            : '$group:${row['id'] ?? row.hashCode}';
        if (seen.add(identity)) combined.add(row);
      }
    }
    return UnifiedSearchPolicy.sortRows(
      combined,
      _sort,
      forceLatest: _tab == 'Latest' && _sort == 'Relevance',
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rowsForCurrentTab();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
          child: TextField(
            controller: _controller,
            focusNode: _focusNode,
            textInputAction: TextInputAction.search,
            onChanged: (_) {
              setState(() {});
              _debounce?.cancel();
              _debounce = Timer(const Duration(milliseconds: 350), () {
                if (mounted && _controller.text.trim().length >= 2) _search();
              });
            },
            onSubmitted: (_) => _search(),
            decoration: InputDecoration(
              hintText: 'Search people, posts, topics and communities',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _controller.text.isEmpty
                  ? IconButton(
                      tooltip: 'Search',
                      onPressed: _search,
                      icon: const Icon(Icons.arrow_forward_rounded),
                    )
                  : IconButton(
                      tooltip: 'Clear search',
                      onPressed: () {
                        _controller.clear();
                        _debounce?.cancel();
                        _search();
                        setState(() {});
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(28),
              ),
            ),
          ),
        ),
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            children: [
              for (final tab in UnifiedSearchPolicy.kinds.keys)
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 3,
                    vertical: 5,
                  ),
                  child: ChoiceChip(
                    label: Text(tab),
                    selected: _tab == tab,
                    onSelected: (_) => _selectTab(tab),
                  ),
                ),
            ],
          ),
        ),
        if (const {'Top', 'Latest', 'Posts', 'Media', 'Fediverse'}
            .contains(_tab))
          SizedBox(
            height: 42,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final sort in const [
                  'Relevance',
                  'Latest',
                  'Most liked',
                  'Most viewed',
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 6, top: 3, bottom: 3),
                    child: ChoiceChip(
                      label: Text(sort),
                      selected: _sort == sort,
                      onSelected: (_) {
                        setState(() => _sort = sort);
                        if (_query.isNotEmpty) _search();
                      },
                    ),
                  ),
              ],
            ),
          ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        if (_notice != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                _notice!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.cloud_off_outlined),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _error!,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: _search,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _search,
            child: ListView(
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
              children: [
                if (_query.isEmpty && !_loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 56, horizontal: 18),
                    child: Column(
                      children: [
                        Icon(Icons.travel_explore_rounded, size: 48),
                        SizedBox(height: 12),
                        Text(
                          'Search Testagram',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 6),
                        Text(
                          'Find people, posts, hashtags, threads, communities and Fediverse content.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                else if (_loading && rows.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(28),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_error == null && rows.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: 48,
                      horizontal: 18,
                    ),
                    child: Column(
                      children: [
                        const Icon(Icons.search_off_rounded, size: 42),
                        const SizedBox(height: 10),
                        Text(
                          'No ${_tab == 'Top' ? 'matching' : _tab.toLowerCase()} results for “$_query”.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Try another phrase or switch categories.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                else
                  ...rows.map(_resultCard),
                if (_hasMore && !_loadingMore)
                  Center(
                    child: TextButton.icon(
                      onPressed: () => _search(append: true),
                      icon: const Icon(Icons.expand_more_rounded),
                      label: const Text('Load more results'),
                    ),
                  ),
                if (_loadingMore)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _resultCard(Map<String, dynamic> row) {
    final group = _groupForRow(row);
    final title = switch (group) {
      'users' => UnifiedSearchPolicy.firstText(
          row,
          [
            'display_name',
            'username',
          ],
          fallback: 'Testagram user'),
      'hashtags' => '#${UnifiedSearchPolicy.firstText(row, [
            'tag',
            'name'
          ], fallback: 'topic').replaceFirst(RegExp(r'^#'), '')}',
      'posts' => UnifiedSearchPolicy.firstText(
          row,
          [
            'content',
            'summary',
            'title',
          ],
          fallback: 'Post'),
      'threads' => UnifiedSearchPolicy.firstText(
          row,
          [
            'title',
            'body',
          ],
          fallback: 'Thread'),
      'communities' => UnifiedSearchPolicy.firstText(
          row,
          [
            'display_name',
            'name',
            'slug',
          ],
          fallback: 'Community'),
      'replies' => UnifiedSearchPolicy.firstText(
          row,
          [
            'content',
          ],
          fallback: 'Reply'),
      'fediverse' => UnifiedSearchPolicy.firstText(
          row,
          [
            'content',
            'summary',
            'display_name',
            'username',
          ],
          fallback: 'Fediverse item'),
      _ => UnifiedSearchPolicy.firstText(
          row,
          [
            'title',
            'name',
            'content',
            'username',
          ],
          fallback: 'Search result'),
    };
    final subtitle = switch (group) {
      'users' =>
        '@${row['username'] ?? ''}${row['origin'] == 'fediverse' && row['domain'] != null ? '@${row['domain']}' : ''}',
      'hashtags' =>
        '${row['usage_count'] ?? 0} posts · ${row['follower_count'] ?? 0} followers',
      'posts' =>
        '${row['user_profiles'] is Map ? (row['user_profiles'] as Map)['username'] ?? '' : ''} · ${row['created_at'] ?? ''}',
      'threads' =>
        '${row['profiles'] is Map ? (row['profiles'] as Map)['username'] ?? '' : ''} · ${row['created_at'] ?? ''}',
      'communities' =>
        '${row['member_count'] ?? 0} members · ${row['post_count'] ?? 0} posts',
      'replies' =>
        '${row['user_profiles'] is Map ? (row['user_profiles'] as Map)['username'] ?? '' : ''} · ${row['created_at'] ?? ''}',
      'instances' =>
        '${row['software'] ?? row['provider'] ?? 'Fediverse'} · ${row['account_count'] ?? 0} indexed accounts',
      'fediverse' =>
        '${row['remote_account'] is Map ? (row['remote_account'] as Map)['username'] ?? row['actor_uri'] ?? '' : row['actor_uri'] ?? ''} · Fediverse',
      _ => '${row['created_at'] ?? ''}',
    };
    final avatar = group == 'users'
        ? '${row['avatar_url'] ?? ''}'
        : group == 'posts' && row['user_profiles'] is Map
            ? '${(row['user_profiles'] as Map)['avatar_url'] ?? ''}'
            : group == 'threads' && row['profiles'] is Map
                ? '${(row['profiles'] as Map)['avatar_url'] ?? ''}'
                : '';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: avatar.startsWith('http')
            ? CircleAvatar(backgroundImage: CachedNetworkImageProvider(avatar))
            : CircleAvatar(child: Icon(_iconFor(group))),
        title: Text(
          title,
          maxLines: group == 'posts' || group == 'replies' ? 4 : 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => _openResult(group, row),
      ),
    );
  }

  String _groupForRow(Map<String, dynamic> row) {
    if (_tab != 'Top') return UnifiedSearchPolicy.groupForTab(_tab);
    if (row.containsKey('domain') && row.containsKey('base_url')) {
      return 'instances';
    }
    if (row.containsKey('tag') || row.containsKey('usage_count')) {
      return 'hashtags';
    }
    if (row.containsKey('actor_uri') && row.containsKey('content')) {
      return 'fediverse';
    }
    if (row.containsKey('remote_account') || row.containsKey('uri')) {
      return 'fediverse';
    }
    if (row.containsKey('username') && !row.containsKey('content')) {
      return 'users';
    }
    if (row.containsKey('member_count') || row.containsKey('slug')) {
      return 'communities';
    }
    if (row.containsKey('owner_id') || row.containsKey('body')) {
      return 'threads';
    }
    if (row.containsKey('parent_reply_id') ||
        row['type'] == 'reply' ||
        row['type'] == 'thread_reply') {
      return 'replies';
    }
    if (row.containsKey('content')) return 'posts';
    return 'all';
  }

  IconData _iconFor(String group) => switch (group) {
        'users' => Icons.person_outline_rounded,
        'hashtags' => Icons.tag_rounded,
        'posts' => Icons.article_outlined,
        'threads' => Icons.forum_outlined,
        'communities' => Icons.groups_2_outlined,
        'replies' => Icons.reply_rounded,
        'fediverse' => Icons.public_rounded,
        'instances' => Icons.dns_outlined,
        _ => Icons.search_rounded,
      };

  Future<void> _openExternalUrl(String value) async {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        (!uri.isScheme('http') && !uri.isScheme('https'))) {
      return;
    }
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _openResult(String group, Map<String, dynamic> row) {
    switch (group) {
      case 'users':
        final username = '${row['username'] ?? ''}'.replaceFirst(
          RegExp(r'^@'),
          '',
        );
        if (row['origin'] == 'fediverse' || row['actor_uri'] != null) {
          final actor = '${row['actor_uri'] ?? ''}';
          if (actor.startsWith('https://') || actor.startsWith('http://')) {
            context.go(
              '/fediverse/profile?actor=${Uri.encodeQueryComponent(actor)}',
            );
          }
        } else if (username.isNotEmpty) {
          context.go('/profile/${Uri.encodeComponent(username)}');
        }
        break;
      case 'hashtags':
        final tag = '${row['tag'] ?? row['name'] ?? ''}'.replaceFirst(
          RegExp(r'^#'),
          '',
        );
        if (tag.isNotEmpty) context.go('/hashtag/${Uri.encodeComponent(tag)}');
        break;
      case 'posts':
        final id = '${row['id'] ?? ''}';
        if (row['is_federated'] == true) {
          final target = '${row['url'] ?? row['uri'] ?? id}';
          if (target.startsWith('https://') || target.startsWith('http://')) {
            unawaited(_openExternalUrl(target));
          }
        } else if (id.isNotEmpty) {
          context.go('/post/${Uri.encodeComponent(id)}');
        }
        break;
      case 'threads':
        final id = '${row['id'] ?? ''}';
        if (id.isNotEmpty) context.go('/thread/${Uri.encodeComponent(id)}');
        break;
      case 'communities':
        final slug = '${row['slug'] ?? row['name'] ?? ''}';
        if (slug.isNotEmpty) context.go('/c/${Uri.encodeComponent(slug)}');
        break;
      case 'replies':
        final postId = '${row['post_id'] ?? ''}';
        final threadId = '${row['thread_id'] ?? ''}';
        if (postId.isNotEmpty) {
          context.go('/post/${Uri.encodeComponent(postId)}');
        } else if (threadId.isNotEmpty) {
          context.go('/thread/${Uri.encodeComponent(threadId)}');
        }
        break;
      case 'instances':
        final baseUrl = '${row['base_url'] ?? ''}';
        if (baseUrl.startsWith('https://') || baseUrl.startsWith('http://')) {
          unawaited(_openExternalUrl(baseUrl));
        }
        break;
      case 'fediverse':
        final objectUrl = '${row['url'] ?? row['uri'] ?? ''}';
        if (objectUrl.startsWith('http://') ||
            objectUrl.startsWith('https://')) {
          unawaited(_openExternalUrl(objectUrl));
          break;
        }
        final remoteAccount = row['remote_account'];
        final actor =
            '${row['actor_uri'] ?? (remoteAccount is Map ? remoteAccount['actor_uri'] : null) ?? ''}';
        if (actor.startsWith('http://') || actor.startsWith('https://')) {
          context.go(
            '/fediverse/profile?actor=${Uri.encodeQueryComponent(actor)}',
          );
        }
        break;
      default:
        break;
    }
  }
}
