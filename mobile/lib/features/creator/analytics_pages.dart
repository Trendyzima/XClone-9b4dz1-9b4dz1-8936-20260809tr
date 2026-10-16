import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class PostAnalyticsPage extends StatefulWidget {
  const PostAnalyticsPage({this.postId, super.key});
  final String? postId;
  @override
  State<PostAnalyticsPage> createState() => _PostAnalyticsPageState();
}

class _PostAnalyticsPageState extends State<PostAnalyticsPage> {
  final _db = Supabase.instance.client;
  bool _loading = true, _detailLoading = false;
  String? _error;
  List<Map<String, dynamic>> _posts = const [], _earnings = const [];
  Map<String, dynamic>? _selected, _analytics;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to view post analytics.';
      });
      return;
    }
    try {
      final rows = await _db
          .from('posts')
          .select(
            'id,content,image_url,video_url,media_urls,is_video,views_count,likes_count,reposts_count,replies_count,created_at',
          )
          .eq('user_id', user.id)
          .order('views_count', ascending: false)
          .limit(50);
      final posts = rows.map((r) => Map<String, dynamic>.from(r)).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _posts = posts;
        _loading = false;
      });
      if (posts.isEmpty) {
        setState(() {
          _selected = null;
          _analytics = null;
          _earnings = const [];
        });
        return;
      }
      Map<String, dynamic>? target;
      if (widget.postId == null) {
        target = posts.first;
      } else {
        for (final post in posts) {
          if ('${post['id']}' == widget.postId) {
            target = post;
            break;
          }
        }
      }
      if (target == null) {
        setState(
          () => _error =
              'That post is unavailable or is not owned by this account.',
        );
        return;
      }
      await _selectPost(target);
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Post analytics could not be loaded. Refresh to retry.';
        });
      }
    }
  }

  Future<void> _selectPost(Map<String, dynamic> post) async {
    if (!mounted) {
      return;
    }
    setState(() {
      _selected = post;
      _detailLoading = true;
      _error = null;
    });
    final user = _db.auth.currentUser;
    if (user == null) {
      setState(() => _detailLoading = false);
      return;
    }
    try {
      final result = await Future.wait<dynamic>([
        _db
            .from('post_analytics')
            .select('views,unique_viewers,engagement_rate,shares')
            .eq('post_id', post['id'])
            .maybeSingle(),
        _db
            .from('creator_earnings')
            .select('id,source_type,amount,currency,status,created_at')
            .eq('post_id', post['id'])
            .eq('creator_id', user.id)
            .order('created_at', ascending: false)
            .limit(50),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _analytics = result[0] == null
            ? null
            : Map<String, dynamic>.from(result[0] as Map);
        _earnings = (result[1] as List)
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        _detailLoading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _detailLoading = false;
          _error = 'Detailed metrics are unavailable. Basic post counters are still shown.';
        });
      }
    }
  }

  int _number(dynamic value) => int.tryParse('$value') ?? 0;
  double _decimal(dynamic value) => double.tryParse('$value') ?? 0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final post = _selected;
    final views = _number(_analytics?['views'] ?? post?['views_count']);
    final unique = _number(_analytics?['unique_viewers']);
    final likes = _number(post?['likes_count']);
    final reposts = _number(post?['reposts_count']);
    final replies = _number(post?['replies_count']);
    final shares = _number(_analytics?['shares']);
    final engagement = _decimal(_analytics?['engagement_rate']);
    final totalEarnings = _earnings.fold<double>(
      0,
      (sum, row) => sum + _decimal(row['amount']),
    );
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Post analytics',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Metrics are taken from the post counters and available analytics records; missing breakdowns are not estimated.',
          ),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          if (!_loading && _posts.isEmpty && _error == null)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text('No posts are available for analytics yet.'),
              ),
            ),
          if (_posts.isNotEmpty) ...[
            DropdownButtonFormField<String>(
              value: post == null ? null : '${post['id']}',
              decoration: const InputDecoration(
                labelText: 'Choose a post',
                border: OutlineInputBorder(),
              ),
              items: _posts
                  .map(
                    (p) => DropdownMenuItem(
                      value: '${p['id']}',
                      child: Text(
                        '${p['content'] ?? 'Post'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _detailLoading
                  ? null
                  : (id) {
                      for (final item in _posts) {
                        if ('${item['id']}' == id) {
                          _selectPost(item);
                          break;
                        }
                      }
                    },
            ),
            const SizedBox(height: 12),
            if (_detailLoading) const LinearProgressIndicator(),
            if (post != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${post['content'] ?? 'Post'}',
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Published ${post['created_at'] ?? 'date unavailable'}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 2,
              childAspectRatio: 1.8,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                _metric('Views', '$views', Icons.visibility_outlined),
                _metric(
                  'Unique viewers',
                  _analytics == null ? 'Unavailable' : '$unique',
                  Icons.people_outline,
                ),
                _metric('Likes', '$likes', Icons.favorite_border),
                _metric('Reposts', '$reposts', Icons.repeat),
                _metric('Replies', '$replies', Icons.chat_bubble_outline),
                _metric(
                  'Shares',
                  _analytics == null ? 'Unavailable' : '$shares',
                  Icons.share_outlined,
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (_analytics != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.trending_up),
                  title: const Text('Recorded engagement rate'),
                  trailing: Text('${engagement.toStringAsFixed(2)}%'),
                ),
              ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.account_balance_wallet_outlined),
                title: const Text('Creator earnings'),
                subtitle: Text('${_earnings.length} recorded entries'),
                trailing: Text(totalEarnings.toStringAsFixed(2)),
              ),
            ),
            for (final row in _earnings)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.receipt_long_outlined),
                  title: Text(
                    '${row['source_type'] ?? 'Earning'} • ${row['status'] ?? 'unknown'}',
                  ),
                  subtitle: Text('${row['created_at'] ?? ''}'),
                  trailing: Text(
                    '${row['currency'] ?? 'KES'} ${_decimal(row['amount']).toStringAsFixed(2)}',
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _metric(String label, String value, IconData icon) => Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 18,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  label,
                  style: const TextStyle(fontSize: 12),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class StoryAnalyticsPage extends StatefulWidget {
  const StoryAnalyticsPage({super.key});
  @override
  State<StoryAnalyticsPage> createState() => _StoryAnalyticsPageState();
}

class _StoryAnalyticsPageState extends State<StoryAnalyticsPage> {
  final _db = Supabase.instance.client;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _stories = const [];
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to view story analytics.';
      });
      return;
    }
    try {
      final rows = await _db
          .from('stories')
          .select('id,caption,created_at,expires_at,metadata')
          .eq('owner_id', user.id)
          .order('created_at', ascending: false)
          .limit(50);
      final stories = rows.map((r) => Map<String, dynamic>.from(r)).toList();
      final ids = stories.map((s) => '${s['id']}').toList();
      Map<String, int> recentCounts = {};
      if (ids.isNotEmpty) {
        try {
          final since = DateTime.now()
              .subtract(const Duration(days: 7))
              .toUtc()
              .toIso8601String();
          final views = await _db
              .from('story_views')
              .select('story_id,viewer_id,viewed_at')
              .inFilter('story_id', ids)
              .gte('viewed_at', since)
              .limit(5000);
          for (final row in views) {
            final id = '${row['story_id']}';
            recentCounts[id] = (recentCounts[id] ?? 0) + 1;
          }
        } catch (_) {
          /* RLS may intentionally hide viewer-level analytics; metadata totals remain available. */
        }
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _stories = stories.map((story) {
          final raw = story['metadata'];
          final metadata = raw is Map
              ? Map<String, dynamic>.from(raw)
              : <String, dynamic>{};
          return {
            ...story,
            'views_total': int.tryParse('${metadata['views_count'] ?? 0}') ?? 0,
            'views_7d': recentCounts['${story['id']}'],
          };
        }).toList();
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Story analytics could not be loaded. Refresh to retry.';
        });
      }
    }
  }

  int _sum(String key) => _stories.fold<int>(
    0,
    (sum, story) => sum + (int.tryParse('${story[key] ?? 0}') ?? 0),
  );
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final active = _stories
        .where(
          (s) =>
              DateTime.tryParse('${s['expires_at'] ?? ''}')
                  ?.isAfter(DateTime.now()) ==
              true,
        )
        .length;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Story analytics',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Story totals use stored view counters. The seven-day count is shown only when viewer analytics are available under your account permissions.',
          ),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          if (!_loading && _stories.isEmpty && _error == null)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text('No stories are available for analytics yet.'),
              ),
            ),
          if (_stories.isNotEmpty)
            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 2,
              childAspectRatio: 1.8,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                _metric(
                  'Total views',
                  '${_sum('views_total')}',
                  Icons.visibility_outlined,
                ),
                _metric(
                  'Stories posted',
                  '${_stories.length}',
                  Icons.auto_stories_outlined,
                ),
                _metric('Active stories', '$active', Icons.timelapse),
                _metric(
                  'Recent views (7d)',
                  _stories.any((s) => s['views_7d'] != null)
                      ? '${_sum('views_7d')}'
                      : 'Unavailable',
                  Icons.trending_up,
                ),
              ],
            ),
          for (final story in _stories)
            Card(
              child: ListTile(
                leading: const Icon(Icons.auto_stories_outlined),
                title: Text(
                  '${story['caption'] ?? 'Story'}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  'Posted ${story['created_at'] ?? ''} • ${DateTime.tryParse('${story['expires_at'] ?? ''}')?.isAfter(DateTime.now()) == true ? 'Active' : 'Expired'}',
                ),
                trailing: Text('${story['views_total'] ?? 0} views'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value, IconData icon) => Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 20),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          Text(label, style: const TextStyle(fontSize: 12)),
        ],
      ),
    ),
  );
}
