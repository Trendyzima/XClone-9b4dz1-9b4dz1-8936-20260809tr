import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/tv/tv_playback_policy.dart';

void main() {
  group('tvCanRequestSponsoredAd', () {
    test('does not request an ad while the player is still loading', () {
      expect(
        tvCanRequestSponsoredAd(
          hasPlaybackStarted: false,
          alreadyRequested: false,
          isCurrentGeneration: true,
        ),
        isFalse,
      );
    });

    test('allows one ad after the current player starts', () {
      expect(
        tvCanRequestSponsoredAd(
          hasPlaybackStarted: true,
          alreadyRequested: false,
          isCurrentGeneration: true,
        ),
        isTrue,
      );
    });

    test('does not request duplicate ads for one playback generation', () {
      expect(
        tvCanRequestSponsoredAd(
          hasPlaybackStarted: true,
          alreadyRequested: true,
          isCurrentGeneration: true,
        ),
        isFalse,
      );
    });

    test('ignores playback-ready callbacks from an old channel', () {
      expect(
        tvCanRequestSponsoredAd(
          hasPlaybackStarted: true,
          alreadyRequested: false,
          isCurrentGeneration: false,
        ),
        isFalse,
      );
    });
  });
}
