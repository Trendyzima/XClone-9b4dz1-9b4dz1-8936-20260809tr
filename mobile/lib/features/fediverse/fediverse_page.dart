import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:share_plus/share_plus.dart';

class FediversePage extends StatefulWidget {
  const FediversePage({super.key, this.instancesOnly = false});
  final bool instancesOnly;
  @override
  State<FediversePage> createState() => _FediversePageState();
}

class _FediversePageState extends State<FediversePage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  List<Map<String, dynamic>> _posts = [], _instances = [];
  final Set<String> _liked = {}, _boosted = {};
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
      if (widget.instancesOnly) {
        final rows = await _db
            .from('federated_instances')
            .select(
                'id,domain,base_url,provider,software,public_timeline_available,last_fetched_at,discovered_at')
            .order('domain')
            .limit(100)
            .timeout(const Duration(seconds: 15));
        if (mounted) {
          setState(() => _instances =
              rows.map((r) => Map<String, dynamic>.from(r as Map)).toList());
        }
        return;
      }
      final rows = await _db
          .from('federated_objects')
          .select(
              'id,uri,object_type,actor_uri,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning')
          .isFilter('deleted_at', null)
          .eq('tombstone', false)
          .order('published_at', ascending: false)
          .order('id', ascending: false)
          .limit(30)
          .timeout(const Duration(seconds: 15));
      final posts =
          rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      final actorUris = posts
          .map((p) => '${p['actor_uri'] ?? ''}')
          .where((v) => v.isNotEmpty)
          .toSet()
          .toList();
      final actors = actorUris.isEmpty
          ? <dynamic>[]
          : await _db
              .from('federated_actors')
              .select('actor_uri,username,domain,display_name,avatar_url')
              .inFilter('actor_uri', actorUris);
      final byUri = {
        for (final a in actors)
          '${a['actor_uri']}': Map<String, dynamic>.from(a as Map)
      };
      for (final post in posts) {
        post['actor'] = byUri['${post['actor_uri']}'];
      }
      final uid = _uid;
      if (uid != null && posts.isNotEmpty) {
        final reactions = await _db
            .from('federated_reactions')
            .select('object_uri,reaction_type')
            .eq('user_id', uid)
            .inFilter('object_uri', posts.map((p) => '${p['uri']}').toList());
        _liked.addAll(reactions
            .where((r) => r['reaction_type'] == 'like')
            .map((r) => '${r['object_uri']}'));
        _boosted.addAll(reactions
            .where((r) => r['reaction_type'] == 'boost')
            .map((r) => '${r['object_uri']}'));
      }
      if (mounted) setState(() => _posts = posts);
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Fediverse data could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _react(Map<String, dynamic> post, String kind) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final uri = '${post['uri'] ?? ''}';
    if (!uri.startsWith('https://')) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('This remote post has no valid ActivityPub URI.')));
      return;
    }
    final set = kind == 'like' ? _liked : _boosted;
    final wasActive = set.contains(uri);
    setState(() {
      wasActive ? set.remove(uri) : set.add(uri);
    });
    try {
      final response = await _db.functions.invoke('testagram-api', body: {
        'path': wasActive
            ? (kind == 'like' ? '/unfavorite' : '/unboost')
            : (kind == 'like' ? '/favorite' : '/boost'),
        'method': 'POST',
        'body': {'post_id': uri}
      });
      if (response.data == null) throw StateError('empty response');
    } catch (_) {
      if (mounted) {
        setState(() {
          wasActive ? set.add(uri) : set.remove(uri);
        });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Federated action failed. Your local state was restored.')));
      }
    }
  }

  Future<void> _open(String? raw) async {
    final uri = Uri.tryParse(raw ?? '');
    if (uri == null ||
        !{'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty) {
      return;
    }
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open this remote link.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.instancesOnly) {
      return RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.all(14), children: [
            Row(children: [
              IconButton(
                  onPressed: () => context.go('/fediverse'),
                  icon: const Icon(Icons.arrow_back_rounded)),
              Expanded(
                  child: Text('Fediverse instances',
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900)))
            ]),
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
            ..._instances.map((i) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                    leading:
                        const CircleAvatar(child: Icon(Icons.public_rounded)),
                    title: Text('${i['domain']}',
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: Text(
                        '${i['software'] ?? i['provider'] ?? 'ActivityPub'} · Last synced ${i['last_fetched_at'] ?? 'not yet'}'),
                    trailing: IconButton(
                        onPressed: () => _open('${i['base_url']}'),
                        icon: const Icon(Icons.open_in_new_rounded)))))
          ]));
    }
    return RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          Row(children: [
            Expanded(
                child: Text('Fediverse',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w900))),
            IconButton(
                tooltip: 'Discover instances',
                onPressed: () => context.go('/fediverse/instances'),
                icon: const Icon(Icons.public_rounded)),
            IconButton(
                tooltip: 'Refresh timeline',
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded))
          ]),
          const SizedBox(height: 4),
          const Text('A cached ActivityPub timeline from the open social web.'),
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
          if (!_loading && _posts.isEmpty && _error == null)
            const Padding(
                padding: EdgeInsets.all(24),
                child: Center(
                    child: Text(
                        'No federated posts are cached yet. Refresh later.'))),
          ..._posts.map((p) {
            final actor = (p['actor'] as Map<String, dynamic>?) ?? {};
            final handle =
                '${actor['username'] ?? 'remote'}@${actor['domain'] ?? 'fediverse'}';
            final name = '${actor['display_name'] ?? handle}';
            final uri = '${p['uri'] ?? ''}';
            final url = '${p['url'] ?? uri}';
            final sensitive = p['sensitive'] == true ||
                '${p['content_warning'] ?? ''}'.isNotEmpty;
            return Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            CircleAvatar(
                                backgroundImage: '${actor['avatar_url'] ?? ''}'
                                        .startsWith('http')
                                    ? NetworkImage('${actor['avatar_url']}')
                                    : null,
                                child: '${actor['avatar_url'] ?? ''}'
                                        .startsWith('http')
                                    ? null
                                    : const Icon(Icons.person_outline_rounded)),
                            const SizedBox(width: 10),
                            Expanded(
                                child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                  Text(name,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w800)),
                                  Text('@$handle',
                                      style:
                                          Theme.of(context).textTheme.bodySmall)
                                ])),
                            IconButton(
                                tooltip: 'Open remote post',
                                onPressed: () => _open(url),
                                icon: const Icon(Icons.open_in_new_rounded))
                          ]),
                          if (sensitive)
                            Padding(
                                padding: const EdgeInsets.only(top: 10),
                                child: Text(
                                    'Content warning: ${p['content_warning'] ?? 'sensitive media'}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        color: Colors.orange))),
                          Padding(
                              padding: const EdgeInsets.only(top: 10),
                              child: Text(
                                  sensitive
                                      ? 'This post is marked sensitive. Open the remote post to view its full content.'
                                      : '${p['content'] ?? p['summary'] ?? ''}',
                                  maxLines: sensitive ? 3 : 12,
                                  overflow: TextOverflow.ellipsis)),
                          if (p['tags'] is List &&
                              (p['tags'] as List).isNotEmpty)
                            Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Wrap(
                                    spacing: 6,
                                    children: (p['tags'] as List)
                                        .take(6)
                                        .map((tag) => Chip(
                                            label: Text(
                                                '#${tag is Map ? tag['name'] ?? '' : tag}'),
                                            visualDensity:
                                                VisualDensity.compact))
                                        .toList())),
                          const Divider(height: 24),
                          Row(children: [
                            TextButton.icon(
                                onPressed: () => _react(p, 'like'),
                                icon: Icon(
                                    _liked.contains(uri)
                                        ? Icons.favorite
                                        : Icons.favorite_border,
                                    color: _liked.contains(uri)
                                        ? Colors.pink
                                        : null),
                                label: Text('${p['like_count'] ?? 0}')),
                            TextButton.icon(
                                onPressed: () => _react(p, 'boost'),
                                icon: Icon(Icons.repeat_rounded,
                                    color: _boosted.contains(uri)
                                        ? Colors.green
                                        : null),
                                label: Text('${p['announce_count'] ?? 0}')),
                            const Spacer(),
                            Text('${p['reply_count'] ?? 0} replies',
                                style: Theme.of(context).textTheme.bodySmall),
                            IconButton(
                                tooltip: 'Share',
                                onPressed: () => Share.share('$name\n$url'),
                                icon: const Icon(Icons.share_rounded))
                          ])
                        ])));
          }),
        ]));
  }
}
