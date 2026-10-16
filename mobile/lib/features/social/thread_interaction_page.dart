import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

enum ThreadInteractionMode { likes, reposts, quotes, quoteLikes, replyLikes }

class ThreadInteractionPage extends StatefulWidget {
  const ThreadInteractionPage({
    required this.threadId,
    required this.mode,
    this.quoteId,
    this.replyId,
    super.key,
  });
  final String threadId;
  final ThreadInteractionMode mode;
  final String? quoteId;
  final String? replyId;

  @override
  State<ThreadInteractionPage> createState() => _ThreadInteractionPageState();
}

class _ThreadInteractionPageState extends State<ThreadInteractionPage> {
  final _db = Supabase.instance.client;
  final _composer = TextEditingController();
  bool _loading = true, _submitting = false, _acting = false;
  String? _error;
  Map<String, dynamic>? _thread;
  List<Map<String, dynamic>> _items = const [];

  String get _title => switch (widget.mode) {
    ThreadInteractionMode.likes => 'Likes',
    ThreadInteractionMode.reposts => 'Reposts & retweets',
    ThreadInteractionMode.quotes => 'Quotes',
    ThreadInteractionMode.quoteLikes => 'Quote likes',
    ThreadInteractionMode.replyLikes => 'Reply likes',
  };
  IconData get _icon => switch (widget.mode) {
    ThreadInteractionMode.likes ||
    ThreadInteractionMode.quoteLikes ||
    ThreadInteractionMode.replyLikes => Icons.favorite_border,
    ThreadInteractionMode.reposts => Icons.repeat,
    ThreadInteractionMode.quotes => Icons.format_quote,
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _composer.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final thread = await _db
          .from('threads')
          .select(
            'id,owner_id,body,created_at,likes_count,reposts_count,quotes_count,replies_count',
          )
          .eq('id', widget.threadId)
          .isFilter('deleted_at', null)
          .maybeSingle();
      if (thread == null) {
        throw StateError('This thread is unavailable.');
      }
      List<dynamic> rows;
      switch (widget.mode) {
        case ThreadInteractionMode.likes:
          rows = await _db
              .from('thread_likes')
              .select('id,user_id,created_at')
              .eq('thread_id', widget.threadId)
              .order('created_at', ascending: false)
              .limit(100);
        case ThreadInteractionMode.reposts:
          rows = await _db
              .from('thread_reposts')
              .select('id,user_id,created_at')
              .eq('thread_id', widget.threadId)
              .order('created_at', ascending: false)
              .limit(100);
        case ThreadInteractionMode.quotes:
          rows = await _db
              .from('thread_quotes')
              .select('id,user_id,content,created_at')
              .eq('thread_id', widget.threadId)
              .order('created_at', ascending: false)
              .limit(100);
        case ThreadInteractionMode.quoteLikes:
          rows = await _db
              .from('thread_quote_likes')
              .select('id,user_id,created_at')
              .eq('quote_id', widget.quoteId!)
              .order('created_at', ascending: false)
              .limit(100);
        case ThreadInteractionMode.replyLikes:
          rows = await _db
              .from('thread_reply_likes')
              .select('id,user_id,created_at')
              .eq('reply_id', widget.replyId!)
              .order('created_at', ascending: false)
              .limit(100);
      }
      final ids = rows.map((row) => '${row['user_id']}').toSet().toList();
      final profiles = ids.isEmpty
          ? <dynamic>[]
          : await _db
                .from('profiles')
                .select('id,username,display_name,full_name,avatar_url,verified')
                .inFilter('id', ids);
      final profileById = <String, Map<String, dynamic>>{};
      for (final profile in profiles) {
        profileById['${profile['id']}'] = Map<String, dynamic>.from(profile);
      }
      final items = rows.map((row) {
        final item = Map<String, dynamic>.from(row);
        item['profile'] = profileById['${row['user_id']}'];
        return item;
      }).toList();
      if (!mounted) {
        return;
      }
      setState(() {
        _thread = Map<String, dynamic>.from(thread);
        _items = items;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Could not load ${_title.toLowerCase()}. Check your connection and try again.';
        });
      }
    }
  }

  Future<void> _toggle() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      context.go('/auth');
      return;
    }
    if (_acting) {
      return;
    }
    final id = switch (widget.mode) {
      ThreadInteractionMode.quoteLikes => widget.quoteId,
      ThreadInteractionMode.replyLikes => widget.replyId,
      _ => widget.threadId,
    };
    final table = switch (widget.mode) {
      ThreadInteractionMode.quoteLikes => 'thread_quote_likes',
      ThreadInteractionMode.replyLikes => 'thread_reply_likes',
      _ => 'thread_likes',
    };
    final foreignKey = switch (widget.mode) {
      ThreadInteractionMode.quoteLikes => 'quote_id',
      ThreadInteractionMode.replyLikes => 'reply_id',
      _ => 'thread_id',
    };
    if (widget.mode == ThreadInteractionMode.reposts ||
        widget.mode == ThreadInteractionMode.quotes) {
      return;
    }
    setState(() => _acting = true);
    try {
      final existing = await _db
          .from(table)
          .select('id')
          .eq(foreignKey, id!)
          .eq('user_id', user.id)
          .maybeSingle();
      if (existing == null) {
        await _db.from(table).insert({foreignKey: id, 'user_id': user.id});
      } else {
        await _db.from(table).delete().eq(foreignKey, id).eq('user_id', user.id);
      }
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('That reaction could not be saved. Please retry.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _acting = false);
      }
    }
  }

  Future<void> _submitQuote() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      context.go('/auth');
      return;
    }
    final content = _composer.text.trim();
    if (content.isEmpty || content.length > 500 || _submitting) {
      return;
    }
    setState(() => _submitting = true);
    try {
      await _db.from('thread_quotes').insert({
        'thread_id': widget.threadId,
        'user_id': user.id,
        'content': content,
        'media_urls': <String>[],
      });
      _composer.clear();
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Quote posted.')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Quote could not be posted. Check permissions and retry.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(_title),
        actions: [
          IconButton(onPressed: _load, tooltip: 'Refresh', icon: const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            if (_thread != null)
              InkWell(
                onTap: () => context.go('/thread/${widget.threadId}'),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: theme.dividerColor)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.arrow_back, size: 16),
                          const SizedBox(width: 6),
                          Text('Open thread', style: theme.textTheme.labelMedium),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${_thread!['body'] ?? ''}',
                        maxLines: 5,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '♥ ${_thread!['likes_count'] ?? 0}   ↻ ${_thread!['reposts_count'] ?? 0}   ❞ ${_thread!['quotes_count'] ?? 0}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            if (widget.mode == ThreadInteractionMode.quotes)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    TextField(
                      controller: _composer,
                      minLines: 2,
                      maxLines: 5,
                      maxLength: 500,
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        hintText: 'Add your thought to this quote…',
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.icon(
                        onPressed: _submitting ? null : _submitQuote,
                        icon: _submitting
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.send),
                        label: const Text('Quote thread'),
                      ),
                    ),
                  ],
                ),
              ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Card(
                  child: ListTile(
                    leading: const Icon(Icons.error_outline),
                    title: Text(_error!),
                    trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
                  ),
                ),
              ),
            if (!_loading && _error == null && _items.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  children: [
                    Icon(_icon, size: 32, color: theme.colorScheme.secondary),
                    const SizedBox(height: 12),
                    Text('No ${_title.toLowerCase()} yet.'),
                    const SizedBox(height: 6),
                    Text(
                      'When people interact with this thread, they will appear here.',
                      style: theme.textTheme.bodySmall,
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            for (final item in _items) _personTile(item, theme),
          ],
        ),
      ),
    );
  }

  Widget _personTile(Map<String, dynamic> item, ThemeData theme) {
    final profile = item['profile'] as Map<String, dynamic>?;
    final name =
        '${profile?['display_name'] ?? profile?['full_name'] ?? profile?['username'] ?? 'Testagram member'}';
    final username = profile?['username'] == null
        ? null
        : '@${'${profile!['username']}'.replaceFirst(RegExp(r'^@'), '')}';
    final avatar = profile?['avatar_url'] as String?;
    return ListTile(
      leading: CircleAvatar(
        backgroundImage: avatar == null || avatar.isEmpty ? null : NetworkImage(avatar),
        child: avatar == null || avatar.isEmpty
            ? Text(name.isEmpty ? '?' : name.characters.first.toUpperCase())
            : null,
      ),
      title: Row(
        children: [
          Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (profile?['verified'] == true)
            const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Icon(Icons.verified, size: 16, color: Colors.blue),
            ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (username != null) Text(username),
          if (item['content'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('${item['content']}', maxLines: 5, overflow: TextOverflow.ellipsis),
            ),
          if (item['created_at'] != null)
            Text('${item['created_at']}', style: theme.textTheme.labelSmall),
        ],
      ),
      trailing:
          widget.mode == ThreadInteractionMode.likes ||
              widget.mode == ThreadInteractionMode.quoteLikes ||
              widget.mode == ThreadInteractionMode.replyLikes
          ? IconButton(
              onPressed: _acting ? null : _toggle,
              tooltip: 'Like or unlike',
              icon: const Icon(Icons.favorite_border),
            )
          : null,
      onTap: username == null ? null : () => context.push('/${username.substring(1)}'),
      isThreeLine: item['content'] != null,
    );
  }
}
