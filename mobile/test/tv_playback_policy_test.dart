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
}
