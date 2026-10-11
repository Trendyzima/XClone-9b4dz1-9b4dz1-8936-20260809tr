import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ThreadDetailPage extends StatefulWidget {
  const ThreadDetailPage(
      {super.key, required this.threadId, this.repliesOnly = false});
  final String threadId;
  final bool repliesOnly;
  @override
  State<ThreadDetailPage> createState() => _ThreadDetailPageState();
}

class _ThreadDetailPageState extends State<ThreadDetailPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  final _reply = TextEditingController();
  Map<String, dynamic>? _thread;
  List<Map<String, dynamic>> _replies = [];
  bool _liked = false, _reposted = false;
  bool _loading = true, _sending = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final row = await _db
          .from('threads')
          .select(
              'id,owner_id,title,body,visibility,created_at,likes_count,reposts_count,replies_count,media_urls')
          .eq('id', widget.threadId)
          .isFilter('deleted_at', null)
          .single()
          .timeout(const Duration(seconds: 15));
      final profile = await _db
          .from('profiles')
          .select('id,username,display_name,avatar_url,verified')
          .eq('id', '${row['owner_id']}')
          .maybeSingle();
      final replyRows = await _db
          .from('thread_replies')
          .select('id,thread_id,user_id,content,created_at,parent_reply_id')
          .eq('thread_id', widget.threadId)
          .order('created_at', ascending: true)
          .limit(100)
          .timeout(const Duration(seconds: 15));
      final ids = replyRows.map((r) => '${r['user_id']}').toSet().toList();
      final profiles = ids.isEmpty
          ? <dynamic>[]
          : await _db
              .from('profiles')
              .select('id,username,display_name,avatar_url')
              .inFilter('id', ids);
      final byId = {
        for (final p in profiles)
          '${p['id']}': Map<String, dynamic>.from(p as Map)
      };
      final uid = _uid;
      final likeRows = uid == null
          ? <dynamic>[]
          : await _db
              .from('thread_likes')
              .select('id')
              .eq('thread_id', widget.threadId)
              .eq('user_id', uid)
              .limit(1);
      final repostRows = uid == null
          ? <dynamic>[]
          : await _db
              .from('thread_reposts')
              .select('id')
              .eq('thread_id', widget.threadId)
              .eq('user_id', uid)
              .limit(1);
      final replies = replyRows.map((r) {
        final v = Map<String, dynamic>.from(r as Map);
        v['profile'] = byId['${v['user_id']}'];
        return v;
      }).toList();
      if (!mounted) return;
      setState(() {
        _thread = {...Map<String, dynamic>.from(row), 'profile': profile};
        _replies = replies;
        _liked = likeRows.isNotEmpty;
        _reposted = repostRows.isNotEmpty;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'This thread could not be loaded. It may have been removed or is unavailable.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendReply() async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final body = _reply.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await _db.from('thread_replies').insert(
          {'thread_id': widget.threadId, 'user_id': uid, 'content': body});
      _reply.clear();
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Reply could not be sent. Please retry.')));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _toggle(String table, bool active) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    try {
      if (active) {
        await _db
            .from(table)
            .delete()
            .eq('thread_id', widget.threadId)
            .eq('user_id', uid);
      } else {
        await _db
            .from(table)
            .insert({'thread_id': widget.threadId, 'user_id': uid});
      }
      if (table == 'thread_likes') {
        setState(() => _liked = !active);
      } else {
        setState(() => _reposted = !active);
      }
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Action failed. Please retry.')));
      }
    }
  }

  String _initial(String value) => value.isEmpty ? 'T' : value[0].toUpperCase();

  @override
  Widget build(BuildContext context) => RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          IconButton(
              onPressed: () => context.go('/threads'),
              icon: const Icon(Icons.arrow_back_rounded)),
          Expanded(
              child: Text(widget.repliesOnly ? 'Replies' : 'Thread',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)))
        ]),
        if (_loading)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Text(_error!),
                TextButton(onPressed: _load, child: const Text('Retry'))
              ])),
        if (!_loading && _thread != null) ...[
          Card(
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(children: [
                          CircleAvatar(
                              child: Text(_initial(
                                  '${_thread!['profile']?['display_name'] ?? _thread!['profile']?['username'] ?? 'T'}'))),
                          const SizedBox(width: 10),
                          Expanded(
                              child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                Text(
                                    '${_thread!['profile']?['display_name'] ?? _thread!['profile']?['username'] ?? 'Testagram user'}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w800)),
                                Text(
                                    '@${_thread!['profile']?['username'] ?? 'user'}',
                                    style:
                                        Theme.of(context).textTheme.bodySmall)
                              ]))
                        ]),
                        if ('${_thread!['title'] ?? ''}'.isNotEmpty)
                          Padding(
                              padding: const EdgeInsets.only(top: 12),
                              child: Text('${_thread!['title']}',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w900,
                                      fontSize: 18))),
                        Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Text('${_thread!['body'] ?? ''}',
                                style: const TextStyle(
                                    fontSize: 16, height: 1.5))),
                        const Divider(height: 24),
                        Row(children: [
                          TextButton.icon(
                              onPressed: () => _toggle('thread_likes', _liked),
                              icon: const Icon(Icons.favorite_border),
                              label: Text(
                                  '${_thread!['likes_count'] ?? 0} Likes')),
                          TextButton.icon(
                              onPressed: () =>
                                  _toggle('thread_reposts', _reposted),
                              icon: const Icon(Icons.repeat_rounded),
                              label: Text(
                                  '${_thread!['reposts_count'] ?? 0} Reposts')),
                          const Spacer(),
                          Text('${_replies.length} replies')
                        ]),
                      ]))),
          const SizedBox(height: 12),
          Text('Join the conversation',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800)),
          Card(
              child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(children: [
                    TextField(
                        controller: _reply,
                        maxLength: 2000,
                        minLines: 2,
                        maxLines: 4,
                        decoration: const InputDecoration(
                            hintText: 'Write a thoughtful reply…',
                            border: InputBorder.none)),
                    Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton.icon(
                            onPressed: _sending ? null : _sendReply,
                            icon: const Icon(Icons.send_rounded),
                            label: Text(_sending ? 'Sending…' : 'Reply')))
                  ]))),
          if (_replies.isEmpty)
            const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: Text('No replies yet. Be the first.'))),
          ..._replies.map((r) {
            final p = (r['profile'] as Map<String, dynamic>?) ?? {};
            return Card(
                margin: const EdgeInsets.only(top: 8),
                child: ListTile(
                    leading: CircleAvatar(
                        child: Text(_initial(
                            '${p['display_name'] ?? p['username'] ?? 'T'}'))),
                    title: Text(
                        '${p['display_name'] ?? p['username'] ?? 'Testagram user'}',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Padding(
                        padding: const EdgeInsets.only(top: 5),
                        child: Text('${r['content'] ?? ''}')),
                    isThreeLine: true));
          }),
        ],
      ]));
}
