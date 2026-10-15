import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/tv/tv_playback_policy.dart';

void main() {
  group('tvHasPlaybackSurface', () {
    test('recognizes a browser HLS player without a native controller', () {
      expect(
        tvHasPlaybackSurface(
          isWeb: true,
          webPlaybackUrl: 'https://cdn.example/live/index.m3u8',
          hasExternalPlaybackAction: false,
          hasInitializedNativePlayer: false,
        ),
        isTrue,
      );
    });

    test('does not treat an empty browser URL as playable', () {
      expect(
        tvHasPlaybackSurface(
          isWeb: true,
          webPlaybackUrl: '  ',
          hasExternalPlaybackAction: false,
          hasInitializedNativePlayer: false,
        ),
        isFalse,
      );
    });

    test('does not use a web URL as a native playback surface', () {
      expect(
        tvHasPlaybackSurface(
          isWeb: false,
          webPlaybackUrl: 'https://cdn.example/live/index.m3u8',
          hasExternalPlaybackAction: false,
          hasInitializedNativePlayer: false,
        ),
        isFalse,
      );
    });

    test(
      'recognizes an external YouTube playback action on either platform',
      () {
      expect(
        tvHasPlaybackSurface(
          isWeb: true,
          webPlaybackUrl: null,
          hasExternalPlaybackAction: true,
          hasInitializedNativePlayer: false,
        ),
        isTrue,
      );
      },
    );

    test('recognizes an initialized native player', () {
      expect(
        tvHasPlaybackSurface(
          isWeb: false,
          webPlaybackUrl: null,
          hasExternalPlaybackAction: false,
          hasInitializedNativePlayer: true,
        ),
        isTrue,
      );
    });
  });

  group('tvExternalYoutubeWatchUrl', () {
    test('returns a canonical YouTube URL for a valid video id', () {
      expect(
        tvExternalYoutubeWatchUrl('dQw4w9WgXcQ'),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
    });

    test('rejects empty or malformed video ids', () {
      expect(tvExternalYoutubeWatchUrl(''), isNull);
      expect(tvExternalYoutubeWatchUrl('not a video id'), isNull);
      expect(tvExternalYoutubeWatchUrl('dQw4w9WgXcQ&autoplay=1'), isNull);
    });
  });

  group('TV app lifecycle playback policy', () {
    test('pauses when the app is inactive, hidden, paused, or detached', () {
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.detached,
      ]) {
        expect(tvShouldPauseForLifecycle(state), isTrue, reason: '$state');
      }
      expect(tvShouldPauseForLifecycle(AppLifecycleState.resumed), isFalse);
    });

    test('resumes only on foreground when playback was previously active', () {
      expect(
        tvShouldResumeAfterLifecycle(
          state: AppLifecycleState.resumed,
          wasPlayingBeforePause: true,
        ),
        isTrue,
      );
      expect(
        tvShouldResumeAfterLifecycle(
          state: AppLifecycleState.resumed,
          wasPlayingBeforePause: false,
        ),
        isFalse,
      );
      expect(
        tvShouldResumeAfterLifecycle(
          state: AppLifecycleState.paused,
          wasPlayingBeforePause: true,
        ),
        isFalse,
      );
    });
  });
}
