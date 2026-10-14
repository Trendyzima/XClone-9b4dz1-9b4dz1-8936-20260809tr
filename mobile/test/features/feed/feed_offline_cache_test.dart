import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:testagram/features/feed/feed_offline_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('feed snapshots are scoped by user and tab', () async {
    await FeedOfflineCache.write(
      userId: 'user-a',
      tab: 'For you',
      posts: [
        {'id': 'post-1', 'text': 'cached post'},
      ],
    );

    expect(
      (await FeedOfflineCache.read(
        userId: 'user-a',
        tab: 'For you',
      ))
          .single['id'],
      'post-1',
    );
    expect(
      await FeedOfflineCache.read(userId: 'user-b', tab: 'For you'),
      isEmpty,
    );
    expect(
      await FeedOfflineCache.read(userId: 'user-a', tab: 'Following'),
      isEmpty,
    );
  });

  test('empty feed does not overwrite a useful offline snapshot', () async {
    await FeedOfflineCache.write(
      userId: 'user-a',
      tab: 'For you',
      posts: [
        {'id': 'post-1'},
      ],
    );
    await FeedOfflineCache.write(userId: 'user-a', tab: 'For you', posts: []);
    expect(
      (await FeedOfflineCache.read(
        userId: 'user-a',
        tab: 'For you',
      ))
          .single['id'],
      'post-1',
    );
  });

  test('snapshot is bounded to the newest supported window', () async {
    final posts = List.generate(
      FeedOfflineCache.maxPosts + 10,
      (index) => <String, dynamic>{'id': 'post-$index'},
    );
    await FeedOfflineCache.write(
      userId: 'user-a',
      tab: 'For you',
      posts: posts,
    );
    final cached = await FeedOfflineCache.read(
      userId: 'user-a',
      tab: 'For you',
    );
    expect(cached, hasLength(FeedOfflineCache.maxPosts));
    expect(cached.first['id'], 'post-0');
  });
}
