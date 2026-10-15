// Temporary formatter diagnostic trigger.
import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:video_player/video_player.dart';

import '../../core/config/app_config.dart';
import 'tv_web_player.dart';
import 'tv_playback_policy.dart';
import 'tv_channel_cache_policy.dart';
import 'tv_stream_prefetch.dart';
import '../feed/sponsored_ad_service.dart';

class TvPage extends StatefulWidget {
  const TvPage({
    super.key,
    this.title = 'TikVTV',
    this.initialVerticalMode = true,
    this.streamId,
  });

  final String title;
  final bool initialVerticalMode;
  final String? streamId;
  @override
  State<TvPage> createState() => _TvPageState();
}

class _TvPageState extends State<TvPage> with WidgetsBindingObserver {
  List<Map<String, dynamic>> _channels = [];
  Map<String, dynamic>? _selected;
  bool _loading = false;
  String? _error;
  VideoPlayerController? _player;
  // Keep at most one adjacent native stream initialized, then reuse it on swipe.
  VideoPlayerController? _preloadedPlayer;
  String? _preloadedStreamUrl;
  Future<void>? _preloadedInitialization;
  int _preloadGeneration = 0;
  String? _youtubeExternalUrl;
  bool _playerLoading = false;
  bool _verticalMode = true;
  bool _loadingMore = false;
  int _activeIndex = 0;
  final PageController _feedPageController = PageController();
  int _loadedCatalogSourceCount = 0;
  bool _cacheRestoreAttempted = false;
  int _catalogLoadGeneration = 0;
  int _playGeneration = 0;
  String? _playbackError;
  String? _webPlaybackUrl;
  SponsoredAd? _tvSponsoredAd;
  bool _tvAdRequestedForGeneration = false;
  VideoPlayerController? _lifecyclePausedPlayer;
  late final SponsoredAdService _adService = SponsoredAdService.forClient(
    _client,
  );
  SupabaseClient get _client => Supabase.instance.client;

  @override
  void initState() {
    super.initState();
    _verticalMode = widget.initialVerticalMode;
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (kIsWeb) return;

    if (tvShouldPauseForLifecycle(state)) {
      final player = _player;
      if (player != null &&
          player.value.isInitialized &&
          player.value.isPlaying) {
        _lifecyclePausedPlayer = player;
        unawaited(_pauseNativePlayer(player));
      }
      return;
    }

    final pausedPlayer = _lifecyclePausedPlayer;
    _lifecyclePausedPlayer = null;
    final shouldResume = tvShouldResumeAfterLifecycle(
      state: state,
      wasPlayingBeforePause: pausedPlayer != null,
    );
    if (shouldResume &&
        pausedPlayer != null &&
        identical(_player, pausedPlayer) &&
        pausedPlayer.value.isInitialized) {
      unawaited(_resumeNativePlayer(pausedPlayer));
    }
  }

  Future<void> _pauseNativePlayer(VideoPlayerController player) async {
    try {
      await player.pause();
    } catch (_) {
      // Lifecycle transitions must not crash the channel feed.
    }
  }

  Future<void> _resumeNativePlayer(VideoPlayerController player) async {
    try {
      if (mounted && identical(_player, player) && player.value.isInitialized) {
        await player.play();
      }
    } catch (_) {
      // Playback can require a fresh user gesture after an OS interruption.
    }
  }

  @override
  void dispose() {
    _feedPageController.dispose();
    WidgetsBinding.instance.removeObserver(this);
    _lifecyclePausedPlayer = null;
    _player?.dispose();
    _preloadGeneration++;
    _preloadedPlayer?.dispose();
    _preloadedPlayer = null;
    _preloadedStreamUrl = null;
    _preloadedInitialization = null;
    _adService.close();
    super.dispose();
  }

  static const _catalogSources = <String>[
    'nexus-ke',
    'nexus-news',
    'iptv-org-ke',
    'world-ip-tv-verified',
    'nexus-best',
    'nexus-sports',
    'nexus-music',
    'nexus-kids',
    'nexus-entertainment',
    'iptv-org-int',
    'free-tv-ke',
    'free-tv-global',
    'iptv-org-news',
    'iptv-org-sports',
    'iptv-org-music',
    'iprtl-freetv',
    'iprtl-pluto',
    'subash-football-cricket',
    'dhanytv-indonesia',
    'blitz-latam',
    'freecast-global',
    'india-active-community',
    'portugal-free-tv',
    'indonesia-community',
    'xumo-community',
    'south-africa-community',
    'plex-fast-global',
    'samsung-tv-plus-global',
    'roku-fast-global',
    'italy-openiptv-community',
    'alplox-public-official-global',
    'south-africa-freevisionplay',
    'm3upt-portuguese-global',
  ];
  static const _initialSourceCount = 3;
  static const _sourceBatchSize = 3;

