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
            GoRoute(path: '/tv', builder: (_, __) => const TvPage()),
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
