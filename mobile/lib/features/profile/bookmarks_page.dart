import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class BookmarksPage extends StatefulWidget {
  const BookmarksPage({super.key});

  @override
  State<BookmarksPage> createState() => _BookmarksPageState();
}

class _BookmarksPageState extends State<BookmarksPage> {
  SupabaseClient get _db => Supabase.instance.client;
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  final Set<String> _removing = {};

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
      final userId = _db.auth.currentUser?.id;
      if (userId == null) {
        throw StateError('Sign in to view your saved posts.');
      }
      final saved = await _db
          .from('bookmarks')
          .select('post_id,created_at')
          .eq('user_id', userId)
          .order('created_at', ascending: false)
          .limit(100)
          .timeout(const Duration(seconds: 15));
      final bookmarkRows =
          saved.map((row) => Map<String, dynamic>.from(row as Map)).toList();
      final ids = bookmarkRows
          .map((row) => '${row['post_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      if (ids.isEmpty) {
        if (mounted) setState(() => _items = []);
        return;
      }
      final posts = await _db
          .from('posts')
          .select('*')
          .inFilter('id', ids)
          .isFilter('deleted_at', null)
          .timeout(const Duration(seconds: 15));
      final byId = <String, Map<String, dynamic>>{
        for (final row in posts)
          '${row['id']}': Map<String, dynamic>.from(row as Map),
      };
      final ordered = <Map<String, dynamic>>[];
      for (final bookmark in bookmarkRows) {
        final post = byId['${bookmark['post_id']}'];
        if (post != null) {
          ordered.add({...post, '_saved_at': bookmark['created_at']});
        }
      }
      if (mounted) setState(() => _items = ordered);
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Saved posts could not load. Check your connection and try again.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _remove(String postId) async {
    if (_removing.contains(postId)) return;
    setState(() => _removing.add(postId));
    try {
      await _db.rpc('testagram_bookmark_remove', params: {
        'p_post_id': postId,
      }).timeout(const Duration(seconds: 15));
      if (mounted) {
        setState(() {
          _items.removeWhere((item) => '${item['id']}' == postId);
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not remove this saved post.')),
        );
      }
    } finally {
      if (mounted) setState(() => _removing.remove(postId));
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Saved posts',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            Text([
              'Posts you bookmarked for later.',
              'Only you can manage your saved list.',
            ].join(' ')),
            const SizedBox(height: 12),
            if (_loading && _items.isEmpty)
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
            if (!_loading && _items.isEmpty && _error == null)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: Text('No saved posts yet.')),
              ),
            ..._items.map((post) {
              final id = '${post['id']}';
              final body = '${post['content'] ?? post['body'] ?? ''}';
              final image = '${post['image_url'] ?? ''}';
              final video = '${post['video_url'] ?? ''}';
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(body.isEmpty ? 'Media post' : body),
                      if (image.startsWith('https://'))
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: Image.network(
                            image,
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
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${post['created_at'] ?? ''}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                          TextButton.icon(
                            onPressed: _removing.contains(id)
                                ? null
                                : () => _remove(id),
                            icon: _removing.contains(id)
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.bookmark_remove_outlined),
                            label: const Text('Remove'),
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
