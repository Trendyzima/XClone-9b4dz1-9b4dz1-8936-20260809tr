import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ExplorePage extends StatefulWidget {
  const ExplorePage({super.key});
  @override
  State<ExplorePage> createState() => _ExplorePageState();
}

class _ExplorePageState extends State<ExplorePage> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _people = [];
  List<Map<String, dynamic>> _posts = [];
  final Set<String> _following = {};
  bool _loading = false;
  String? _error;
  SupabaseClient get _client => Supabase.instance.client;
  String get _uid => _client.auth.currentUser!.id;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _runSearch(String raw) async {
    final query = raw.trim();
    if (query.length < 2) {
      setState(() {
        _people = [];
        _posts = [];
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final safe =
          query.replaceAll(',', ' ').replaceAll('%', '').replaceAll('_', ' ');
      final results = await Future.wait([
        _client
            .from('profiles')
            .select(
                'id,username,display_name,avatar_url,verified,verified_tier')
            .or('username.ilike.%$safe%,display_name.ilike.%$safe%')
            .neq('id', _uid)
            .limit(20),
        _client
            .from('posts')
            .select('id,content,created_at,user_id,author_id,likes_count')
            .ilike('content', '%$safe%')
            .isFilter('deleted_at', null)
            .order('created_at', ascending: false)
            .limit(15),
      ]);
      final people = (results[0] as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
      final posts = (results[1] as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
      if (people.isNotEmpty) {
        final followRows = await _client
            .from('follows')
            .select('following_id')
            .eq('follower_id', _uid)
            .inFilter('following_id', people.map((p) => '${p['id']}').toList());
        _following.addAll(followRows.map((row) => '${row['following_id']}'));
      }
      if (posts.isNotEmpty) {
        final ids = posts
            .map((p) => '${p['author_id'] ?? p['user_id']}')
            .toSet()
            .toList();
        final profiles = await _client
            .from('profiles')
            .select('id,username,display_name')
            .inFilter('id', ids);
        final byId = {
          for (final p in profiles)
            '${p['id']}': Map<String, dynamic>.from(p as Map)
        };
        for (final post in posts) {
          post['profile'] = byId['${post['author_id'] ?? post['user_id']}'];
        }
      }
      if (mounted) {
        setState(() {
          _people = people;
          _posts = posts;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = 'Search failed. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleFollow(Map<String, dynamic> person) async {
    final id = '${person['id']}';
    final wasFollowing = _following.contains(id);
    setState(() {
      wasFollowing ? _following.remove(id) : _following.add(id);
    });
    try {
      if (wasFollowing) {
        await _client
            .from('follows')
            .delete()
            .eq('follower_id', _uid)
            .eq('following_id', id);
      } else {
        await _client.from('follows').insert(
            {'follower_id': _uid, 'following_id': id, 'status': 'accepted'});
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          wasFollowing ? _following.add(id) : _following.remove(id);
        });
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Follow update failed: $error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(14), children: [
      Text('Explore Testagram',
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      TextField(
          controller: _search,
          onSubmitted: _runSearch,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
              hintText: 'Search people and posts',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: IconButton(
                  onPressed: () => _runSearch(_search.text),
                  icon: const Icon(Icons.arrow_forward_rounded)))),
      const SizedBox(height: 8),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null)
        Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
      if (_people.isNotEmpty) ...[
        const SizedBox(height: 16),
        Text('People',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        ..._people.map((person) {
          final name =
              '${person['display_name'] ?? person['username'] ?? 'Testagram user'}';
          final avatar = '${person['avatar_url'] ?? ''}';
          final isFollowing = _following.contains('${person['id']}');
          return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: CircleAvatar(
                    backgroundImage: avatar.startsWith('http')
                        ? CachedNetworkImageProvider(avatar)
                        : null,
                    child: avatar.startsWith('http')
                        ? null
                        : Text(name.isEmpty ? 'T' : name[0].toUpperCase())),
                title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text('@${person['username'] ?? 'testagram'}'),
                trailing: OutlinedButton(
                    onPressed: () => _toggleFollow(person),
                    child: Text(isFollowing ? 'Following' : 'Follow')),
                onTap: () {
                  final username = '${person['username'] ?? ''}';
                  if (username.isNotEmpty) {
                    context.go('/profile/${Uri.encodeComponent(username)}');
                  }
                },
              ));
        }),
      ],
      if (_posts.isNotEmpty) ...[
        const SizedBox(height: 14),
        Text('Posts',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        ..._posts.map((post) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          '${post['profile']?['display_name'] ?? post['profile']?['username'] ?? 'Testagram user'}',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 6),
                      Text('${post['content'] ?? ''}'),
                      const SizedBox(height: 8),
                      Text('♥ ${post['likes_count'] ?? 0}',
                          style: Theme.of(context).textTheme.bodySmall)
                    ])))),
      ],
      if (!_loading &&
          _people.isEmpty &&
          _posts.isEmpty &&
          _search.text.trim().length >= 2 &&
          _error == null)
        const Padding(
            padding: EdgeInsets.all(28),
            child: Center(child: Text('No matching people or posts.'))),
      if (_search.text.trim().length < 2)
        const Padding(
            padding: EdgeInsets.symmetric(vertical: 28),
            child:
                Center(child: Text('Search for a username, person or topic.'))),
    ]);
  }
}
