import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/testagram_theme.dart';
import '../core/widgets/testagram_background.dart';

class TestagramShell extends StatelessWidget {
  const TestagramShell({
    required this.location,
    required this.child,
    required this.themeMode,
    required this.onThemeChanged,
    super.key,
  });

  final String location;
  final Widget child;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  static const _destinations = <_Destination>[
    _Destination('/', 'Home', Icons.home_rounded),
    _Destination('/tv', 'World TV', Icons.live_tv_rounded),
    _Destination('/explore', 'Explore', Icons.tag_rounded),
    _Destination('/threads', 'Threads', Icons.forum_outlined),
    _Destination(
        '/notifications', 'Notifications', Icons.notifications_none_rounded),
    _Destination('/messages', 'Messages', Icons.mail_outline_rounded),
    _Destination('/spaces', 'Live Spaces', Icons.graphic_eq_rounded),
    _Destination('/communities', 'Communities', Icons.groups_2_outlined),
    _Destination('/profile', 'Profile', Icons.person_outline_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final desktop = width >= 900;
    final showRightRail = width >= 1320;
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: desktop
          ? null
          : AppBar(
              titleSpacing: 16,
              title: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset('assets/branding/testagram-icon.webp',
                      width: 30, height: 30),
                  const SizedBox(width: 9),
                  const Text('Testagram',
                      style: TextStyle(
                          fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                ],
              ),
              actions: [
                IconButton(
                  tooltip: 'Messages',
                  onPressed: () => context.go('/messages'),
                  icon: const Icon(Icons.chat_bubble_outline_rounded),
                ),
                _AppearanceMenu(
                    themeMode: themeMode, onThemeChanged: onThemeChanged),
                IconButton(
                  tooltip: 'Settings',
                  onPressed: () => context.go('/settings'),
                  icon: const Icon(Icons.settings_outlined),
                ),
                const SizedBox(width: 6),
              ],
            ),
      body: TestagramBackground(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (desktop)
              SizedBox(
                width: 248,
                child: _DesktopNavigation(
                  location: location,
                  themeMode: themeMode,
                  onThemeChanged: onThemeChanged,
                ),
              ),
            Expanded(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 720),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: (dark ? TestagramTheme.darkSurface : Colors.white)
                          .withValues(alpha: 0.91),
                      border: Border.symmetric(
                        vertical: BorderSide(
                          color: Theme.of(context)
                              .dividerColor
                              .withValues(alpha: 0.72),
                        ),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: (dark ? Colors.black : TestagramTheme.green)
                              .withValues(alpha: dark ? 0.15 : 0.035),
                          blurRadius: 32,
                          spreadRadius: 0,
                        ),
                      ],
                    ),
                    child: child,
                  ),
                ),
              ),
            ),
            if (showRightRail) const SizedBox(width: 20),
            if (showRightRail)
              const SizedBox(
                width: 292,
                child: _RightContextRail(),
              ),
          ],
        ),
      ),
      bottomNavigationBar: desktop
          ? null
          : NavigationBar(
              selectedIndex: _mobileSelectedIndex(location),
              onDestinationSelected: (index) =>
                  context.go(_mobileDestinations[index].path),
              destinations: _mobileDestinations
                  .map((item) => NavigationDestination(
                        icon: Icon(item.icon),
                        selectedIcon: Icon(item.icon,
                            color: Theme.of(context).colorScheme.primary),
                        label: item.label,
                      ))
                  .toList(),
            ),
    );
  }

  static const _mobileDestinations = <_Destination>[
    _Destination('/', 'Home', Icons.home_rounded),
    _Destination('/explore', 'Explore', Icons.search_rounded),
    _Destination('/tv', 'TV', Icons.live_tv_rounded),
    _Destination('/notifications', 'Alerts', Icons.notifications_none_rounded),
    _Destination('/profile', 'Profile', Icons.person_outline_rounded),
  ];

  int _mobileSelectedIndex(String path) {
    final index = _mobileDestinations.indexWhere((item) =>
        item.path == path || (item.path != '/' && path.startsWith(item.path)));
    return index < 0 ? 0 : index;
  }
}

class _DesktopNavigation extends StatelessWidget {
  const _DesktopNavigation({
    required this.location,
    required this.themeMode,
    required this.onThemeChanged,
  });

