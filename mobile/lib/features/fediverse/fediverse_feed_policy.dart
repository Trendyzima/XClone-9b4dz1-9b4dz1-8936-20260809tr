import 'package:flutter/foundation.dart';

typedef FediversePost = Map<String, dynamic>;

String _fediversePostKey(FediversePost post) =>
    '${post['uri'] ?? post['object_url'] ?? post['id'] ?? ''}';

DateTime _fediversePublishedAt(FediversePost post) =>
    DateTime.tryParse('${post['published_at'] ?? post['created_at'] ?? ''}') ??
    DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

bool _isVisibleFediversePost(FediversePost post) =>
    post['deleted_at'] == null && post['tombstone'] != true;

/// Result of reconciling a refreshed server page with the reader's visible list.
///
/// Existing cards retain their order; newly discovered posts are staged until
/// the reader explicitly chooses to show them.
@immutable
class FediverseFeedReconciliation {
  const FediverseFeedReconciliation({
    required this.visible,
    required this.pending,
  });

  final List<FediversePost> visible;
  final List<FediversePost> pending;
}

FediverseFeedReconciliation reconcileFediverseFeed(
  List<FediversePost> current,
  List<FediversePost> incoming,
) {
  final incomingByKey = <String, FediversePost>{};
  for (final post in incoming) {
    if (!_isVisibleFediversePost(post)) continue;
    final key = _fediversePostKey(post);
    if (key.isNotEmpty) incomingByKey[key] = post;
  }

  final visibleKeys = <String>{};
  final visible = <FediversePost>[];
  for (final post in current) {
    if (!_isVisibleFediversePost(post)) continue;
    final key = _fediversePostKey(post);
    if (key.isNotEmpty) visibleKeys.add(key);
    final updated = key.isEmpty ? null : incomingByKey[key];
    visible.add(
      updated == null ? post : <String, dynamic>{...post, ...updated},
    );
  }

  final pendingByKey = <String, FediversePost>{};
  for (final post in incoming) {
    if (!_isVisibleFediversePost(post)) continue;
    final key = _fediversePostKey(post);
    if (key.isEmpty || visibleKeys.contains(key)) continue;
    pendingByKey[key] = post;
  }
  final pending = pendingByKey.values.toList()
    ..sort(
      (a, b) => _fediversePublishedAt(b).compareTo(_fediversePublishedAt(a)),
    );
  return FediverseFeedReconciliation(visible: visible, pending: pending);
}

/// Applies staged posts only after an explicit user action, newest first.
List<FediversePost> applyPendingFediversePosts(
  List<FediversePost> current,
  List<FediversePost> pending,
) {
  final seen = current
      .map(_fediversePostKey)
      .where((key) => key.isNotEmpty)
      .toSet();
  final additions = <FediversePost>[];
  for (final post in pending) {
    if (!_isVisibleFediversePost(post)) continue;
    final key = _fediversePostKey(post);
    if (key.isEmpty || !seen.add(key)) continue;
    additions.add(post);
  }
  additions.sort(
    (a, b) => _fediversePublishedAt(b).compareTo(_fediversePublishedAt(a)),
  );
  return [...additions, ...current];
}
