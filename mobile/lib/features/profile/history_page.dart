import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  SupabaseClient get _db => Supabase.instance.client;
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  bool _clearing = false;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final userId = _db.auth.currentUser?.id;
      if (userId == null) {
        if (mounted && generation == _generation) {
          setState(() {
            _posts = [];
            _error = 'Sign in to view your browsing history.';
          });
        }
        return;
      }

      final historyRows = await _db
          .from('browsing_history')
          .select('entity_type,entity_id,created_at')
          .eq('user_id', userId)
          .eq('entity_type', 'post')
          .order('created_at', ascending: false)
          .limit(50)
          .timeout(const Duration(seconds: 15));

      final orderedIds = <String>[];
      final viewedAt = <String, dynamic>{};
      for (final row in historyRows) {
        final id = '${row['entity_id'] ?? ''}';
        if (id.isEmpty || viewedAt.containsKey(id)) continue;
        orderedIds.add(id);
        viewedAt[id] = row['created_at'];
      }

      if (orderedIds.isEmpty) {
        if (mounted && generation == _generation) {
          setState(() => _posts = []);
        }
        return;
      }

      final postRows = await _db
          .from('posts')
          .select('*')
          .inFilter('id', orderedIds)
          .isFilter('deleted_at', null)
          .timeout(const Duration(seconds: 15));
      final byId = <String, Map<String, dynamic>>{
        for (final row in postRows)
          '${row['id']}': Map<String, dynamic>.from(row as Map),
      };
      final authorIds = byId.values
          .map((post) => '${post['author_id'] ?? post['user_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      final profileRows = authorIds.isEmpty
          ? <dynamic>[]
          : await _db
              .from('profiles')
              .select('id,username,display_name,avatar_url,verified')
              .inFilter('id', authorIds)
              .timeout(const Duration(seconds: 15));
      final profiles = <String, Map<String, dynamic>>{
        for (final row in profileRows)
          '${row['id']}': Map<String, dynamic>.from(row as Map),
      };

      final orderedPosts = <Map<String, dynamic>>[];
      for (final id in orderedIds) {
        final post = byId[id];
        if (post == null) continue;
        post['profile'] = profiles['${post['author_id'] ?? post['user_id']}'];
        post['_viewed_at'] = viewedAt[id];
        orderedPosts.add(post);
      }
      if (mounted && generation == _generation) {
        setState(() => _posts = orderedPosts);
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error =
            'Browsing history could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _clearHistory() async {
    final userId = _db.auth.currentUser?.id;
    if (userId == null || _clearing) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear browsing history?'),
        content: const Text(
          'This removes your browsing-history records. It does not delete the posts themselves.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Clear history'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _clearing = true;
      _error = null;
    });
    try {
      await _db
          .from('browsing_history')
          .delete()
          .eq('user_id', userId)
          .timeout(const Duration(seconds: 15));
      if (mounted) {
        setState(() => _posts = []);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Browsing history cleared.')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not clear browsing history. Retry.')),
        );
      }
    } finally {
      if (mounted) setState(() => _clearing = false);
    }
  }

  String _initial(String value) =>
      value.trim().isEmpty ? 'T' : value.trim()[0].toUpperCase();

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(14),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Browsing history',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh history',
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            const Text('Posts you have viewed recently.'),
            if (_posts.isNotEmpty) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _clearing ? null : _clearHistory,
                icon: _clearing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.delete_sweep_outlined),
                label: Text(_clearing ? 'Clearing…' : 'Clear all history'),
              ),
            ],
            if (_loading && _posts.isEmpty)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Text(_error!),
                    TextButton(onPressed: _load, child: const Text('Retry')),
                  ],
                ),
              ),
            if (!_loading && _posts.isEmpty && _error == null)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Center(
                  child: Column(
                    children: [
                      Icon(Icons.history_rounded, size: 42),
                      SizedBox(height: 10),
                      Text('No browsing history yet.'),
                      SizedBox(height: 4),
                      Text('Posts you view will appear here.'),
                    ],
                  ),
                ),
              ),
            ..._posts.map((post) {
              final profile = post['profile'] as Map<String, dynamic>? ?? {};
              final name =
                  '${profile['display_name'] ?? profile['username'] ?? 'Testagram user'}';
              final username = '${profile['username'] ?? ''}';
              final body = '${post['content'] ?? post['body'] ?? ''}';
              final image = '${post['image_url'] ?? ''}';
              final video = '${post['video_url'] ?? ''}';
              return Card(
                margin: const EdgeInsets.only(top: 10),
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          CircleAvatar(
                            child: Text(_initial(name)),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(name,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w800)),
                                if (username.isNotEmpty)
                                  Text('@$username',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodySmall),
                              ],
                            ),
                          ),
                          if (profile['verified'] == true)
                            const Icon(Icons.verified_rounded, size: 18),
                        ],
                      ),
                      if (body.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: SelectableText(body),
                        ),
                      if (image.startsWith('https://'))
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Image.network(
                            image,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) =>
                                const SizedBox.shrink(),
                          ),
                        ),
                      if (video.startsWith('https://'))
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: SelectableText('Video: $video'),
                        ),
                      const Divider(height: 22),
                      Row(
                        children: [
                          const Icon(Icons.history_rounded, size: 16),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              'Viewed ${post['_viewed_at'] ?? 'recently'}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                          IconButton(
                            tooltip: 'Copy post link',
                            onPressed: () async {
                              final id = '${post['id']}';
                              await Clipboard.setData(ClipboardData(
                                  text: '${Uri.parse('https://testagram.site/post/$id')}'));
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                      content: Text('Post link copied.')),
                                );
                              }
                            },
                            icon: const Icon(Icons.link_rounded),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ),
      );
}
