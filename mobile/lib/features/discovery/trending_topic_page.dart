import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class TrendingTopicPage extends StatefulWidget {
  const TrendingTopicPage({super.key, required this.topic});
  final String topic;
  @override
  State<TrendingTopicPage> createState() => _TrendingTopicPageState();
}

class _TrendingTopicPageState extends State<TrendingTopicPage> {
  final _db = Supabase.instance.client;
  Map<String, dynamic>? _trend;
  Map<String, dynamic>? _hashtag;
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  bool _following = false;
  bool _working = false;
  String? _error;
  String get _tag =>
      Uri.decodeComponent(widget.topic).replaceFirst(RegExp(r'^#'), '').trim();
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant TrendingTopicPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.topic != widget.topic) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final trend = await _db
          .from('trending_topics')
          .select('*')
          .eq('topic', _tag)
          .maybeSingle()
          .timeout(const Duration(seconds: 12));
      final hashtag = await _db
          .from('hashtags')
          .select('id,tag,usage_count')
          .eq('tag', _tag.replaceFirst(RegExp(r'^#'), ''))
          .maybeSingle()
          .timeout(const Duration(seconds: 12));
      final user = _db.auth.currentUser;
      var following = false;
      if (user != null && hashtag != null) {
        final row = await _db
            .from('hashtag_follows')
            .select('id')
            .eq('user_id', user.id)
            .eq('hashtag_id', hashtag['id'])
            .maybeSingle();
        following = row != null;
      }
      final since = DateTime.now()
          .toUtc()
          .subtract(const Duration(days: 7))
          .toIso8601String();
      final posts = await _db
          .from('posts')
          .select(
            'id,user_id,content,image_url,video_url,media_urls,likes_count,reposts_count,replies_count,created_at,profiles!posts_user_id_fkey(username,display_name,avatar_url,verified_tier)',
          )
          .ilike(
            'content',
            '%${_tag.replaceAll('%', r'\%').replaceAll('_', r'\_')}%',
          )
          .gte('created_at', since)
          .isFilter('deleted_at', null)
          .order('likes_count', ascending: false)
          .limit(60)
          .timeout(const Duration(seconds: 20));
      final items =
          posts.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      items.sort(
        (a, b) => ((b['likes_count'] as num?)?.toInt() ?? 0).compareTo(
          (a['likes_count'] as num?)?.toInt() ?? 0,
        ),
      );
      if (mounted) {
        setState(() {
          _trend = trend;
          _hashtag =
              hashtag == null ? null : Map<String, dynamic>.from(hashtag);
          _posts = items;
          _following = following;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Trending topic could not load. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleFollow() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) context.go('/auth');
      return;
    }
    final hashtag = _hashtag;
    if (hashtag == null) {
      setState(
        () => _error = 'This topic has no registered hashtag to follow yet.',
      );
      return;
    }
    setState(() => _working = true);
    try {
      if (_following) {
        await _db
            .from('hashtag_follows')
            .delete()
            .eq('user_id', user.id)
            .eq('hashtag_id', hashtag['id']);
      } else {
        await _db.from('hashtag_follows').insert({
          'user_id': user.id,
          'hashtag_id': hashtag['id'],
        });
      }
      if (mounted) setState(() => _following = !_following);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not update hashtag follow. Retry.');
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Trending topic'),
          actions: [
            IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '#$_tag',
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${_trend?['category'] ?? 'Trending'} · ${_trend?['posts_count'] ?? _hashtag?['usage_count'] ?? 0} posts',
                            ),
                            if (_trend?['description'] is String)
                              Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Text('${_trend!['description']}'),
                              ),
                            const SizedBox(height: 10),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: OutlinedButton.icon(
                                onPressed: _working ? null : _toggleFollow,
                                icon:
                                    Icon(_following ? Icons.check : Icons.add),
                                label: Text(
                                  _following ? 'Following' : 'Follow hashtag',
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_error != null)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.error_outline),
                          title: Text(_error!),
                          trailing: IconButton(
                            onPressed: _load,
                            icon: const Icon(Icons.refresh),
                          ),
                        ),
                      ),
                    Text(
                      'Recent posts',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    if (_posts.isEmpty && _error == null)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Text('No recent posts found for this topic.'),
                      ),
                    for (final post in _posts)
                      Card(
                        child: ListTile(
                          leading: CircleAvatar(
                            child: Text(
                              ('${(post['profiles'] is Map ? (post['profiles'] as Map)['username'] : 'U') ?? 'U'}')
                                  .characters
                                  .first
                                  .toUpperCase(),
                            ),
                          ),
                          title: Text(
                            '${(post['profiles'] is Map ? (post['profiles'] as Map)['username'] : null) ?? 'Testagram user'}',
                          ),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              '${post['content'] ?? ''}\n♥ ${post['likes_count'] ?? 0}   ↻ ${post['reposts_count'] ?? 0}   ◯ ${post['replies_count'] ?? 0}',
                              maxLines: 6,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          isThreeLine: true,
                        ),
                      ),
                  ],
                ),
              ),
      );
}
