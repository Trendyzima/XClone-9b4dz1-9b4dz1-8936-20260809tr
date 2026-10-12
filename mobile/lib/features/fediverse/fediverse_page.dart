import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:share_plus/share_plus.dart';

class FediversePage extends StatefulWidget {
  const FediversePage({
    super.key,
    this.instancesOnly = false,
    this.section = 'feed',
  });
  final bool instancesOnly;
  final String section;

  String get title {
    if (instancesOnly) return 'Fediverse instances';
    return switch (section) {
      'discover' => 'Discover the Fediverse',
      'organic-discovery' => 'Organic discovery',
      'mastodon' => 'Mastodon timeline',
      'inbox' => 'Fediverse inbox',
      'relay' => 'Fediverse relays',
      'analytics' => 'Fediverse analytics',
      'identity' => 'Federated identity',
      'profile' => 'Federated profile',
      'posts' => 'Federated posts',
      'threads' => 'Federated threads',
      'replies' => 'Federated replies',
      'media' => 'Federated media',
      'videos' => 'Federated videos',
      'podcasts' => 'Federated podcasts',
      'series' => 'Federated series',
      'likes' => 'Liked federated posts',
      'tips' => 'Federated tips',
      'gifts' => 'Federated gifts',
      'followers' => 'Federated followers',
      'following' => 'Federated following',
      'profile-analytics' => 'Profile analytics',
      'controls' => 'Federation controls',
      _ => 'Fediverse',
    };
  }

  @override
  State<FediversePage> createState() => _FediversePageState();
}

