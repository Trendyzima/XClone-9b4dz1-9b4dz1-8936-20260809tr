import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/config/app_config.dart';
import '../core/auth/auth_redirect_policy.dart';
import '../core/theme/testagram_theme.dart';
import '../features/auth/auth_page.dart';
import '../features/explore/explore_page.dart';
import '../features/feed/feed_page.dart';
import '../features/feed/post_detail_page.dart';
import '../features/feed/post_interaction_page.dart';
import '../features/feed/post_quote_composer_page.dart';
import '../features/feed/post_reply_chain_page.dart';
import '../features/feed/post_interaction_policy.dart';
import '../features/messages/messages_page.dart';
import '../features/messages/team_chat_page.dart';
import '../features/notifications/notifications_page.dart';
import '../features/profile/profile_page.dart';
import '../features/discovery/trending_topic_page.dart';
import '../features/commerce/seller_storefront_page.dart';
import '../features/commerce/premium_page.dart';
import '../features/commerce/credits_page.dart';
import '../features/profile/profile_features_page.dart';
import '../features/discovery/interests_page.dart';
import '../features/posts/scheduled_posts_page.dart';
import '../features/creator/podcast_search_page.dart';
import '../features/creator/series_page.dart';
import '../features/profile/bookmarks_page.dart';
import '../features/profile/history_page.dart';
import '../features/settings/settings_page.dart';
import '../features/settings/blocked_users_page.dart';
import '../features/settings/active_sessions_page.dart';
import '../features/settings/legal_pages.dart';
import '../features/tv/tv_page.dart';
import '../features/tv/tv_channel_profile_page.dart';
import '../features/threads/threads_page.dart';
import '../features/threads/thread_detail_page.dart';
import '../features/communities/communities_page.dart';
import '../features/communities/community_detail_page.dart';
import '../features/creator/creator_studio_page.dart';
import '../features/creator/analytics_pages.dart';
import '../features/creator/podcast_analytics_page.dart';
import '../features/creator/referral_page.dart';
import '../features/creator/rewards_page.dart';
import '../features/tv/tv_studio_page.dart';
import '../features/videos/videos_page.dart';
import '../features/discovery/discovery_pages.dart';
import '../features/marketplace/products_page.dart';
import '../features/marketplace/orders_page.dart';
import '../features/marketplace/wishlist_page.dart';
import '../features/social/lists_pages.dart';
import '../features/social/polls_page.dart';
import '../features/social/thread_interaction_page.dart';
import '../features/ads/ad_campaigns_page.dart';
import '../features/ads/ad_performance_page.dart';
import '../features/admin/governance_page.dart';
import '../features/admin/admin_overview_page.dart';
import '../features/admin/admin_users_page.dart';
import '../features/admin/admin_fraud_page.dart';
import '../features/admin/identity_verification_review_page.dart';
import '../features/admin/verification_requests_page.dart';
import '../features/admin/regulator_console_page.dart';
import '../features/ads/ad_config_page.dart';
import '../features/news/news_page.dart';
import '../features/news/news_article_page.dart';
import '../features/fediverse/fediverse_page.dart';
import '../features/spaces/spaces_page.dart';
import '../features/native_route/native_feature_page.dart';
import '../features/wallet/currency_converter_page.dart';
import '../features/wallet/wallet_page.dart';
import '../features/wallet/wallet_auxiliary_page.dart';
import '../features/wallet/wallet_savings_page.dart';
import '../features/wallet/wallet_send_page.dart';
import '../features/wallet/wallet_security_page.dart';
import '../features/wallet/wallet_mpesa_page.dart';
import 'testagram_shell.dart';

class TestagramApp extends StatefulWidget {
  const TestagramApp({super.key});

  @override
  State<TestagramApp> createState() => _TestagramAppState();
}

class _TestagramAppState extends State<TestagramApp> {
  late final GoRouter _router;
  late final _AuthRefresh _authRefresh;
  ThemeMode _themeMode = ThemeMode.system;

