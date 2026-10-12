/// Returns whether the currently selected TV item has a real playback surface.
///
/// A web HLS URL is a playback surface even though Flutter's native
/// VideoPlayerController is intentionally absent on Web. Keeping this policy
/// separate prevents the vertical feed from showing a permanent "Watch" button
/// over an already-mounted browser player.
bool tvHasPlaybackSurface({
  required bool isWeb,
  required String? webPlaybackUrl,
  required bool hasYoutubePlayer,
  required bool hasInitializedNativePlayer,
}) {
  if (hasYoutubePlayer || hasInitializedNativePlayer) return true;
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