  final String location;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        border: Border(
          right: BorderSide(color: Theme.of(context).dividerColor),
        ),
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 22),
              child: Row(
                children: [
                  Image.asset('assets/branding/testagram-icon.webp',
                      width: 34, height: 34),
                  const SizedBox(width: 10),
                  const Flexible(
                    child: Text('Testagram',
                        style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.6)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final item in TestagramShell._destinations)
                    _NavItem(
                      item: item,
                      selected: item.path == location ||
                          (item.path != '/' && location.startsWith(item.path)),
                    ),
                  const Padding(
                    padding: EdgeInsets.fromLTRB(12, 18, 12, 8),
                    child: Text('YOUR SPACE',
                        style: TextStyle(
                            fontSize: 10,
                            letterSpacing: 1.3,
                            fontWeight: FontWeight.w800,
                            color: Colors.grey)),
                  ),
                  _NavItem(
                    item: const _Destination('/bookmarks', 'Bookmarks',
                        Icons.bookmark_border_rounded),
                    selected: location.startsWith('/bookmarks'),
                  ),
                  _NavItem(
                    item: const _Destination(
                        '/settings', 'Settings', Icons.settings_outlined),
                    selected: location.startsWith('/settings'),
                  ),
                  const SizedBox(height: 18),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.workspace_premium_rounded,
                              color: color.primary),
                          const SizedBox(height: 8),
                          const Text('Upgrade to Premium',
                              style: TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 5),
                          Text(
                            'Unlock exclusive features and creator tools.',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: () => context.go('/premium'),
                              child: const Text('Explore Premium'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Appearance',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  PopupMenuButton<ThemeMode>(
                    tooltip: 'Change appearance',
                    initialValue: themeMode,
                    onSelected: onThemeChanged,
                    icon: const Icon(Icons.contrast_rounded),
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                          value: ThemeMode.system,
                          child: Text('System appearance')),
                      PopupMenuItem(
                          value: ThemeMode.light,
                          child: Text('Light appearance')),
                      PopupMenuItem(
                          value: ThemeMode.dark,
                          child: Text('Dark appearance')),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.item, required this.selected});

  final _Destination item;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected
            ? theme.colorScheme.primary.withValues(alpha: 0.11)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(13),
        child: InkWell(
          borderRadius: BorderRadius.circular(13),
          onTap: () => context.go(item.path),
          child: Container(
            constraints: const BoxConstraints(minHeight: 46),
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(13),
              border: Border.all(
                color: selected
                    ? theme.colorScheme.primary.withValues(alpha: 0.18)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                Icon(item.icon,
                    size: 21,
                    color: selected
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurface),
                const SizedBox(width: 13),
                Expanded(
                  child: Text(
                    item.label,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                      color: selected ? theme.colorScheme.primary : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RightContextRail extends StatelessWidget {
  const _RightContextRail();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.only(top: 18, bottom: 24, right: 14),
        children: const [
          _RightSearch(),
          SizedBox(height: 16),
          _RightRailCard(
            title: 'Trending',
            icon: Icons.trending_up_rounded,
            rows: [
              ('#Testagram', 'Popular on Testagram'),
              ('Creator economy', 'Creators and communities'),
              ('Live now', 'Watch what is happening'),
            ],
          ),
          SizedBox(height: 14),
          _RightRailCard(
            title: 'Communities',
            icon: Icons.groups_2_outlined,
            rows: [
              ('Browse communities', 'Find people who share your interests'),
              ('Live Spaces', 'Join a live conversation'),
            ],
          ),
          SizedBox(height: 14),
          _RightRailFooter(),
        ],
      ),
    );
  }
}

class _RightSearch extends StatelessWidget {
  const _RightSearch();

  @override
  Widget build(BuildContext context) {
    return TextField(
      readOnly: true,
      onTap: () => context.go('/explore'),
      decoration: const InputDecoration(
        prefixIcon: Icon(Icons.search_rounded),
        hintText: 'Search Testagram',
        contentPadding: EdgeInsets.zero,
      ),
    );
  }
}

class _RightRailCard extends StatelessWidget {
  const _RightRailCard({
    required this.title,
    required this.icon,
    required this.rows,
  });

  final String title;
  final IconData icon;
  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon,
                    size: 18, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Text(title,
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.w900)),
              ],
            ),
            const SizedBox(height: 10),
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(row.$1,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(row.$2, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RightRailFooter extends StatelessWidget {
  const _RightRailFooter();

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).textTheme.bodySmall?.color;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Text(
        'Terms · Privacy · Help · About\n© Testagram',
        style: TextStyle(fontSize: 11, color: muted, height: 1.8),
      ),
    );
  }
}

class _AppearanceMenu extends StatelessWidget {
  const _AppearanceMenu({
    required this.themeMode,
    required this.onThemeChanged,
  });

  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  @override
  Widget build(BuildContext context) => PopupMenuButton<ThemeMode>(
        tooltip: 'Appearance',
        initialValue: themeMode,
        onSelected: onThemeChanged,
        icon: const Icon(Icons.contrast_rounded),
        itemBuilder: (_) => const [
          PopupMenuItem(
              value: ThemeMode.system, child: Text('System appearance')),
          PopupMenuItem(
              value: ThemeMode.light, child: Text('Light appearance')),
          PopupMenuItem(value: ThemeMode.dark, child: Text('Dark appearance')),
        ],
      );
}

class _Destination {
  const _Destination(this.path, this.label, this.icon);
  final String path;
  final String label;
  final IconData icon;
}
