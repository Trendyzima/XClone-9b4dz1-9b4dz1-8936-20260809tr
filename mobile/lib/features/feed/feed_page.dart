import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:video_player/video_player.dart';

import '../../core/media/media_upload_policy.dart';
import 'feed_load_policy.dart';
import 'feed_media_url.dart';
import 'feed_offline_cache.dart';
import 'sponsored_ad_service.dart';

class FeedPage extends StatefulWidget {
  const FeedPage({super.key});
  @override
  State<FeedPage> createState() => _FeedPageState();
}

class _FeedPageState extends State<FeedPage> {
  final _scroll = ScrollController();
  final List<Map<String, dynamic>> _posts = [];
  final Set<String> _liked = {};
  final Set<String> _bookmarked = {};
  final Set<String> _reposted = {};
  bool _loading = false;
  bool _publishing = false;
  bool _hasMore = true;
  String _feedTab = 'For you';
  String? _error;
  String? _cursorCreatedAt;
  String? _cursorId;
  int _loadGeneration = 0;
  int _refreshGeneration = 0;
  SponsoredAd? _sponsoredAd;
  late final SponsoredAdService _adService = SponsoredAdService.forClient(
    _client,
  );
  static const _pageSize = 15;

  SupabaseClient get _client => Supabase.instance.client;
  String get _userId => _client.auth.currentUser!.id;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _adService.close();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 700) {
      if (!_loading && _hasMore) _load();
    }
  }

  Future<void> _load({bool reset = false}) async {
    if (!FeedLoadPolicy.shouldStart(
      loading: _loading,
      hasMore: _hasMore,
      reset: reset,
    )) {
      return;
    }
    _loadGeneration = FeedLoadPolicy.nextGeneration(_loadGeneration);
    final generation = _loadGeneration;
    if (reset) _refreshGeneration++;
    final refreshGeneration = _refreshGeneration;
    final pageCursorCreatedAt = reset ? null : _cursorCreatedAt;
    final pageCursorId = reset ? null : _cursorId;
    if (reset) {
      _cursorCreatedAt = null;
      _cursorId = null;
      _hasMore = true;
      _liked.clear();
      _bookmarked.clear();
      _reposted.clear();
    }
    setState(() {
      _loading = true;
      _error = null;
      if (reset) _sponsoredAd = null;
    });
    // Show a user-scoped snapshot immediately while the live request runs. If
    // the network is unavailable, the cached timeline remains readable.
    if (reset && _posts.isEmpty) {
      final cached = await FeedOfflineCache.read(
        userId: _client.auth.currentUser?.id ?? 'anonymous',
        tab: _feedTab,
      );
      if (mounted &&
          cached.isNotEmpty &&
          FeedLoadPolicy.isCurrent(
            requestGeneration: generation,
            currentGeneration: _loadGeneration,
          )) {
        setState(() {
          _posts
            ..clear()
            ..addAll(cached);
          final lastCached = _posts.isEmpty ? null : _posts.last;
          _cursorCreatedAt =
              lastCached == null ? null : '${lastCached['created_at'] ?? ''}';
          _cursorId = lastCached == null ? null : '${lastCached['id'] ?? ''}';
          _hasMore = _posts.length >= FeedOfflineCache.maxPosts;
        });
      }
    }
    try {
      List<String> followingIds = [];
      final viewerId = _client.auth.currentUser?.id;
      if (_feedTab == 'Following' && viewerId != null) {
        final follows = await _client
            .from('follows')
            .select('following_id')
            .eq('follower_id', viewerId)
            .timeout(const Duration(seconds: 12));
        if (!FeedLoadPolicy.isCurrent(
          requestGeneration: generation,
          currentGeneration: _loadGeneration,
        )) {
          return;
        }
        followingIds = follows
            .map((row) => '${row['following_id']}')
            .where((id) => id.isNotEmpty)
            .toList();
      }
      final postQuery = _client.from('posts').select('*');
      var pagedQuery = _feedTab == 'Following'
          ? postQuery.inFilter('author_id', followingIds)
          : postQuery;
      // Keyset pagination is stable when new posts arrive while the reader
      // scrolls; offset pagination can skip or repeat rows between requests.
      final cursorFilter = FeedLoadPolicy.cursorFilter(
        createdAt: pageCursorCreatedAt,
        id: pageCursorId,
      );
      if (cursorFilter != null) {
        pagedQuery = pagedQuery.or(cursorFilter);
      }
      final response =
          _feedTab == 'Following' && (viewerId == null || followingIds.isEmpty)
              ? <dynamic>[]
              : await pagedQuery
                  .order('created_at', ascending: false)
                  .order('id', ascending: false)
                  .limit(_pageSize)
                  .timeout(const Duration(seconds: 15));
      if (!FeedLoadPolicy.isCurrent(
        requestGeneration: generation,
        currentGeneration: _loadGeneration,
      )) {
        return;
      }
      final rows = response
          .map((row) => Map<String, dynamic>.from(row as Map))
          .where((row) => row['deleted_at'] == null)
          .toList();
      final ids = rows
          .map((row) => '${row['author_id'] ?? row['user_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      final profiles = ids.isEmpty
          ? <dynamic>[]
          : await _client
              .from('profiles')
              .select(
                'id,username,display_name,avatar_url,verified,verified_tier',
              )
              .inFilter('id', ids);
      if (!FeedLoadPolicy.isCurrent(
        requestGeneration: generation,
        currentGeneration: _loadGeneration,
      )) {
        return;
      }
      final byId = <String, Map<String, dynamic>>{};
      for (final profile in profiles) {
        final value = Map<String, dynamic>.from(profile as Map);
        byId['${value['id']}'] = value;
      }
      for (final row in rows) {
        row['profile'] = byId['${row['author_id'] ?? row['user_id']}'];
      }
      final postIds = rows.map((row) => '${row['id']}').toList();
      final loadedLikes = <String>{};
      final loadedBookmarks = <String>{};
      final loadedReposts = <String>{};
      if (postIds.isNotEmpty && viewerId != null) {
        final likeRows = await _client
            .from('post_reactions')
            .select('post_id')
            .eq('user_id', viewerId)
            .eq('emoji', '❤️')
            .inFilter('post_id', postIds);
        if (!FeedLoadPolicy.isCurrent(
          requestGeneration: generation,
          currentGeneration: _loadGeneration,
        )) {
          return;
        }
        final bookmarkRows = await _client
            .from('bookmarks')
            .select('post_id')
            .eq('user_id', viewerId)
            .inFilter('post_id', postIds);
        if (!FeedLoadPolicy.isCurrent(
          requestGeneration: generation,
          currentGeneration: _loadGeneration,
        )) {
          return;
        }
        final repostRows = await _client
            .from('reposts')
            .select('post_id')
            .eq('user_id', viewerId)
            .inFilter('post_id', postIds);
        if (!FeedLoadPolicy.isCurrent(
          requestGeneration: generation,
          currentGeneration: _loadGeneration,
        )) {
          return;
        }
        loadedLikes.addAll(likeRows.map((row) => '${row['post_id']}'));
        loadedBookmarks.addAll(bookmarkRows.map((row) => '${row['post_id']}'));
        loadedReposts.addAll(repostRows.map((row) => '${row['post_id']}'));
      }
      if (!mounted ||
          !FeedLoadPolicy.isCurrent(
            requestGeneration: generation,
            currentGeneration: _loadGeneration,
          )) {
        return;
      }
      setState(() {
        if (reset) _posts.clear();
        final known = _posts.map((post) => '${post['id']}').toSet();
        _posts.addAll(rows.where((row) => !known.contains('${row['id']}')));
        if (reset) {
          _liked
            ..clear()
            ..addAll(loadedLikes);
          _bookmarked
            ..clear()
            ..addAll(loadedBookmarks);
          _reposted
            ..clear()
            ..addAll(loadedReposts);
        } else {
          _liked.addAll(loadedLikes);
          _bookmarked.addAll(loadedBookmarks);
          _reposted.addAll(loadedReposts);
        }
        final lastLoaded = rows.isEmpty ? null : rows.last;
        if (lastLoaded != null) {
          _cursorCreatedAt = '${lastLoaded['created_at'] ?? ''}';
          _cursorId = '${lastLoaded['id'] ?? ''}';
        }
        _hasMore = rows.length == _pageSize;
      });
      unawaited(
        FeedOfflineCache.write(
          userId: viewerId ?? 'anonymous',
          tab: _feedTab,
          posts: _posts,
        ),
      );
      if (reset && _posts.length >= 5) {
        unawaited(_loadSponsoredAd(refreshGeneration));
      }
    } catch (error) {
      if (mounted &&
          FeedLoadPolicy.isCurrent(
            requestGeneration: generation,
            currentGeneration: _loadGeneration,
          )) {
        setState(() => _error = _friendlyError(error));
      }
    } finally {
      if (mounted &&
          FeedLoadPolicy.isCurrent(
            requestGeneration: generation,
            currentGeneration: _loadGeneration,
          )) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _loadSponsoredAd(int refreshGeneration) async {
    final ad = await _adService.requestAd(
      slotCode: 'feed-inline',
      content: const {
        'genres': ['social', 'community'],
      },
    );
    if (!mounted ||
        !FeedLoadPolicy.isCurrent(
          requestGeneration: refreshGeneration,
          currentGeneration: _refreshGeneration,
        )) {
      return;
    }
    setState(() => _sponsoredAd = ad);
  }

  void _promptSignIn(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        action: SnackBarAction(
          label: 'Sign in',
          onPressed: () => context.go('/auth'),
        ),
      ),
    );
  }

  String _friendlyError(Object error) {
    final message = error.toString();
    if (message.contains('SocketException') ||
        message.contains('Failed host lookup')) {
      return 'You appear to be offline. Check your connection and retry.';
    }
    if (message.contains('TimeoutException')) {
      return 'The feed took too long to respond. Pull down to retry.';
    }
    return 'Could not load the feed. Please retry. Details: ${message.length > 150 ? '${message.substring(0, 150)}…' : message}';
  }

  Future<void> _toggleLike(Map<String, dynamic> post) async {
    if (_client.auth.currentUser == null) {
      _promptSignIn('Sign in to like posts.');
      return;
    }
    final id = '${post['id']}';
    final wasLiked = _liked.contains(id);
    setState(() {
      wasLiked ? _liked.remove(id) : _liked.add(id);
    });
    try {
      if (wasLiked) {
        await _client
            .from('post_reactions')
            .delete()
            .eq('user_id', _userId)
            .eq('post_id', id)
            .eq('emoji', '❤️');
      } else {
        await _client.from('post_reactions').upsert({
          'user_id': _userId,
          'post_id': id,
          'emoji': '❤️',
        }, onConflict: 'post_id,user_id');
      }
      if (mounted) {
        setState(
          () => post['likes_count'] =
              ((post['likes_count'] as num?)?.toInt() ?? 0) +
                  (wasLiked ? -1 : 1),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          wasLiked ? _liked.add(id) : _liked.remove(id);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update like: $error')),
        );
      }
    }
  }

  Future<void> _toggleBookmark(Map<String, dynamic> post) async {
    if (_client.auth.currentUser == null) {
      _promptSignIn('Sign in to bookmark posts.');
      return;
    }
    final id = '${post['id']}';
    final wasSaved = _bookmarked.contains(id);
    setState(() {
      wasSaved ? _bookmarked.remove(id) : _bookmarked.add(id);
    });
    try {
      if (wasSaved) {
        await _client
            .from('bookmarks')
            .delete()
            .eq('user_id', _userId)
            .eq('post_id', id);
      } else {
        await _client.from('bookmarks').insert({
          'user_id': _userId,
          'post_id': id,
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          wasSaved ? _bookmarked.add(id) : _bookmarked.remove(id);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update bookmark: $error')),
        );
      }
    }
  }

  Future<void> _toggleRepost(Map<String, dynamic> post) async {
    if (_client.auth.currentUser == null) {
      _promptSignIn('Sign in to repost.');
      return;
    }
    final id = '${post['id']}';
    final wasReposted = _reposted.contains(id);
    setState(() {
      wasReposted ? _reposted.remove(id) : _reposted.add(id);
    });
    try {
      if (wasReposted) {
        await _client
            .from('reposts')
            .delete()
            .eq('user_id', _userId)
            .eq('post_id', id);
      } else {
        await _client.from('reposts').insert({
          'user_id': _userId,
          'post_id': id,
        });
      }
      if (mounted) {
        setState(
          () => post['reposts_count'] =
              ((post['reposts_count'] as num?)?.toInt() ?? 0) +
                  (wasReposted ? -1 : 1),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          wasReposted ? _reposted.add(id) : _reposted.remove(id);
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update repost: $error')),
        );
      }
    }
  }

  Future<void> _copyPostLink(Map<String, dynamic> post) async {
    final link = 'https://testagram.site/post/${post['id']}';
    await Clipboard.setData(ClipboardData(text: link));
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Post link copied.')));
    }
  }

  Future<void> _sharePost(Map<String, dynamic> post) async {
    final link = 'https://testagram.site/post/${post['id']}';
    final body =
        '${post['content'] ?? 'Check out this post on Testagram'}\n$link';
    try {
      await Share.share(body, subject: 'Testagram post');
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open the share sheet: $error')),
        );
      }
    }
  }

  Future<void> _reportPost(Map<String, dynamic> post) async {
    if (_client.auth.currentUser == null) {
      _promptSignIn('Sign in to report a post.');
      return;
    }
    const reasons = <String, String>{
      'spam': 'Spam or misleading',
      'hate_speech': 'Hate speech',
      'misinformation': 'Misinformation',
      'explicit': 'Explicit content',
      'violence': 'Violence or threats',
      'harassment': 'Harassment or bullying',
    };
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Report post'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: reasons.entries
              .map(
                (entry) => ListTile(
                  title: Text(entry.value),
                  onTap: () => Navigator.pop(context, entry.key),
                ),
              )
              .toList(),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
    if (reason == null) return;
    try {
      await _client.from('reports').insert({
        'reporter_id': _userId,
        'target_type': 'post',
        'target_id': post['id'],
        'reason': reason,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Report submitted to Testagram moderation.'),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Report could not be submitted: $error')),
        );
      }
    }
  }

  Future<void> _showComments(Map<String, dynamic> post) async {
    if (_client.auth.currentUser == null) {
      _promptSignIn('Sign in to open the discussion.');
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _CommentsSheet(
        postId: '${post['id']}',
        client: _client,
        userId: _userId,
      ),
    );
  }

  Future<void> _compose() async {
    if (_client.auth.currentUser == null) {
      _promptSignIn('Sign in to publish a post.');
      return;
    }
    final controller = TextEditingController();
    final picker = ImagePicker();
    XFile? selectedMedia;
    var selectedIsVideo = false;
    var choosingMedia = false;
    final draft = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 12,
            bottom: MediaQuery.viewInsetsOf(context).bottom + 24,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Create a post',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: controller,
                  autofocus: true,
                  maxLength: 5000,
                  maxLines: 6,
                  minLines: 3,
                  decoration: const InputDecoration(
                    hintText: 'What is happening on Testagram?',
                    alignLabelWithHint: true,
                  ),
                ),
                if (selectedMedia != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color:
                          Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          selectedIsVideo
                              ? Icons.video_file_rounded
                              : Icons.image_rounded,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            selectedMedia!.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Remove attachment',
                          onPressed: () => setSheetState(() {
                            selectedMedia = null;
                            selectedIsVideo = false;
                          }),
                          icon: const Icon(Icons.close_rounded),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: choosingMedia
                          ? null
                          : () async {
                              setSheetState(() => choosingMedia = true);
                              try {
                                final file = await picker.pickImage(
                                  source: ImageSource.camera,
                                  imageQuality: 88,
                                  maxWidth: 2560,
                                );
                                if (file != null) {
                                  setSheetState(() {
                                    selectedMedia = file;
                                    selectedIsVideo = false;
                                  });
                                }
                              } catch (_) {
                                if (sheetContext.mounted) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Camera is unavailable or permission was denied.',
                                      ),
                                    ),
                                  );
                                }
                              } finally {
                                if (sheetContext.mounted) {
                                  setSheetState(() => choosingMedia = false);
                                }
                              }
                            },
                      icon: const Icon(Icons.photo_camera_outlined),
                      label: const Text('Camera'),
                    ),
                    OutlinedButton.icon(
                      onPressed: choosingMedia
                          ? null
                          : () async {
                              setSheetState(() => choosingMedia = true);
                              try {
                                final file = await picker.pickImage(
                                  source: ImageSource.gallery,
                                  imageQuality: 88,
                                  maxWidth: 2560,
                                );
                                if (file != null) {
                                  setSheetState(() {
                                    selectedMedia = file;
                                    selectedIsVideo = false;
                                  });
                                }
                              } catch (_) {
                                if (sheetContext.mounted) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Photo selection failed. Check media permissions and retry.',
                                      ),
                                    ),
                                  );
                                }
                              } finally {
                                if (sheetContext.mounted) {
                                  setSheetState(() => choosingMedia = false);
                                }
                              }
                            },
                      icon: const Icon(Icons.photo_library_outlined),
                      label: const Text('Photo'),
                    ),
                    OutlinedButton.icon(
                      onPressed: choosingMedia
                          ? null
                          : () async {
                              setSheetState(() => choosingMedia = true);
                              try {
                                final file = await picker.pickVideo(
                                  source: ImageSource.gallery,
                                  maxDuration: const Duration(minutes: 5),
                                );
                                if (file != null) {
                                  setSheetState(() {
                                    selectedMedia = file;
                                    selectedIsVideo = true;
                                  });
                                }
                              } catch (_) {
                                if (sheetContext.mounted) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Video selection failed. Check media permissions and retry.',
                                      ),
                                    ),
                                  );
                                }
                              } finally {
                                if (sheetContext.mounted) {
                                  setSheetState(() => choosingMedia = false);
                                }
                              }
                            },
                      icon: const Icon(Icons.video_library_outlined),
                      label: const Text('Video'),
                    ),
                  ],
                ),
                if (choosingMedia) const LinearProgressIndicator(),
                const SizedBox(height: 14),
                FilledButton(
                  onPressed: choosingMedia ||
                          (controller.text.trim().isEmpty &&
                              selectedMedia == null)
                      ? null
                      : () => Navigator.pop(sheetContext, {
                            'content': controller.text.trim(),
                            'media': selectedMedia,
                            'isVideo': selectedIsVideo,
                          }),
                  child: const Text('Publish post'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    controller.dispose();
    if (draft == null) return;
    final content = '${draft['content'] ?? ''}'.trim();
    final media = draft['media'] as XFile?;
    final isVideo = draft['isVideo'] == true;
    if (content.isEmpty && media == null) return;
    if (_publishing) return;
    setState(() => _publishing = true);
    String? uploadedPath;
    try {
      String? mediaUrl;
      if (media != null) {
        final bytes = await media.readAsBytes();
        final extension = MediaUploadPolicy.normalizeExtension(
          media.name,
          isVideo: isVideo,
        );
        MediaUploadPolicy.validateSize(bytes.length, isVideo: isVideo);
        final path =
            '$_userId/${DateTime.now().microsecondsSinceEpoch}.$extension';
        await _client.storage.from('posts').uploadBinary(
              path,
              bytes,
              fileOptions: FileOptions(
                contentType: MediaUploadPolicy.contentType(extension),
                upsert: false,
              ),
            );
        uploadedPath = path;
        mediaUrl = _client.storage.from('posts').getPublicUrl(path);
      }
      await _client.from('posts').insert({
        'user_id': _userId,
        'author_id': _userId,
        'content': content,
        if (mediaUrl != null && isVideo) 'video_url': mediaUrl,
        if (mediaUrl != null && !isVideo) 'image_url': mediaUrl,
        if (mediaUrl != null) 'is_video': isVideo,
      });
      if (mounted) {
        await _load(reset: true);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your post has been published.')),
        );
      }
    } catch (error) {
      if (uploadedPath != null) {
        try {
          await _client.storage.from('posts').remove([uploadedPath]);
        } catch (_) {
          // Best-effort cleanup; storage policies remain authoritative.
        }
      }
      if (mounted) {
        final message = error.toString().replaceFirst('Exception: ', '');
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Post failed: $message')));
      }
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: CustomScrollView(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Container(
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .scaffoldBackgroundColor
                    .withValues(alpha: 0.94),
                border: Border(
                  bottom: BorderSide(color: Theme.of(context).dividerColor),
                ),
              ),
              child: Row(
                children: [
                  for (final tab in const ['For you', 'Following'])
                    Expanded(
                      child: InkWell(
                        onTap: _feedTab == tab || _loading
                            ? null
                            : () {
                                setState(() => _feedTab = tab);
                                _load(reset: true);
                              },
                        child: Container(
                          constraints: const BoxConstraints(minHeight: 48),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            border: Border(
                              bottom: BorderSide(
                                color: _feedTab == tab
                                    ? Theme.of(context).colorScheme.primary
                                    : Colors.transparent,
                                width: 3,
                              ),
                            ),
                          ),
                          child: Text(
                            tab,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: _feedTab == tab
                                  ? Theme.of(context).colorScheme.onSurface
                                  : Theme.of(context)
                                      .textTheme
                                      .bodySmall
                                      ?.color,
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
              child: Card(
                child: InkWell(
                  borderRadius: BorderRadius.circular(18),
                  onTap: _publishing ? null : _compose,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        CircleAvatar(
                          backgroundColor:
                              Theme.of(context).colorScheme.primaryContainer,
                          child: const Icon(Icons.edit_rounded),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text('Share something with your community…'),
                        ),
                        IconButton(
                          tooltip: 'Create post',
                          onPressed: _compose,
                          icon: const Icon(Icons.add_circle_rounded),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (_error != null)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  children: [
                    if (_posts.isNotEmpty)
                      const Icon(Icons.cloud_off_rounded, size: 20),
                    Text(
                      _posts.isNotEmpty
                          ? 'Live refresh failed — showing saved posts.'
                          : _error!,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => _load(reset: true),
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            ),
          if (_posts.isEmpty && _loading)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_posts.isEmpty && _error == null)
            SliverFillRemaining(
              hasScrollBody: false,
              child: Center(
                child: Text(
                  _feedTab == 'Following' && _client.auth.currentUser == null
                      ? 'Sign in to see posts from people you follow.'
                      : 'No posts yet. Be the first to share something.',
                ),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 14),
              sliver: SliverList.separated(
                itemCount: _posts.length +
                    (_sponsoredAd != null && _posts.length >= 5 ? 1 : 0),
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (_sponsoredAd != null &&
                      _posts.length >= 5 &&
                      index == 5) {
                    return SponsoredAdCard(
                      key: ValueKey(_sponsoredAd!.impressionId),
                      ad: _sponsoredAd!,
                      service: _adService,
                    );
                  }
                  final postIndex =
                      _sponsoredAd != null && _posts.length >= 5 && index > 5
                          ? index - 1
                          : index;
                  final post = _posts[postIndex];
                  return _PostCard(
                    post: post,
                    liked: _liked.contains('${post['id']}'),
                    bookmarked: _bookmarked.contains('${post['id']}'),
                    reposted: _reposted.contains('${post['id']}'),
                    onLike: () => _toggleLike(post),
                    onBookmark: () => _toggleBookmark(post),
                    onRepost: () => _toggleRepost(post),
                    onReply: () => _showComments(post),
                    onShare: () => _sharePost(post),
                    onCopyLink: () => _copyPostLink(post),
                    onReport: () => _reportPost(post),
                  );
                },
              ),
            ),
          if (_loading && _posts.isNotEmpty)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
          if (!_hasMore && _posts.isNotEmpty)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.fromLTRB(20, 10, 20, 24),
                child: Center(
                  child: Text(
                    'You’re all caught up.',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PostCard extends StatelessWidget {
  const _PostCard({
    required this.post,
    required this.liked,
    required this.bookmarked,
    required this.reposted,
    required this.onLike,
    required this.onBookmark,
    required this.onRepost,
    required this.onReply,
    required this.onShare,
    required this.onCopyLink,
    required this.onReport,
  });
  final Map<String, dynamic> post;
  final bool liked;
  final bool bookmarked;
  final bool reposted;
  final VoidCallback onLike;
  final VoidCallback onBookmark;
  final VoidCallback onRepost;
  final VoidCallback onReply;
  final VoidCallback onShare;
  final VoidCallback onCopyLink;
  final VoidCallback onReport;

  @override
  Widget build(BuildContext context) {
    final profile = (post['profile'] as Map?)?.cast<String, dynamic>() ??
        <String, dynamic>{};
    final name =
        '${profile['display_name'] ?? profile['username'] ?? 'Testagram user'}';
    final avatar = '${profile['avatar_url'] ?? ''}';
    final content = '${post['content'] ?? ''}';
    final media = FeedMediaUrl.normalize(post['image_url']) ?? '';
    final video = FeedMediaUrl.normalize(post['video_url']) ?? '';
    final verified = profile['verified'] == true ||
        (profile['verified_tier'] != null &&
            profile['verified_tier'] != 'none');
    final date = DateTime.tryParse('${post['created_at'] ?? ''}');
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 13, 14, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 21,
                  backgroundImage: avatar.startsWith('http')
                      ? CachedNetworkImageProvider(avatar)
                      : null,
                  child: avatar.startsWith('http')
                      ? null
                      : Text(name.isNotEmpty ? name[0].toUpperCase() : 'T'),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          if (verified)
                            const Padding(
                              padding: EdgeInsets.only(left: 4),
                              child: Icon(
                                Icons.verified_rounded,
                                size: 15,
                                color: Color(0xFF148F44),
                              ),
                            ),
                        ],
                      ),
                      Text(
                        '@${profile['username'] ?? 'testagram'} · ${date == null ? '' : _relativeDate(date)}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'More options',
                  onPressed: () => showModalBottomSheet<void>(
                    context: context,
                    showDragHandle: true,
                    builder: (context) => SafeArea(
                      child: Wrap(
                        children: [
                          ListTile(
                            leading: const Icon(Icons.link_rounded),
                            title: const Text('Copy post link'),
                            onTap: () {
                              Navigator.pop(context);
                              onCopyLink();
                            },
                          ),
                          ListTile(
                            leading: const Icon(Icons.flag_outlined),
                            title: const Text('Report post'),
                            onTap: () {
                              Navigator.pop(context);
                              onReport();
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.more_horiz_rounded),
                ),
              ],
            ),
            if (content.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 10, bottom: 8),
                child: SelectableText(
                  content,
                  style: const TextStyle(fontSize: 15, height: 1.4),
                ),
              ),
            if (video.startsWith('http'))
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 8),
                child: _InlineVideo(url: video),
              ),
            if (media.startsWith('http'))
              Padding(
                padding: const EdgeInsets.only(top: 6, bottom: 8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: CachedNetworkImage(
                    imageUrl: media,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    placeholder: (_, __) => const SizedBox(
                      height: 160,
                      child: Center(child: CircularProgressIndicator()),
                    ),
                    errorWidget: (_, __, ___) => const SizedBox(
                      height: 100,
                      child: Center(child: Icon(Icons.broken_image_outlined)),
                    ),
                  ),
                ),
              ),
            const Divider(height: 12),
            Row(
              children: [
                _PostAction(
                  icon: liked
                      ? Icons.favorite_rounded
                      : Icons.favorite_border_rounded,
                  label: '${post['likes_count'] ?? 0}',
                  active: liked,
                  onTap: onLike,
                ),
                _PostAction(
                  icon: Icons.mode_comment_outlined,
                  label: '${post['replies_count'] ?? 0}',
                  onTap: onReply,
                ),
                _PostAction(
                  icon: Icons.repeat_rounded,
                  label: '${post['reposts_count'] ?? 0}',
                  active: reposted,
                  onTap: onRepost,
                ),
                IconButton(
                  tooltip: 'Share post',
                  onPressed: onShare,
                  icon: const Icon(Icons.share_outlined),
                ),
                const Spacer(),
                IconButton(
                  tooltip: bookmarked ? 'Remove bookmark' : 'Bookmark',
                  onPressed: onBookmark,
                  icon: Icon(
                    bookmarked
                        ? Icons.bookmark_rounded
                        : Icons.bookmark_border_rounded,
                    color: bookmarked
                        ? Theme.of(context).colorScheme.primary
                        : null,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _relativeDate(DateTime date) {
    final delta = DateTime.now().difference(date);
    if (delta.inMinutes < 1) return 'now';
    if (delta.inHours < 1) return '${delta.inMinutes}m';
    if (delta.inDays < 1) return '${delta.inHours}h';
    if (delta.inDays < 7) return '${delta.inDays}d';
    return '${date.day}/${date.month}/${date.year}';
  }
}

class _PostAction extends StatelessWidget {
  const _PostAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  @override
  Widget build(BuildContext context) => TextButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 19, color: active ? Colors.redAccent : null),
        label: Text(label, style: const TextStyle(fontSize: 12)),
      );
}

class _InlineVideo extends StatefulWidget {
  const _InlineVideo({required this.url});
  final String url;
  @override
  State<_InlineVideo> createState() => _InlineVideoState();
}

class _InlineVideoState extends State<_InlineVideo> {
  VideoPlayerController? _controller;
  ScrollPosition? _scrollPosition;
  bool _loading = false;
  bool _initializing = false;
  bool _wasVisible = false;
  bool _manuallyPaused = false;
  String? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final nextPosition = Scrollable.maybeOf(context)?.position;
    if (!identical(nextPosition, _scrollPosition)) {
      _scrollPosition?.removeListener(_onScroll);
      _scrollPosition = nextPosition;
      _scrollPosition?.addListener(_onScroll);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _updateVisibility());
  }

  void _onScroll() => _updateVisibility();

  void _updateVisibility() {
    if (!mounted) return;
    final object = context.findRenderObject();
    if (object is! RenderBox || !object.hasSize) return;
    final rect = object.localToGlobal(Offset.zero) & object.size;
    final screen = MediaQuery.sizeOf(context);
    final padding = MediaQuery.paddingOf(context);
    final visibleTop = padding.top;
    final visibleBottom = screen.height - padding.bottom;
    final visibleHeight = (rect.bottom.clamp(visibleTop, visibleBottom) -
            rect.top.clamp(visibleTop, visibleBottom))
        .clamp(0.0, rect.height);
    final visible = rect.height > 0 && visibleHeight / rect.height >= 0.55;

    if (visible && !_wasVisible) _manuallyPaused = false;
    _wasVisible = visible;
    final controller = _controller;
    if (!visible) {
      if (controller?.value.isPlaying == true) {
        controller!.pause();
      }
      return;
    }
    if (_manuallyPaused) return;
    if (controller == null) {
      unawaited(_initializeAndPlay());
    } else if (controller.value.isInitialized && !controller.value.isPlaying) {
      unawaited(controller.play());
    }
  }

  Future<void> _initializeAndPlay() async {
    if (_initializing || _controller != null || !mounted) return;
    _initializing = true;
    setState(() {
      _loading = true;
      _error = null;
    });
    VideoPlayerController? controller;
    try {
      final uri = Uri.parse(widget.url);
      if (uri.scheme != 'https' || uri.host.isEmpty) {
        throw const FormatException('Unsafe video URL');
      }
      controller = VideoPlayerController.networkUrl(uri);
      _controller = controller;
      await controller.initialize().timeout(const Duration(seconds: 18));
      await controller.setLooping(true);
      await controller.setVolume(0);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {});
      if (_wasVisible && !_manuallyPaused) await controller.play();
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Video could not start. Check the stream URL or network.';
        });
      }
      if (identical(_controller, controller)) _controller = null;
      await controller?.dispose();
    } finally {
      _initializing = false;
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggle() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      _manuallyPaused = false;
      await _initializeAndPlay();
      return;
    }
    if (controller.value.isPlaying) {
      _manuallyPaused = true;
      await controller.pause();
    } else {
      _manuallyPaused = false;
      await controller.setVolume(0);
      await controller.play();
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _scrollPosition?.removeListener(_onScroll);
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: AspectRatio(
        aspectRatio: controller?.value.isInitialized == true
            ? controller!.value.aspectRatio
            : 16 / 9,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (controller?.value.isInitialized == true)
              VideoPlayer(controller!)
            else
              Container(
                color: Colors.black87,
                child: Center(
                  child: Icon(
                    Icons.play_circle_outline_rounded,
                    size: 54,
                    color: Colors.white.withValues(alpha: 0.9),
                  ),
                ),
              ),
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: _toggle,
                child: Center(
                  child: _loading
                      ? const CircularProgressIndicator()
                      : controller?.value.isPlaying == true
                          ? const Icon(
                              Icons.pause_circle_outline_rounded,
                              size: 54,
                              color: Colors.white,
                            )
                          : const Icon(
                              Icons.play_circle_outline_rounded,
                              size: 54,
                              color: Colors.white,
                            ),
                ),
              ),
            ),
            if (_error != null)
              Positioned(
                left: 8,
                right: 8,
                bottom: 8,
                child: Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
              ),
            const Positioned(
              right: 8,
              top: 8,
              child: Icon(Icons.volume_off_rounded, color: Colors.white70),
            ),
          ],
        ),
      ),
    );
  }
}

class _CommentsSheet extends StatefulWidget {
  const _CommentsSheet({
    required this.postId,
    required this.client,
    required this.userId,
  });
  final String postId;
  final SupabaseClient client;
  final String userId;
  @override
  State<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends State<_CommentsSheet> {
  final _composer = TextEditingController();
  List<Map<String, dynamic>> _replies = [];
  bool _loading = false;
  bool _sending = false;
  String? _error;

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
      final rows = await widget.client
          .from('replies')
          .select('id,user_id,post_id,content,created_at')
          .eq('post_id', widget.postId)
          .order('created_at', ascending: true)
          .limit(100);
      final replies =
          rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
      final ids = replies.map((row) => '${row['user_id']}').toSet().toList();
      if (ids.isNotEmpty) {
        final profiles = await widget.client
            .from('profiles')
            .select('id,username,display_name,avatar_url')
            .inFilter('id', ids);
        final byId = {
          for (final row in profiles)
            '${row['id']}': Map<String, dynamic>.from(row as Map),
        };
        for (final reply in replies) {
          reply['profile'] = byId['${reply['user_id']}'];
        }
      }
      if (mounted) setState(() => _replies = replies);
    } catch (error) {
      if (mounted) {
        setState(() => _error = 'Comments could not be loaded. Retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.client.from('replies').insert({
        'post_id': widget.postId,
        'user_id': widget.userId,
        'content': text,
      });
      _composer.clear();
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Comment failed: $error')));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.78,
          child: Column(
            children: [
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Replies (${_replies.length})',
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                    ),
                    IconButton(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
              ),
              if (_error != null)
                Padding(padding: const EdgeInsets.all(8), child: Text(_error!)),
              if (_loading && _replies.isEmpty)
                const Expanded(
                    child: Center(child: CircularProgressIndicator()))
              else
                Expanded(
                  child: _replies.isEmpty
                      ? const Center(child: Text('Be the first to reply.'))
                      : ListView.builder(
                          itemCount: _replies.length,
                          itemBuilder: (context, index) {
                            final reply = _replies[index];
                            final profile = (reply['profile'] as Map?)
                                    ?.cast<String, dynamic>() ??
                                <String, dynamic>{};
                            final name =
                                '${profile['display_name'] ?? profile['username'] ?? 'Testagram user'}';
                            final avatar = '${profile['avatar_url'] ?? ''}';
                            return ListTile(
                              leading: CircleAvatar(
                                backgroundImage: avatar.startsWith('http')
                                    ? CachedNetworkImageProvider(avatar)
                                    : null,
                                child: avatar.startsWith('http')
                                    ? null
                                    : Text(
                                        name.isEmpty
                                            ? 'T'
                                            : name[0].toUpperCase(),
                                      ),
                              ),
                              title: Text(
                                name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700),
                              ),
                              subtitle: Text('${reply['content'] ?? ''}'),
                            );
                          },
                        ),
                ),
              Padding(
                padding: EdgeInsets.fromLTRB(
                  12,
                  8,
                  12,
                  MediaQuery.viewInsetsOf(context).bottom + 12,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _composer,
                        minLines: 1,
                        maxLines: 4,
                        maxLength: 2000,
                        decoration: const InputDecoration(
                          hintText: 'Write a reply…',
                          counterText: '',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: _sending ? null : _send,
                      icon: _sending
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_rounded),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
}
