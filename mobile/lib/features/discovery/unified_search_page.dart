import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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
  SupabaseClient get _db => Supabase.instance.client;

  String _tab = 'Top';
  String _query = '';
  Map<String, dynamic> _results = UnifiedSearchPolicy.normalize(null);
  bool _loading = false;
  String? _error;
  int _requestGeneration = 0;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
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
    super.dispose();
  }

  Future<void> _search({bool retryAuth = true}) async {
    final query = UnifiedSearchPolicy.normalizeQuery(_controller.text);
    final generation = ++_requestGeneration;
    if (query.isEmpty) {
      setState(() {
        _query = '';
        _results = UnifiedSearchPolicy.normalize(null);
        _loading = false;
        _error = null;
      });
      return;
    }
    if (_db.auth.currentUser == null) {
      setState(() {
        _query = query;
        _loading = false;
        _error = 'Sign in to search Testagram.';
        _results = UnifiedSearchPolicy.normalize(null);
      });
      return;
    }

    setState(() {
      _query = query;
      _loading = true;
      _error = null;
    });
    try {
      // Call the same canonical RPC as the web client. Supabase supplies the
      // current JWT; the function's grants and RLS remain authoritative.
      final response = await _db
          .rpc(
            'testagram_search_unified',
            params: {
              'p_q': query,
              'p_kind': UnifiedSearchPolicy.kinds[_tab] ?? 'all',
              'p_limit': 40,
            },
          )
          .timeout(const Duration(seconds: 18));
      if (!mounted || generation != _requestGeneration) return;
      final normalized = UnifiedSearchPolicy.normalize(response);
      setState(() => _results = normalized);
    } catch (error) {
      if (!mounted || generation != _requestGeneration) return;
      final message = error.toString().toLowerCase();
      final authFailure =
          message.contains('jwt') ||
          message.contains('401') ||
          message.contains('unauthorized') ||
          message.contains('not authenticated');
      if (authFailure && retryAuth) {
        try {
          await _db.auth.refreshSession().timeout(const Duration(seconds: 12));
          if (_db.auth.currentSession != null &&
              mounted &&
              generation == _requestGeneration) {
            return _search(retryAuth: false);
          }
        } catch (_) {
          // Render the actionable auth error below rather than masking it.
        }
      }
      if (mounted && generation == _requestGeneration) {
        setState(() => _error = UnifiedSearchPolicy.errorMessage(error));
      }
    } finally {
      if (mounted && generation == _requestGeneration) {
        setState(() => _loading = false);
      }
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
      return (_results[group] as List<Map<String, dynamic>>?) ?? const [];
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
    ]) {
      for (final row
          in (_results[group] as List<Map<String, dynamic>>?) ?? const []) {
        final identity = '${row['uri'] ?? row['id'] ?? row.hashCode}';
        if (seen.add(identity)) combined.add(row);
      }
    }
    return combined;
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
        if (_loading) const LinearProgressIndicator(minHeight: 2),
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
      'users' => UnifiedSearchPolicy.firstText(row, [
        'display_name',
        'username',
      ], fallback: 'Testagram user'),
      'hashtags' =>
        '#${UnifiedSearchPolicy.firstText(row, ['tag', 'name'], fallback: 'topic').replaceFirst(RegExp(r'^#'), '')}',
      'posts' => UnifiedSearchPolicy.firstText(row, [
        'content',
        'summary',
        'title',
      ], fallback: 'Post'),
      'threads' => UnifiedSearchPolicy.firstText(row, [
        'title',
        'body',
      ], fallback: 'Thread'),
      'communities' => UnifiedSearchPolicy.firstText(row, [
        'display_name',
        'name',
        'slug',
      ], fallback: 'Community'),
      'replies' => UnifiedSearchPolicy.firstText(row, [
        'content',
      ], fallback: 'Reply'),
      'fediverse' => UnifiedSearchPolicy.firstText(row, [
        'content',
        'summary',
        'display_name',
        'username',
      ], fallback: 'Fediverse item'),
      _ => UnifiedSearchPolicy.firstText(row, [
        'title',
        'name',
        'content',
        'username',
      ], fallback: 'Search result'),
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
    if (row.containsKey('tag') || row.containsKey('usage_count'))
      return 'hashtags';
    if (row.containsKey('actor_uri') && row.containsKey('content'))
      return 'fediverse';
    if (row.containsKey('remote_account') || row.containsKey('uri'))
      return 'fediverse';
    if (row.containsKey('username') && !row.containsKey('content'))
      return 'users';
    if (row.containsKey('member_count') || row.containsKey('slug'))
      return 'communities';
    if (row.containsKey('owner_id') || row.containsKey('body'))
      return 'threads';
    if (row.containsKey('parent_reply_id') ||
        row['type'] == 'reply' ||
        row['type'] == 'thread_reply')
      return 'replies';
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
    _ => Icons.search_rounded,
  };

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
        if (id.isNotEmpty && row['is_federated'] != true)
          context.go('/post/${Uri.encodeComponent(id)}');
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
      case 'fediverse':
        final actor = '${row['actor_uri'] ?? ''}';
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
