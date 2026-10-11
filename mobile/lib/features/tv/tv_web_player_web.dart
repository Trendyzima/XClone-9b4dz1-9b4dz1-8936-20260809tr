import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

@JS('Hls')
external JSFunction? get _hlsConstructor;

@JS('Hls.isSupported')
external JSBoolean _hlsIsSupported();

@JS('Hls.Events')
external JSObject? get _hlsEvents;

@JS()
extension type _HlsEvents(JSObject _) implements JSObject {
  @JS('ERROR')
  external JSString get error;
}

@JS()
extension type _HlsInstance(JSObject _) implements JSObject {
  external void loadSource(String url);
  external void attachMedia(web.HTMLMediaElement media);
  external void destroy();
  external void on(JSAny? event, JSFunction listener);
}

class TvWebPlayer extends StatefulWidget {
  const TvWebPlayer({required this.url, this.onError, super.key});

  final String url;
  final ValueChanged<String>? onError;

  @override
  State<TvWebPlayer> createState() => _TvWebPlayerState();
}

class _TvWebPlayerState extends State<TvWebPlayer> {
  static Future<bool>? _hlsLoad;
  late final String _viewType;
  web.HTMLVideoElement? _video;
  _HlsInstance? _hls;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    // ignore: prefer_interpolation_to_compose_strings
    _viewType = 'testagram-tv-player-' +
        DateTime.now().microsecondsSinceEpoch.toString();
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (int viewId) {
      final video = web.HTMLVideoElement()
        ..controls = true
        ..autoplay = true
        ..muted = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.style.setProperty('width', '100%');
      video.style.setProperty('height', '100%');
      video.style.setProperty('object-fit', 'contain');
      video.style.setProperty('background-color', '#000');
      video.style.setProperty('border', '0');
      video.addEventListener(
          'error',
          ((web.Event event) {
            _reportError(
                'This stream failed to load in the browser. Try another channel or retry.');
          }).toJS);
      _video = video;
      unawaited(_attach(video, widget.url, ++_generation));
      return video;
    });
  }

  static Future<bool> _ensureHls() {
    if (_hlsConstructor != null) return Future<bool>.value(true);
    return _hlsLoad ??= () async {
      final completer = Completer<bool>();
      final script = web.HTMLScriptElement()
        ..src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js'
        ..async = true;
      script.addEventListener(
          'load',
          ((web.Event event) {
            if (!completer.isCompleted) {
              completer.complete(_hlsConstructor != null);
            }
          }).toJS);
      script.addEventListener(
          'error',
          ((web.Event event) {
            if (!completer.isCompleted) {
              completer.complete(false);
            }
          }).toJS);
      web.document.head?.append(script);
      return completer.future.timeout(
        const Duration(seconds: 12),
        onTimeout: () => false,
      );
    }();
  }

  Future<void> _attach(
      web.HTMLVideoElement video, String url, int generation) async {
    _destroyHls();
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (!mounted || generation != _generation) return;

    final parsed = Uri.tryParse(url);
    final upstream = parsed?.queryParameters['url'] ?? url;
    final lower = upstream.toLowerCase();
    final isHls = lower.contains('.m3u8') ||
        lower.contains('.m3u') ||
        lower.contains('format=m3u');
    if (!isHls ||
        video.canPlayType('application/vnd.apple.mpegurl').isNotEmpty) {
      video.src = url;
      try {
        await video.play().toDart;
      } catch (_) {
        // Browser autoplay policies may require the user to press Play.
      }
      return;
    }

    final loaded = await _ensureHls();
    if (!mounted || generation != _generation) return;
    if (!loaded) {
      _reportError(
          'HLS playback support could not load. Check your connection and retry.');
      return;
    }
    final constructor = _hlsConstructor;
    if (constructor == null || !_hlsIsSupported().toDart) {
      _reportError(
          'This browser cannot play HLS. Try a supported browser or another channel.');
      return;
    }
    try {
      final instance = _HlsInstance(
        constructor.callAsConstructorVarArgs<JSObject>(const []),
      );
      _hls = instance;
      instance.loadSource(url);
      instance.attachMedia(video);
      final eventsObject = _hlsEvents;
      if (eventsObject != null) {
        final events = _HlsEvents(eventsObject);
        instance.on(
            events.error,
            ((JSAny? event, JSAny? data) {
              if (!mounted || generation != _generation) return;
              final details = data?.dartify();
              if (details is Map && details['fatal'] == true) {
                _reportError(
                    'This HLS stream is unavailable or its provider rejected playback.');
              }
            }).toJS);
      }
    } catch (_) {
      _reportError('HLS playback could not initialize for this stream.');
    }
  }

  void _reportError(String message) {
    if (mounted) setState(() => _error = message);
    widget.onError?.call(message);
  }

  void _destroyHls() {
    final instance = _hls;
    _hls = null;
    try {
      instance?.destroy();
    } catch (_) {}
  }

  @override
  void didUpdateWidget(covariant TvWebPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url && _video != null) {
      setState(() => _error = null);
      unawaited(_attach(_video!, widget.url, ++_generation));
    }
  }

  @override
  void dispose() {
    _generation++;
    _destroyHls();
    _video?.pause();
    _video?.removeAttribute('src');
    _video?.load();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(
        fit: StackFit.expand,
        children: [
          HtmlElementView(viewType: _viewType),
          if (_error != null)
            Positioned(
              left: 14,
              right: 14,
              bottom: 14,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xDD101010),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
              ),
            ),
        ],
      );
}
