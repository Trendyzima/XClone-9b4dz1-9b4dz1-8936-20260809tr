import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

enum PostInteractionKind { likes, reposts, quotes, quoteLikes }

class PostInteractionPage extends StatefulWidget {
  const PostInteractionPage({
    required this.postId,
    required this.kind,
    super.key,
  });

  final String postId;
  final PostInteractionKind kind;

  @override
  State<PostInteractionPage> createState() => _PostInteractionPageState();
}

class _PostInteractionPageState extends State<PostInteractionPage> {
  SupabaseClient get _db => Supabase.instance.client;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _items = [];
  int _generation = 0;

  String get _title => switch (widget.kind) {
        PostInteractionKind.likes => 'Likes',
        PostInteractionKind.reposts => 'Reposts',
        PostInteractionKind.quotes => 'Quotes',
        PostInteractionKind.quoteLikes => 'Likes on quotes',
      };

  String _displayName(Map<String, dynamic>? profile) {
    final displayName = profile?['display_name'];
    if (displayName != null && displayName.toString().trim().isNotEmpty) {
      return displayName.toString();
    }
    final username = profile?['username'];
    if (username != null && username.toString().trim().isNotEmpty) {
      return username.toString();
    }
    return 'Testagram user';
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PostInteractionPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.postId != widget.postId || oldWidget.kind != widget.kind) {
      _load();
    }
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final post = await _db
          .from('posts')
          .select('id,content,created_at,user_id,author_id')
          .eq('id', widget.postId)
          .isFilter('deleted_at', null)
          .maybeSingle()
          .timeout(const Duration(seconds: 15));
      if (post == null) {
        throw StateError('This post is unavailable.');
      }

      List<Map<String, dynamic>> rows;
      Map<String, String> quoteContentById = {};
      if (widget.kind == PostInteractionKind.likes) {
        final data = await _db
            .from('post_reactions')
            .select('id,user_id,post_id,created_at')
            .eq('post_id', widget.postId)
            .eq('emoji', '❤️')
            .order('created_at', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        rows = data.map((row) => Map<String, dynamic>.from(row)).toList();
      } else if (widget.kind == PostInteractionKind.reposts) {
        final data = await _db
            .from('reposts')
            .select('id,user_id,post_id,created_at')
            .eq('post_id', widget.postId)
            .order('created_at', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        rows = data.map((row) => Map<String, dynamic>.from(row)).toList();
      } else {
        final quoteRows = await _db
            .from('posts')
            .select('id,content,created_at,user_id,author_id')
            .eq('quoted_post_id', widget.postId)
            .isFilter('deleted_at', null)
            .order('created_at', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        final quotes =
            quoteRows.map((row) => Map<String, dynamic>.from(row)).toList();
        quoteContentById = {
          for (final quote in quotes)
            '${quote['id']}': '${quote['content'] ?? ''}',
        };
        if (widget.kind == PostInteractionKind.quotes) {
          rows = quotes;
        } else {
          final quoteIds = quotes
              .map((quote) => '${quote['id'] ?? ''}')
              .where((id) => id.isNotEmpty)
              .toList();
          if (quoteIds.isEmpty) {
            rows = [];
          } else {
            final data = await _db
                .from('post_reactions')
                .select('id,user_id,post_id,created_at')
                .inFilter('post_id', quoteIds)
                .eq('emoji', '❤️')
                .order('created_at', ascending: false)
                .limit(100)
                .timeout(const Duration(seconds: 15));
            rows = data.map((row) => Map<String, dynamic>.from(row)).toList();
          }
        }
      }

      final userIds = rows
          .map((row) => '${row['author_id'] ?? row['user_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      final profiles = userIds.isEmpty
          ? <dynamic>[]
          : await _db
              .from('profiles')
              .select('id,username,display_name,avatar_url,verified')
              .inFilter('id', userIds)
              .timeout(const Duration(seconds: 12));
      final profileById = <String, Map<String, dynamic>>{
        for (final profile in profiles)
          '${profile['id']}': Map<String, dynamic>.from(profile),
      };
      final enriched = rows.map((row) {
        final userId = '${row['author_id'] ?? row['user_id'] ?? ''}';
        return <String, dynamic>{
          ...row,
          'profile': profileById[userId],
          'quote_content': quoteContentById['${row['post_id'] ?? row['id']}'],
        };
      }).toList();

      if (!mounted || generation != _generation) return;
      setState(() {
        _items = enriched;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = 'Could not load this list. Check your connection and retry.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_title),
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => context.pop(),
          icon: const Icon(Icons.arrow_back),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _load,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : _items.isEmpty
                  ? Center(child: Text('No ${_title.toLowerCase()} yet.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        physics: const AlwaysScrollableScrollPhysics(),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) =>
                            const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final profile =
                              item['profile'] as Map<String, dynamic>?;
                          final name = _displayName(profile);
                          final username = '${profile?['username'] ?? ''}';
                          final avatar = '${profile?['avatar_url'] ?? ''}';
                          final detail = switch (widget.kind) {
                            PostInteractionKind.quotes =>
                              '${item['content'] ?? 'Quoted this post'}',
                            PostInteractionKind.quoteLikes =>
                              'Liked a quote: ${item['quote_content'] ?? ''}',
                            PostInteractionKind.reposts => 'Reposted this post',
                            PostInteractionKind.likes => 'Liked this post',
                          };
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundImage: avatar.startsWith('http')
                                  ? NetworkImage(avatar)
                                  : null,
                              child: avatar.startsWith('http')
                                  ? null
                                  : Text(name.isEmpty
                                      ? 'T'
                                      : name[0].toUpperCase()),
                            ),
                            title: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (username.isNotEmpty) Text('@$username'),
                                Text(
                                  detail,
                                  maxLines: 3,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                            isThreeLine: username.isNotEmpty,
                            onTap: username.isEmpty
                                ? null
                                : () => context.push('/profile/$username'),
                          );
                        },
                      ),
                    ),
    );
  }
}
