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

  static bool isCurrent({
    required int requestGeneration,
    required int currentGeneration,
  }) =>
      requestGeneration == currentGeneration;
}
