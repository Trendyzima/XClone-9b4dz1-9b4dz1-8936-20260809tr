import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

class PostDetailPage extends StatefulWidget {
  const PostDetailPage({super.key, required this.postId, this.repliesOnly = false});

  final String postId;
  final bool repliesOnly;

  @override
  State<PostDetailPage> createState() => _PostDetailPageState();
}

class _PostDetailPageState extends State<PostDetailPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  final _reply = TextEditingController();
  Map<String, dynamic>? _post;
  List<Map<String, dynamic>> _replies = [];
  bool _liked = false;
  bool _bookmarked = false;
  bool _reposted = false;
  bool _loading = true;
  bool _sending = false;
  bool _busy = false;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PostDetailPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.postId != widget.postId) _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
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
          .select('*')
          .eq('id', widget.postId)
          .isFilter('deleted_at', null)
          .maybeSingle()
          .timeout(const Duration(seconds: 15));
      if (post == null) {
        throw StateError('This post was deleted or is unavailable.');
      }

      final authorId = '${post['author_id'] ?? post['user_id'] ?? ''}';
      final profile = authorId.isEmpty
          ? null
          : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url,verified,verified_tier')
                .eq('id', authorId)
                .maybeSingle()
                .timeout(const Duration(seconds: 12));
      final replyRows = await _db
          .from('replies')
          .select('id,user_id,post_id,content,created_at')
          .eq('post_id', widget.postId)
          .order('created_at', ascending: true)
          .limit(100)
          .timeout(const Duration(seconds: 15));
      final replies = replyRows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
      final replyUserIds = replies
          .map((row) => '${row['user_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      final replyProfiles = replyUserIds.isEmpty
          ? <dynamic>[]
          : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url,verified')
                .inFilter('id', replyUserIds)
                .timeout(const Duration(seconds: 12));
      final replyProfilesById = <String, Map<String, dynamic>>{
        for (final row in replyProfiles) '${row['id']}': Map<String, dynamic>.from(row as Map),
      };
      for (final reply in replies) {
        reply['profile'] = replyProfilesById['${reply['user_id']}'];
      }

      final uid = _uid;
      var liked = false;
      var bookmarked = false;
      var reposted = false;
      if (uid != null) {
        final interactions = await Future.wait([
          _db
              .from('post_reactions')
              .select('id')
              .eq('user_id', uid)
              .eq('post_id', widget.postId)
              .eq('emoji', '❤️')
              .limit(1),
          _db
              .from('bookmarks')
              .select('post_id')
              .eq('user_id', uid)
              .eq('post_id', widget.postId)
              .limit(1),
          _db
              .from('reposts')
              .select('post_id')
              .eq('user_id', uid)
              .eq('post_id', widget.postId)
              .limit(1),
        ]);
        liked = (interactions[0] as List).isNotEmpty;
        bookmarked = (interactions[1] as List).isNotEmpty;
        reposted = (interactions[2] as List).isNotEmpty;
        // Record a view using the same event table and fields as the web history.
        try {
          await _db.from('browsing_history').insert({
            'user_id': uid,
            'entity_type': 'post',
            'entity_id': widget.postId,
            'post_id': widget.postId,
            'view_type': 'post',
          });
        } catch (_) {
          // Viewing remains available if history recording is blocked by policy.
        }
      }
      if (!mounted || generation != _generation) return;
      setState(() {
        _post = {
          ...Map<String, dynamic>.from(post),
          'profile': profile == null ? null : Map<String, dynamic>.from(profile),
        };
        _replies = replies;
        _liked = liked;
        _bookmarked = bookmarked;
        _reposted = reposted;
      });
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = error is StateError
              ? error.message.toString()
              : 'This post could not load. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _toggleLike() async {
    final uid = _uid;
    final post = _post;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    if (post == null || _busy) return;
    final previous = _liked;
    setState(() {
      _liked = !previous;
      post['likes_count'] = ((post['likes_count'] as num?)?.toInt() ?? 0) + (previous ? -1 : 1);
    });
    try {
      if (previous) {
        await _db
            .from('post_reactions')
            .delete()
            .eq('user_id', uid)
            .eq('post_id', widget.postId)
            .eq('emoji', '❤️');
      } else {
        await _db.from('post_reactions').upsert({
          'user_id': uid,
          'post_id': widget.postId,
          'emoji': '❤️',
        }, onConflict: 'post_id,user_id');
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _liked = previous;
          post['likes_count'] = ((post['likes_count'] as num?)?.toInt() ?? 0) + (previous ? 1 : -1);
        });
        _showMessage('Could not update like. Please retry.');
      }
    }
  }

  Future<void> _toggleBookmark() async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    if (_busy) return;
    final previous = _bookmarked;
    setState(() {
      _busy = true;
      _bookmarked = !previous;
    });
    try {
      if (previous) {
        await _db.from('bookmarks').delete().eq('user_id', uid).eq('post_id', widget.postId);
      } else {
        await _db.from('bookmarks').insert({'user_id': uid, 'post_id': widget.postId});
      }
    } catch (_) {
      if (mounted) {
        setState(() => _bookmarked = previous);
        _showMessage('Could not update saved posts. Please retry.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleRepost() async {
    final uid = _uid;
    final post = _post;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    if (post == null || _busy) return;
    final previous = _reposted;
    setState(() {
      _busy = true;
      _reposted = !previous;
      post['reposts_count'] = ((post['reposts_count'] as num?)?.toInt() ?? 0) + (previous ? -1 : 1);
    });
    try {
      if (previous) {
        await _db.from('reposts').delete().eq('user_id', uid).eq('post_id', widget.postId);
      } else {
        await _db.from('reposts').insert({'user_id': uid, 'post_id': widget.postId});
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _reposted = previous;
          post['reposts_count'] =
              ((post['reposts_count'] as num?)?.toInt() ?? 0) + (previous ? 1 : -1);
        });
        _showMessage('Could not update repost. Please retry.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendReply() async {
    final uid = _uid;
    final body = _reply.text.trim();
    if (uid == null) {
      context.go('/auth');
      return;
    }
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await _db
          .from('replies')
          .insert({'post_id': widget.postId, 'user_id': uid, 'content': body})
          .timeout(const Duration(seconds: 15));
      _reply.clear();
      await _load();
    } catch (_) {
      if (mounted) _showMessage('Reply could not be sent. Please retry.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _sharePost() async {
    final body = _post?['content']?.toString() ?? 'Check out this post on Testagram';
    await Share.share(
      '$body\nhttps://testagram.site/post/${widget.postId}',
      subject: 'Testagram post',
    );
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _initial(String value) => value.trim().isEmpty ? 'T' : value.trim()[0].toUpperCase();

  Future<void> _openMedia(String raw) async {
    final uri = Uri.tryParse(raw);
    if (uri == null || !{'https', 'http'}.contains(uri.scheme) || uri.host.isEmpty) {
      _showMessage('This media link is invalid.');
      return;
    }
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) _showMessage('Could not open this media.');
  }

  @override
  Widget build(BuildContext context) {
    final post = _post;
    final profile = post?['profile'] as Map<String, dynamic>? ?? {};
    final name = '${profile['display_name'] ?? profile['username'] ?? 'Testagram user'}';
    final avatar = '${profile['avatar_url'] ?? ''}';
    final body = '${post?['content'] ?? post?['body'] ?? ''}';
    final image = '${post?['image_url'] ?? ''}';
    final video = '${post?['video_url'] ?? ''}';
    final mediaUrls = post?['media_urls'];
    final media = mediaUrls is List
        ? mediaUrls.map((value) => '$value').where((value) => value.startsWith('https://')).toList()
        : <String>[];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => context.go('/'),
                icon: const Icon(Icons.arrow_back_rounded),
                tooltip: 'Back to feed',
              ),
              Expanded(
                child: Text(
                  widget.repliesOnly ? 'Post replies' : 'Post',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(_error!),
                    TextButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            ),
          if (!_loading && post == null && _error == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('Post not found.')),
            ),
          if (post != null) ...[
            Card(
              clipBehavior: Clip.antiAlias,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          backgroundImage: avatar.startsWith('https://')
                              ? NetworkImage(avatar)
                              : null,
                          child: avatar.startsWith('https://') ? null : Text(_initial(name)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: const TextStyle(fontWeight: FontWeight.w800)),
                              if ('${profile['username'] ?? ''}'.isNotEmpty)
                                Text(
                                  '@${profile['username']}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                            ],
                          ),
                        ),
                        if (profile['verified'] == true)
                          const Icon(Icons.verified_rounded, color: Colors.blue),
                      ],
                    ),
                    if (body.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 14),
                        child: SelectableText(
                          body,
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(height: 1.5),
                        ),
                      ),
                    if (image.startsWith('https://'))
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Image.network(
                          image,
                          width: double.infinity,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                        ),
                      ),
                    if (video.startsWith('https://'))
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: OutlinedButton.icon(
                          onPressed: () => _openMedia(video),
                          icon: const Icon(Icons.play_circle_outline_rounded),
                          label: const Text('Open video'),
                        ),
                      ),
                    ...media.map(
                      (url) => Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: OutlinedButton.icon(
                          onPressed: () => _openMedia(url),
                          icon: const Icon(Icons.perm_media_outlined),
                          label: const Text('Open attached media'),
                        ),
                      ),
                    ),
                    const Divider(height: 28),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      alignment: WrapAlignment.spaceBetween,
                      children: [
                        TextButton.icon(
                          onPressed: _toggleLike,
                          icon: Icon(
                            _liked ? Icons.favorite : Icons.favorite_border,
                            color: _liked ? Colors.red : null,
                          ),
                          label: Text('${post['likes_count'] ?? 0}'),
                        ),
                        TextButton.icon(
                          onPressed: () => context.push('/post/${widget.postId}/replies'),
                          icon: const Icon(Icons.mode_comment_outlined),
                          label: Text('${post['replies_count'] ?? _replies.length}'),
                        ),
                        TextButton.icon(
                          onPressed: _toggleRepost,
                          icon: Icon(
                            Icons.repeat_rounded,
                            color: _reposted ? Theme.of(context).colorScheme.primary : null,
                          ),
                          label: Text('${post['reposts_count'] ?? 0}'),
                        ),
                        IconButton(
                          tooltip: _bookmarked ? 'Remove bookmark' : 'Save post',
                          onPressed: _toggleBookmark,
                          icon: Icon(_bookmarked ? Icons.bookmark : Icons.bookmark_border),
                        ),
                        IconButton(
                          tooltip: 'Share post',
                          onPressed: _sharePost,
                          icon: const Icon(Icons.share_outlined),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Replies (${_replies.length})',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            if (_uid != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: _reply,
                        minLines: 2,
                        maxLines: 4,
                        maxLength: 2000,
                        decoration: const InputDecoration(
                          hintText: 'Write a reply…',
                          border: InputBorder.none,
                        ),
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton.icon(
                          onPressed: _sending ? null : _sendReply,
                          icon: _sending
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.send_rounded),
                          label: Text(_sending ? 'Sending…' : 'Reply'),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              Card(
                child: ListTile(
                  leading: const Icon(Icons.lock_outline_rounded),
                  title: const Text('Sign in to reply'),
                  onTap: () => context.go('/auth'),
                ),
              ),
            if (_replies.isEmpty && !_loading)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: Text('No replies yet. Be the first.')),
              ),
            ..._replies.map((reply) {
              final person = reply['profile'] as Map<String, dynamic>? ?? {};
              final replyName =
                  '${person['display_name'] ?? person['username'] ?? 'Testagram user'}';
              final replyAvatar = '${person['avatar_url'] ?? ''}';
              return Card(
                margin: const EdgeInsets.only(top: 6),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundImage: replyAvatar.startsWith('https://')
                        ? NetworkImage(replyAvatar)
                        : null,
                    child: replyAvatar.startsWith('https://') ? null : Text(_initial(replyName)),
                  ),
                  title: Text(replyName, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: Text('${reply['content'] ?? ''}'),
                  ),
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}
