import 'package:flutter/widgets.dart';

/// Returns whether the currently selected TV item has a real playback surface.
///
/// A web HLS URL and an external-provider launch action are valid playback
/// surfaces even though they do not use a native VideoPlayerController. Keeping
/// this policy separate prevents the vertical feed from showing a permanent
/// "Watch" button over an already-mounted player or launch action.
bool tvHasPlaybackSurface({
  required bool isWeb,
  required String? webPlaybackUrl,
  required bool hasExternalPlaybackAction,
  required bool hasInitializedNativePlayer,
}) {
  if (hasExternalPlaybackAction || hasInitializedNativePlayer) return true;
  return isWeb && (webPlaybackUrl?.trim().isNotEmpty ?? false);
}

/// Ads are eligible only after the selected player has actually started.
/// Generation checks keep an old channel from requesting or attaching a unit.
bool tvCanRequestSponsoredAd({
  required bool hasPlaybackStarted,
  required bool alreadyRequested,
  required bool isCurrentGeneration,
}) =>
    hasPlaybackStarted && !alreadyRequested && isCurrentGeneration;

/// Native TV playback should pause whenever the app is not foregrounded.
bool tvShouldPauseForLifecycle(AppLifecycleState state) =>
    state != AppLifecycleState.resumed;

/// Resume only when the same controller had been playing before backgrounding.
bool tvShouldResumeAfterLifecycle({
  required AppLifecycleState state,
  required bool wasPlayingBeforePause,
}) =>
    state == AppLifecycleState.resumed && wasPlayingBeforePause;

/// Return a canonical external YouTube URL only for a valid video identifier.
/// YouTube playback is deliberately external on Android so the APK needs no WebView.
String? tvExternalYoutubeWatchUrl(String videoId) {
  final id = videoId.trim();
  if (!RegExp(r'^[A-Za-z0-9_-]{11}$').hasMatch(id)) return null;
  return Uri.https('www.youtube.com', '/watch', {'v': id}).toString();
}