class _FediversePageState extends State<FediversePage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  List<Map<String, dynamic>> _posts = [], _instances = [];
  List<Map<String, dynamic>> _surfaceRows = [];
  Map<String, int> _surfaceMetrics = {};
  String? _surfaceMessage;
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
      _surfaceRows = [];
      _surfaceMetrics = {};
      _surfaceMessage = null;
    });
    try {
      if (widget.instancesOnly ||
          widget.section == 'discover' ||
          widget.section == 'organic-discovery') {
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
      if (_sectionNeedsDedicatedBackend) {
        await _loadDedicatedSection();
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

  List<Map<String, dynamic>> get _visiblePosts {
    final source = _posts;
    switch (widget.section) {
      case 'replies':
        return source
            .where((p) => '${p['in_reply_to_uri'] ?? ''}'.isNotEmpty)
            .toList();
      case 'threads':
        return source
            .where((p) =>
                '${p['in_reply_to_uri'] ?? ''}'.isEmpty &&
                '${p['object_type'] ?? ''}'.toLowerCase() == 'note')
            .toList();
      case 'media':
        return source
            .where((p) =>
                p['attachments'] is List &&
                (p['attachments'] as List).isNotEmpty)
            .toList();
      case 'videos':
        return source
            .where((p) =>
                '${p['object_type'] ?? ''}'.toLowerCase() == 'video' ||
                '${p['content'] ?? ''}'.toLowerCase().contains('video'))
            .toList();
      case 'podcasts':
        return source
            .where((p) =>
                '${p['object_type'] ?? ''}'.toLowerCase() == 'audio' ||
                '${p['content'] ?? ''}'.toLowerCase().contains('podcast'))
            .toList();
      case 'likes':
        return source.where((p) => _liked.contains('${p['uri']}')).toList();
      default:
        return source;
    }
  }

  bool get _sectionNeedsDedicatedBackend => const {
        'inbox',
        'relay',
        'analytics',
        'identity',
        'profile',
        'tips',
        'gifts',
        'followers',
        'following',
        'profile-analytics',
        'controls',
      }.contains(widget.section);

  Future<void> _loadDedicatedSection() async {
    final uid = _uid;
    if (uid == null) {
      _surfaceMessage = 'Sign in to use this Fediverse feature.';
      return;
    }

    switch (widget.section) {
      case 'inbox':
        final rows = await _db
            .from('activitypub_inbox')
            .select('id,activity_type,actor_url,object_url,payload,processed,created_at')
            .eq('local_user_id', uid)
            .order('created_at', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        _surfaceRows = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        return;
      case 'identity':
        final rows = await _db
            .from('activitypub_actors')
            .select('id,actor_id,username,domain,inbox_url,outbox_url,followers_url,following_url,public_key_pem,created_at,updated_at')
            .eq('user_id', uid)
            .limit(10)
            .timeout(const Duration(seconds: 15));
        _surfaceRows = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        if (_surfaceRows.isEmpty) {
          _surfaceMessage = 'No local ActivityPub identity is registered for this account yet.';
        }
        return;
      case 'relay':
        final rows = await _db
            .from('activitypub_outbox')
            .select('id,activity_type,activity_id,payload,delivered,created_at')
            .eq('local_user_id', uid)
            .order('created_at', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        _surfaceRows = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        return;
      case 'controls':
        final results = await Future.wait([
          _db.from('fediverse_domain_blocks').select('id,domain,created_at').eq('user_id', uid).limit(100),
          _db.from('fediverse_content_filters').select('id,name,phrase,action,contexts,expires_at,created_at').eq('user_id', uid).limit(100),
        ]);
        _surfaceRows = [
          ...(results[0] as List).map((row) => {
                'kind': 'Blocked domain',
                ...Map<String, dynamic>.from(row as Map),
              }),
          ...(results[1] as List).map((row) => {
                'kind': 'Content filter',
                ...Map<String, dynamic>.from(row as Map),
              }),
        ];
        if (_surfaceRows.isEmpty) {
          _surfaceMessage = 'No domain blocks or content filters are configured.';
        }
        return;
      case 'analytics':
      case 'profile-analytics':
        final results = await Future.wait([
          _db.from('federated_objects').select('id').limit(1000),
          _db.from('federated_actors').select('id').limit(1000),
          _db.from('federated_reactions').select('id').eq('user_id', uid).limit(1000),
          _db.from('federated_instances').select('id').limit(1000),
          _db.from('activitypub_outbox').select('id').eq('local_user_id', uid).limit(1000),
        ]);
        _surfaceMetrics = {
          'Cached posts': (results[0] as List).length,
          'Known actors': (results[1] as List).length,
          'Your reactions': (results[2] as List).length,
          'Known instances': (results[3] as List).length,
          'Your activities': (results[4] as List).length,
        };
        return;
      case 'following':
        final rows = await _db
            .from('federated_following')
            .select('id,remote_actor_url,remote_username,remote_domain,created_at')
            .eq('local_user_id', uid)
            .order('created_at', ascending: false)
            .limit(200)
            .timeout(const Duration(seconds: 15));
        _surfaceRows = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        return;
      case 'followers':
        final rows = await _db
            .from('activitypub_inbox')
            .select('id,activity_type,actor_url,object_url,payload,processed,created_at')
            .eq('local_user_id', uid)
            .ilike('activity_type', '%Follow%')
            .order('created_at', ascending: false)
            .limit(200)
            .timeout(const Duration(seconds: 15));
        _surfaceRows = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        return;
      case 'likes':
        final reactions = await _db
            .from('federated_reactions')
            .select('object_uri,created_at')
            .eq('user_id', uid)
            .eq('reaction_type', 'like')
            .order('created_at', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        final uris = reactions
            .map((row) => '${row['object_uri'] ?? ''}')
            .where((uri) => uri.isNotEmpty)
            .toList();
        if (uris.isEmpty) return;
        final rows = await _db
            .from('federated_objects')
            .select('id,uri,object_type,actor_uri,url,content,summary,published_at,attachments,tags,like_count,announce_count,reply_count,content_warning')
            .inFilter('uri', uris)
            .isFilter('deleted_at', null)
            .eq('tombstone', false)
            .limit(100)
            .timeout(const Duration(seconds: 15));
        _surfaceRows = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        return;
      case 'tips':
      case 'gifts':
        _surfaceMessage = 'Tips and gifts do not yet have a native ActivityPub data contract.';
        return;
      default:
        final actors = await _db
            .from('activitypub_actors')
            .select('actor_id,username,domain')
            .eq('user_id', uid)
            .limit(1)
            .timeout(const Duration(seconds: 15));
        if (actors.isEmpty) {
          _surfaceMessage = 'Create a local Fediverse identity before viewing this profile surface.';
          return;
        }
        final actorUri = '${actors.first['actor_id'] ?? ''}';
        if (actorUri.isEmpty) {
          _surfaceMessage = 'The local Fediverse identity has no canonical actor URI.';
          return;
        }
        final rows = await _db
            .from('federated_objects')
            .select('id,uri,object_type,actor_uri,url,content,summary,published_at,in_reply_to_uri,attachments,tags,like_count,announce_count,reply_count,content_warning')
            .eq('actor_uri', actorUri)
            .isFilter('deleted_at', null)
            .eq('tombstone', false)
            .order('published_at', ascending: false)
            .limit(200)
            .timeout(const Duration(seconds: 15));
        var items = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        if (widget.section == 'replies') {
          items = items.where((row) => row['in_reply_to_uri'] != null).toList();
        } else if (widget.section == 'threads') {
          items = items.where((row) => row['in_reply_to_uri'] == null).toList();
        } else if (widget.section == 'media') {
          items = items.where((row) => row['attachments'] is List && (row['attachments'] as List).isNotEmpty).toList();
        } else if (widget.section == 'videos') {
          items = items.where((row) => '${row['object_type'] ?? ''}'.toLowerCase() == 'video' || (row['attachments'] is List && (row['attachments'] as List).any((item) => item is Map && '${item['mediaType'] ?? item['media_type'] ?? ''}'.startsWith('video/')))).toList();
        } else if (widget.section == 'podcasts') {
          items = items.where((row) => '${row['object_type'] ?? ''}'.toLowerCase() == 'audio').toList();
        } else if (widget.section == 'series') {
          items = items.where((row) => '${row['object_type'] ?? ''}'.toLowerCase() == 'series').toList();
        }
        _surfaceRows = items;
        return;
    }
  }

  Future<void> _markInboxProcessed(Map<String, dynamic> row) async {
    final uid = _uid;
    if (uid == null || row['id'] == null) return;
    try {
      await _db
          .from('activitypub_inbox')
          .update({'processed': true})
          .eq('id', row['id'])
          .eq('local_user_id', uid);
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Could not mark this inbox activity as processed.'),
        ));
      }
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
    if (widget.instancesOnly ||
        widget.section == 'discover' ||
        widget.section == 'organic-discovery') {
      return RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.all(14), children: [
            Row(children: [
              IconButton(
                  onPressed: () => context.go('/fediverse'),
                  icon: const Icon(Icons.arrow_back_rounded)),
              Expanded(
                  child: Text(widget.title,
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
                child: Text(widget.title,
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
          if (_surfaceMessage != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(_surfaceMessage!),
              ),
            ),
          if (_surfaceMetrics.isNotEmpty)
            ..._surfaceMetrics.entries.map((entry) => Card(
                  child: ListTile(
                    leading: const CircleAvatar(child: Icon(Icons.insights_rounded)),
                    title: Text(entry.key),
                    trailing: Text('${entry.value}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
                  ),
                )),
          if (_sectionNeedsDedicatedBackend &&
              !_loading &&
              _error == null &&
              _surfaceMessage == null &&
              _surfaceMetrics.isEmpty &&
              _surfaceRows.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('Nothing to show here yet.')),
            ),
          if (_sectionNeedsDedicatedBackend)
            ..._surfaceRows.map((row) {
              final title = '${row['kind'] ?? row['display_name'] ?? row['remote_username'] ?? row['username'] ?? row['activity_type'] ?? row['name'] ?? row['domain'] ?? row['object_type'] ?? 'Activity'}';
              final subtitle = '${row['domain'] ?? row['remote_domain'] ?? row['actor_url'] ?? row['actor_id'] ?? row['remote_actor_url'] ?? row['phrase'] ?? row['url'] ?? row['object_url'] ?? row['activity_id'] ?? row['created_at'] ?? ''}';
              final detail = '${row['content'] ?? row['summary'] ?? row['payload'] ?? ''}';
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Icon(widget.section == 'inbox' ? Icons.inbox_rounded : widget.section == 'relay' ? Icons.outbox_rounded : widget.section == 'controls' ? Icons.shield_rounded : Icons.public_rounded),
                  title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
                  subtitle: Text([subtitle, detail].where((value) => value.isNotEmpty && value != '{}').join('\\n'), maxLines: 4, overflow: TextOverflow.ellipsis),
                  trailing: widget.section == 'inbox' && row['processed'] != true
                      ? IconButton(tooltip: 'Mark processed', onPressed: () => _markInboxProcessed(row), icon: const Icon(Icons.check_circle_outline_rounded))
                      : widget.section == 'relay'
                          ? Icon(row['delivered'] == true ? Icons.check_circle_rounded : Icons.schedule_rounded)
                          : null,
                ),
              );
            }),
          else if (widget.section == 'discover' ||
              widget.section == 'organic-discovery')
            const Text('Discover public instances and open social communities.')
          else
            const Text(
                'A cached ActivityPub timeline from the open social web.'),
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
          if (!_sectionNeedsDedicatedBackend &&
              _visiblePosts.isEmpty &&
              !_loading &&
              _error == null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text(
                    'No items are available in ${widget.title.toLowerCase()} yet.'),
              ),
            ),
          if (!_sectionNeedsDedicatedBackend)
            ..._visiblePosts.map((p) {
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
                                  backgroundImage:
                                      '${actor['avatar_url'] ?? ''}'
                                              .startsWith('http')
                                          ? NetworkImage(
                                              '${actor['avatar_url']}')
                                          : null,
                                  child: '${actor['avatar_url'] ?? ''}'
                                          .startsWith('http')
                                      ? null
                                      : const Icon(
                                          Icons.person_outline_rounded)),
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
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall)
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
