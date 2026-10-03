import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _green = Color(0xFF16A34A);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const url = String.fromEnvironment('SUPABASE_URL');
  const anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  if (url.isNotEmpty && anonKey.isNotEmpty) {
    await Supabase.initialize(url: url, anonKey: anonKey);
  }
  runApp(const TestagramApp());
}

class TestagramApp extends StatelessWidget {
  const TestagramApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Testagram',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: _green),
      scaffoldBackgroundColor: const Color(0xFFF8FAF8),
      navigationBarTheme: const NavigationBarThemeData(height: 72),
    ),
    darkTheme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: _green, brightness: Brightness.dark),
      navigationBarTheme: const NavigationBarThemeData(height: 72),
    ),
    themeMode: ThemeMode.system,
    home: const MobileShell(),
  );
}

class MobileShell extends StatefulWidget {
  const MobileShell({super.key});
  @override State<MobileShell> createState() => _MobileShellState();
}

class _MobileShellState extends State<MobileShell> {
  int index = 0;
  static const pages = <Widget>[
    _FeedPage(), _ExplorePage(), _NotificationsPage(), _MessagesPage(), _ProfilePage(),
  ];
  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(bottom: false, child: IndexedStack(index: index, children: pages)),
    floatingActionButton: FloatingActionButton(onPressed: () {}, tooltip: 'Create', child: const Icon(Icons.add_rounded)),
    bottomNavigationBar: NavigationBar(
      selectedIndex: index,
      onDestinationSelected: (value) => setState(() => index = value),
      destinations: const [
        NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
        NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore_rounded), label: 'Explore'),
        NavigationDestination(icon: Icon(Icons.notifications_none_rounded), selectedIcon: Icon(Icons.notifications_rounded), label: 'Alerts'),
        NavigationDestination(icon: Icon(Icons.mail_outline_rounded), selectedIcon: Icon(Icons.mail_rounded), label: 'Messages'),
        NavigationDestination(icon: Icon(Icons.person_outline_rounded), selectedIcon: Icon(Icons.person_rounded), label: 'Profile'),
      ],
    ),
  );
}

class _FeedPage extends StatelessWidget {
  const _FeedPage();
  @override
  Widget build(BuildContext context) => CustomScrollView(
    slivers: [
      const SliverAppBar(pinned: true, titleSpacing: 20, title: Text('Testagram', style: TextStyle(fontWeight: FontWeight.w900))),
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
        sliver: SliverList.separated(
          itemCount: 4,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (_, __) => const _PostCard(),
        ),
      ),
    ],
  );
}

class _PostCard extends StatelessWidget {
  const _PostCard();
  @override
  Widget build(BuildContext context) => Card(
    elevation: 0,
    margin: EdgeInsets.zero,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
    child: const Padding(
      padding: EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          CircleAvatar(child: Icon(Icons.person_rounded)),
          SizedBox(width: 10),
          Expanded(child: Text('@testagram', style: TextStyle(fontWeight: FontWeight.w800))),
          Icon(Icons.more_horiz_rounded),
        ]),
        SizedBox(height: 14),
        Text('Flutter mobile foundation. Production data and feature parity are added incrementally behind validated contracts.'),
        SizedBox(height: 16),
        Row(children: [
          Icon(Icons.favorite_border_rounded, size: 21), SizedBox(width: 18),
          Icon(Icons.chat_bubble_outline_rounded, size: 21), SizedBox(width: 18),
          Icon(Icons.repeat_rounded, size: 21), SizedBox(width: 18),
          Icon(Icons.bookmark_border_rounded, size: 21),
        ]),
      ]),
    ),
  );
}

class _ExplorePage extends StatelessWidget { const _ExplorePage(); @override Widget build(BuildContext c) => const _SimplePage(title: 'Explore', icon: Icons.explore_rounded); }
class _NotificationsPage extends StatelessWidget { const _NotificationsPage(); @override Widget build(BuildContext c) => const _SimplePage(title: 'Notifications', icon: Icons.notifications_rounded); }
class _MessagesPage extends StatelessWidget { const _MessagesPage(); @override Widget build(BuildContext c) => const _SimplePage(title: 'Messages', icon: Icons.mail_rounded); }
class _ProfilePage extends StatelessWidget { const _ProfilePage(); @override Widget build(BuildContext c) => const _SimplePage(title: 'Profile', icon: Icons.person_rounded); }

class _SimplePage extends StatelessWidget {
  final String title; final IconData icon;
  const _SimplePage({required this.title, required this.icon});
  @override Widget build(BuildContext context) => Center(child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [Icon(icon, size: 52), const SizedBox(height: 12),
      Text(title, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900)),
      const SizedBox(height: 8), const Text('Flutter surface — parity work follows.')],
  ));
}
