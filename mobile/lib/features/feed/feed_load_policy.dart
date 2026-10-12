/// Guards feed requests while allowing an explicit refresh to supersede a
/// pagination request that is already in flight.
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
}
