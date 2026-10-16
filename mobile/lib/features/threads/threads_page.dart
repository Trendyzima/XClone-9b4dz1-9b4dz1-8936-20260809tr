import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ThreadsPage extends StatefulWidget {
  const ThreadsPage({super.key});
  @override
  State<ThreadsPage> createState() => _ThreadsPageState();
}

class _ThreadsPageState extends State<ThreadsPage> {
  final _scroll = ScrollController();
  final _composer = TextEditingController();
  final _items = <Map<String, dynamic>>[];
  final _liked = <String>{};
  final _reposted = <String>{};
  bool _loading = false, _publishing = false, _hasMore = true;
  String _tab = 'For you';
  int _page = 0;
  String? _error;
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _composer.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 500 &&
        !_loading &&
        _hasMore) {
      _load();
    }
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading || (!reset && !_hasMore)) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    if (reset) {
      _page = 0;
      _hasMore = true;
      _items.clear();
      _liked.clear();
      _reposted.clear();
    }
    try {
      final start = _page * 20;
      final viewer = _uid;
      List<String> following = [];
      if (_tab == 'Following' && viewer != null) {
        final rows = await _db.from('follows').select('following_id').eq('follower_id', viewer);
        following = rows.map((r) => '${r['following_id']}').toList();
      }
      final base = _db
          .from('threads')
          .select(
            'id,owner_id,title,body,visibility,created_at,deleted_at,likes_count,reposts_count,replies_count,media_urls',
          );
      final response = _tab == 'Following' && (viewer == null || following.isEmpty)
          ? <dynamic>[]
          : await (_tab == 'Following' ? base.inFilter('owner_id', following) : base)
                .isFilter('deleted_at', null)
                .eq('visibility', 'public')
                .order('created_at', ascending: false)
                .range(start, start + 19)
                .timeout(const Duration(seconds: 15));
      final rows = response.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      final ownerIds = rows.map((r) => '${r['owner_id']}').toSet().toList();
      final profiles = ownerIds.isEmpty
          ? <dynamic>[]
          : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url,verified')
                .inFilter('id', ownerIds);
      final byId = {for (final p in profiles) '${p['id']}': Map<String, dynamic>.from(p as Map)};
      for (final row in rows) {
        row['profile'] = byId['${row['owner_id']}'];
      }
      if (viewer != null && rows.isNotEmpty) {
        final ids = rows.map((r) => '${r['id']}').toList();
        final likes = await _db
            .from('thread_likes')
            .select('thread_id')
            .eq('user_id', viewer)
            .inFilter('thread_id', ids);
        final reposts = await _db
            .from('thread_reposts')
            .select('thread_id')
            .eq('user_id', viewer)
            .inFilter('thread_id', ids);
        _liked.addAll(likes.map((r) => '${r['thread_id']}'));
        _reposted.addAll(reposts.map((r) => '${r['thread_id']}'));
      }
      if (!mounted) return;
      setState(() {
        _items.addAll(rows);
        _hasMore = rows.length == 20;
        if (_hasMore) _page++;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Threads could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _publish() async {
    final body = _composer.text.trim();
    if (_uid == null) {
      context.go('/auth');
      return;
    }
    if (body.isEmpty || _publishing) return;
    setState(() => _publishing = true);
    try {
      await _db.from('threads').insert({'owner_id': _uid, 'body': body, 'visibility': 'public'});
      _composer.clear();
      await _load(reset: true);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Thread published')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Could not publish thread. Please retry.')));
      }
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  Future<void> _toggle(String id, bool like) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final set = like ? _liked : _reposted;
    final wasSet = set.contains(id);
    setState(() {
      wasSet ? set.remove(id) : set.add(id);
    });
    try {
      final table = like ? 'thread_likes' : 'thread_reposts';
      if (wasSet) {
        await _db.from(table).delete().eq('thread_id', id).eq('user_id', uid);
      } else {
        await _db.from(table).insert({'thread_id': id, 'user_id': uid});
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          wasSet ? set.add(id) : set.remove(id);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Action failed. Your feed was restored; retry.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: () => _load(reset: true),
    child: ListView(
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 12),
          child: Text(
            'Threads',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'For you', label: Text('For you')),
              ButtonSegment(value: 'Following', label: Text('Following')),
            ],
            selected: {_tab},
            onSelectionChanged: (v) {
              setState(() => _tab = v.first);
              _load(reset: true);
            },
          ),
        ),
        if (_uid != null)
          Card(
            margin: const EdgeInsets.all(12),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  TextField(
                    controller: _composer,
                    maxLines: 4,
                    minLines: 2,
                    maxLength: 500,
                    decoration: const InputDecoration(
                      hintText: 'Start a conversation…',
                      border: InputBorder.none,
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: _publishing ? null : _publish,
                      icon: const Icon(Icons.send_rounded),
                      label: Text(_publishing ? 'Publishing…' : 'Post thread'),
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.all(12),
            child: OutlinedButton(
              onPressed: () => context.go('/auth'),
              child: const Text('Sign in to publish a thread'),
            ),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Text(_error!),
                TextButton(onPressed: () => _load(reset: true), child: const Text('Retry')),
              ],
            ),
          ),
        ..._items.map((t) {
          final id = '${t['id']}';
          final p = (t['profile'] as Map<String, dynamic>?) ?? {};
          final name = '${p['display_name'] ?? p['username'] ?? 'Testagram user'}';
          final media = t['media_urls'];
          return Card(
            margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
            child: InkWell(
              onTap: () => context.go('/thread/$id'),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(child: Text(name.isEmpty ? 'T' : name[0].toUpperCase())),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: const TextStyle(fontWeight: FontWeight.w800)),
                              Text(
                                '@${p['username'] ?? 'user'}',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'Open thread',
                          onPressed: () => context.go('/thread/$id'),
                          icon: const Icon(Icons.open_in_new_rounded),
                        ),
                      ],
                    ),
                    if ('${t['title'] ?? ''}'.trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(
                          '${t['title']}',
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('${t['body'] ?? ''}'),
                    ),
                    if (media is List && media.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Wrap(
                          spacing: 8,
                          children: media
                              .take(4)
                              .map((m) => const Icon(Icons.attach_file_rounded, size: 18))
                              .toList(),
                        ),
                      ),
                    const Divider(height: 24),
                    Row(
                      children: [
                        TextButton.icon(
                          onPressed: () => context.go('/thread/$id/replies'),
                          icon: const Icon(Icons.chat_bubble_outline_rounded),
                          label: Text('${t['replies_count'] ?? 0}'),
                        ),
                        const Spacer(),
                        IconButton(
                          tooltip: 'Repost',
                          onPressed: () => _toggle(id, false),
                          color: _reposted.contains(id) ? Colors.green : null,
                          icon: const Icon(Icons.repeat_rounded),
                        ),
                        Text('${t['reposts_count'] ?? 0}'),
                        const SizedBox(width: 8),
                        IconButton(
                          tooltip: 'Like',
                          onPressed: () => _toggle(id, true),
                          color: _liked.contains(id) ? Colors.pink : null,
                          icon: Icon(_liked.contains(id) ? Icons.favorite : Icons.favorite_border),
                        ),
                        Text('${t['likes_count'] ?? 0}'),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(20),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (!_loading && _items.isEmpty && _error == null)
          const Padding(
            padding: EdgeInsets.all(28),
            child: Center(child: Text('No threads yet. Start the first conversation.')),
          ),
        if (!_loading && _hasMore && _items.isNotEmpty)
          Center(
            child: TextButton(onPressed: _load, child: const Text('Load more')),
          ),
      ],
    ),
  );
}
