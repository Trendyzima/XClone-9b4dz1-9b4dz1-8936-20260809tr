import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class CommunityDetailPage extends StatefulWidget {
  const CommunityDetailPage({super.key, required this.name});
  final String name;
  @override
  State<CommunityDetailPage> createState() => _CommunityDetailPageState();
}

class _CommunityDetailPageState extends State<CommunityDetailPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  Map<String, dynamic>? _community;
  List<Map<String, dynamic>> _posts = [];
  bool _joined = false, _loading = true, _working = false;
  String? _error;
  final _composer = TextEditingController();
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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final community = await _db
          .from('communities')
          .select(
              'id,name,display_name,description,icon_url,banner_url,is_private,member_count,post_count,owner_id,rules')
          .eq('name', widget.name)
          .maybeSingle()
          .timeout(const Duration(seconds: 15));
      if (community == null) throw StateError('not found');
      final posts = await _db
          .from('posts')
          .select(
              'id,author_id,user_id,content,created_at,likes_count,community_id')
          .eq('community_id', '${community['id']}')
          .order('created_at', ascending: false)
          .limit(30)
          .timeout(const Duration(seconds: 15));
      var joined = false;
      if (_uid != null) {
        final membership = await _db
            .from('community_members')
            .select('status')
            .eq('community_id', '${community['id']}')
            .eq('user_id', _uid!)
            .maybeSingle();
        joined = membership?['status'] == 'active';
      }
      if (!mounted) return;
      setState(() {
        _community = Map<String, dynamic>.from(community);
        _posts = posts.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        _joined = joined;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'This community could not load. It may be private or no longer available.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleMembership() async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final id = '${_community!['id']}';
    final joining = !_joined;
    setState(() {
      _working = true;
      _joined = joining;
    });
    try {
      await _db.rpc(joining ? 'join_community' : 'leave_community',
          params: {'p_community_id': id});
      await _load();
    } catch (_) {
      if (mounted) {
        setState(() => _joined = !joining);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Membership update failed. Please retry.')));
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _publish() async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    if (!_joined) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Join this community before posting.')));
      return;
    }
    final content = _composer.text.trim();
    if (content.isEmpty || _working) return;
    setState(() => _working = true);
    try {
      await _db.from('posts').insert({
        'author_id': uid,
        'user_id': uid,
        'community_id': _community!['id'],
        'content': content
      });
      _composer.clear();
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Post could not be published. Please retry.')));
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          IconButton(
              onPressed: () => context.go('/communities'),
              icon: const Icon(Icons.arrow_back_rounded)),
          Expanded(
              child: Text('Community',
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
        if (!_loading && _community != null) ...[
          if ('${_community!['banner_url'] ?? ''}'.startsWith('http'))
            ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Image.network('${_community!['banner_url']}',
                    height: 130,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink())),
          Card(
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                            '${_community!['display_name'] ?? _community!['name']}',
                            style: Theme.of(context)
                                .textTheme
                                .titleLarge
                                ?.copyWith(fontWeight: FontWeight.w900)),
                        Text('c/${_community!['name']}'),
                        const SizedBox(height: 8),
                        Text(
                            '${_community!['description'] ?? 'A Testagram community.'}'),
                        const SizedBox(height: 8),
                        Text(
                            '${_community!['member_count'] ?? 0} members · ${_community!['post_count'] ?? 0} posts'),
                        const SizedBox(height: 12),
                        if (_uid != null)
                          FilledButton(
                              onPressed: _working ? null : _toggleMembership,
                              child: Text(_joined
                                  ? 'Leave community'
                                  : 'Join community'))
                      ]))),
          if (_joined)
            Card(
                child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(children: [
                      TextField(
                          controller: _composer,
                          maxLength: 2000,
                          maxLines: 3,
                          decoration: const InputDecoration(
                              hintText: 'Share with this community…',
                              border: InputBorder.none)),
                      Align(
                          alignment: Alignment.centerRight,
                          child: FilledButton.icon(
                              onPressed: _working ? null : _publish,
                              icon: const Icon(Icons.send_rounded),
                              label: const Text('Publish')))
                    ]))),
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('Community posts',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w900))),
          if (_posts.isEmpty)
            const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: Text('No posts yet.'))),
          ..._posts.map((p) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                  title: Text('${p['content'] ?? ''}'),
                  subtitle: Text('${p['created_at'] ?? ''}'),
                  onTap: () => context.go('/post/${p['id']}')))),
        ],
      ]));
}