  @override
  void initState() {
    super.initState();
    _authRefresh = _AuthRefresh();
    if (AppConfig.isConfigured) {
      _authRefresh.bind(Supabase.instance.client.auth.onAuthStateChange);
    }
    _router = GoRouter(
      initialLocation: '/',
      errorBuilder: (context, state) => NativeFeaturePage(
        title: 'Page not found',
        routePath: state.uri.path,
        pathParameters: state.pathParameters,
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
            path == '/search' ||
            path == '/discover' ||
            path.startsWith('/discover/') ||
            path == '/tv' ||
            path == '/iptv' ||
            path == '/tv/channels' ||
            path == '/tv/reels' ||
            path == '/shop' ||
            path == '/fediverse/feed' ||
            path == '/fediverse/discover' ||
            path == '/fediverse/organic-discovery' ||
            path == '/videos' ||
            path == '/shorts' ||
            path == '/videos/watchlater' ||
            path == '/hashtags' ||
            path.startsWith('/hashtag/') ||
            path == '/leaderboard' ||
            path == '/leaderboard/creators' ||
            path == '/news' ||
            path.startsWith('/post/') ||
            path.startsWith('/news/') ||
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
        if (!signedIn && !onAuth && !onSetup && !publicRoute) {
          return '/auth?returnTo=${Uri.encodeComponent(state.uri.toString())}';
        }
        return null;
      },
      routes: [
        GoRoute(path: '/setup', builder: (_, __) => const _SetupPage()),
        GoRoute(
          path: '/auth',
          builder: (_, state) => AuthPage(
            recovery: state.uri.queryParameters['reset'] == '1' ||
                state.uri.queryParameters['type'] == 'recovery',
            returnTo: AuthRedirectPolicy.safeReturnPath(
              state.uri.queryParameters['returnTo'],
            ),
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
            // Historical discovery URLs resolve to native Flutter search.
            // Route-specific filters remain partial until separately ported.
            GoRoute(path: '/search', builder: (_, __) => const ExplorePage()),
            GoRoute(path: '/discover', builder: (_, __) => const ExplorePage()),
            GoRoute(
              path: '/discover/suggested',
              builder: (_, __) => const ExplorePage(),
            ),
            GoRoute(
              path: '/discover/popular',
              builder: (_, __) => const ExplorePage(),
            ),
            GoRoute(
              path: '/discover/fediverse',
              builder: (_, __) => const FediversePage(section: 'discover'),
            ),
            GoRoute(path: '/threads', builder: (_, __) => const ThreadsPage()),
            GoRoute(
              path: '/post/:postId/replies',
              builder: (_, state) => PostInteractionPage(
                postId: state.pathParameters['postId'] ?? '',
                kind: PostInteractionKind.replies,
              ),
            ),
            GoRoute(
              path: '/post/:postId/likes',
              builder: (_, state) => PostInteractionPage(
                postId: state.pathParameters['postId'] ?? '',
                kind: PostInteractionKind.likes,
              ),
            ),
            GoRoute(
              path: '/post/:postId/reposts',
              builder: (_, state) => PostInteractionPage(
                postId: state.pathParameters['postId'] ?? '',
                kind: PostInteractionKind.reposts,
              ),
            ),
            GoRoute(
              path: '/post/:postId/quotes',
              builder: (_, state) => PostInteractionPage(
                postId: state.pathParameters['postId'] ?? '',
                kind: PostInteractionKind.quotes,
              ),
            ),
            GoRoute(
              path: '/post/:postId/quote-likes',
              builder: (_, state) => PostInteractionPage(
                postId: state.pathParameters['postId'] ?? '',
                kind: PostInteractionKind.quoteLikes,
              ),
            ),
            GoRoute(
              path: '/post/:postId',
              builder: (_, state) =>
                  PostDetailPage(postId: state.pathParameters['postId'] ?? ''),
            ),
            GoRoute(
              path: '/communities',
              builder: (_, __) => const CommunitiesPage(),
            ),
            GoRoute(
              path: '/c/:name',
              builder: (_, state) =>
                  CommunityDetailPage(name: state.pathParameters['name'] ?? ''),
            ),
            GoRoute(
              path: '/c/:name/posts',
              builder: (_, state) =>
                  CommunityDetailPage(name: state.pathParameters['name'] ?? ''),
            ),
            GoRoute(
              path: '/c/:name/members',
              builder: (_, state) =>
                  CommunityDetailPage(name: state.pathParameters['name'] ?? ''),
            ),
            GoRoute(
              path: '/c/:name/chat',
              builder: (_, state) =>
                  CommunityDetailPage(name: state.pathParameters['name'] ?? ''),
            ),
            GoRoute(
              path: '/c/:name/events',
              builder: (_, state) =>
                  CommunityDetailPage(name: state.pathParameters['name'] ?? ''),
            ),
            GoRoute(
              path: '/c/:name/shop',
              builder: (_, state) =>
                  CommunityDetailPage(name: state.pathParameters['name'] ?? ''),
            ),
            GoRoute(
              path: '/thread/:id',
              builder: (_, state) =>
                  ThreadDetailPage(threadId: state.pathParameters['id'] ?? ''),
            ),
            GoRoute(
              path: '/thread/:threadId/replies',
              builder: (_, state) => ThreadDetailPage(
                threadId: state.pathParameters['threadId'] ?? '',
                repliesOnly: true,
              ),
            ),
            GoRoute(
              path: '/tv',
              builder: (_, __) => const TvPage(title: 'TikVTV'),
            ),
            GoRoute(
              path: '/channel/:handle',
              builder: (_, state) => TvChannelProfilePage(
                handle: state.pathParameters['handle'] ?? '',
              ),
            ),
            GoRoute(
              path: '/iptv',
              builder: (_, __) => const TvPage(title: 'IPTV · TikVTV'),
            ),
            GoRoute(
              path: '/tv/channels',
              builder: (_, __) => const TvPage(
                title: 'TV channels',
                initialVerticalMode: false,
              ),
            ),
            GoRoute(
              path: '/tv/reels',
              builder: (_, __) =>
                  const TvPage(title: 'TV Reels', initialVerticalMode: true),
            ),
            GoRoute(
              path: '/stream/:streamId',
              builder: (_, state) => TvPage(
                title: 'Live broadcast',
                streamId: state.pathParameters['streamId'],
              ),
            ),
            GoRoute(
              path: '/tv/live/:streamId',
              builder: (_, state) => TvPage(
                title: 'Live broadcast',
                streamId: state.pathParameters['streamId'],
              ),
            ),
            GoRoute(path: '/videos', builder: (_, __) => const VideosPage()),
            GoRoute(
              path: '/shorts',
              builder: (_, __) => const VideosPage(shortsMode: true),
            ),
            GoRoute(
              path: '/videos/watchlater',
              builder: (_, __) => const VideosPage(watchLaterOnly: true),
            ),
            GoRoute(
              path: '/hashtags',
              builder: (_, __) => const HashtagsPage(),
            ),
            GoRoute(
              path: '/hashtag/:tag',
              builder: (_, state) =>
                  HashtagsPage(tag: state.pathParameters['tag']),
            ),
            GoRoute(
              path: '/leaderboard',
              builder: (_, __) => const LeaderboardPage(),
            ),
            GoRoute(
              path: '/leaderboard/creators',
              builder: (_, __) => const LeaderboardPage(),
            ),
            GoRoute(
              path: '/products',
              builder: (_, __) => const ProductsPage(),
            ),
            GoRoute(
              path: '/marketplace',
              builder: (_, __) => const ProductsPage(),
            ),
            GoRoute(
              path: '/p/:productId',
              builder: (_, state) =>
                  ProductsPage(productId: state.pathParameters['productId']),
            ),
            GoRoute(path: '/shop', builder: (_, __) => const ProductsPage()),
            GoRoute(path: '/orders', builder: (_, __) => const OrdersPage()),
            GoRoute(
              path: '/create-ad',
              builder: (_, __) =>
                  const AdCampaignsPage(mode: AdCampaignsMode.create),
            ),
            GoRoute(
              path: '/my-ads',
              builder: (_, __) =>
                  const AdCampaignsPage(mode: AdCampaignsMode.list),
            ),
            GoRoute(
              path: '/ad-analytics',
              builder: (_, __) =>
                  const AdCampaignsPage(mode: AdCampaignsMode.analytics),
            ),
            GoRoute(
              path: '/admin/ad-config',
              builder: (_, __) => const AdConfigPage(),
            ),
            GoRoute(
              path: '/admin/ads',
              builder: (_, __) => const AdConfigPage(),
            ),
            GoRoute(
              path: '/admin/ads-management',
              builder: (_, __) => const AdConfigPage(),
            ),
            GoRoute(path: '/news', builder: (_, __) => const NewsPage()),
            GoRoute(
              path: '/news/:id',
              builder: (_, state) =>
                  NewsArticlePage(articleId: state.pathParameters['id'] ?? ''),
            ),
            GoRoute(path: '/history', builder: (_, __) => const HistoryPage()),
            GoRoute(
              path: '/fediverse',
              builder: (_, __) => const FediversePage(),
            ),
            GoRoute(
              path: '/fediverse/feed',
              builder: (_, __) => const FediversePage(section: 'feed'),
            ),
            GoRoute(
              path: '/fediverse/discover',
              builder: (_, __) => const FediversePage(section: 'discover'),
            ),
            GoRoute(
              path: '/fediverse/organic-discovery',
              builder: (_, __) =>
                  const FediversePage(section: 'organic-discovery'),
            ),
            GoRoute(
              path: '/fediverse/instances',
              builder: (_, __) => const FediversePage(instancesOnly: true),
            ),
            GoRoute(
              path: '/fediverse/mastodon',
              builder: (_, __) => const FediversePage(section: 'mastodon'),
            ),
            GoRoute(
              path: '/fediverse/inbox',
              builder: (_, __) => const FediversePage(section: 'inbox'),
            ),
            GoRoute(
              path: '/fediverse/relay',
              builder: (_, __) => const FediversePage(section: 'relay'),
            ),
            GoRoute(
              path: '/fediverse/analytics',
              builder: (_, __) => const FediversePage(section: 'analytics'),
            ),
            GoRoute(
              path: '/fediverse/identity',
              builder: (_, __) => const FediversePage(section: 'identity'),
            ),
            GoRoute(
              path: '/fediverse/controls',
              builder: (_, __) => const FediversePage(section: 'controls'),
            ),
            GoRoute(
              path: '/fediverse/profile',
              builder: (_, state) => FediversePage(
                section: 'profile',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/posts',
              builder: (_, state) => FediversePage(
                section: 'posts',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/threads',
              builder: (_, state) => FediversePage(
                section: 'threads',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/replies',
              builder: (_, state) => FediversePage(
                section: 'replies',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/media',
              builder: (_, state) => FediversePage(
                section: 'media',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/videos',
              builder: (_, state) => FediversePage(
                section: 'videos',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/podcasts',
              builder: (_, state) => FediversePage(
                section: 'podcasts',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/series',
              builder: (_, state) => FediversePage(
                section: 'series',
                actorUri: state.uri.queryParameters['actor'],
                handle: state.uri.queryParameters['handle'],
              ),
            ),
            GoRoute(
              path: '/fediverse/profile/likes',
              builder: (_, __) => const FediversePage(section: 'likes'),
            ),
            GoRoute(
              path: '/fediverse/profile/tips',
              builder: (_, __) => const FediversePage(section: 'tips'),
            ),
            GoRoute(
              path: '/fediverse/profile/gifts',
              builder: (_, __) => const FediversePage(section: 'gifts'),
            ),
            GoRoute(
              path: '/fediverse/profile/followers',
              builder: (_, __) => const FediversePage(section: 'followers'),
            ),
            GoRoute(
              path: '/fediverse/profile/following',
              builder: (_, __) => const FediversePage(section: 'following'),
            ),
            GoRoute(
              path: '/fediverse/profile/analytics',
              builder: (_, __) =>
                  const FediversePage(section: 'profile-analytics'),
            ),
            GoRoute(path: '/spaces', builder: (_, __) => const SpacesPage()),
            GoRoute(
              path: '/spaces/:id',
              builder: (_, state) =>
                  SpacesPage(spaceId: state.pathParameters['id']),
            ),
            GoRoute(
              path: '/space-recording/:id',
              builder: (_, state) =>
                  SpacesPage(recordingId: state.pathParameters['id']),
            ),
            GoRoute(
              path: '/space/:id',
              builder: (_, state) =>
                  SpacesPage(spaceId: state.pathParameters['id']),
            ),
            GoRoute(
              path: '/space/:id/recordings',
              builder: (_, state) =>
                  SpacesPage(spaceId: state.pathParameters['id']),
            ),
            GoRoute(
              path: '/start-stream',
              builder: (_, __) => const TvStudioPage(),
            ),
            GoRoute(
              path: '/tv-studio',
              builder: (_, __) => const TvStudioPage(),
            ),
            GoRoute(
              path: '/tv-studio/:streamId',
              builder: (_, state) =>
                  TvStudioPage(streamId: state.pathParameters['streamId']),
            ),
            GoRoute(
              path: '/tv-studio/:streamId/guests',
              builder: (_, state) => TvStudioPage(
                streamId: state.pathParameters['streamId'],
                guestsOnly: true,
              ),
            ),
            GoRoute(
              path: '/creator-studio',
              builder: (_, __) => const CreatorStudioPage(),
            ),
            GoRoute(
              path: '/creator-studio/:section',
              builder: (_, state) => CreatorStudioPage(
                section: state.pathParameters['section'] ?? 'overview',
              ),
            ),
            GoRoute(
              path: '/notifications',
              builder: (_, __) => const NotificationsPage(),
            ),
            GoRoute(
              path: '/messages',
              builder: (_, __) => const MessagesPage(),
            ),
            GoRoute(path: '/profile', builder: (_, __) => const ProfilePage()),
            GoRoute(
              path: '/bookmarks',
              builder: (_, __) => const BookmarksPage(),
            ),
            GoRoute(
              path: '/profile/:username/followers',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'followers',
              ),
            ),
            GoRoute(
              path: '/profile/:username/following',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'following',
              ),
            ),
            // Preserve the web client's distinct profile section deep links.
            // These use the native profile data layer rather than falling
            // through to the generic "screen still being migrated" handler.
            GoRoute(
              path: '/profile/:username/posts',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'posts',
              ),
            ),
            GoRoute(
              path: '/profile/:username/threads',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'threads',
              ),
            ),
            GoRoute(
              path: '/profile/:username/replies',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'replies',
              ),
            ),
            GoRoute(
              path: '/profile/:username/media',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'media',
              ),
            ),
            GoRoute(
              path: '/profile/:username/videos',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'videos',
              ),
            ),
            GoRoute(
              path: '/profile/:username/likes',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'likes',
              ),
            ),
            GoRoute(
              path: '/profile/:username/podcasts',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'podcasts',
              ),
            ),
            GoRoute(
              path: '/profile/:username/series',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'series',
              ),
            ),
            GoRoute(
              path: '/profile/:username/tips',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'tips',
              ),
            ),
            GoRoute(
              path: '/profile/:username/gifts',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'gifts',
              ),
            ),
            GoRoute(
              path: '/profile/:username/analytics',
              builder: (_, state) => ProfilePage(
                username: state.pathParameters['username'],
                section: 'analytics',
              ),
            ),
            GoRoute(
              path: '/profile/:username',
              builder: (_, state) =>
                  ProfilePage(username: state.pathParameters['username']),
            ),
            GoRoute(
              path: '/settings',
              builder: (_, __) => const SettingsPage(),
            ),
            GoRoute(
              path: '/settings/account',
              builder: (_, __) => const SettingsPage(section: 'account'),
            ),
            GoRoute(
              path: '/settings/appearance',
              builder: (_, __) => const SettingsPage(section: 'appearance'),
            ),
            GoRoute(
              path: '/settings/connections',
              builder: (_, __) => const SettingsPage(section: 'connections'),
            ),
            GoRoute(
              path: '/settings/notifications',
              builder: (_, __) => const SettingsPage(section: 'notifications'),
            ),
            GoRoute(
              path: '/settings/privacy',
              builder: (_, __) => const SettingsPage(section: 'privacy'),
            ),
            GoRoute(
              path: '/notification-preferences',
              builder: (_, __) => const SettingsPage(section: 'notifications'),
            ),
            GoRoute(
              path: '/ad-performance',
              builder: (_, __) => const AdPerformancePage(),
            ),
            GoRoute(
              path: '/admin',
              builder: (_, __) => const AdminOverviewPage(),
            ),
            GoRoute(
              path: '/admin/ads-review',
              builder: (_, state) => NativeFeaturePage(
                title: 'Ad Review',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/admin/fraud',
              builder: (_, __) => const AdminFraudPage(),
            ),
            GoRoute(
              path: '/admin/governance',
              builder: (_, __) => const GovernancePage(),
            ),
            GoRoute(
              path: '/admin/identity-verification',
              builder: (_, __) => const IdentityVerificationReviewPage(),
            ),
            GoRoute(
              path: '/admin/overview',
              builder: (_, __) => const AdminOverviewPage(),
            ),
            GoRoute(
              path: '/admin/platform-revenue',
              builder: (_, state) => NativeFeaturePage(
                title: 'Platform Revenue',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/admin/revenue',
              builder: (_, state) => NativeFeaturePage(
                title: 'Revenue Management',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/admin/seo',
              builder: (_, state) => NativeFeaturePage(
                title: 'SEO Management',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/admin/staff-recruitment',
              builder: (_, state) => NativeFeaturePage(
                title: 'Staff Recruitment',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/admin/users',
              builder: (_, __) => const AdminUsersPage(),
            ),
            GoRoute(
              path: '/admin/verifications',
              builder: (_, __) => const VerificationRequestsPage(),
            ),
            GoRoute(
              path: '/ai',
              builder: (_, state) => NativeFeaturePage(
                title: 'AI Assistant',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/ai-bot-setup',
              builder: (_, state) => NativeFeaturePage(
                title: 'AI Bot Setup',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            // Analytics uses the existing authenticated, data-backed post
            // analytics flow rather than a generic migration shell.
            GoRoute(
              path: '/analytics',
              builder: (_, __) => const PostAnalyticsPage(),
            ),
            GoRoute(
              path: '/appeals',
              builder: (_, state) => NativeFeaturePage(
                title: 'Appeals',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/blocked',
              builder: (_, __) => const BlockedUsersPage(),
            ),
            GoRoute(
              path: '/boost-analytics/:postId',
              builder: (_, state) => PostAnalyticsPage(
                postId: state.pathParameters['postId'],
              ),
            ),
            // Reuse the audited server-backed campaign creation workflow;
            // payment state is still confirmed by the backend callback.
            GoRoute(
              path: '/boost-create',
              builder: (_, __) => const AdCampaignsPage(
                mode: AdCampaignsMode.create,
              ),
            ),
            GoRoute(
              path: '/call/:callId',
              builder: (_, state) => NativeFeaturePage(
                title: 'Call',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/challenge/:id',
              builder: (_, state) => NativeFeaturePage(
                title: 'Challenge',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(path: '/credits', builder: (_, __) => const CreditsPage()),
            GoRoute(
              path: '/daily-rewards',
              builder: (_, __) => const RewardsPage(),
            ),
            GoRoute(
              path: '/fraud-detection',
              builder: (_, __) => const AdminFraudPage(),
            ),
            GoRoute(path: '/help', builder: (_, __) => const HelpPage()),
            GoRoute(
              path: '/interests',
              builder: (_, __) => const InterestsPage(),
            ),
            GoRoute(
              path: '/jobs',
              builder: (_, state) => NativeFeaturePage(
                title: 'Jobs',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/leaderboard/challenges',
              builder: (_, state) => NativeFeaturePage(
                title: 'Challenge Leaderboard',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(path: '/lists', builder: (_, __) => const ListsPage()),
            GoRoute(
              path: '/lists/:id',
              builder: (_, state) =>
                  ListDetailPage(listId: state.pathParameters['id']!),
            ),
            // The native Creator Studio already owns the creator's
            // monetization controls and earnings read model.
            GoRoute(
              path: '/monetization',
              builder: (_, __) => const CreatorStudioPage(),
            ),
            GoRoute(
              path: '/payouts',
              builder: (_, state) => NativeFeaturePage(
                title: 'Payouts',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/platform-inbox',
              builder: (_, state) => NativeFeaturePage(
                title: 'Platform Inbox',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/podcasts/analytics',
              builder: (_, __) => const PodcastAnalyticsPage(),
            ),
            GoRoute(
              path: '/podcasts/search',
              builder: (_, __) => const PodcastSearchPage(),
            ),
            GoRoute(
              path: '/policy',
              builder: (_, __) => const ContentPolicyPage(),
            ),
            GoRoute(path: '/polls', builder: (_, __) => const PollsPage()),
            GoRoute(
              path: '/post-analytics',
              builder: (_, __) => const PostAnalyticsPage(),
            ),
            GoRoute(
              path: '/post-analytics/:postId',
              builder: (_, state) =>
                  PostAnalyticsPage(postId: state.pathParameters['postId']),
            ),
            GoRoute(
              path: '/post-remote',
              builder: (_, __) => const FediversePage(section: 'posts'),
            ),
            GoRoute(
              path: '/post-remote/likes',
              builder: (_, state) => PostInteractionPage(
                postId: PostInteractionPolicy.resolvePostId(
                  postUri: state.uri.queryParameters['post_uri'],
                  postId: state.uri.queryParameters['postId'],
                ),
                kind: PostInteractionKind.likes,
              ),
            ),
            GoRoute(
              path: '/post-remote/quotes',
              builder: (_, state) => PostInteractionPage(
                postId: PostInteractionPolicy.resolvePostId(
                  postUri: state.uri.queryParameters['post_uri'],
                  postId: state.uri.queryParameters['postId'],
                ),
                kind: PostInteractionKind.quotes,
              ),
            ),
            GoRoute(
              path: '/post-remote/replies',
              builder: (_, state) => PostInteractionPage(
                postId: PostInteractionPolicy.resolvePostId(
                  postUri: state.uri.queryParameters['post_uri'],
                  postId: state.uri.queryParameters['postId'],
                ),
                kind: PostInteractionKind.replies,
              ),
            ),
            GoRoute(
              path: '/post-remote/reply/:replyId',
              builder: (_, state) => PostReplyChainPage(
                postId: PostInteractionPolicy.resolvePostId(
                  postUri: state.uri.queryParameters['post_uri'],
                  postId: state.uri.queryParameters['postId'],
                ),
                replyId: state.pathParameters['replyId'] ?? '',
              ),
            ),
            GoRoute(
              path: '/post-remote/reposts',
              builder: (_, state) => PostInteractionPage(
                postId: PostInteractionPolicy.resolvePostId(
                  postUri: state.uri.queryParameters['post_uri'],
                  postId: state.uri.queryParameters['postId'],
                ),
                kind: PostInteractionKind.reposts,
              ),
            ),
            GoRoute(
              path: '/post/:postId/quote',
              builder: (_, state) => PostQuoteComposerPage(
                postId: state.pathParameters['postId'] ?? '',
              ),
            ),
            GoRoute(
              path: '/post/:postId/reply/:replyId',
              builder: (_, state) => PostReplyChainPage(
                postId: state.pathParameters['postId'] ?? '',
                replyId: state.pathParameters['replyId'] ?? '',
              ),
            ),
            GoRoute(
              path: '/premium',
              builder: (_, state) => PremiumPage(
                returnToken: state.uri.queryParameters['paypal'] == 'return'
                    ? state.uri.queryParameters['token']
                    : null,
              ),
            ),
            GoRoute(
              path: '/privacy',
              builder: (_, __) => const PrivacyPolicyPage(),
            ),
            GoRoute(
              path: '/profile-features',
              builder: (_, __) => const ProfileFeaturesPage(),
            ),
            GoRoute(
              path: '/referral',
              builder: (_, __) => const ReferralPage(),
            ),
            GoRoute(
              path: '/referrals',
              builder: (_, __) => const ReferralPage(),
            ),
            GoRoute(
              path: '/regulator',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/regulator/analytics',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/regulator/announce',
              builder: (_, state) => NativeFeaturePage(
                title: 'Announcements',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/regulator/audit',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/regulator/employees',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/regulator/features',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/regulator/moderation',
              builder: (_, __) => const AdminFraudPage(),
            ),
            GoRoute(
              path: '/regulator/platform',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/regulator/reports',
              builder: (_, state) => NativeFeaturePage(
                title: 'Regulatory Reports',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/regulator/wallets',
              builder: (_, state) =>
                  RegulatorConsolePage(routePath: state.matchedLocation),
            ),
            GoRoute(
              path: '/revenue-analytics',
              builder: (_, state) => NativeFeaturePage(
                title: 'Revenue Analytics',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(path: '/rewards', builder: (_, __) => const RewardsPage()),
            GoRoute(
              path: '/ride',
              builder: (_, state) => NativeFeaturePage(
                title: 'Ride',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/scheduled',
              builder: (_, __) => const ScheduledPostsPage(),
            ),
            GoRoute(
              path: '/seller/:username',
              builder: (_, state) => SellerStorefrontPage(
                username: state.pathParameters['username'] ?? '',
              ),
            ),
            GoRoute(
              path: '/series',
              builder: (_, __) => const CreatorSeriesPage(),
            ),
            GoRoute(
              path: '/sessions',
              builder: (_, __) => const ActiveSessionsPage(),
            ),
            GoRoute(
              path: '/sports',
              builder: (_, state) => NativeFeaturePage(
                title: 'Sports',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/staff',
              builder: (_, state) => NativeFeaturePage(
                title: 'Staff Console',
                routePath: state.matchedLocation,
                pathParameters: state.pathParameters,
              ),
            ),
            GoRoute(
              path: '/story-analytics',
              builder: (_, __) => const StoryAnalyticsPage(),
            ),
            GoRoute(
              path: '/team-chat',
              builder: (_, __) => const TeamChatPage(),
            ),
            GoRoute(
              path: '/terms',
              builder: (_, __) => const TermsOfServicePage(),
            ),
            GoRoute(
              path: '/thread/:threadId/likes',
              builder: (_, state) => ThreadInteractionPage(
                threadId: state.pathParameters['threadId']!,
                mode: ThreadInteractionMode.likes,
              ),
            ),
            GoRoute(
              path: '/thread/:threadId/quote-likes/:quoteId',
              builder: (_, state) => ThreadInteractionPage(
                threadId: state.pathParameters['threadId']!,
                quoteId: state.pathParameters['quoteId'],
                mode: ThreadInteractionMode.quoteLikes,
              ),
            ),
            GoRoute(
              path: '/thread/:threadId/quotes',
              builder: (_, state) => ThreadInteractionPage(
                threadId: state.pathParameters['threadId']!,
                mode: ThreadInteractionMode.quotes,
              ),
            ),
            GoRoute(
              path: '/thread/:threadId/reply-likes/:replyId',
              builder: (_, state) => ThreadInteractionPage(
                threadId: state.pathParameters['threadId']!,
                replyId: state.pathParameters['replyId'],
                mode: ThreadInteractionMode.replyLikes,
              ),
            ),
            GoRoute(
              path: '/thread/:threadId/reposts',
              builder: (_, state) => ThreadInteractionPage(
                threadId: state.pathParameters['threadId']!,
                mode: ThreadInteractionMode.reposts,
              ),
            ),
            GoRoute(
              path: '/threads/create',
              builder: (_, __) => const ThreadsPage(),
            ),
            GoRoute(
              path: '/trending/:topic',
              builder: (_, state) =>
                  TrendingTopicPage(topic: state.pathParameters['topic'] ?? ''),
            ),
            // Keep the legacy /verify deep link on the real native
            // verification status flow instead of the generic migration shell.
            GoRoute(
              path: '/verify',
              builder: (_, __) => const IdentityVerificationStatusPage(),
            ),
            GoRoute(
              path: '/verify-identity',
              builder: (_, __) => const IdentityVerificationStatusPage(),
            ),
            GoRoute(path: '/wallet', builder: (_, __) => const WalletPage()),
            GoRoute(
              path: '/wallet/analytics',
              builder: (_, __) => const WalletAuxiliaryPage(
                mode: WalletAuxiliaryMode.analytics,
              ),
            ),
            GoRoute(
              path: '/wallet/converter',
              builder: (_, __) => const CurrencyConverterPage(),
            ),
            GoRoute(
              path: '/wallet/history',
              builder: (_, __) => const WalletPage(showHistory: true),
            ),
            GoRoute(
              path: '/wallet/mpesa',
              builder: (_, __) => const WalletMpesaPage(),
            ),
            GoRoute(
              path: '/wallet/pocket',
              builder: (_, __) =>
                  const WalletAuxiliaryPage(mode: WalletAuxiliaryMode.pocket),
            ),
            GoRoute(
              path: '/wallet/receive',
              builder: (_, __) =>
                  const WalletAuxiliaryPage(mode: WalletAuxiliaryMode.receive),
            ),
            GoRoute(
              path: '/wallet/referrals',
              builder: (_, __) => const WalletAuxiliaryPage(
                mode: WalletAuxiliaryMode.referrals,
              ),
            ),
            GoRoute(
              path: '/wallet/reminders',
              builder: (_, __) => const WalletAuxiliaryPage(
                mode: WalletAuxiliaryMode.reminders,
              ),
            ),
            GoRoute(
              path: '/wallet/savings',
              builder: (_, __) => const WalletSavingsPage(),
            ),
            GoRoute(
              path: '/wallet/scheduled',
              builder: (_, __) => const WalletAuxiliaryPage(
                mode: WalletAuxiliaryMode.scheduled,
              ),
            ),
            GoRoute(
              path: '/wallet/security',
              builder: (_, __) => const WalletSecurityPage(),
            ),
            GoRoute(
              path: '/wallet/send',
              builder: (_, __) => const WalletSendPage(),
            ),
            GoRoute(
              path: '/wishlist',
              builder: (_, __) => const WishlistPage(),
            ),
          ],
        ),
      ],
    );
  }

  @override
  void dispose() {
    _router.dispose();
    _authRefresh.dispose();
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
                Image.asset(
                  'assets/branding/testagram-icon.webp',
                  width: 76,
                  height: 76,
                ),
                const SizedBox(height: 20),
                Text(
                  'Testagram is not configured',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
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