  Future<List<Map<String, dynamic>>> _loadCatalogSource(String sourceId) async {
    try {
      final base = Uri.parse(AppConfig.supabaseUrl);
      final uri = Uri.https(base.host, '/functions/v1/tv-catalog', {
        'source': sourceId,
      });
      final response = await http.get(uri, headers: const {
        'Accept': 'application/json'
      }).timeout(const Duration(seconds: 18));
      if (response.statusCode < 200 || response.statusCode >= 300) return [];
      final payload = jsonDecode(response.body);
      if (payload is! Map || payload['channels'] is! List) return [];
      final raw = (payload['channels'] as List).take(180);
      return raw
          .whereType<Map>()
          .map((channel) {
            final row = Map<String, dynamic>.from(channel);
            final url = '${row['url'] ?? row['source_url'] ?? ''}'.trim();
            final name = '${row['name'] ?? 'Live TV'}'.trim();
            if (!url.startsWith('https://') && !url.startsWith('http://')) {
              return <String, dynamic>{};
            }
            return <String, dynamic>{
              ...row,
              'id': '${row['id'] ?? '$sourceId-${name.hashCode}'}',
              'title': name,
              'name': name,
              'description':
                  '${row['group'] ?? row['category'] ?? row['source'] ?? 'Public live channel'}',
              'thumbnail_url': row['logo'] ?? row['logo_url'],
              'playback_url': url,
              'stream_url': url,
              'url': url,
              'category': row['group'] ?? row['category'] ?? sourceId,
              '_sourceType': 'catalog',
              'is_live': true,
            };
          })
          .where((row) => row.isNotEmpty)
          .toList();
    } catch (_) {
      // Each source is independent: one upstream outage must not blank TV.
      return [];
    }
  }

  /// Return a fresh randomized order for each feed load/refresh.
  ///
  /// Fisher-Yates gives every channel a fair position within this loaded set.
  /// If randomization happens to reproduce the previous order, rotate once so
  /// a refresh visibly changes the feed instead of appearing to do nothing.
  List<Map<String, dynamic>> _shuffleChannels(
    List<Map<String, dynamic>> channels, {
    List<Map<String, dynamic>> previous = const [],
  }) {
    final shuffled = List<Map<String, dynamic>>.of(channels);
    final random = math.Random();
    for (var i = shuffled.length - 1; i > 0; i--) {
      final j = random.nextInt(i + 1);
      final item = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = item;
    }

    bool sameOrder(List<Map<String, dynamic>> a, List<Map<String, dynamic>> b) {
      if (a.length != b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if ('${a[i]['id'] ?? _streamUrl(a[i])}' !=
            '${b[i]['id'] ?? _streamUrl(b[i])}') {
          return false;
        }
      }
      return true;
    }

    if (shuffled.length > 1 && sameOrder(shuffled, previous)) {
      shuffled.insert(0, shuffled.removeLast());
    }
    return shuffled;
  }

