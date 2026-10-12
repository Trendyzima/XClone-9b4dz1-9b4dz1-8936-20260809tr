import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config/app_config.dart';
import '../core/auth/session_guard.dart';
import '../core/auth/testagram_session_storage.dart';
import '../core/theme/testagram_theme.dart';
import '../features/auth/auth_page.dart';
import '../features/explore/explore_page.dart';
import '../features/feed/feed_page.dart';
import '../features/messages/messages_page.dart';
import '../features/notifications/notifications_page.dart';
import '../features/profile/profile_page.dart';
import '../features/settings/settings_page.dart';
import '../features/tv/tv_page.dart';
import '../features/threads/threads_page.dart';
import '../features/threads/thread_detail_page.dart';
import '../features/communities/communities_page.dart';
import '../features/communities/community_detail_page.dart';
import '../features/creator/creator_studio_page.dart';
import '../features/tv/tv_studio_page.dart';
import '../features/videos/videos_page.dart';
import '../features/discovery/discovery_pages.dart';
import '../features/marketplace/products_page.dart';
import '../features/marketplace/orders_page.dart';
import '../features/ads/ad_campaigns_page.dart';
import '../features/ads/ad_config_page.dart';
import '../features/news/news_page.dart';
import '../features/fediverse/fediverse_page.dart';
import '../features/spaces/spaces_page.dart';
import 'testagram_shell.dart';

class TestagramApp extends StatefulWidget {
  const TestagramApp({super.key});

  @override
  State<TestagramApp> createState() => _TestagramAppState();
}

class _TestagramAppState extends State<TestagramApp> {
  late final GoRouter _router;
  late final _AuthRefresh _authRefresh;
  SessionGuard? _sessionGuard;
  ThemeMode _themeMode = ThemeMode.system;

