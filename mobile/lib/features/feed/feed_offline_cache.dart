import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// A small, user-scoped feed snapshot for quick launch and offline read-only use.
/// This stores post payloads only: never auth tokens, session data, or secrets.
class FeedOfflineCache {
  FeedOfflineCache._();

  static const int maxPosts = 150;
  static const Duration maxAge = Duration(days: 7);
  static const String _prefix = 'testagram.feed.snapshot.v1.';

  static String _key({required String userId, required String tab}) {
    // IDs are opaque identifiers; encoding avoids accidental key separators.
    final user = base64Url.encode(utf8.encode(userId)).replaceAll('=', '');
    final feed = base64Url.encode(utf8.encode(tab)).replaceAll('=', '');
    return '$_prefix$user.$feed';
  }

  static Future<List<Map<String, dynamic>>> read({
    required String userId,
    required String tab,
  }) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key(userId: userId, tab: tab));
      if (raw == null) return const [];
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return const [];
      final savedAt = DateTime.tryParse('${decoded['savedAt'] ?? ''}');
      if (savedAt == null || DateTime.now().difference(savedAt) > maxAge) {
        await prefs.remove(_key(userId: userId, tab: tab));
        return const [];
      }
      final posts = decoded['posts'];
      if (posts is! List) return const [];
      return posts
          .whereType<Map>()
          .map((post) => Map<String, dynamic>.from(post))
          .take(maxPosts)
          .toList(growable: false);
    } catch (_) {
      // Corrupt/unsupported local cache must never prevent the network feed.
      return const [];
    }
  }

  static Future<void> write({
    required String userId,
    required String tab,
    required List<Map<String, dynamic>> posts,
  }) async {
    if (posts.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final safePosts = posts.take(maxPosts).toList(growable: false);
      await prefs.setString(
        _key(userId: userId, tab: tab),
        jsonEncode({
          'savedAt': DateTime.now().toUtc().toIso8601String(),
          'posts': safePosts,
        }),
      );
    } catch (_) {
      // Quota/platform serialization failures are non-fatal; online feed remains usable.
    }
  }
}
