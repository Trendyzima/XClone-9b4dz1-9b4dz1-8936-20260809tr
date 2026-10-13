import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'post_interaction_policy.dart';

enum PostInteractionKind { likes, replies, reposts, quotes, quoteLikes }

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
  String? _notice;
  Map<String, dynamic>? _rootPost;
  List<Map<String, dynamic>> _items = [];
  final TextEditingController _replyText = TextEditingController();
  bool _sendingReply = false;
  int _generation = 0;

  String get _title => switch (widget.kind) {
        PostInteractionKind.likes => 'Likes',
        PostInteractionKind.replies => 'Replies',
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
  void dispose() {
    _generation++;
    _replyText.dispose();
    super.dispose();
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
      _notice = null;
      _rootPost = null;
    });
    try {
      if (widget.postId.trim().isEmpty) {
        throw StateError(
            'Post ID or remote post URI is missing. Open this list from the original post.');
      }
      if (PostInteractionPolicy.isRemotePostId(widget.postId)) {
        final root = await _db
            .from('federated_objects')
            .select(
                'uri,actor_uri,content,summary,published_at,like_count,announce_count,reply_count,quote_count,deleted_at,tombstone')
            .eq('uri', widget.postId)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        if (root == null ||
            root['deleted_at'] != null ||
            root['tombstone'] == true) {
          throw StateError('This federated post is unavailable.');
        }
        dynamic remoteData;
        switch (widget.kind) {
          case PostInteractionKind.replies:
            remoteData = await _db
                .from('federated_objects')
                .select(
                    'uri,actor_uri,content,summary,published_at,in_reply_to_uri,deleted_at,tombstone')
                .eq('in_reply_to_uri', widget.postId)
                .isFilter('deleted_at', null)
                .eq('tombstone', false)
                .order('published_at', ascending: false)
                .limit(PostInteractionPolicy.boundedListLimit(100))
                .timeout(const Duration(seconds: 15));
            break;
          case PostInteractionKind.quotes:
            remoteData = await _db
                .from('federated_objects')
                .select(
                    'uri,actor_uri,content,summary,published_at,quote_uri,deleted_at,tombstone')
                .eq('quote_uri', widget.postId)
                .isFilter('deleted_at', null)
                .eq('tombstone', false)
                .order('published_at', ascending: false)
                .limit(PostInteractionPolicy.boundedListLimit(100))
                .timeout(const Duration(seconds: 15));
            break;
          case PostInteractionKind.likes:
          case PostInteractionKind.reposts:
          case PostInteractionKind.quoteLikes:
            remoteData = <dynamic>[];
            break;
        }
        final remoteRows = (remoteData as List)
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
        final actorUris = remoteRows
            .map((row) => '${row['actor_uri'] ?? ''}')
            .where((id) => id.isNotEmpty)
            .toSet()
            .toList();
        final actors = actorUris.isEmpty
            ? <dynamic>[]
            : await _db
                .from('federated_actors')
                .select('actor_uri,username,domain,display_name,avatar_url')
                .inFilter('actor_uri', actorUris)
                .timeout(const Duration(seconds: 12));
        final actorByUri = <String, Map<String, dynamic>>{
          for (final actor in actors)
            '${actor['actor_uri']}': Map<String, dynamic>.from(actor),
        };
        for (final row in remoteRows) {
          row['profile'] = actorByUri['${row['actor_uri']}'];
        }
        if (!mounted || generation != _generation) return;
        setState(() {
          _rootPost = Map<String, dynamic>.from(root as Map);
          _items = remoteRows;
          if (widget.kind == PostInteractionKind.likes ||
              widget.kind == PostInteractionKind.reposts ||
              widget.kind == PostInteractionKind.quoteLikes) {
            _notice =
                'This remote server does not expose a complete public actor list for this interaction. The original post and available interaction counts are shown above.';
          }
          _loading = false;
        });
        return;
      }
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
      _rootPost = Map<String, dynamic>.from(post as Map);

      List<Map<String, dynamic>> rows;
      Map<String, String> quoteContentById = {};
      if (widget.kind == PostInteractionKind.replies) {
        final data = await _db
            .from('replies')
            .select('id,user_id,post_id,content,created_at,parent_reply_id')
            .eq('post_id', widget.postId)
            .order('created_at', ascending: false)
            .limit(PostInteractionPolicy.boundedListLimit(100))
            .timeout(const Duration(seconds: 15));
        rows = data.map((row) => Map<String, dynamic>.from(row)).toList();
      } else if (widget.kind == PostInteractionKind.likes) {
        final data = await _db
            .from('post_reactions')
            .select('id,user_id,post_id,created_at')
            .eq('post_id', widget.postId)
            .eq('emoji', '❤️')
            .order('created_at', ascending: false)
            .limit(PostInteractionPolicy.boundedListLimit(100))
            .timeout(const Duration(seconds: 15));
        rows = data.map((row) => Map<String, dynamic>.from(row)).toList();
      } else if (widget.kind == PostInteractionKind.reposts) {
        final data = await _db
            .from('reposts')
            .select('id,user_id,post_id,created_at')
            .eq('post_id', widget.postId)
            .order('created_at', ascending: false)
            .limit(PostInteractionPolicy.boundedListLimit(100))
            .timeout(const Duration(seconds: 15));
        rows = data.map((row) => Map<String, dynamic>.from(row)).toList();
      } else {
        final quoteRows = await _db
            .from('posts')
            .select('id,content,created_at,user_id,author_id')
            .eq('quoted_post_id', widget.postId)
            .isFilter('deleted_at', null)
            .order('created_at', ascending: false)
            .limit(PostInteractionPolicy.boundedListLimit(100))
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
                .limit(PostInteractionPolicy.boundedListLimit(100))
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

  Future<void> _sendReply() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      context.go('/auth');
      return;
    }
    final content = _replyText.text.trim();
    if (PostInteractionPolicy.validateComposerText(content) != null ||
        _sendingReply) {
      return;
    }
    setState(() {
      _sendingReply = true;
      _error = null;
    });
    try {
      if (PostInteractionPolicy.isRemotePostId(widget.postId)) {
        final response = await _db.functions.invoke('testagram-api', body: {
          'path': '/reply',
          'method': 'POST',
          'body': {'post_id': widget.postId, 'content': content},
        }).timeout(const Duration(seconds: 30));
        if (response.data is Map && (response.data as Map)['error'] != null) {
          throw StateError('The federation service rejected this reply.');
        }
      } else {
        final result = await _db.rpc('capability_dispatch', params: {
          'p_capability': 'testagram.replies.create',
          'p_input': {'post_id': widget.postId, 'content': content},
        }).timeout(const Duration(seconds: 20));
        if (result is! Map || result['created'] != true) {
          throw StateError('The reply service did not confirm the reply.');
        }
      }
      if (!mounted) return;
      _replyText.clear();
      await _load();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e is StateError
              ? e.message.toString()
              : 'Reply could not be sent. Check your connection and permissions, then retry.';
        });
      }
    } finally {
      if (mounted) setState(() => _sendingReply = false);
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
      bottomNavigationBar: widget.kind == PostInteractionKind.replies &&
              _db.auth.currentUser != null
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _replyText,
                        onChanged: (_) => setState(() {}),
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 5000,
                        enabled: !_sendingReply,
                        decoration: const InputDecoration(
                          hintText: 'Write a reply…',
                          border: OutlineInputBorder(),
                          counterText: '',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      tooltip: 'Send reply',
                      onPressed: _sendingReply ||
                              PostInteractionPolicy.validateComposerText(
                                      _replyText.text) !=
                                  null
                          ? null
                          : _sendReply,
                      icon: _sendingReply
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send),
                    ),
                  ],
                ),
              ),
            )
          : null,
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
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(12),
                    children: [
                      if (_rootPost != null)
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Original post',
                                    style:
                                        Theme.of(context).textTheme.labelLarge),
                                const SizedBox(height: 6),
                                SelectableText(
                                  '${_rootPost!['content'] ?? _rootPost!['summary'] ?? ''}',
                                ),
                                if (_rootPost!['published_at'] != null ||
                                    _rootPost!['created_at'] != null)
                                  Text(
                                    '${_rootPost!['published_at'] ?? _rootPost!['created_at']}',
                                    style:
                                        Theme.of(context).textTheme.bodySmall,
                                  ),
                                if (_rootPost!['like_count'] != null ||
                                    _rootPost!['likes_count'] != null)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: Text(
                                      '${_rootPost!['like_count'] ?? _rootPost!['likes_count'] ?? 0} likes · ${_rootPost!['reply_count'] ?? _rootPost!['replies_count'] ?? 0} replies · ${_rootPost!['announce_count'] ?? _rootPost!['reposts_count'] ?? 0} reposts',
                                      style:
                                          Theme.of(context).textTheme.bodySmall,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      if (_notice != null)
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(_notice!, textAlign: TextAlign.center),
                        ),
                      if (_items.isEmpty && _notice == null)
                        Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text('No ${_title.toLowerCase()} yet.',
                              textAlign: TextAlign.center),
                        ),
                      ..._items.map((item) {
                        final profile =
                            item['profile'] as Map<String, dynamic>?;
                        final name = _displayName(profile);
                        final username = '${profile?['username'] ?? ''}';
                        final avatar = '${profile?['avatar_url'] ?? ''}';
                        final detail = switch (widget.kind) {
                          PostInteractionKind.replies =>
                            '${item['content'] ?? 'Replied to this post'}',
                          PostInteractionKind.quotes =>
                            '${item['content'] ?? 'Quoted this post'}',
                          PostInteractionKind.quoteLikes =>
                            'Liked a quote: ${item['quote_content'] ?? ''}',
                          PostInteractionKind.reposts => 'Reposted this post',
                          PostInteractionKind.likes => 'Liked this post',
                        };
                        return Card(
                          child: ListTile(
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
                            title: Text(name,
                                maxLines: 1, overflow: TextOverflow.ellipsis),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (username.isNotEmpty) Text('@$username'),
                                Text(detail,
                                    maxLines: 3,
                                    overflow: TextOverflow.ellipsis),
                              ],
                            ),
                            isThreeLine: username.isNotEmpty,
                            onTap: username.isEmpty
                                ? null
                                : () => context.push('/profile/$username'),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
    );
  }
}
