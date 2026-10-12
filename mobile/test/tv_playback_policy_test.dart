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
          hasYoutubePlayer: false,
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
          hasYoutubePlayer: false,
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
          hasYoutubePlayer: false,
          hasInitializedNativePlayer: false,
        ),
        isFalse,
      );
    });

    test('recognizes YouTube playback on either platform', () {
      expect(
        tvHasPlaybackSurface(
          isWeb: true,
          webPlaybackUrl: null,
          hasYoutubePlayer: true,
          hasInitializedNativePlayer: false,
        ),
        isTrue,
      );
    });

    test('recognizes an initialized native player', () {
      expect(
        tvHasPlaybackSurface(
          isWeb: false,
          webPlaybackUrl: null,
          hasYoutubePlayer: false,
          hasInitializedNativePlayer: true,
        ),
        isTrue,
      );
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
