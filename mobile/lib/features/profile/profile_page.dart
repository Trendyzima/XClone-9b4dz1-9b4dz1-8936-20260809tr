import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/config/app_config.dart';

class ProfilePage extends StatefulWidget {
  const ProfilePage({this.username, this.section = 'posts', super.key});
  final String? username;
  final String section;

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _posts = [];
  List<Map<String, dynamic>> _people = [];
  int _followers = 0;
  int _following = 0;
  bool _isFollowing = false;
  bool _loading = false;
  bool _followBusy = false;
  String? _error;
  SupabaseClient get _client => Supabase.instance.client;
  String? get _uid => _client.auth.currentUser?.id;
  String get _targetId => '${_profile?['id'] ?? _uid ?? ''}';
  bool get _isOwnProfile => _uid != null && _targetId == _uid;

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
      final uid = _uid;
      if (widget.username == null && uid == null) {
        throw Exception('Sign in to view your own profile.');
      }
      final profile = widget.username == null
          ? await _client
              .from('profiles')
              .select('*')
              .eq('id', uid!)
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
      if (uid != null && targetId != uid) {
        final relation = await _client
            .from('follows')
            .select('id')
            .eq('follower_id', uid)
            .eq('following_id', targetId)
            .eq('status', 'accepted')
            .maybeSingle();
        following = relation != null;
      }
      final people = <Map<String, dynamic>>[];
      if (widget.section == 'followers' || widget.section == 'following') {
        final relationColumn =
            widget.section == 'followers' ? 'following_id' : 'follower_id';
        final personColumn =
            widget.section == 'followers' ? 'follower_id' : 'following_id';
        final relationships = await _client
            .from('follows')
            .select('follower_id,following_id')
            .eq(relationColumn, targetId)
            .eq('status', 'accepted')
            .limit(1000)
            .timeout(const Duration(seconds: 15));
        final ids = relationships
            .map((row) => '${row[personColumn]}')
            .where((id) => id.isNotEmpty && id != targetId)
            .toList();
        if (ids.isNotEmpty) {
          final profiles = await _client
              .from('profiles')
              .select('id,username,display_name,full_name,avatar_url,bio')
              .inFilter('id', ids)
              .limit(1000)
              .timeout(const Duration(seconds: 15));
          final byId = <String, Map<String, dynamic>>{
            for (final row in profiles)
              '${row['id']}': Map<String, dynamic>.from(row as Map),
          };
          people.addAll(
            ids.map((id) => byId[id]).whereType<Map<String, dynamic>>(),
          );
        }
      }
      // Load each profile section from its canonical data source. Do not
      // silently show the ordinary timeline for a different section.
      var sectionItems = (results[0] as List)
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
      switch (widget.section) {
        case 'threads':
          final threadRows = await _client
              .from('threads')
              .select('*')
              .eq('owner_id', targetId)
              .isFilter('deleted_at', null)
              .order('created_at', ascending: false)
              .limit(30)
              .timeout(const Duration(seconds: 15));
          sectionItems = threadRows.map((row) {
            final item = Map<String, dynamic>.from(row as Map);
            item['content'] = item['content'] ?? item['body'] ?? '';
            return item;
          }).toList();
          break;
        case 'replies':
          final replyRows = await _client
              .from('replies')
              .select('*')
              .eq('user_id', targetId)
              .order('created_at', ascending: false)
              .limit(30)
              .timeout(const Duration(seconds: 15));
          sectionItems = replyRows.map((row) {
            final item = Map<String, dynamic>.from(row as Map);
            item['content'] = item['content'] ?? item['body'] ?? '';
            return item;
          }).toList();
          break;
        case 'likes':
          final reactionRows = await _client
              .from('post_reactions')
              .select('post_id')
              .eq('user_id', targetId)
              .order('created_at', ascending: false)
              .limit(30)
              .timeout(const Duration(seconds: 15));
          final postIds = reactionRows
              .map((row) => '${row['post_id']}')
              .where((id) => id.isNotEmpty)
              .toSet()
              .toList();
          if (postIds.isEmpty) {
            sectionItems = [];
          } else {
            final likedPosts = await _client
                .from('posts')
                .select('*')
                .inFilter('id', postIds)
                .isFilter('deleted_at', null)
                .limit(30)
                .timeout(const Duration(seconds: 15));
            sectionItems = likedPosts
                .map((row) => Map<String, dynamic>.from(row as Map))
                .toList()
              ..sort((a, b) => '${b['created_at'] ?? ''}'
                  .compareTo('${a['created_at'] ?? ''}'));
          }
          break;
        case 'media':
          sectionItems = sectionItems.where((item) {
            final mediaUrls = item['media_urls'];
            return '${item['image_url'] ?? ''}'.isNotEmpty ||
                '${item['video_url'] ?? ''}'.isNotEmpty ||
                '${item['media_url'] ?? ''}'.isNotEmpty ||
                (mediaUrls is List && mediaUrls.isNotEmpty) ||
                (int.tryParse('${item['media_count'] ?? 0}') ?? 0) > 0;
          }).toList();
          break;
        case 'videos':
          sectionItems = sectionItems.where((item) {
            final videoUrl = '${item['video_url'] ?? ''}';
            return item['is_video'] == true || videoUrl.isNotEmpty;
          }).toList();
          break;
        case 'podcasts':
        case 'series':
        case 'tips':
        case 'gifts':
        case 'analytics':
          sectionItems = [];
          break;
      }
      if (!mounted) return;
      setState(() {
        _people = people;
        _profile = Map<String, dynamic>.from(profile);
        _posts = sectionItems;
        _followers = (results[1] as List).length;
        _following = (results[2] as List).length;
        _isFollowing = following;
      });
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = 'Unable to load this profile. Pull down to retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String get _emptySectionMessage {
    switch (widget.section) {
      case 'threads':
        return 'No threads yet.';
      case 'replies':
        return 'No replies yet.';
      case 'media':
        return 'No media posts yet.';
      case 'videos':
        return 'No videos yet.';
      case 'likes':
        return 'No liked posts to show.';
      default:
        return 'No posts yet.';
    }
  }

  String get _sectionHeading {
    final owner = _isOwnProfile ? 'Your' : 'Their';
    switch (widget.section) {
      case 'posts':
        return '$owner posts';
      case 'threads':
        return '$owner threads';
      case 'replies':
        return '$owner replies';
      case 'media':
        return '$owner media';
      case 'videos':
        return '$owner videos';
      case 'likes':
        return _isOwnProfile ? 'Posts you liked' : 'Liked posts';
      case 'podcasts':
        return '$owner podcasts';
      case 'series':
        return '$owner series';
      case 'tips':
        return '$owner tips';
      case 'gifts':
        return 'Gifts';
      case 'analytics':
        return 'Profile analytics';
      default:
        return '$owner posts';
    }
  }

  Future<void> _toggleFollow() async {
    if (_isOwnProfile || _followBusy) return;
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
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
            .eq('follower_id', uid)
            .eq('following_id', _targetId);
      } else {
        await _client.from('follows').insert({
          'follower_id': uid,
          'following_id': _targetId,
          'status': 'accepted',
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _isFollowing = previous;
          _followers += previous ? 1 : -1;
        });
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Follow update failed: $error')));
      }
    } finally {
      if (mounted) setState(() => _followBusy = false);
    }
  }

  Future<String> _uploadProfileMedia(XFile file, String kind) async {
    final session = _client.auth.currentSession;
    if (session == null) {
      throw Exception('Sign in again before uploading profile media.');
    }
    final extension =
        file.name.contains('.') ? file.name.split('.').last.toLowerCase() : '';
    const mimeByExtension = <String, String>{
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'gif': 'image/gif',
      'avif': 'image/avif',
    };
    final mime = mimeByExtension[extension];
    if (mime == null) {
      throw Exception('Choose a JPG, PNG, WebP, GIF or AVIF image.');
    }
    final bytes = await file.readAsBytes();
    final limit = kind == 'avatar' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (bytes.isEmpty || bytes.length > limit) {
      throw Exception(
        kind == 'avatar'
            ? 'Avatar must be a non-empty image no larger than 2 MB.'
            : 'Cover image must be a non-empty image no larger than 5 MB.',
      );
    }
    final uri = Uri.parse(AppConfig.supabaseUrl)
        .resolve('/functions/v1/profile-media-upload');
    final request = http.MultipartRequest('POST', uri)
      ..headers.addAll({
        'apikey': AppConfig.supabasePublishableKey,
        'Authorization': 'Bearer ${session.accessToken}',
        'Accept': 'application/json',
      })
      ..fields['kind'] = kind
      ..files.add(
        http.MultipartFile.fromBytes(
          'file',
          bytes,
          filename: file.name,
          contentType: MediaType.parse(mime),
        ),
      );
    final streamed = await request.send().timeout(const Duration(seconds: 35));
    final response = await http.Response.fromStream(streamed);
    final payload = jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map
          ? '${payload['error'] ?? payload['message'] ?? 'Profile media upload failed'}'
          : 'Profile media upload failed (HTTP ${response.statusCode}).';
      throw Exception(message);
    }
    if (payload is! Map ||
        payload['ok'] != true ||
        payload['delivery_url'] is! String) {
      throw Exception('The profile media service did not confirm the upload.');
    }
    return payload['delivery_url'] as String;
  }

  Future<void> _editProfile() async {
    final name = TextEditingController(
      text: '${_profile?['display_name'] ?? _profile?['full_name'] ?? ''}',
    );
    final bio = TextEditingController(text: '${_profile?['bio'] ?? ''}');
    final website = TextEditingController(
      text: '${_profile?['website'] ?? _profile?['website_url'] ?? ''}',
    );
    final location = TextEditingController(
      text: '${_profile?['location'] ?? ''}',
    );
    final picker = ImagePicker();
    XFile? avatarFile;
    XFile? coverFile;
    var picking = false;
    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Edit profile'),
          content: SizedBox(
            width: 440,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: name,
                    maxLength: 80,
                    decoration: const InputDecoration(
                      labelText: 'Display name',
                    ),
                  ),
                  TextField(
                    controller: bio,
                    maxLength: 500,
                    minLines: 2,
                    maxLines: 4,
                    decoration: const InputDecoration(labelText: 'Bio'),
                  ),
                  TextField(
                    controller: website,
                    maxLength: 500,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(labelText: 'Website'),
                  ),
                  TextField(
                    controller: location,
                    maxLength: 120,
                    decoration: const InputDecoration(labelText: 'Location'),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: picking
                            ? null
                            : () async {
                                setDialogState(() => picking = true);
                                try {
                                  final file = await picker.pickImage(
                                    source: ImageSource.camera,
                                    imageQuality: 85,
                                    maxWidth: 2048,
                                  );
                                  if (file != null) {
                                    if (await file.length() > 2 * 1024 * 1024) {
                                      if (dialogContext.mounted) {
                                        ScaffoldMessenger.of(
                                          dialogContext,
                                        ).showSnackBar(
                                          const SnackBar(
                                            content: Text(
                                              'Avatar must be 2 MB or smaller.',
                                            ),
                                          ),
                                        );
                                      }
                                    } else {
                                      setDialogState(() => avatarFile = file);
                                    }
                                  }
                                } catch (_) {
                                  if (dialogContext.mounted) {
                                    ScaffoldMessenger.of(dialogContext)
                                        .showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Camera access failed. Check permission and retry.',
                                        ),
                                      ),
                                    );
                                  }
                                } finally {
                                  if (dialogContext.mounted) {
                                    setDialogState(() => picking = false);
                                  }
                                }
                              },
                        icon: const Icon(Icons.photo_camera_outlined),
                        label: const Text('Take avatar photo'),
                      ),
                      OutlinedButton.icon(
                        onPressed: picking
                            ? null
                            : () async {
                                setDialogState(() => picking = true);
                                try {
                                  final file = await picker.pickImage(
                                    source: ImageSource.gallery,
                                    imageQuality: 85,
                                    maxWidth: 2048,
                                  );
                                  if (file != null) {
                                    if (await file.length() > 2 * 1024 * 1024) {
                                      if (dialogContext.mounted) {
                                        ScaffoldMessenger.of(
                                          dialogContext,
                                        ).showSnackBar(
                                          const SnackBar(
                                            content: Text(
                                              'Avatar must be 2 MB or smaller.',
                                            ),
                                          ),
                                        );
                                      }
                                    } else {
                                      setDialogState(() => avatarFile = file);
                                    }
                                  }
                                } catch (_) {
                                  if (dialogContext.mounted) {
                                    ScaffoldMessenger.of(dialogContext)
                                        .showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Photo selection failed. Check media permissions and retry.',
                                        ),
                                      ),
                                    );
                                  }
                                } finally {
                                  if (dialogContext.mounted) {
                                    setDialogState(() => picking = false);
                                  }
                                }
                              },
                        icon: const Icon(Icons.account_circle_outlined),
                        label: const Text('Choose avatar'),
                      ),
                      OutlinedButton.icon(
                        onPressed: picking
                            ? null
                            : () async {
                                setDialogState(() => picking = true);
                                try {
                                  final file = await picker.pickImage(
                                    source: ImageSource.gallery,
                                    imageQuality: 85,
                                    maxWidth: 2560,
                                  );
                                  if (file != null) {
                                    if (await file.length() > 5 * 1024 * 1024) {
                                      if (dialogContext.mounted) {
                                        ScaffoldMessenger.of(dialogContext)
                                            .showSnackBar(
                                          const SnackBar(
                                            content: Text(
                                              'Cover image must be 5 MB or smaller.',
                                            ),
                                          ),
                                        );
                                      }
                                    } else {
                                      setDialogState(() => coverFile = file);
                                    }
                                  }
                                } catch (_) {
                                  if (dialogContext.mounted) {
                                    ScaffoldMessenger.of(dialogContext)
                                        .showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Cover selection failed. Check media permissions and retry.',
                                        ),
                                      ),
                                    );
                                  }
                                } finally {
                                  if (dialogContext.mounted) {
                                    setDialogState(() => picking = false);
                                  }
                                }
                              },
                        icon: const Icon(Icons.wallpaper_outlined),
                        label: const Text('Choose cover'),
                      ),
                    ],
                  ),
                  if (avatarFile != null || coverFile != null) ...[
                    const SizedBox(height: 8),
                    if (avatarFile != null)
                      Text(
                        'Avatar: ${avatarFile!.name}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    if (coverFile != null)
                      Text(
                        'Cover: ${coverFile!.name}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                  if (picking)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: LinearProgressIndicator(),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: picking
                  ? null
                  : () => Navigator.pop(dialogContext, {
                        'display_name': name.text.trim(),
                        'bio': bio.text.trim(),
                        'website': website.text.trim(),
                        'location': location.text.trim(),
                        'avatar': avatarFile,
                        'cover': coverFile,
                      }),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    name.dispose();
    bio.dispose();
    website.dispose();
    location.dispose();
    if (draft == null) return;

    try {
      final update = <String, dynamic>{
        'display_name': draft['display_name'],
        'bio': draft['bio'],
        'website': draft['website'],
        'location': draft['location'],
      };
      final avatar = draft['avatar'] as XFile?;
      final cover = draft['cover'] as XFile?;
      if (avatar != null) {
        update['avatar_url'] = await _uploadProfileMedia(avatar, 'avatar');
      }
      if (cover != null) {
        update['cover_url'] = await _uploadProfileMedia(cover, 'cover');
      }
      final result = await _client.rpc('profile_update',
          params: {'p_input': update}).timeout(const Duration(seconds: 20));
      if (result is! Map || result['updated'] != true) {
        throw Exception('The server did not confirm the profile update.');
      }
      if (mounted) {
        await _load();
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('Profile updated.')));
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Profile update failed: ${error.toString().replaceFirst('Exception: ', '')}',
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile ?? <String, dynamic>{};
    final name =
        '${profile['display_name'] ?? profile['full_name'] ?? profile['username'] ?? 'Testagram user'}';
    final avatar = '${profile['avatar_url'] ?? ''}';
    final cover = profile['cover_url']?.toString() ?? '';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          if (_error != null)
            Padding(padding: const EdgeInsets.all(12), child: Text(_error!)),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  if (cover.startsWith('http'))
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: CachedNetworkImage(
                        imageUrl: cover,
                        height: 112,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorWidget: (_, __, ___) => const SizedBox(height: 8),
                      ),
                    ),
                  if (cover.startsWith('http')) const SizedBox(height: 12),
                  CircleAvatar(
                    radius: 42,
                    backgroundImage: avatar.startsWith('http')
                        ? CachedNetworkImageProvider(avatar)
                        : null,
                    child: avatar.startsWith('http')
                        ? null
                        : Text(
                            name.isEmpty ? 'T' : name[0].toUpperCase(),
                            style: const TextStyle(fontSize: 28),
                          ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    name,
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  Text(
                    '@${profile['username'] ?? 'testagram'}',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  if ('${profile['bio'] ?? ''}'.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        '${profile['bio']}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      _Stat(value: '${_posts.length}', label: 'Posts'),
                      _Stat(value: '$_followers', label: 'Followers'),
                      _Stat(value: '$_following', label: 'Following'),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (_isOwnProfile)
                    OutlinedButton.icon(
                      onPressed: _editProfile,
                      icon: const Icon(Icons.edit_outlined),
                      label: const Text('Edit profile'),
                    )
                  else
                    FilledButton.tonalIcon(
                      onPressed: _followBusy ? null : _toggleFollow,
                      icon: _followBusy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(
                              _isFollowing
                                  ? Icons.person_remove_alt_1_rounded
                                  : Icons.person_add_alt_1_rounded,
                            ),
                      label: Text(_isFollowing ? 'Following' : 'Follow'),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (widget.section == 'followers' ||
              widget.section == 'following') ...[
            Text(
              widget.section == 'followers' ? 'Followers' : 'Following',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            if (_loading && _people.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (!_loading && _people.isEmpty && _error == null)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Text(
                    widget.section == 'followers'
                        ? 'No followers to show yet.'
                        : 'Not following anyone yet.',
                  ),
                ),
              ),
            ..._people.map(
              (person) => Card(
                margin: const EdgeInsets.only(top: 8),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundImage: '${person['avatar_url'] ?? ''}'
                            .startsWith('http')
                        ? CachedNetworkImageProvider('${person['avatar_url']}')
                        : null,
                    child: '${person['avatar_url'] ?? ''}'.startsWith('http')
                        ? null
                        : const Icon(Icons.person_outline_rounded),
                  ),
                  title: Text(
                    '${person['display_name'] ?? person['full_name'] ?? person['username'] ?? 'Testagram user'}',
                  ),
                  subtitle: Text('@${person['username'] ?? 'testagram'}'),
                  onTap: '${person['username'] ?? ''}'.isEmpty
                      ? null
                      : () => context.go(
                            '/profile/${Uri.encodeComponent('${person['username']}')}',
                          ),
                ),
              ),
            ),
          ] else ...[
            Text(
              _sectionHeading,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            if (const {'podcasts', 'series', 'tips', 'gifts', 'analytics'}
                .contains(widget.section))
              const Padding(
                padding: EdgeInsets.all(20),
                child: Center(
                  child: Text(
                    'This profile section is not yet connected to its native data view.',
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            if (_loading && _posts.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (!_loading &&
                _posts.isEmpty &&
                _error == null &&
                !const {'podcasts', 'series', 'tips', 'gifts', 'analytics'}
                    .contains(widget.section))
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(child: Text(_emptySectionMessage)),
              ),
            ..._posts.map(
              (post) => Card(
                margin: const EdgeInsets.only(top: 8),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${post['content'] ?? ''}'),
                      const SizedBox(height: 8),
                      Text(
                        '${post['created_at'] ?? ''}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});
  final String value;
  final String label;
  @override
  Widget build(BuildContext context) => Column(
        children: [
          Text(
            value,
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}
