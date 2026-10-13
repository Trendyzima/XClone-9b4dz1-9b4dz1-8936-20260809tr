/// Shared route/input guards for local and ActivityPub post interactions.
class PostInteractionPolicy {
  const PostInteractionPolicy._();

  static String resolvePostId({
    String? pathPostId,
    String? postUri,
    String? postId,
  }) {
    for (final candidate in [pathPostId, postUri, postId]) {
      final value = candidate?.trim() ?? '';
      if (value.isNotEmpty) return value;
    }
    return '';
  }

  static bool isRemotePostId(String value) {
    final uri = Uri.tryParse(value.trim());
    return uri != null &&
        uri.scheme.toLowerCase() == 'https' &&
        uri.host.isNotEmpty &&
        !uri.userInfo.contains('@');
  }

  static String? validateComposerText(String value, {int maxLength = 5000}) {
    final text = value.trim();
    if (text.isEmpty) return 'Write something before publishing.';
    if (text.length > maxLength) {
      return 'Text exceeds the $maxLength character limit.';
    }
    return null;
  }

  static int boundedListLimit(int value, {int max = 100}) =>
      value.clamp(1, max);
}
