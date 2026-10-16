import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';

class SponsoredAd {
  const SponsoredAd({
    required this.requestId,
    required this.impressionId,
    required this.eventToken,
    required this.headline,
    required this.body,
    required this.sponsored,
    this.imageUrl,
    this.clickThroughUrl,
    this.cta,
  });

  final String requestId;
  final String impressionId;
  final String eventToken;
  final String headline;
  final String body;
  final bool sponsored;
  final String? imageUrl;
  final String? clickThroughUrl;
  final String? cta;

  static SponsoredAd? tryParse(Object? value) {
    if (value is! Map) return null;
    final map = Map<String, dynamic>.from(value);
    if (map['kind'] != 'display' || map['sponsored'] != true) return null;
    final requestId = _string(map['requestId']);
    final impressionId = _string(map['impressionId']);
    final eventToken = _string(map['eventToken']);
    final headline = _string(map['headline']);
    final body = _string(map['body']);
    final imageUrl = _safeHttpUrl(map['imageUrl']);
    if (requestId.isEmpty ||
        impressionId.isEmpty ||
        eventToken.isEmpty ||
        (headline.isEmpty && body.isEmpty && imageUrl == null)) {
      return null;
    }
    return SponsoredAd(
      requestId: requestId,
      impressionId: impressionId,
      eventToken: eventToken,
      headline: headline,
      body: body,
      sponsored: true,
      imageUrl: imageUrl,
      clickThroughUrl: _safeHttpUrl(map['clickThroughUrl']),
      cta: _string(map['cta']).isEmpty ? 'Learn more' : _string(map['cta']),
    );
  }

  static String _string(Object? value) => value is String ? value.trim() : '';

  static String? _safeHttpUrl(Object? value) {
    final raw = _string(value);
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        (uri.scheme != 'https' && uri.scheme != 'http') ||
        uri.host.isEmpty) {
      return null;
    }
    return uri.toString();
  }
}

