import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/feed/post_interaction_policy.dart';

void main() {
  group('PostInteractionPolicy', () {
    test('prefers path ID and safely falls back to ActivityPub query IDs', () {
      expect(
          PostInteractionPolicy.resolvePostId(
            pathPostId: ' local-id ',
            postUri: 'https://remote.example/objects/1',
          ),
          'local-id');
      expect(
          PostInteractionPolicy.resolvePostId(
            pathPostId: ' ',
            postUri: 'https://remote.example/objects/1',
          ),
          'https://remote.example/objects/1');
      expect(
          PostInteractionPolicy.resolvePostId(postId: 'fallback'), 'fallback');
      expect(PostInteractionPolicy.resolvePostId(), isEmpty);
    });

    test('remote IDs must be HTTPS URLs with a host', () {
      expect(PostInteractionPolicy.isRemotePostId('https://social.example/p/1'),
          isTrue);
      expect(PostInteractionPolicy.isRemotePostId('http://social.example/p/1'),
          isFalse);
      expect(PostInteractionPolicy.isRemotePostId('https:///missing-host'),
          isFalse);
      expect(PostInteractionPolicy.isRemotePostId('not-a-url'), isFalse);
    });

    test('composer rejects empty or over-limit content and accepts valid text',
        () {
      expect(PostInteractionPolicy.validateComposerText('   '), isNotNull);
      expect(PostInteractionPolicy.validateComposerText('hello'), isNull);
      expect(PostInteractionPolicy.validateComposerText('123456', maxLength: 5),
          isNotNull);
    });

    test('list limit is bounded to a safe range', () {
      expect(PostInteractionPolicy.boundedListLimit(-5), 1);
      expect(PostInteractionPolicy.boundedListLimit(30), 30);
      expect(PostInteractionPolicy.boundedListLimit(1000), 100);
    });
  });
}
