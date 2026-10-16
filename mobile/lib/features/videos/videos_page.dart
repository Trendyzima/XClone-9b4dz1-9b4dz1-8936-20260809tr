import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:video_player/video_player.dart';

class VideosPage extends StatefulWidget {
  const VideosPage({super.key, this.shortsMode = false, this.watchLaterOnly = false});
  final bool shortsMode;
  final bool watchLaterOnly;
  @override
  State<VideosPage> createState() => _VideosPageState();
}

class _VideosPageState extends State<VideosPage> {
  static const _pageSize = 12;
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  final _pager = PageController();
  final _videos = <Map<String, dynamic>>[];
  final _liked = <String>{};
  final _saved = <String>{};
  bool _loading = false, _hasMore = true;
  int _page = 0, _active = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSaved().then((_) {
      if (mounted) _load(reset: true);
    });
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  Future<void> _loadSaved() async {
    final prefs = await SharedPreferences.getInstance();
    final key = 'testagram-watch-later:${_uid ?? 'guest'}';
    final raw = prefs.getString(key);
    if (raw == null) return;
    try {
      _saved.addAll((jsonDecode(raw) as List).map((v) => '$v'));
    } catch (_) {
      /* malformed local cache is ignored */
    }
  }

  Future<void> _persistSaved() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('testagram-watch-later:${_uid ?? 'guest'}', jsonEncode(_saved.toList()));
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading || (!reset && !_hasMore)) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    if (reset) {
      _videos.clear();
      _page = 0;
      _hasMore = true;
      _liked.clear();
    }
    try {
      if (widget.watchLaterOnly && _saved.isEmpty) {
        if (mounted) {
          setState(() {
            _hasMore = false;
            _videos.clear();
          });
        }
        return;
      }
      var query = _db
          .from('posts')
          .select(
            'id,user_id,author_id,content,video_url,views_count,likes_count,created_at,is_video',
          )
          .eq('is_video', true)
          .not('video_url', 'is', null);
      if (widget.watchLaterOnly) query = query.inFilter('id', _saved.toList());
      final rows = await query
          .order('created_at', ascending: false)
          .range(_page * _pageSize, _page * _pageSize + _pageSize - 1)
          .timeout(const Duration(seconds: 15));
      var page = rows
          .map((r) => Map<String, dynamic>.from(r as Map))
          .where((r) => '${r['video_url'] ?? ''}'.startsWith('http'))
          .toList();
      final authorIds = page
          .map((v) => '${v['author_id'] ?? v['user_id'] ?? ''}')
          .where((v) => v.isNotEmpty)
          .toSet()
          .toList();
      final profiles = authorIds.isEmpty
          ? <dynamic>[]
          : await _db
              .from('profiles')
              .select('id,username,display_name,avatar_url,verified')
              .inFilter('id', authorIds);
      final byId = {for (final p in profiles) '${p['id']}': Map<String, dynamic>.from(p as Map)};
      for (final video in page) {
        video['profile'] = byId['${video['author_id'] ?? video['user_id']}'];
      }
      final uid = _uid;
      if (uid != null && page.isNotEmpty) {
        final ids = page.map((v) => '${v['id']}').toList();
        final reactions = await _db
            .from('post_reactions')
            .select('post_id')
            .eq('user_id', uid)
            .eq('emoji', '❤️')
            .inFilter('post_id', ids);
        _liked.addAll(reactions.map((r) => '${r['post_id']}'));
      }
      if (widget.watchLaterOnly) {
        page = page.where((v) => _saved.contains('${v['id']}')).toList();
      }
      if (!mounted) return;
      setState(() {
        _videos.addAll(page);
        _hasMore = rows.length == _pageSize;
        if (_hasMore) _page++;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Videos could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleSaved(Map<String, dynamic> video) async {
    final id = '${video['id']}';
    final wasSaved = _saved.contains(id);
    setState(() {
      wasSaved ? _saved.remove(id) : _saved.add(id);
      if (widget.watchLaterOnly && wasSaved) {
        _videos.removeWhere((v) => '${v['id']}' == id);
      }
    });
    try {
      await _persistSaved();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Watch Later could not be saved on this device.')),
        );
      }
    }
  }

  Future<void> _toggleLike(Map<String, dynamic> video) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final id = '${video['id']}';
    final wasLiked = _liked.contains(id);
    setState(() {
      wasLiked ? _liked.remove(id) : _liked.add(id);
      video['likes_count'] = ((video['likes_count'] as num?)?.toInt() ?? 0) + (wasLiked ? -1 : 1);
    });
    try {
      if (wasLiked) {
        await _db
            .from('post_reactions')
            .delete()
            .eq('user_id', uid)
            .eq('post_id', id)
            .eq('emoji', '❤️');
      } else {
        await _db.from('post_reactions').upsert({
          'user_id': uid,
          'post_id': id,
          'emoji': '❤️',
        }, onConflict: 'post_id,user_id');
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          wasLiked ? _liked.add(id) : _liked.remove(id);
          video['likes_count'] =
              ((video['likes_count'] as num?)?.toInt() ?? 0) + (wasLiked ? 1 : -1);
        });
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Like failed. Please retry.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.watchLaterOnly
        ? 'Watch Later'
        : widget.shortsMode
            ? 'Shorts'
            : 'Videos';
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              IconButton(
                tooltip: 'Videos',
                onPressed: () => context.go('/videos'),
                icon: const Icon(Icons.video_library_outlined),
              ),
              IconButton(
                tooltip: 'Watch Later',
                onPressed: () => context.go('/videos/watchlater'),
                icon: const Icon(Icons.bookmark_border_rounded),
              ),
            ],
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                Text(_error!),
                TextButton(onPressed: () => _load(reset: true), child: const Text('Retry')),
              ],
            ),
          ),
        Expanded(
          child: _videos.isEmpty && _loading
              ? const Center(child: CircularProgressIndicator())
              : _videos.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('No videos found yet.'),
                          TextButton(
                              onPressed: () => _load(reset: true), child: const Text('Refresh')),
                        ],
                      ),
                    )
                  : PageView.builder(
                      controller: _pager,
                      scrollDirection: Axis.vertical,
                      itemCount: _videos.length + (_hasMore ? 1 : 0),
                      onPageChanged: (index) {
                        setState(() => _active = index);
                        if (index >= _videos.length - 3 && !_loading && _hasMore) {
                          _load();
                        }
                      },
                      itemBuilder: (context, index) {
                        if (index >= _videos.length) {
                          return const Center(child: CircularProgressIndicator());
                        }
                        final video = _videos[index];
                        return _VideoCard(
                          video: video,
                          active: index == _active,
                          shortsMode: widget.shortsMode,
                          liked: _liked.contains('${video['id']}'),
                          saved: _saved.contains('${video['id']}'),
                          onLike: () => _toggleLike(video),
                          onSave: () => _toggleSaved(video),
                          onShare: () => Share.share(
                            'Watch this Testagram video: https://testagram.site/videos?id=${video['id']}',
                          ),
                        );
                      },
                    ),
        ),
      ],
    );
  }
}