/// Client for the canonical Testagram-owned ZenAd decision/event endpoints.
/// A no-fill or network failure is deliberately a no-op for organic content.
class SponsoredAdService {
  SponsoredAdService({
    required this.supabaseUrl,
    required this.publishableKey,
    this.accessToken,
    this.accessTokenProvider,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  factory SponsoredAdService.forClient(SupabaseClient client) {
    return SponsoredAdService(
      supabaseUrl: AppConfig.supabaseUrl,
      publishableKey: AppConfig.supabasePublishableKey,
      accessTokenProvider: () => client.auth.currentSession?.accessToken,
    );
  }

  final String supabaseUrl;
  final String publishableKey;
  final String? accessToken;
  final String? Function()? accessTokenProvider;
  final http.Client _http;

  Uri _endpoint(String name) {
    final base = supabaseUrl.replaceFirst(RegExp(r'/+$'), '');
    return Uri.parse('$base/functions/v1/$name');
  }

  String get _deviceHint =>
      kIsWeb ? 'web' : defaultTargetPlatform.name.toLowerCase();

  String _requestId() {
    final random = Random.secure().nextInt(1 << 32);
    return 'flutter_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}_${random.toRadixString(36)}';
  }

  Map<String, String> get _headers => {
    'apikey': publishableKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    if ((accessTokenProvider?.call() ?? accessToken)?.isNotEmpty == true)
      'Authorization': 'Bearer ${accessTokenProvider?.call() ?? accessToken}',
  };

  Future<SponsoredAd?> requestAd({
    required String slotCode,
    Map<String, dynamic> content = const {},
  }) async {
    if (supabaseUrl.trim().isEmpty || publishableKey.trim().isEmpty) {
      return null;
    }
    try {
      final response = await _http
          .post(
            _endpoint('zenad-decision'),
            headers: _headers,
            body: jsonEncode({
              'slotCode': slotCode,
              'id': _requestId(),
              'content': content,
              'user': {'device': _deviceHint},
              'privacy': {'personalized': false},
            }),
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode < 200 || response.statusCode >= 300) return null;
      return SponsoredAd.tryParse(jsonDecode(response.body));
    } catch (_) {
      return null;
    }
  }

  // Guard each impression/event pair in this service instance. The server remains
  // the authoritative idempotency boundary; this avoids duplicate client posts
  // caused by repeated taps, widget rebuilds, and concurrent visibility callbacks.
  final Set<String> _recordedEvents = <String>{};
  final Map<String, Future<bool>> _eventsInFlight = <String, Future<bool>>{};

  Future<bool> recordEvent({
    required SponsoredAd ad,
    required String eventType,
    Map<String, dynamic> metadata = const {},
  }) {
    if (!const {
      'viewable',
      'click',
      'video_start',
      'video_first_quartile',
      'video_midpoint',
      'video_third_quartile',
      'video_complete',
    }.contains(eventType)) {
      return Future.value(false);
    }

    final key = '${ad.impressionId}:$eventType';
    if (_recordedEvents.contains(key)) return Future.value(true);
    final pending = _eventsInFlight[key];
    if (pending != null) return pending;

    final request = _sendEvent(ad: ad, eventType: eventType, metadata: metadata)
        .then((success) {
          if (success) _recordedEvents.add(key);
          return success;
        })
        .whenComplete(() {
          _eventsInFlight.remove(key);
        });
    _eventsInFlight[key] = request;
    return request;
  }

  Future<bool> _sendEvent({
    required SponsoredAd ad,
    required String eventType,
    required Map<String, dynamic> metadata,
  }) async {
    try {
      final response = await _http
          .post(
            _endpoint('zenad-event'),
            headers: _headers,
            body: jsonEncode({
              'impressionId': ad.impressionId,
              'eventToken': ad.eventToken,
              'eventType': eventType,
              'metadata': metadata,
            }),
          )
          .timeout(const Duration(seconds: 6));
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }

  void close() => _http.close();
}

/// Fraction of the creative's area intersecting the visible screen viewport.
/// A viewable event must not be inferred merely because a lazy-list item mounted.
double sponsoredAdVisibleFraction(Rect creativeRect, Size viewport) {
  if (creativeRect.isEmpty || viewport.isEmpty) return 0;
  final visibleRect = creativeRect.intersect(Offset.zero & viewport);
  if (visibleRect.isEmpty) return 0;
  return (visibleRect.width * visibleRect.height) /
      (creativeRect.width * creativeRect.height);
}

/// Compact but clearly labelled native sponsored unit; organic feed remains
/// usable when the ad has no fill, fails to load, or cannot open its destination.
class SponsoredAdCard extends StatefulWidget {
  const SponsoredAdCard({
    required this.ad,
    required this.service,
    this.compact = false,
    super.key,
  });

  final SponsoredAd ad;
  final SponsoredAdService service;
  final bool compact;

  @override
  State<SponsoredAdCard> createState() => _SponsoredAdCardState();
}

class _SponsoredAdCardState extends State<SponsoredAdCard>
    with WidgetsBindingObserver {
  static const _viewabilityThreshold = 0.5;
  static const _viewabilityDuration = Duration(seconds: 1);
  static const _sampleInterval = Duration(milliseconds: 250);

  Timer? _viewabilityTimer;
  DateTime? _visibleSince;
  bool _eventSent = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // A lazy-list item can mount before it is actually visible. Sample the
    // rendered geometry instead of treating widget construction as an impression.
    _viewabilityTimer = Timer.periodic(_sampleInterval, (_) {
      _checkViewability();
    });
  }

  @override
  void didUpdateWidget(covariant SponsoredAdCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ad.impressionId != widget.ad.impressionId) {
      _eventSent = false;
      _visibleSince = null;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _visibleSince = null;
  }

  void _checkViewability() {
    if (!mounted || _eventSent) return;
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      _visibleSince = null;
      return;
    }

    final renderObject = context.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.hasSize) return;

    final viewport = MediaQuery.sizeOf(context);
    final creativeRect =
        renderObject.localToGlobal(Offset.zero) & renderObject.size;
    final visibleFraction = sponsoredAdVisibleFraction(creativeRect, viewport);
    if (visibleFraction < _viewabilityThreshold) {
      _visibleSince = null;
      return;
    }

    final now = DateTime.now();
    _visibleSince ??= now;
    if (now.difference(_visibleSince!) < _viewabilityDuration) return;

    _eventSent = true;
    unawaited(
      widget.service.recordEvent(
        ad: widget.ad,
        eventType: 'viewable',
        metadata: {
          'surface': widget.compact ? 'iptv_vertical' : 'social_feed',
          'visibleFraction': visibleFraction,
          'continuousVisibleMs': now.difference(_visibleSince!).inMilliseconds,
        },
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _viewabilityTimer?.cancel();
    super.dispose();
  }

  Future<void> _openDestination() async {
    final raw = widget.ad.clickThroughUrl;
    if (raw == null) return;
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        (uri.scheme != 'https' && uri.scheme != 'http') ||
        uri.host.isEmpty) {
      return;
    }
    await widget.service.recordEvent(
      ad: widget.ad,
      eventType: 'click',
      metadata: {'surface': widget.compact ? 'iptv_vertical' : 'social_feed'},
    );
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Ad navigation failures must not interrupt feed or player controls.
    }
  }

  @override
  Widget build(BuildContext context) {
    final ad = widget.ad;
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: ad.clickThroughUrl == null ? null : _openDestination,
        child: Padding(
          padding: EdgeInsets.all(widget.compact ? 8 : 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (ad.imageUrl != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(
                    ad.imageUrl!,
                    width: widget.compact ? 64 : 92,
                    height: widget.compact ? 64 : 92,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  ),
                ),
              if (ad.imageUrl != null) const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Theme.of(context)
                            .colorScheme
                            .surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(5),
                      ),
                      child: const Text(
                        'Sponsored',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(height: 5),
                    if (ad.headline.isNotEmpty)
                      Text(
                        ad.headline,
                        maxLines: widget.compact ? 1 : 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    if (ad.body.isNotEmpty)
                      Text(
                        ad.body,
                        maxLines: widget.compact ? 2 : 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                    if (ad.clickThroughUrl != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton(
                          onPressed: _openDestination,
                          child: Text(ad.cta ?? 'Learn more'),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
