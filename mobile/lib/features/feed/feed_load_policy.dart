/// Pure request policy for the paginated social feed.
class FeedLoadPolicy {
  const FeedLoadPolicy._();

  static bool shouldStart({
    required bool loading,
    required bool hasMore,
    required bool reset,
  }) {
    if (reset) return true;
    return !loading && hasMore;
  }

  /// A refresh increments the generation. Results from older generations are
  /// ignored even if their network calls complete after the refresh.
  static int nextGeneration(int current) => current + 1;

  /// PostgREST keyset cursor for a descending (created_at, id) ordering.
  /// The ID tie-breaker prevents posts with identical timestamps from being
  /// repeated or skipped between pages.
  static String? cursorFilter({
    required String? createdAt,
    required String? id,
  }) {
    if (createdAt == null ||
        createdAt.isEmpty ||
        id == null ||
        id.isEmpty) {
      return null;
    }
    return 'created_at.lt.$createdAt,'
        'and(created_at.eq.$createdAt,id.lt.$id)';
  }

  static bool isCurrent({
    required int requestGeneration,
    required int currentGeneration,
  }) =>
      requestGeneration == currentGeneration;
}