class _VideoCard extends StatefulWidget {
  const _VideoCard({
    required this.video,
    required this.active,
    required this.shortsMode,
    required this.liked,
    required this.saved,
    required this.onLike,
    required this.onSave,
    required this.onShare,
  });
  final Map<String, dynamic> video;
  final bool active, shortsMode, liked, saved;
  final VoidCallback onLike, onSave, onShare;
  @override
  State<_VideoCard> createState() => _VideoCardState();
}

class _VideoCardState extends State<_VideoCard> {
  VideoPlayerController? _controller;
  bool _failed = false;
  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    final url = '${widget.video['video_url'] ?? ''}';
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      setState(() => _failed = true);
      return;
    }
    final controller = VideoPlayerController.networkUrl(Uri.parse(url));
    _controller = controller;
    try {
      await controller.initialize().timeout(const Duration(seconds: 20));
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {});
      if (widget.active) await controller.play();
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  void didUpdateWidget(covariant _VideoCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    if (widget.active && !oldWidget.active) {
      c.play();
    } else if (!widget.active && oldWidget.active) {
      c.pause();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final profile = (widget.video['profile'] as Map<String, dynamic>?) ?? {};
    final name = '${profile['display_name'] ?? profile['username'] ?? 'Testagram creator'}';
    final controller = _controller;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
      child: Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: widget.shortsMode ? 620 : 780),
          child: SizedBox.expand(
            child: Card(
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: Container(
                      color: Colors.black,
                      alignment: Alignment.center,
                      child: _failed
                          ? const Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.video_library_outlined, color: Colors.white70, size: 42),
                                SizedBox(height: 8),
                                Text(
                                  'This video could not be played',
                                  style: TextStyle(color: Colors.white70),
                                ),
                              ],
                            )
                          : controller != null && controller.value.isInitialized
                              ? AspectRatio(
                                  aspectRatio: controller.value.aspectRatio,
                                  child: VideoPlayer(controller),
                                )
                              : const CircularProgressIndicator(),
                    ),
                  ),
                  Positioned(
                    left: 12,
                    right: 70,
                    bottom: 16,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                            shadows: [Shadow(blurRadius: 8, color: Colors.black)],
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${widget.video['content'] ?? ''}',
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            shadows: [Shadow(blurRadius: 8, color: Colors.black)],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${widget.video['views_count'] ?? 0} views',
                          style: const TextStyle(color: Colors.white70),
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    right: 8,
                    bottom: 18,
                    child: Column(
                      children: [
                        IconButton(
                          tooltip: widget.liked ? 'Unlike' : 'Like',
                          onPressed: widget.onLike,
                          color: widget.liked ? Colors.pinkAccent : Colors.white,
                          icon: Icon(widget.liked ? Icons.favorite : Icons.favorite_border),
                        ),
                        Text(
                          '${widget.video['likes_count'] ?? 0}',
                          style: const TextStyle(color: Colors.white),
                        ),
                        const SizedBox(height: 10),
                        IconButton(
                          tooltip: widget.saved ? 'Remove from Watch Later' : 'Save to Watch Later',
                          onPressed: widget.onSave,
                          color: widget.saved ? Colors.greenAccent : Colors.white,
                          icon: Icon(widget.saved ? Icons.bookmark : Icons.bookmark_border),
                        ),
                        IconButton(
                          tooltip: 'Share video',
                          onPressed: widget.onShare,
                          color: Colors.white,
                          icon: const Icon(Icons.share_rounded),
                        ),
                      ],
                    ),
                  ),
                  if (controller != null && controller.value.isInitialized)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: IconButton.filledTonal(
                        onPressed: () async {
                          if (controller.value.isPlaying) {
                            await controller.pause();
                          } else {
                            await controller.play();
                          }
                          if (mounted) setState(() {});
                        },
                        icon: Icon(
                          controller.value.isPlaying
                              ? Icons.pause_rounded
                              : Icons.play_arrow_rounded,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
