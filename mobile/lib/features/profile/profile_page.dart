import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({this.username, super.key});
  final String? username;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _posts = [];
  int _followers = 0;
  int _following = 0;
  bool _isFollowing = false;
  bool _loading = false;
  bool _followBusy = false;
  String? _error;
  SupabaseClient get _client => Supabase.instance.client;
  String get _uid => _client.auth.currentUser!.id;
  String get _targetId => '${_profile?['id'] ?? _uid}';
  bool get _isOwnProfile => _targetId == _uid;

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
      final profile = widget.username == null
          ? await _client
              .from('profiles')
              .select('*')
              .eq('id', _uid)
              .maybeSingle()
          : await _client
              .from('profiles')
              .select('*')
              .eq('username', widget.username!)
              .maybeSingle();
      if (profile == null) throw Exception('This profile could not be found.');
      final targetId = '${profile['id']}';
      final results = await Future.wait([
        _client
            .from('posts')
            .select('*')
            .eq('user_id', targetId)
            .isFilter('deleted_at', null)
            .order('created_at', ascending: false)
            .limit(30),
        _client
            .from('follows')
            .select('id')
            .eq('following_id', targetId)
            .eq('status', 'accepted')
            .limit(1000),
        _client
            .from('follows')
            .select('id')
            .eq('follower_id', targetId)
            .eq('status', 'accepted')
            .limit(1000),
      ]);
      var following = false;
      if (targetId != _uid) {
        final relation = await _client
            .from('follows')
            .select('id')
            .eq('follower_id', _uid)
            .eq('following_id', targetId)
            .eq('status', 'accepted')
            .maybeSingle();
        following = relation != null;
      }
      if (!mounted) return;
      setState(() {
        _profile = Map<String, dynamic>.from(profile);
        _posts = (results[0] as List)
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList();
        _followers = (results[1] as List).length;
        _following = (results[2] as List).length;
        _isFollowing = following;
      });
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = 'Unable to load this profile. Pull down to retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleFollow() async {
    if (_isOwnProfile || _followBusy) return;
    final previous = _isFollowing;
    setState(() {
      _isFollowing = !previous;
      _followBusy = true;
      _followers += previous ? -1 : 1;
    });
    try {
      if (previous) {
        await _client
            .from('follows')
            .delete()
            .eq('follower_id', _uid)
            .eq('following_id', _targetId);
      } else {
        await _client.from('follows').insert({
          'follower_id': _uid,
          'following_id': _targetId,
          'status': 'accepted'
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _isFollowing = previous;
          _followers += previous ? 1 : -1;
        });
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Follow update failed: $error')));
      }
    } finally {
      if (mounted) setState(() => _followBusy = false);
    }
  }

  Future<void> _editProfile() async {
    final name = TextEditingController(
        text: '${_profile?['display_name'] ?? _profile?['full_name'] ?? ''}');
    final bio = TextEditingController(text: '${_profile?['bio'] ?? ''}');
    final save = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
              title: const Text('Edit profile'),
              content: SingleChildScrollView(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextField(
                    controller: name,
                    maxLength: 80,
                    decoration:
                        const InputDecoration(labelText: 'Display name')),
                const SizedBox(height: 8),
                TextField(
                    controller: bio,
                    maxLength: 280,
                    minLines: 2,
                    maxLines: 4,
                    decoration: const InputDecoration(labelText: 'Bio')),
              ])),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Save'))
              ],
            ));
    if (save != true) {
      name.dispose();
      bio.dispose();
      return;
    }
    try {
      await _client.from('profiles').update({
        'display_name': name.text.trim(),
        'bio': bio.text.trim()
      }).eq('id', _uid);
      name.dispose();
      bio.dispose();
      if (mounted) {
        await _load();
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('Profile updated.')));
        }
      }
    } catch (error) {
      name.dispose();
      bio.dispose();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Profile update failed: $error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile ?? <String, dynamic>{};
    final name =
        '${profile['display_name'] ?? profile['full_name'] ?? profile['username'] ?? 'Testagram user'}';
    final avatar = '${profile['avatar_url'] ?? ''}';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        if (_error != null)
          Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
        Card(
            child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(children: [
                  CircleAvatar(
                      radius: 42,
                      backgroundImage: avatar.startsWith('http')
                          ? CachedNetworkImageProvider(avatar)
                          : null,
                      child: avatar.startsWith('http')
                          ? null
                          : Text(name.isEmpty ? 'T' : name[0].toUpperCase(),
                              style: const TextStyle(fontSize: 28))),
                  const SizedBox(height: 12),
                  Text(name,
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800)),
                  Text('@${profile['username'] ?? 'testagram'}',
                      style: Theme.of(context).textTheme.bodyMedium),
                  if ('${profile['bio'] ?? ''}'.isNotEmpty)
                    Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text('${profile['bio']}',
                            textAlign: TextAlign.center)),
                  const SizedBox(height: 16),
                  Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _Stat(value: '${_posts.length}', label: 'Posts'),
                        _Stat(value: '$_followers', label: 'Followers'),
                        _Stat(value: '$_following', label: 'Following'),
                      ]),
                  const SizedBox(height: 12),
                  if (_isOwnProfile)
                    OutlinedButton.icon(
                        onPressed: _editProfile,
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Edit profile'))
                  else
                    FilledButton.tonalIcon(
                        onPressed: _followBusy ? null : _toggleFollow,
                        icon: _followBusy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : Icon(_isFollowing
                                ? Icons.person_remove_alt_1_rounded
                                : Icons.person_add_alt_1_rounded),
                        label: Text(_isFollowing ? 'Following' : 'Follow')),
                ]))),
        const SizedBox(height: 12),
        Text('${_isOwnProfile ? 'Your' : 'Their'} posts',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        if (_loading && _posts.isEmpty)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator())),
        if (!_loading && _posts.isEmpty && _error == null)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('No posts yet.'))),
        ..._posts.map((post) => Card(
            margin: const EdgeInsets.only(top: 8),
            child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${post['content'] ?? ''}'),
                      const SizedBox(height: 8),
                      Text('${post['created_at'] ?? ''}',
                          style: Theme.of(context).textTheme.bodySmall)
                    ])))),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});
  final String value;
  final String label;
  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800)),
        Text(label, style: Theme.of(context).textTheme.bodySmall)
      ]);
}