  @override
  void initState() {
    super.initState();
    _authRefresh = _AuthRefresh();
    if (AppConfig.isConfigured) {
      _authRefresh.bind(Supabase.instance.client.auth.onAuthStateChange);
      _sessionGuard =
          SessionGuard(Supabase.instance.client, TestagramSessionStorage())
            ..start();
    }
    _router = GoRouter(
      initialLocation: '/',
      errorBuilder: (context, state) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.construction_rounded, size: 48),
                const SizedBox(height: 12),
                const Text('This screen is still being migrated.'),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () async {
                    final uri = Uri.parse('https://testagram.site').replace(
                        path: state.uri.path,
                        query:
                            state.uri.query.isEmpty ? null : state.uri.query);
                    await launchUrl(uri, mode: LaunchMode.externalApplication);
                  },
                  child: const Text('Open the existing Testagram screen'),
                ),
                TextButton(
                    onPressed: () => context.go('/'),
                    child: const Text('Back to Flutter home')),
              ],
            ),
          ),
        ),
      ),
      refreshListenable: _authRefresh,
      redirect: (context, state) {
        if (!AppConfig.isConfigured) return '/setup';
        final signedIn = Supabase.instance.client.auth.currentSession != null;
        final onAuth = state.matchedLocation == '/auth';
        final onSetup = state.matchedLocation == '/setup';
        final path = state.matchedLocation;
        final publicRoute = path == '/' ||
            path == '/explore' ||
            path == '/tv' ||
            path == '/videos' ||
            path == '/shorts' ||
            path == '/videos/watchlater' ||
            path == '/hashtags' ||
            path.startsWith('/hashtag/') ||
            path == '/leaderboard' ||
            path == '/leaderboard/creators' ||
            path == '/news' ||
            path == '/fediverse' ||
            path == '/fediverse/instances' ||
            path == '/spaces' ||
            path.startsWith('/spaces/') ||
            path.startsWith('/space-recording/') ||
            path == '/products' ||
            path == '/marketplace' ||
            path.startsWith('/p/') ||
            path == '/threads' ||
            path == '/communities' ||
            path.startsWith('/thread/') ||
            path.startsWith('/c/') ||
            path.startsWith('/profile/');
        if (!signedIn && !onAuth && !onSetup && !publicRoute) return '/auth';
        return null;
      },
      routes: [
        GoRoute(path: '/setup', builder: (_, __) => const _SetupPage()),
        GoRoute(
          path: '/auth',
          builder: (_, state) => AuthPage(
            recovery: state.uri.queryParameters['reset'] == '1' ||
                state.uri.queryParameters['type'] == 'recovery',
          ),
        ),
        ShellRoute(
          builder: (context, state, child) => TestagramShell(
            location: state.matchedLocation,
            themeMode: _themeMode,
            onThemeChanged: (mode) => setState(() => _themeMode = mode),
            child: child,
          ),
          routes: [
            GoRoute(path: '/', builder: (_, __) => const FeedPage()),
            GoRoute(path: '/explore', builder: (_, __) => const ExplorePage()),
            GoRoute(path: '/threads', builder: (_, __) => const ThreadsPage()),
            GoRoute(
                path: '/communities',
                builder: (_, __) => const CommunitiesPage()),
            GoRoute(
                path: '/c/:name',
                builder: (_, state) => CommunityDetailPage(
                    name: state.pathParameters['name'] ?? '')),
            GoRoute(
                path: '/c/:name/posts',
                builder: (_, state) => CommunityDetailPage(
                    name: state.pathParameters['name'] ?? '')),
            GoRoute(
                path: '/c/:name/members',
                builder: (_, state) => CommunityDetailPage(
                    name: state.pathParameters['name'] ?? '')),
            GoRoute(
                path: '/c/:name/chat',
                builder: (_, state) => CommunityDetailPage(
                    name: state.pathParameters['name'] ?? '')),
            GoRoute(
                path: '/c/:name/events',
                builder: (_, state) => CommunityDetailPage(
                    name: state.pathParameters['name'] ?? '')),
            GoRoute(
                path: '/c/:name/shop',
                builder: (_, state) => CommunityDetailPage(
                    name: state.pathParameters['name'] ?? '')),
            GoRoute(
                path: '/thread/:id',
                builder: (_, state) => ThreadDetailPage(
                    threadId: state.pathParameters['id'] ?? '')),
            GoRoute(
                path: '/thread/:threadId/replies',
                builder: (_, state) => ThreadDetailPage(
                    threadId: state.pathParameters['threadId'] ?? '',
                    repliesOnly: true)),
            GoRoute(path: '/tv', builder: (_, __) => const TvPage()),
            GoRoute(path: '/videos', builder: (_, __) => const VideosPage()),
            GoRoute(
                path: '/shorts',
                builder: (_, __) => const VideosPage(shortsMode: true)),
            GoRoute(
                path: '/videos/watchlater',
                builder: (_, __) => const VideosPage(watchLaterOnly: true)),
            GoRoute(
                path: '/hashtags', builder: (_, __) => const HashtagsPage()),
            GoRoute(
                path: '/hashtag/:tag',
                builder: (_, state) =>
                    HashtagsPage(tag: state.pathParameters['tag'])),
            GoRoute(
                path: '/leaderboard',
                builder: (_, __) => const LeaderboardPage()),
            GoRoute(
                path: '/leaderboard/creators',
                builder: (_, __) => const LeaderboardPage()),
            GoRoute(
                path: '/products', builder: (_, __) => const ProductsPage()),
            GoRoute(
                path: '/marketplace', builder: (_, __) => const ProductsPage()),
            GoRoute(
                path: '/p/:productId',
                builder: (_, state) =>
                    ProductsPage(productId: state.pathParameters['productId'])),
            GoRoute(path: '/orders', builder: (_, __) => const OrdersPage()),
            GoRoute(
                path: '/create-ad',
                builder: (_, __) => const AdCampaignsPage(mode: AdCampaignsMode.create)),
            GoRoute(
                path: '/my-ads',
                builder: (_, __) => const AdCampaignsPage(mode: AdCampaignsMode.list)),
            GoRoute(
                path: '/ad-analytics',
                builder: (_, __) => const AdCampaignsPage(mode: AdCampaignsMode.analytics)),
            GoRoute(
                path: '/admin/ad-config',
                builder: (_, __) => const AdConfigPage()),
            GoRoute(
                path: '/admin/ads',
                builder: (_, __) => const AdConfigPage()),
            GoRoute(
                path: '/admin/ads-management',
                builder: (_, __) => const AdConfigPage()),
            GoRoute(path: '/news', builder: (_, __) => const NewsPage()),
            GoRoute(
                path: '/fediverse', builder: (_, __) => const FediversePage()),
            GoRoute(
                path: '/fediverse/instances',
                builder: (_, __) => const FediversePage(instancesOnly: true)),
            GoRoute(path: '/spaces', builder: (_, __) => const SpacesPage()),
            GoRoute(
                path: '/spaces/:id',
                builder: (_, state) =>
                    SpacesPage(spaceId: state.pathParameters['id'])),
            GoRoute(
                path: '/space-recording/:id',
                builder: (_, state) =>
                    SpacesPage(recordingId: state.pathParameters['id'])),
            GoRoute(
                path: '/space/:id',
                builder: (_, state) =>
                    SpacesPage(spaceId: state.pathParameters['id'])),
            GoRoute(
                path: '/space/:id/recordings',
                builder: (_, state) =>
                    SpacesPage(spaceId: state.pathParameters['id'])),
            GoRoute(
                path: '/tv-studio', builder: (_, __) => const TvStudioPage()),
            GoRoute(
                path: '/creator-studio',
                builder: (_, __) => const CreatorStudioPage()),
            GoRoute(
                path: '/creator-studio/:section',
                builder: (_, state) => CreatorStudioPage(
                    section: state.pathParameters['section'] ?? 'overview')),
            GoRoute(
                path: '/notifications',
                builder: (_, __) => const NotificationsPage()),
            GoRoute(
                path: '/messages', builder: (_, __) => const MessagesPage()),
            GoRoute(path: '/profile', builder: (_, __) => const ProfilePage()),
            GoRoute(
                path: '/profile/:username',
                builder: (_, state) =>
                    ProfilePage(username: state.pathParameters['username'])),
            GoRoute(
                path: '/settings', builder: (_, __) => const SettingsPage()),
          ],
        ),
      ],
    );
  }

  @override
  void dispose() {
    _router.dispose();
    _authRefresh.dispose();
    _sessionGuard?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Testagram',
      debugShowCheckedModeBanner: false,
      theme: TestagramTheme.light(),
      darkTheme: TestagramTheme.dark(),
      themeMode: _themeMode,
      routerConfig: _router,
    );
  }
}

class _AuthRefresh extends ChangeNotifier {
  dynamic _subscription;

  void bind(Stream<AuthState> stream) {
    _subscription = stream.listen((_) => notifyListeners());
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}

class _SetupPage extends StatelessWidget {
  const _SetupPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset('assets/branding/testagram-icon.webp',
                    width: 76, height: 76),
                const SizedBox(height: 20),
                Text('Testagram is not configured',
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 10),
                const Text(
                  'Build this client with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. '
                  'No backend credentials are embedded in the app source.',
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
