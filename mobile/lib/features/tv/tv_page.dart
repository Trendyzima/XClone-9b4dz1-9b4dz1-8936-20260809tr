import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:http/http.dart' as http;
import 'package:youtube_player_iframe/youtube_player_iframe.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:video_player/video_player.dart';

import '../../core/config/app_config.dart';

class TvPage extends StatefulWidget {
  const TvPage({super.key});
  @override
  State<TvPage> createState() => _TvPageState();
}

class _TvPageState extends State<TvPage> {
  List<Map<String, dynamic>> _channels = [];
  Map<String, dynamic>? _selected;
  bool _loading = false;
  String? _error;
  VideoPlayerController? _player;
  YoutubePlayerController? _youtubePlayer;
  bool _playerLoading = false;
  String? _playbackError;
  SupabaseClient get _client => Supabase.instance.client;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _player?.dispose();
    _youtubePlayer?.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _client
          .from('live_streams')
          .select('*')
          .eq('is_live', true)
          .order('started_at', ascending: false)
          .limit(40);
      if (mounted) {
        setState(() => _channels =
            rows.map((row) => Map<String, dynamic>.from(row as Map)).toList());
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error =
            'Live channels are unavailable. Check the connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _streamUrl(Map<String, dynamic> channel) {
    for (final key in [
      'playback_url',
      'stream_url',
      'hls_url',
      'video_url',
      'manifest_url'
    ]) {
      final value = '${channel[key] ?? ''}'.trim();
      if (value.startsWith('https://') || value.startsWith('http://')) {
        return value;
      }
    }
    return '';
  }

  Future<void> _play(Map<String, dynamic> channel) async {
    setState(() {
      _selected = channel;
      _playerLoading = true;
      _playbackError = null;
    });
    await _player?.dispose();
    await _youtubePlayer?.close();
    _player = null;
    _youtubePlayer = null;
    try {
      // Resolve provider metadata through the same viewer API as the web client.
      final base = Uri.parse(AppConfig.siteUrl);
      final resolverUri = Uri.https(base.host, '/api/live', {
        'action': 'viewer',
        'stream_id': '${channel['id']}',
      });
      final response =
          await http.get(resolverUri).timeout(const Duration(seconds: 12));
      if (response.statusCode >= 200 && response.statusCode < 300) {
        final payload = jsonDecode(response.body);
        final data = payload is Map ? payload['data'] : null;
        final provider = data is Map ? '${data['provider'] ?? ''}' : '';
        final youtube = data is Map && data['youtube'] is Map
            ? data['youtube'] as Map
            : null;
        final videoId = '${youtube?['video_id'] ?? ''}'.trim();
        if (provider == 'youtube' && videoId.isNotEmpty) {
          _youtubePlayer = YoutubePlayerController.fromVideoId(
            videoId: videoId,
            autoPlay: true,
            params: const YoutubePlayerParams(
              showControls: true,
              showFullscreenButton: true,
              enableCaption: true,
              origin: AppConfig.siteUrl,
            ),
          );
          if (mounted) setState(() {});
          return;
        }
      }
      final url = _streamUrl(channel);
      if (url.isEmpty) {
        throw Exception(
            'No playable media URL was returned by the provider resolver.');
      }
      final player = VideoPlayerController.networkUrl(Uri.parse(url));
      _player = player;
      await player.initialize().timeout(const Duration(seconds: 20));
      await player.setLooping(true);
      await player.play();
    } catch (error) {
      _playbackError =
          'Playback could not start. The stream may be offline or require a provider-specific adapter.';
      await _player?.dispose();
      _player = null;
      await _youtubePlayer?.close();
      _youtubePlayer = null;
    } finally {
      if (mounted) setState(() => _playerLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final player = _player;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          Expanded(
              child: Text('Testagram TV',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800))),
          IconButton(
              tooltip: 'Refresh channels',
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded))
        ]),
        const Text(
            'Live channels · playback depends on provider availability and your connection.'),
        if (_selected != null) ...[
          const SizedBox(height: 14),
          Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_youtubePlayer != null)
                      YoutubePlayer(
                          controller: _youtubePlayer!, aspectRatio: 16 / 9)
                    else
                      AspectRatio(
                          aspectRatio: player?.value.isInitialized == true
                              ? player!.value.aspectRatio
                              : 16 / 9,
                          child: Container(
                              color: Colors.black,
                              child: Stack(fit: StackFit.expand, children: [
                                if (player?.value.isInitialized == true)
                                  VideoPlayer(player!)
                                else
                                  const Center(
                                      child: Icon(Icons.live_tv_rounded,
                                          size: 54, color: Colors.white70)),
                                if (_playerLoading)
                                  const Center(
                                      child: CircularProgressIndicator()),
                                if (player?.value.isInitialized == true)
                                  Align(
                                      alignment: Alignment.bottomCenter,
                                      child: VideoProgressIndicator(player!,
                                          allowScrubbing: true,
                                          padding: const EdgeInsets.all(8))),
                                Align(
                                    alignment: Alignment.center,
                                    child: IconButton.filledTonal(
                                        onPressed: player
                                                    ?.value.isInitialized ==
                                                true
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
                                                : Icons.play_arrow_rounded))),
                              ]))),
                    Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${_selected!['title'] ?? 'Live channel'}',
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w800)),
                              if (_playbackError != null)
                                Padding(
                                    padding: const EdgeInsets.only(top: 8),
                                    child: Text(_playbackError!,
                                        style: TextStyle(
                                            color: Theme.of(context)
                                                .colorScheme
                                                .error))),
                              TextButton.icon(
                                  onPressed: () async {
                                    await _player?.dispose();
                                    await _youtubePlayer?.close();
                                    if (mounted) {
                                      setState(() {
                                        _player = null;
                                        _youtubePlayer = null;
                                        _selected = null;
                                        _playbackError = null;
                                      });
                                    }
                                  },
                                  icon: const Icon(Icons.close_rounded),
                                  label: const Text('Close player'))
                            ])),
                  ])),
        ],
        if (_loading && _channels.isEmpty)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                Text(_error!),
                TextButton(onPressed: _load, child: const Text('Retry'))
              ])),
        if (!_loading && _channels.isEmpty && _error == null)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                  child: Text('No live channels are available right now.'))),
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
                                  const Icon(Icons.live_tv_rounded))
                          : Container(
                              color: Theme.of(context)
                                  .colorScheme
                                  .surfaceContainerHighest,
                              child: const Icon(Icons.live_tv_rounded))),
                ),
                title:
                    Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(description,
                    maxLines: 2, overflow: TextOverflow.ellipsis),
                trailing: IconButton(
                    tooltip: active ? 'Selected channel' : 'Play channel',
                    onPressed: () => _play(channel),
                    icon: Icon(
                        active
                            ? Icons.graphic_eq_rounded
                            : Icons.play_circle_outline_rounded,
                        color: Theme.of(context).colorScheme.primary)),
                onTap: () => _play(channel),
              ));
        }),
      ]),
    );
  }
}
