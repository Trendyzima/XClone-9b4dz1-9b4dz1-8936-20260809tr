import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class HashtagsPage extends StatefulWidget {
  const HashtagsPage({super.key, this.tag});
  final String? tag;
  @override
  State<HashtagsPage> createState() => _HashtagsPageState();
}

class _HashtagsPageState extends State<HashtagsPage> {
  SupabaseClient get _db => Supabase.instance.client;
  final _search = TextEditingController();
  List<Map<String, dynamic>> _tags = [], _posts = [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (widget.tag != null) {
        final normalized =
            widget.tag!.replaceFirst(RegExp(r'^#'), '').trim().toLowerCase();
        final hashtag = await _db
            .from('hashtags')
            .select('id,tag,usage_count,created_at')
            .eq('tag', normalized)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        if (hashtag == null) {
          if (mounted) {
            setState(() {
              _tags = [];
              _posts = [];
            });
          }
          return;
        }
        final links = await _db
            .from('post_hashtags')
            .select('post_id')
            .eq('hashtag_id', '${hashtag['id']}')
            .limit(50);
        final ids = links.map((r) => '${r['post_id']}').toList();
        final rows = ids.isEmpty
            ? <dynamic>[]
            : await _db
                .from('posts')
                .select(
                    'id,author_id,content,created_at,likes_count,views_count')
                .inFilter('id', ids)
                .order('created_at', ascending: false);
        final authors = rows.map((r) => '${r['author_id']}').toSet().toList();
        final profiles = authors.isEmpty
            ? <dynamic>[]
            : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url')
                .inFilter('id', authors);
        final byId = {
          for (final p in profiles)
            '${p['id']}': Map<String, dynamic>.from(p as Map)
        };
        final posts = rows.map((r) {
          final p = Map<String, dynamic>.from(r as Map);
          p['profile'] = byId['${p['author_id']}'];
          return p;
        }).toList();
        if (mounted) {
          setState(() {
            _tags = [Map<String, dynamic>.from(hashtag)];
            _posts = posts;
          });
        }
      } else {
        final q = _search.text.trim().replaceAll(RegExp(r'[^a-zA-Z0-9_]'), '');
        var query =
            _db.from('hashtags').select('id,tag,usage_count,created_at');
        if (q.isNotEmpty) query = query.ilike('tag', '%$q%');
        final rows = await query
            .order('usage_count', ascending: false)
            .limit(60)
            .timeout(const Duration(seconds: 15));
        if (mounted) {
          setState(() {
            _tags =
                rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
            _posts = [];
          });
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Hashtags could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = widget.tag != null;
    return RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          Row(children: [
            if (detail)
              IconButton(
                  onPressed: () => context.go('/hashtags'),
                  icon: const Icon(Icons.arrow_back_rounded)),
            Expanded(
                child: Text(
                    detail
                        ? '#${widget.tag!.replaceFirst(RegExp(r'^#'), '')}'
                        : 'Hashtags',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w900)))
          ]),
          if (!detail)
            Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: TextField(
                    controller: _search,
                    onSubmitted: (_) => _load(),
                    decoration: InputDecoration(
                        hintText: 'Search hashtags',
                        prefixIcon: const Icon(Icons.search_rounded),
                        suffixIcon: IconButton(
                            onPressed: () {
                              _search.clear();
                              _load();
                            },
                            icon: const Icon(Icons.close_rounded))))),
          if (_loading)
            const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator())),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.all(12),
                child: Column(children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry'))
                ])),
          if (!detail)
            ..._tags.map((t) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.tag_rounded)),
                    title: Text('#${t['tag']}',
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: Text('${t['usage_count'] ?? 0} posts'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.go(
                        '/hashtag/${Uri.encodeComponent('${t['tag']}')}')))),
          if (detail && !_loading && _posts.isEmpty && _error == null)
            const Padding(
                padding: EdgeInsets.all(20),
                child: Center(
                    child: Text(
                        'No public posts are linked to this hashtag yet.'))),
          if (detail)
            ..._posts.map((p) {
              final profile = (p['profile'] as Map<String, dynamic>?) ?? {};
              return Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                      leading: CircleAvatar(
                          child: Text(_initial(
                              '${profile['display_name'] ?? profile['username'] ?? 'T'}'))),
                      title: Text(
                          '${profile['display_name'] ?? profile['username'] ?? 'Testagram user'}',
                          style: const TextStyle(fontWeight: FontWeight.w800)),
                      subtitle: Padding(
                          padding: const EdgeInsets.only(top: 5),
                          child: Text('${p['content'] ?? ''}',
                              maxLines: 4, overflow: TextOverflow.ellipsis)),
                      trailing: Text('${p['likes_count'] ?? 0} ♥'),
                      onTap: () => context.go('/post/${p['id']}')));
            }),
        ]));
  }

  String _initial(String value) => value.isEmpty ? 'T' : value[0].toUpperCase();
}

class LeaderboardPage extends StatefulWidget {
  const LeaderboardPage({super.key});
  @override
  State<LeaderboardPage> createState() => _LeaderboardPageState();
}

class _LeaderboardPageState extends State<LeaderboardPage> {
  SupabaseClient get _db => Supabase.instance.client;
  List<Map<String, dynamic>> _creators = [];
  bool _loading = true;
  String? _error;
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
      final rows = await _db
          .from('profiles')
          .select('id,username,display_name,avatar_url,follower_count,verified')
          .order('follower_count', ascending: false)
          .limit(50)
          .timeout(const Duration(seconds: 15));
      if (mounted) {
        setState(() => _creators =
            rows.map((r) => Map<String, dynamic>.from(r as Map)).toList());
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Leaderboard could not load. Please retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Text('Leaderboard',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        const Text('Creators ranked by their current follower counts.'),
        if (_loading)
          const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Text(_error!),
                TextButton(onPressed: _load, child: const Text('Retry'))
              ])),
        ..._creators.asMap().entries.map((entry) {
          final index = entry.key;
          final c = entry.value;
          final name = '${c['display_name'] ?? c['username'] ?? 'Creator'}';
          final avatar = '${c['avatar_url'] ?? ''}';
          return Card(
              margin: const EdgeInsets.only(bottom: 7),
              child: ListTile(
                  leading: SizedBox(
                      width: 58,
                      child: Row(children: [
                        Text('#${index + 1}',
                            style:
                                const TextStyle(fontWeight: FontWeight.w900)),
                        const SizedBox(width: 5),
                        CircleAvatar(
                            radius: 18,
                            backgroundImage: avatar.startsWith('http')
                                ? NetworkImage(avatar)
                                : null,
                            child: avatar.startsWith('http')
                                ? null
                                : Text(
                                    name.isEmpty ? 'T' : name[0].toUpperCase()))
                      ])),
                  title: Text(name,
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                  subtitle: Text('@${c['username'] ?? 'creator'}'),
                  trailing: Text('${c['follower_count'] ?? 0} followers'),
                  onTap: () => context.go('/profile/${c['username']}')));
        }),
      ]));
}
