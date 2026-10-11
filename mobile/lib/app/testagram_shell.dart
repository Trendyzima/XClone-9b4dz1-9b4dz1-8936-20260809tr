import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

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
    _Destination('/explore', 'Explore', Icons.search_rounded),
    _Destination('/tv', 'TV', Icons.play_circle_outline_rounded),
    _Destination('/notifications', 'Alerts', Icons.notifications_none_rounded),
    _Destination('/profile', 'Profile', Icons.person_outline_rounded),
  ];

  int get _selectedIndex {
    final index = _destinations.indexWhere((item) =>
        item.path == location ||
        (item.path != '/' && location.startsWith(item.path)));
    return index < 0 ? 0 : index;
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final selected = _selectedIndex;
    return Scaffold(
      appBar: AppBar(
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
          PopupMenuButton<ThemeMode>(
            tooltip: 'Appearance',
            initialValue: themeMode,
            onSelected: onThemeChanged,
            icon: const Icon(Icons.contrast_rounded),
            itemBuilder: (_) => const [
              PopupMenuItem(
                  value: ThemeMode.system, child: Text('System appearance')),
              PopupMenuItem(
                  value: ThemeMode.light, child: Text('Light appearance')),
              PopupMenuItem(
                  value: ThemeMode.dark, child: Text('Dark appearance')),
            ],
          ),
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
          children: [
            if (wide)
              NavigationRail(
                selectedIndex: selected,
                onDestinationSelected: (index) =>
                    context.go(_destinations[index].path),
                labelType: NavigationRailLabelType.all,
                destinations: _destinations
                    .map((item) => NavigationRailDestination(
                          icon: Icon(item.icon),
                          selectedIcon: Icon(item.icon,
                              color: Theme.of(context).colorScheme.primary),
                          label: Text(item.label),
                        ))
                    .toList(),
              ),
            Expanded(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 820),
                  child: child,
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: selected,
              onDestinationSelected: (index) =>
                  context.go(_destinations[index].path),
              destinations: _destinations
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
}

class _Destination {
  const _Destination(this.path, this.label, this.icon);
  final String path;
  final String label;
  final IconData icon;
}
