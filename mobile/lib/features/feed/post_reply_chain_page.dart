import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'post_interaction_policy.dart';

/// Reply-chain view using the local replies parent_reply_id contract or the
/// federated object's canonical URI contract. Never treats a missing remote
/// reply as the root post.
class PostReplyChainPage extends StatefulWidget {
  const PostReplyChainPage({super.key, required this.postId, required this.replyId});
  final String postId;
  final String replyId;
  @override
  State<PostReplyChainPage> createState() => _PostReplyChainPageState();
}

class _PostReplyChainPageState extends State<PostReplyChainPage> {
  SupabaseClient get _db => Supabase.instance.client;
  final _text = TextEditingController();
  Map<String, dynamic>? _root;
  Map<String, dynamic>? _selected;
  List<Map<String, dynamic>> _children = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  int _generation = 0;
  bool get _remote => PostInteractionPolicy.isRemotePostId(widget.postId);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PostReplyChainPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.postId != widget.postId || oldWidget.replyId != widget.replyId) {
      _load();
    }
  }

  @override
  void dispose() {
    _generation++;
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (widget.postId.isEmpty || widget.replyId.isEmpty) {
        throw StateError('Both the post URI and reply ID are required.');
      }
      if (_remote) {
        final results = await Future.wait<dynamic>([
          _db
              .from('federated_objects')
              .select('uri,actor_uri,content,summary,published_at,deleted_at,tombstone')
              .eq('uri', widget.postId)
              .maybeSingle()
              .timeout(const Duration(seconds: 15)),
          _db
              .from('federated_objects')
              .select(
                'uri,actor_uri,content,summary,published_at,in_reply_to_uri,deleted_at,tombstone',
              )
              .eq('uri', widget.replyId)
              .maybeSingle()
              .timeout(const Duration(seconds: 15)),
          _db
              .from('federated_objects')
              .select(
                'uri,actor_uri,content,summary,published_at,in_reply_to_uri,deleted_at,tombstone',
              )
              .eq('in_reply_to_uri', widget.replyId)
              .isFilter('deleted_at', null)
              .eq('tombstone', false)
              .order('published_at')
              .limit(PostInteractionPolicy.boundedListLimit(100))
              .timeout(const Duration(seconds: 15)),
        ]);
        if (results[0] == null) {
          throw StateError('The original federated post is unavailable.');
        }
        if (results[1] == null) {
          throw StateError(
            'The selected reply was not found. It may not be cached or may no longer be visible.',
          );
        }
        if (results[1]['deleted_at'] != null || results[1]['tombstone'] == true) {
          throw StateError('The selected reply is no longer available.');
        }
        if (!mounted || generation != _generation) return;
        setState(() {
          _root = Map<String, dynamic>.from(results[0] as Map);
          _selected = Map<String, dynamic>.from(results[1] as Map);
          _children = (results[2] as List)
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
        });
      } else {
        final results = await Future.wait<dynamic>([
          _db
              .from('posts')
              .select('id,content,author_id,user_id,created_at,deleted_at')
              .eq('id', widget.postId)
              .isFilter('deleted_at', null)
              .maybeSingle()
              .timeout(const Duration(seconds: 15)),
          _db
              .from('replies')
              .select('id,post_id,user_id,content,created_at,parent_reply_id,updated_at')
              .eq('id', widget.replyId)
              .eq('post_id', widget.postId)
              .maybeSingle()
              .timeout(const Duration(seconds: 15)),
          _db
              .from('replies')
              .select('id,post_id,user_id,content,created_at,parent_reply_id,updated_at')
              .eq('post_id', widget.postId)
              .eq('parent_reply_id', widget.replyId)
              .order('created_at')
              .limit(PostInteractionPolicy.boundedListLimit(100))
              .timeout(const Duration(seconds: 15)),
        ]);
        if (results[0] == null) {
          throw StateError('The original post is unavailable.');
        }
        if (results[1] == null) {
          throw StateError('The selected reply was not found or is no longer visible.');
        }
        if (!mounted || generation != _generation) return;
        setState(() {
          _root = Map<String, dynamic>.from(results[0] as Map);
          _selected = Map<String, dynamic>.from(results[1] as Map);
          _children = (results[2] as List)
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
        });
      }
    } catch (e) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = e is StateError
              ? e.message.toString()
              : 'Reply chain could not load. Check access and connection, then retry.',
        );
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _send() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      context.go('/auth');
      return;
    }
    final content = _text.text.trim();
    if (PostInteractionPolicy.validateComposerText(content) != null || _sending) {
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      if (_remote) {
        final response = await _db.functions
            .invoke(
              'testagram-api',
              body: {
                'path': '/reply',
                'method': 'POST',
                'body': {
                  'post_id': widget.postId,
                  'content': content,
                  'parent_reply_id': widget.replyId,
                },
              },
            )
            .timeout(const Duration(seconds: 30));
        if (response.data is Map && (response.data as Map)['error'] != null) {
          throw StateError('The federation service rejected this reply.');
        }
      } else {
        await _db
            .from('replies')
            .insert({
              'post_id': widget.postId,
              'user_id': user.id,
              'content': content,
              'parent_reply_id': widget.replyId,
            })
            .timeout(const Duration(seconds: 20));
      }
      _text.clear();
      await _load();
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = e is StateError
              ? e.message.toString()
              : 'Reply could not be sent. Check your connection and permissions.',
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reply chain'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            tooltip: 'Refresh',
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
                  if (_error != null) ...[
                    Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                    OutlinedButton(onPressed: _load, child: const Text('Retry')),
                    const SizedBox(height: 8),
                  ],
                  if (_root != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Original post', style: theme.textTheme.labelLarge),
                            const SizedBox(height: 8),
                            SelectableText('${_root!['content'] ?? _root!['summary'] ?? ''}'),
                          ],
                        ),
                      ),
                    ),
                  if (_selected != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Selected reply', style: theme.textTheme.labelLarge),
                            const SizedBox(height: 8),
                            SelectableText(
                              '${_selected!['content'] ?? _selected!['summary'] ?? ''}',
                            ),
                            if (_selected!['published_at'] != null ||
                                _selected!['created_at'] != null)
                              Text(
                                '${_selected!['published_at'] ?? _selected!['created_at']}',
                                style: theme.textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  Text('Replies to this reply', style: theme.textTheme.titleMedium),
                  if (_children.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 18),
                      child: Text('No replies yet.'),
                    ),
                  ..._children.map(
                    (row) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.subdirectory_arrow_right),
                        title: Text('${row['content'] ?? row['summary'] ?? ''}'),
                        subtitle: Text('${row['published_at'] ?? row['created_at'] ?? ''}'),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _text,
                    minLines: 2,
                    maxLines: 5,
                    maxLength: 5000,
                    decoration: const InputDecoration(
                      labelText: 'Reply to this reply',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: _selected == null || _sending || _text.text.trim().isEmpty
                        ? null
                        : _send,
                    icon: _sending
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                    label: Text(_sending ? 'Sending…' : 'Send reply'),
                  ),
                ],
              ),
            ),
    );
  }
}