  Future<void> _load() async {
    final loadGeneration = ++_catalogLoadGeneration;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _loadedCatalogSourceCount =
          widget.streamId == null ? _initialSourceCount : 0;
      // Restore the last public catalogue before waiting for the network. This
      // makes the vertical feed useful immediately on repeat visits/offline.
      await _restoreCachedCatalog();
      if (!mounted || loadGeneration != _catalogLoadGeneration) return;
      final catalogFuture = widget.streamId == null
          ? Future.wait(
              _catalogSources.take(_initialSourceCount).map(_loadCatalogSource),
            )
          : Future.value(<List<Map<String, dynamic>>>[]);
      final liveFuture = () async {
        try {
          final query =
              _client.from('live_streams').select('*').eq('is_live', true);
          final rows = widget.streamId == null
              ? await query
                  .order('started_at', ascending: false)
                  .limit(40)
                  .timeout(const Duration(seconds: 15))
              : await query
                  .eq('id', widget.streamId!)
                  .limit(1)
                  .timeout(const Duration(seconds: 15));
          return rows
              .map(
                (row) => Map<String, dynamic>.from(row as Map)
                  ..['_sourceType'] = 'testagram-live',
              )
              .toList();
        } catch (_) {
          return <Map<String, dynamic>>[];
        }
      }();

      // Render the public catalog as soon as it is ready instead of waiting on
      // the separate Testagram community-live query.
      final catalogGroups = await catalogFuture;
      final cachedPublicChannels = _channels
          .where((channel) => channel['_sourceType'] == 'catalog')
          .toList(growable: false);
      final catalogChannels = _shuffleChannels(
        _dedupeChannels(
          catalogGroups.expand((group) => group).toList(),
          existing: cachedPublicChannels,
        ),
        previous: _channels,
      );
      if (mounted && loadGeneration == _catalogLoadGeneration) {
        setState(() {
          _channels = catalogChannels;
          final selectedId = '${_selected?['id'] ?? ''}';
          final selectedIndex = selectedId.isEmpty
              ? -1
              : catalogChannels.indexWhere(
                  (channel) => '${channel['id'] ?? ''}' == selectedId,
                );
          if (selectedIndex >= 0) {
            _activeIndex = selectedIndex;
          } else {
            if (_selected != null) _selected = null;
            _activeIndex = 0;
          }
          if (catalogChannels.isEmpty) {
            _error = 'Loading community live channels…';
          }
        });
        unawaited(_persistCachedCatalog(catalogChannels));
        if (_selected != null && _feedPageController.hasClients) {
          final selectedIndex = catalogChannels.indexWhere(
            (channel) =>
                '${channel['id'] ?? ''}' == '${_selected?['id'] ?? ''}',
          );
          if (selectedIndex >= 0) _feedPageController.jumpToPage(selectedIndex);
        }
      }

      final live = await liveFuture;
      if (!mounted || loadGeneration != _catalogLoadGeneration) return;
      final filteredCatalog = widget.streamId == null
          ? catalogChannels
          : catalogChannels
              .where((channel) => '${channel['id'] ?? ''}' == widget.streamId)
              .toList();
      final merged = _shuffleChannels(
        _dedupeChannels(
          live,
          existing: widget.streamId == null ? catalogChannels : filteredCatalog,
        ),
        previous: _channels,
      );
      if (mounted && loadGeneration == _catalogLoadGeneration) {
        setState(() {
          _channels = merged;
          _error = merged.isEmpty
              ? (widget.streamId == null
                  ? 'TV channels could not be loaded. Check your connection and retry.'
                  : 'That live stream is unavailable or has ended.')
              : null;
          final selectedId = '${_selected?['id'] ?? ''}';
          final selectedIndex = selectedId.isEmpty
              ? -1
              : merged.indexWhere(
                  (channel) => '${channel['id'] ?? ''}' == selectedId,
                );
          if (selectedIndex >= 0) {
            _activeIndex = selectedIndex;
          } else {
            if (_selected != null) _selected = null;
            _activeIndex = 0;
          }
        });
        unawaited(_persistCachedCatalog(merged));
        if (_selected != null && _feedPageController.hasClients) {
          final selectedIndex = merged.indexWhere(
            (channel) =>
                '${channel['id'] ?? ''}' == '${_selected?['id'] ?? ''}',
          );
          if (selectedIndex >= 0) _feedPageController.jumpToPage(selectedIndex);
        }
        if (widget.streamId == null && merged.isNotEmpty && _selected == null) {
          _activeIndex = 0;
          unawaited(_play(merged.first));
          unawaited(_prepareAdjacent(0));
        }
        final requestedId = widget.streamId;
        if (requestedId != null && requestedId.isNotEmpty) {
          final index = merged.indexWhere(
            (channel) => '${channel['id'] ?? ''}' == requestedId,
          );
          if (index >= 0) {
            _activeIndex = index;
            unawaited(_play(merged[index]));
          } else if (merged.isNotEmpty) {
            setState(
              () => _error =
                  'That stream is not in the current live catalogue. Refresh or open the TV catalogue.',
            );
          }
        }
      }
    } catch (_) {
      if (mounted && loadGeneration == _catalogLoadGeneration) {
        setState(
          () => _error = _channels.isNotEmpty
              ? null
              : 'TV channels could not be loaded. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted && loadGeneration == _catalogLoadGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _restoreCachedCatalog() async {
    if (_cacheRestoreAttempted ||
        widget.streamId != null ||
        _channels.isNotEmpty) {
      return;
    }
    _cacheRestoreAttempted = true;
    try {
      final preferences = await SharedPreferences.getInstance().timeout(
        const Duration(seconds: 2),
      );
      final cached = TvChannelCachePolicy.decode(
        preferences.getString(TvChannelCachePolicy.cacheKey),
      );
      if (!mounted || _channels.isNotEmpty || cached.isEmpty) return;
      setState(() {
        _channels = cached;
        _activeIndex = 0;
        _error = null;
      });
      // Start the cached first item and prepare its neighbor while the fresh
      // catalogue is fetched in parallel by _load.
      unawaited(_play(cached.first));
      unawaited(_prepareAdjacent(0));
    } catch (_) {
      // Persistence is best effort; always continue with the live catalogue.
    }
  }

  Future<void> _persistCachedCatalog(
    List<Map<String, dynamic>> channels,
  ) async {
    try {
      final encoded = TvChannelCachePolicy.encode(channels);
      if (encoded == null) return;
      final preferences = await SharedPreferences.getInstance().timeout(
        const Duration(seconds: 2),
      );
      await preferences
          .setString(TvChannelCachePolicy.cacheKey, encoded)
          .timeout(const Duration(seconds: 2));
    } catch (_) {
      // Quota/private mode must not affect live playback.
    }
  }

  /// Refresh the vertical feed and return the viewer to its newly shuffled top.
  Future<void> _refreshVerticalFeed() async {
    if (_loading) return;

    setState(() {
      _activeIndex = 0;
      _playbackError = null;
    });
    if (_feedPageController.hasClients) {
      _feedPageController.jumpToPage(0);
    }

    await _load();
    if (!mounted || _channels.isEmpty || widget.streamId != null) return;

    if (_feedPageController.hasClients) {
      _feedPageController.jumpToPage(0);
    }
    setState(() => _activeIndex = 0);
    // PageController won't emit onPageChanged when it was already at page 0.
    // Explicitly start the new first channel so the refreshed order is visible.
    unawaited(_play(_channels.first));
  }

  List<Map<String, dynamic>> _dedupeChannels(
    List<Map<String, dynamic>> rows, {
    List<Map<String, dynamic>> existing = const [],
  }) {
    final seenIds = <String>{};
    final seenUrls = <String>{};
    final merged = <Map<String, dynamic>>[];
    for (final row in [...existing, ...rows]) {
      final id = '${row['id'] ?? ''}';
      final url = _streamUrl(row).toLowerCase();
      if ((id.isNotEmpty && !seenIds.add(id)) ||
          (url.isNotEmpty && !seenUrls.add(url))) {
        continue;
      }
      merged.add(row);
    }
    return merged;
  }

  Future<void> _loadMoreCatalogSources() async {
    if (_loadingMore || _loadedCatalogSourceCount >= _catalogSources.length) {
      return;
    }
    _loadingMore = true;
    final start = _loadedCatalogSourceCount;
    final end = (start + _sourceBatchSize).clamp(0, _catalogSources.length);
    // Advance the cursor before awaiting to prevent overlapping page-change callbacks.
    _loadedCatalogSourceCount = end;
    if (mounted) setState(() {});
    try {
      final groups = await Future.wait(
        _catalogSources.skip(start).take(end - start).map(_loadCatalogSource),
      );
      if (!mounted) return;
      setState(() {
        // Keep existing page indices stable: new catalogue sources append after
        // the current feed instead of reshuffling the page under the viewer.
        _channels = _dedupeChannels(
          groups.expand((group) => group).toList(),
          existing: _channels,
        );
        final selectedId = '${_selected?['id'] ?? ''}';
        final selectedIndex = selectedId.isEmpty
            ? -1
            : _channels.indexWhere(
                (channel) => '${channel['id'] ?? ''}' == selectedId,
              );
        if (selectedIndex >= 0) _activeIndex = selectedIndex;
      });
      unawaited(_persistCachedCatalog(_channels));
    } finally {
      _loadingMore = false;
      if (mounted) setState(() {});
    }
  }

  String _streamUrl(Map<String, dynamic> channel) {
    for (final key in [
      'playback_url',
      'stream_url',
      'hls_url',
      'video_url',
      'manifest_url',
      'url',
    ]) {
      final value = '${channel[key] ?? ''}'.trim();
      if (value.startsWith('https://') || value.startsWith('http://')) {
        return value;
      }
    }
    return '';
  }

  /// Warm the next native catalog stream and cache nearby channel artwork.
  ///
  /// Only one stream is initialized ahead, only on native clients, and it is
  /// never played in the background. Artwork uses CachedNetworkImage's shared
  /// cache on Web/Android.
  Future<void> _prepareAdjacent(int index) async {
    if (!mounted || index < 0 || index >= _channels.length) return;

    for (final adjacentIndex in <int>[index - 1, index + 1]) {
      if (adjacentIndex < 0 || adjacentIndex >= _channels.length) continue;
      final thumbnail =
          '${_channels[adjacentIndex]['thumbnail_url'] ?? ''}'.trim();
      if (thumbnail.startsWith('https://') || thumbnail.startsWith('http://')) {
        unawaited(
          precacheImage(
            CachedNetworkImageProvider(thumbnail),
            context,
          ).catchError((_) {}),
        );
      }
    }

    if (index + 1 >= _channels.length) return;
    final next = _channels[index + 1];
    if (next['_sourceType'] != 'catalog') return;
    final url = _streamUrl(next);
    final parsed = Uri.tryParse(url);
    if (parsed == null || parsed.scheme != 'https' || parsed.host.isEmpty) {
      return;
    }
    if (kIsWeb) {
      warmIptvStream(url);
      return;
    }
    if (_preloadedStreamUrl == url && _preloadedPlayer != null) return;

    final generation = ++_preloadGeneration;
    final previous = _preloadedPlayer;
    _preloadedPlayer = null;
    _preloadedStreamUrl = null;
    _preloadedInitialization = null;
    try {
      await previous?.dispose();
    } catch (_) {
      // Releasing an old warm player must not interrupt the active stream.
    }
    if (!mounted || generation != _preloadGeneration) return;

    final player = VideoPlayerController.networkUrl(parsed);
    _preloadedPlayer = player;
    _preloadedStreamUrl = url;
    final initialization = player.initialize().timeout(
          const Duration(seconds: 10),
        );
    _preloadedInitialization = initialization;
    try {
      await initialization;
      // If a swipe consumed this controller while initialize() was pending,
      // ownership now belongs to _play and this task must not dispose it.
      if (!mounted ||
          generation != _preloadGeneration ||
          !identical(_preloadedPlayer, player)) {
        return;
      }
    } catch (_) {
      if (identical(_preloadedPlayer, player)) {
        _preloadedPlayer = null;
        _preloadedStreamUrl = null;
        _preloadedInitialization = null;
        try {
          await player.dispose();
        } catch (_) {}
      }
    }
  }

  Future<void> _play(Map<String, dynamic> channel) async {
    final generation = ++_playGeneration;
    final requestedUrl =
        channel['_sourceType'] == 'catalog' ? _streamUrl(channel) : '';
    final warmPlayer =
        requestedUrl.isNotEmpty && _preloadedStreamUrl == requestedUrl
            ? _preloadedPlayer
            : null;
    final warmInitialization =
        warmPlayer == null ? null : _preloadedInitialization;
    if (warmPlayer != null) {
      _preloadedPlayer = null;
      _preloadedStreamUrl = null;
      _preloadedInitialization = null;
    } else {
      _preloadGeneration++;
      final stalePreload = _preloadedPlayer;
      _preloadedPlayer = null;
      _preloadedStreamUrl = null;
      _preloadedInitialization = null;
      if (stalePreload != null) unawaited(stalePreload.dispose());
    }
    final previousPlayer = _player;
    // No embedded player controller is retained between selections.
    setState(() {
      _selected = channel;
      _player = null;
      _youtubeExternalUrl = null;
      _webPlaybackUrl = null;
      _tvSponsoredAd = null;
      _tvAdRequestedForGeneration = false;
      _playerLoading = true;
      _playbackError = null;
    });
    try {
      await previousPlayer?.dispose();
      if (generation != _playGeneration) return;

      if (channel['_sourceType'] == 'catalog') {
        final url = _streamUrl(channel);
        if (url.isEmpty) {
          throw Exception(
            'The TV catalog did not return a playable stream URL.',
          );
        }
        if (kIsWeb) {
          _webPlaybackUrl = url;
          if (mounted) setState(() {});
          return;
        }
        VideoPlayerController? player = warmPlayer;
        if (player != null) {
          try {
            await warmInitialization?.timeout(const Duration(seconds: 10));
            if (!player.value.isInitialized) {
              await player.dispose();
              player = null;
            }
          } catch (_) {
            await player?.dispose();
            player = null;
          }
        }
        player ??= VideoPlayerController.networkUrl(Uri.parse(url));
        if (generation != _playGeneration) {
          await player.dispose();
          return;
        }
        _player = player;
        if (!player.value.isInitialized) {
          await player.initialize().timeout(const Duration(seconds: 20));
        }
        if (generation != _playGeneration) {
          await player.dispose();
          if (identical(_player, player)) {
            _player = null;
          }
          return;
        }
        await player.setLooping(true);
        await player.setVolume(1);
        await player.play();
        unawaited(_loadTvSponsoredAd(channel, generation));
        return;
      }

      final base = Uri.parse(AppConfig.siteUrl);
      final resolverUri = Uri.https(base.host, '/api/live', {
        'action': 'viewer',
        'stream_id': '${channel['id']}',
      });
      final response =
          await http.get(resolverUri).timeout(const Duration(seconds: 12));
      if (generation != _playGeneration) return;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final payload = jsonDecode(response.body);
        final data = payload is Map ? payload['data'] : null;
        final provider = data is Map ? '${data['provider'] ?? ''}' : '';
        final youtube = data is Map && data['youtube'] is Map
            ? data['youtube'] as Map
            : null;
        final videoId = '${youtube?['video_id'] ?? ''}'.trim();
        if (provider == 'youtube' && videoId.isNotEmpty) {
          // The embedded YouTube Flutter player depends on Android WebView.
          // Keep the APK WebView-free and hand off to the official provider app
          // or the user's external browser instead.
          final watchUrl = tvExternalYoutubeWatchUrl(videoId);
          if (watchUrl == null) {
            throw Exception(
                'The YouTube provider returned an invalid video identifier.');
          }
          if (generation != _playGeneration) return;
          _youtubeExternalUrl = watchUrl;
          if (mounted) setState(() {});
          return;
        }
      }
      final url = _streamUrl(channel);
      if (url.isEmpty) {
        throw Exception(
          'No playable media URL was returned by the provider resolver.',
        );
      }
      if (kIsWeb) {
        _webPlaybackUrl = url;
        if (mounted) setState(() {});
        return;
      }
      final player = VideoPlayerController.networkUrl(Uri.parse(url));
      if (generation != _playGeneration) {
        await player.dispose();
        return;
      }
      _player = player;
      await player.initialize().timeout(const Duration(seconds: 20));
      if (generation != _playGeneration) {
        await player.dispose();
        if (identical(_player, player)) {
          _player = null;
        }
        return;
      }
      await player.setLooping(true);
      await player.play();
      unawaited(_loadTvSponsoredAd(channel, generation));
    } catch (_) {
      if (generation != _playGeneration) return;
      _playbackError =
          'Playback could not start. The stream may be offline or require a provider-specific adapter.';
      await _player?.dispose();
      if (generation != _playGeneration) return;
      _player = null;
      if (generation != _playGeneration) return;
      _youtubeExternalUrl = null;
    } finally {
      if (mounted && generation == _playGeneration) {
        setState(() => _playerLoading = false);
      }
    }
  }

  Widget _externalYoutubeCard(String url) {
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.play_circle_outline,
                  color: Colors.white, size: 64),
              const SizedBox(height: 12),
              const Text(
                'This video plays in YouTube',
                style: TextStyle(color: Colors.white, fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              const Text(
                'To keep Testagram free of embedded WebViews, open it in the YouTube app or your browser.',
                style: TextStyle(color: Colors.white70, fontSize: 12),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () async {
                  final uri = Uri.tryParse(url);
                  if (uri == null ||
                      uri.scheme != 'https' ||
                      uri.host != 'www.youtube.com') {
                    return;
                  }
                  await launchUrl(uri, mode: LaunchMode.externalApplication);
                },
                icon: const Icon(Icons.open_in_new),
                label: const Text('Watch on YouTube'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _loadTvSponsoredAd(
    Map<String, dynamic> channel,
    int playGeneration,
  ) async {
    if (!mounted ||
        !tvCanRequestSponsoredAd(
          hasPlaybackStarted: true,
          alreadyRequested: _tvAdRequestedForGeneration,
          isCurrentGeneration: playGeneration == _playGeneration,
        )) {
      return;
    }
    _tvAdRequestedForGeneration = true;
    final ad = await _adService.requestAd(
      slotCode: 'iptv-overlay',
      content: {
        'genres': ['television', '${channel['category'] ?? 'live'}'],
        'keywords': ['${channel['title'] ?? channel['name'] ?? 'live tv'}'],
      },
    );
    if (!mounted || playGeneration != _playGeneration) return;
    setState(() => _tvSponsoredAd = ad);
  }

  Widget _buildVerticalFeed(BuildContext context) {
    final active = _channels.isNotEmpty && _activeIndex < _channels.length
        ? _channels[_activeIndex]
        : null;
    final selectedIsActive =
        active != null && '${_selected?['id'] ?? ''}' == '${active['id']}';
    final player = selectedIsActive ? _player : null;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.title,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w900,
                        letterSpacing: -0.5,
                      ),
                ),
              ),
              IconButton(
                tooltip: 'Refresh live channels',
                onPressed: _refreshVerticalFeed,
                icon: const Icon(Icons.refresh_rounded),
              ),
              IconButton.filledTonal(
                tooltip: 'Switch to channel list',
                onPressed: () => setState(() => _verticalMode = false),
                icon: const Icon(Icons.view_list_rounded),
              ),
            ],
          ),
        ),
        if (_error != null && _channels.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        Expanded(
          child: _loading && _channels.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _channels.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.live_tv_rounded, size: 56),
                            const SizedBox(height: 12),
                            Text(
                              _error ??
                                  'No live channels are available right now.',
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 8),
                            FilledButton.icon(
                              onPressed: _load,
                              icon: const Icon(Icons.refresh_rounded),
                              label: const Text('Retry'),
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _refreshVerticalFeed,
                      triggerMode: RefreshIndicatorTriggerMode.onEdge,
                      notificationPredicate: (notification) =>
                          notification.depth == 0 &&
                          notification.metrics.axis == Axis.vertical,
                      child: PageView.builder(
                        controller: _feedPageController,
                        physics: const PageScrollPhysics(
                          parent: AlwaysScrollableScrollPhysics(),
                        ),
                        scrollDirection: Axis.vertical,
                        itemCount: _channels.length,
                        allowImplicitScrolling: true,
                        onPageChanged: (index) {
                          setState(() => _activeIndex = index);
                          unawaited(_play(_channels[index]));
                          unawaited(_prepareAdjacent(index));
                          if (index >= _channels.length - 8) {
                            unawaited(_loadMoreCatalogSources());
                          }
                        },
                        itemBuilder: (context, index) {
                          final channel = _channels[index];
                          final isCurrent =
                              index == _activeIndex && selectedIsActive;
                          final hasPlaybackSurface = isCurrent &&
                              tvHasPlaybackSurface(
                                isWeb: kIsWeb,
                                webPlaybackUrl: _webPlaybackUrl,
                                hasExternalPlaybackAction:
                                    _youtubeExternalUrl != null,
                                hasInitializedNativePlayer:
                                    player?.value.isInitialized == true,
                              );
                          final title = '${channel['title'] ?? 'Live channel'}';
                          final description =
                              '${channel['description'] ?? channel['category'] ?? 'Live on Testagram'}';
                          final thumb = '${channel['thumbnail_url'] ?? ''}';
                          final playbackGeneration = _playGeneration;
                          return GestureDetector(
                            // Let embedded browser/YouTube controls receive taps;
                            // native video can still use the card tap to pause.
                            onTap: isCurrent &&
                                    ((kIsWeb && _webPlaybackUrl != null) ||
                                        _youtubeExternalUrl != null)
                                ? null
                                : () async {
                                    if (isCurrent &&
                                        player?.value.isInitialized == true) {
                                      if (player!.value.isPlaying) {
                                        await player.pause();
                                      } else {
                                        await player.play();
                                      }
                                      if (mounted) setState(() {});
                                    } else {
                                      await _play(channel);
                                    }
                                  },
                            child: Container(
                              color: Colors.black,
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  if (isCurrent && _youtubeExternalUrl != null)
                                    _externalYoutubeCard(_youtubeExternalUrl!)
                                  else if (isCurrent &&
                                      kIsWeb &&
                                      _webPlaybackUrl != null)
                                    TvWebPlayer(
                                      url: _webPlaybackUrl!,
                                      onPlaybackReady: () => unawaited(
                                        _loadTvSponsoredAd(
                                          channel,
                                          playbackGeneration,
                                        ),
                                      ),
                                      onError: (message) {
                                        if (mounted) {
                                          setState(
                                              () => _playbackError = message);
                                        }
                                      },
                                    )
                                  else if (isCurrent &&
                                      player?.value.isInitialized == true)
                                    FittedBox(
                                      fit: BoxFit.cover,
                                      child: SizedBox(
                                        width: player!.value.size.width,
                                        height: player.value.size.height,
                                        child: VideoPlayer(player),
                                      ),
                                    )
                                  else if (thumb.startsWith('http'))
                                    CachedNetworkImage(
                                      imageUrl: thumb,
                                      fit: BoxFit.cover,
                                      placeholder: (_, __) => const Center(
                                        child: Icon(
                                          Icons.live_tv_rounded,
                                          color: Colors.white54,
                                          size: 54,
                                        ),
                                      ),
                                      errorWidget: (_, __, ___) => const Center(
                                        child: Icon(
                                          Icons.live_tv_rounded,
                                          color: Colors.white54,
                                          size: 54,
                                        ),
                                      ),
                                    )
                                  else
                                    const Center(
                                      child: Icon(
                                        Icons.live_tv_rounded,
                                        color: Colors.white54,
                                        size: 64,
                                      ),
                                    ),
                                  const IgnorePointer(
                                    child: DecoratedBox(
                                      decoration: BoxDecoration(
                                        gradient: LinearGradient(
                                          begin: Alignment.topCenter,
                                          end: Alignment.bottomCenter,
                                          colors: [
                                            Color(0x99000000),
                                            Colors.transparent,
                                            Color(0xE6000000),
                                          ],
                                          stops: [0, 0.35, 1],
                                        ),
                                      ),
                                    ),
                                  ),
                                  if (isCurrent && _tvSponsoredAd != null)
                                    Positioned(
                                      top: 52,
                                      left: 12,
                                      right: 72,
                                      child: SponsoredAdCard(
                                        key: ValueKey(
                                            _tvSponsoredAd!.impressionId),
                                        ad: _tvSponsoredAd!,
                                        service: _adService,
                                        compact: true,
                                      ),
                                    ),
                                  Positioned(
                                    left: 16,
                                    right: 88,
                                    bottom: 26,
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 10,
                                            vertical: 5,
                                          ),
                                          decoration: BoxDecoration(
                                            color: Theme.of(context)
                                                .colorScheme
                                                .primary,
                                            borderRadius:
                                                BorderRadius.circular(99),
                                          ),
                                          child: const Text(
                                            'LIVE',
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.w900,
                                              fontSize: 11,
                                              letterSpacing: 1.1,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 10),
                                        Text(
                                          title,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 23,
                                            fontWeight: FontWeight.w900,
                                            shadows: [
                                              Shadow(
                                                color: Colors.black87,
                                                blurRadius: 12,
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(height: 5),
                                        Text(
                                          description,
                                          maxLines: 3,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 13,
                                            height: 1.35,
                                          ),
                                        ),
                                        const SizedBox(height: 12),
                                        if (_playbackError != null && isCurrent)
                                          Text(
                                            _playbackError!,
                                            style: const TextStyle(
                                              color: Color(0xFFFFB4AB),
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        if (!hasPlaybackSurface)
                                          FilledButton.icon(
                                            onPressed:
                                                _playerLoading && isCurrent
                                                    ? null
                                                    : () => _play(channel),
                                            icon: _playerLoading && isCurrent
                                                ? const SizedBox(
                                                    width: 16,
                                                    height: 16,
                                                    child:
                                                        CircularProgressIndicator(
                                                      strokeWidth: 2,
                                                    ),
                                                  )
                                                : const Icon(
                                                    Icons.play_arrow_rounded,
                                                  ),
                                            label: Text(
                                              _playerLoading && isCurrent
                                                  ? 'Connecting…'
                                                  : 'Watch channel',
                                            ),
                                          )
                                        else
                                          Text(
                                            (kIsWeb &&
                                                        _webPlaybackUrl !=
                                                            null) ||
                                                    _youtubeExternalUrl != null
                                                ? 'Use player controls to pause or resume'
                                                : player!.value.isPlaying
                                                    ? 'Tap video to pause'
                                                    : 'Tap video to resume',
                                            style: const TextStyle(
                                              color: Colors.white70,
                                              fontSize: 12,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  Positioned(
                                    right: 14,
                                    bottom: 34,
                                    child: Column(
                                      children: [
                                        CircleAvatar(
                                          radius: 25,
                                          backgroundColor:
                                              Colors.white.withValues(
                                            alpha: 0.14,
                                          ),
                                          child: const Icon(
                                            Icons.live_tv_rounded,
                                            color: Colors.white,
                                            size: 28,
                                          ),
                                        ),
                                        const SizedBox(height: 7),
                                        const Text(
                                          'Channel',
                                          style: TextStyle(
                                            color: Colors.white,
                                            fontSize: 11,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                        const SizedBox(height: 18),
                                        IconButton.filledTonal(
                                          tooltip: 'Share channel',
                                          onPressed: () => Share.share(
                                            '$title · Watch on Testagram TV\nhttps://testagram.site/iptv',
                                          ),
                                          icon: const Icon(Icons.share_rounded),
                                        ),
                                        const SizedBox(height: 12),
                                        IconButton.filledTonal(
                                          tooltip: 'Retry playback',
                                          onPressed: () => _play(channel),
                                          icon:
                                              const Icon(Icons.replay_rounded),
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (_playerLoading && isCurrent)
                                    const Positioned(
                                      top: 12,
                                      left: 0,
                                      right: 0,
                                      child:
                                          LinearProgressIndicator(minHeight: 3),
                                    ),
                                  if (index == 0)
                                    const Positioned(
                                      top: 18,
                                      left: 16,
                                      child: Text(
                                        'Swipe up for next channel',
                                        style: TextStyle(
                                          color: Colors.white70,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_verticalMode) return _buildVerticalFeed(context);
    final player = _player;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.title,
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: 'Refresh channels',
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
              ),
              IconButton.filledTonal(
                tooltip: 'Open vertical TV feed',
                onPressed: () => setState(() => _verticalMode = true),
                icon: const Icon(Icons.view_carousel_rounded),
              ),
            ],
          ),
          const Text(
            'Live channels · playback depends on provider availability and your connection.',
          ),
          if (_selected != null) ...[
            const SizedBox(height: 14),
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (kIsWeb && _webPlaybackUrl != null)
                    SizedBox(
                      height: 440,
                      child: TvWebPlayer(
                        url: _webPlaybackUrl!,
                        onError: (message) {
                          if (mounted) {
                            setState(() => _playbackError = message);
                          }
                        },
                      ),
                    )
                  else if (_youtubeExternalUrl != null)
                    _externalYoutubeCard(_youtubeExternalUrl!)
                  else
                    AspectRatio(
                      aspectRatio: player?.value.isInitialized == true
                          ? player!.value.aspectRatio
                          : 16 / 9,
                      child: Container(
                        color: Colors.black,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            if (player?.value.isInitialized == true)
                              VideoPlayer(player!)
                            else
                              const Center(
                                child: Icon(
                                  Icons.live_tv_rounded,
                                  size: 54,
                                  color: Colors.white70,
                                ),
                              ),
                            if (_playerLoading)
                              const Center(child: CircularProgressIndicator()),
                            if (player?.value.isInitialized == true)
                              Align(
                                alignment: Alignment.bottomCenter,
                                child: VideoProgressIndicator(
                                  player!,
                                  allowScrubbing: true,
                                  padding: const EdgeInsets.all(8),
                                ),
                              ),
                            Align(
                              alignment: Alignment.center,
                              child: IconButton.filledTonal(
                                onPressed: player?.value.isInitialized == true
                                    ? () async {
                                        if (player!.value.isPlaying) {
                                          await player.pause();
                                        } else {
                                          await player.play();
                                        }
                                        if (mounted) setState(() {});
                                      }
                                    : null,
                                iconSize: 36,
                                icon: Icon(
                                  player?.value.isPlaying == true
                                      ? Icons.pause_rounded
                                      : Icons.play_arrow_rounded,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${_selected!['title'] ?? 'Live channel'}',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                        if (_playbackError != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              _playbackError!,
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ),
                        TextButton.icon(
                          onPressed: () async {
                            _playGeneration++;
                            await _player?.dispose();
                            if (mounted) {
                              setState(() {
                                _player = null;
                                _youtubeExternalUrl = null;
                                _webPlaybackUrl = null;
                                _selected = null;
                                _playbackError = null;
                              });
                            }
                          },
                          icon: const Icon(Icons.close_rounded),
                          label: const Text('Close player'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (_loadingMore)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Center(
                child: SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          if (_loading && _channels.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            ),
          if (!_loading && _channels.isEmpty && _error == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: Text('No live channels are available right now.'),
              ),
            ),
          const SizedBox(height: 12),
          ..._channels.map((channel) {
            final title = '${channel['title'] ?? 'Live channel'}';
            final description =
                '${channel['description'] ?? channel['category'] ?? 'Live on Testagram'}';
            final thumb = '${channel['thumbnail_url'] ?? ''}';
            final active = '${_selected?['id'] ?? ''}' == '${channel['id']}';
            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: SizedBox(
                    width: 68,
                    height: 54,
                    child: thumb.startsWith('http')
                        ? CachedNetworkImage(
                            imageUrl: thumb,
                            fit: BoxFit.cover,
                            errorWidget: (_, __, ___) =>
                                const Icon(Icons.live_tv_rounded),
                          )
                        : Container(
                            color: Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                            child: const Icon(Icons.live_tv_rounded),
                          ),
                  ),
                ),
                title: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: IconButton(
                  tooltip: active ? 'Selected channel' : 'Play channel',
                  onPressed: () => _play(channel),
                  icon: Icon(
                    active
                        ? Icons.graphic_eq_rounded
                        : Icons.play_circle_outline_rounded,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                onTap: () => _play(channel),
              ),
            );
          }),
        ],
      ),
    );
  }
}
