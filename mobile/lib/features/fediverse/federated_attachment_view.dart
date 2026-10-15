import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

/// Renders public ActivityPub attachments through Testagram's media cache.
class FederatedAttachmentView extends StatefulWidget {
  const FederatedAttachmentView({
    required this.url,
    required this.mediaType,
    this.altText,
    super.key,
  });

  final String url;
  final String mediaType;
  final String? altText;

  @override
  State<FederatedAttachmentView> createState() =>
      _FederatedAttachmentViewState();
}

class _FederatedAttachmentViewState extends State<FederatedAttachmentView> {
  VideoPlayerController? _controller;
  Future<void>? _initialization;

  bool get _isVideo =>
      widget.mediaType.startsWith('video/') ||
      widget.mediaType == 'video' ||
      widget.mediaType == 'application/vnd.apple.mpegurl';

  bool get _isAudio =>
      widget.mediaType.startsWith('audio/') || widget.mediaType == 'audio';

  @override
  void initState() {
    super.initState();
    _initializePlayerIfNeeded();
  }

  @override
  void didUpdateWidget(covariant FederatedAttachmentView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url ||
        oldWidget.mediaType != widget.mediaType) {
      _disposePlayer();
      _initializePlayerIfNeeded();
    }
  }

  void _initializePlayerIfNeeded() {
    if (!_isVideo && !_isAudio) return;
    final uri = Uri.tryParse(widget.url);
    if (uri == null || uri.scheme != 'https') return;
    final controller = VideoPlayerController.networkUrl(uri);
    _controller = controller;
    _initialization = controller.initialize().then((_) {
      if (mounted) setState(() {});
    }).catchError((Object _) {
      if (mounted) setState(() {});
    });
  }

  void _disposePlayer() {
    final controller = _controller;
    _controller = null;
    _initialization = null;
    if (controller != null) {
      controller.dispose();
    }
  }

  @override
  void dispose() {
    _disposePlayer();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_isVideo || _isAudio) {
      final controller = _controller;
      final initialization = _initialization;
      if (controller == null || initialization == null) {
        return _unavailable(context);
      }
      return FutureBuilder<void>(
        future: initialization,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done ||
              !controller.value.isInitialized) {
            if (snapshot.hasError) return _unavailable(context);
            return const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_isVideo)
                  AspectRatio(
                    aspectRatio: controller.value.aspectRatio > 0
                        ? controller.value.aspectRatio
                        : 16 / 9,
                    child: VideoPlayer(controller),
                  )
                else
                  const Padding(
                    padding: EdgeInsets.only(top: 14),
                    child: Icon(Icons.audio_file_rounded, size: 42),
                  ),
                if (widget.altText?.trim().isNotEmpty == true)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                    child: Text(widget.altText!.trim()),
                  ),
                Row(
                  children: [
                    IconButton(
                      tooltip: controller.value.isPlaying ? 'Pause' : 'Play',
                      onPressed: () {
                        setState(() {
                          controller.value.isPlaying
                              ? controller.pause()
                              : controller.play();
                        });
                      },
                      icon: Icon(
                        controller.value.isPlaying
                            ? Icons.pause_circle_filled_rounded
                            : Icons.play_circle_fill_rounded,
                      ),
                    ),
                    Expanded(
                      child: VideoProgressIndicator(
                        controller,
                        allowScrubbing: true,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                    const SizedBox(width: 12),
                  ],
                ),
              ],
            ),
          );
        },
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: CachedNetworkImage(
        imageUrl: widget.url,
        fit: BoxFit.contain,
        placeholder: (_, __) => const SizedBox(
          height: 150,
          child: Center(child: CircularProgressIndicator()),
        ),
        errorWidget: (_, __, ___) => _unavailable(context),
        imageBuilder: (context, imageProvider) => Image(
          image: imageProvider,
          fit: BoxFit.contain,
          semanticLabel: widget.altText,
        ),
      ),
    );
  }

  Widget _unavailable(BuildContext context) => Container(
        constraints: const BoxConstraints(minHeight: 88),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            const Icon(Icons.broken_image_outlined),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'This attachment is unavailable from its source server.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
      );
}
