import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({this.section = 'overview', super.key});

  final String section;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  bool _busy = false;
  String? _error;

  String get _title => switch (widget.section) {
    'account' => 'Account',
    'appearance' => 'Appearance',
    'connections' => 'Connections',
    'notifications' => 'Notifications',
    'privacy' => 'Privacy and safety',
    _ => 'Settings',
  };

  Future<void> _openSite([String path = '']) async {
    final base = AppConfig.siteUrl.replaceFirst(RegExp(r'/$'), '');
    final uri = Uri.parse('$base$path');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Could not open Testagram in your browser.')));
    }
  }

  Future<void> _signOut() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Supabase.instance.client.auth.signOut().timeout(const Duration(seconds: 10));
      if (mounted) context.go('/auth');
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Sign-out could not complete. Retry when connected.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _item({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }

  Widget _sectionContent(User? user) {
    switch (widget.section) {
      case 'account':
        return Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.account_circle_outlined),
                title: const Text('Signed-in account'),
                subtitle: Text(user?.email ?? user?.phone ?? 'Authenticated Testagram account'),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.open_in_new_rounded,
                title: 'Manage account on Testagram',
                subtitle: 'Open the full account interface in your browser.',
                onTap: () => _openSite('/settings/account'),
              ),
              const Divider(height: 1),
              ListTile(
                leading: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.logout_rounded),
                title: Text(_busy ? 'Signing out…' : 'Sign out'),
                subtitle: const Text('End this signed-in session.'),
                onTap: _busy ? null : _signOut,
              ),
            ],
          ),
        );
      case 'appearance':
        return Card(
          child: Column(
            children: [
              const ListTile(
                leading: Icon(Icons.contrast_rounded),
                title: Text('Theme'),
                subtitle: Text(
                  'Choose light, dark or system appearance using the contrast control in the app top bar.',
                ),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.open_in_new_rounded,
                title: 'More appearance controls',
                subtitle: 'Open the complete web appearance settings.',
                onTap: () => _openSite('/settings/appearance'),
              ),
            ],
          ),
        );
      case 'connections':
        return Card(
          child: Column(
            children: [
              const ListTile(
                leading: Icon(Icons.link_rounded),
                title: Text('Connected services'),
                subtitle: Text(
                  'External account linking controls are not yet exposed in this native client.',
                ),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.open_in_new_rounded,
                title: 'Manage connected services',
                subtitle: 'Open the existing connections interface.',
                onTap: () => _openSite('/settings/connections'),
              ),
            ],
          ),
        );
      case 'notifications':
        return Card(
          child: Column(
            children: [
              const ListTile(
                leading: Icon(Icons.notifications_active_outlined),
                title: Text('In-app notifications'),
                subtitle: Text(
                  'The native notifications screen supports live in-app updates while open.',
                ),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.notifications_outlined,
                title: 'View notifications',
                subtitle: 'Open your notification feed.',
                onTap: () => context.go('/notifications'),
              ),
              const Divider(height: 1),
              const ListTile(
                leading: Icon(Icons.phonelink_ring_outlined),
                title: Text('Device push and categories'),
                subtitle: Text(
                  'Push delivery and per-category preferences are not reported as enabled until native delivery is verified.',
                ),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.open_in_new_rounded,
                title: 'Full notification preferences',
                subtitle: 'Open the current web preference controls.',
                onTap: () => _openSite('/settings/notifications'),
              ),
            ],
          ),
        );
      case 'privacy':
        return Card(
          child: Column(
            children: [
              const ListTile(
                leading: Icon(Icons.shield_outlined),
                title: Text('Privacy controls'),
                subtitle: Text(
                  'Block lists, active-session management and account privacy changes are not yet fully native.',
                ),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy policy',
                subtitle: 'Read how Testagram handles privacy.',
                onTap: () => _openSite('/privacy'),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.manage_accounts_outlined,
                title: 'Manage privacy and safety',
                subtitle: 'Open the existing full privacy controls.',
                onTap: () => _openSite('/settings/privacy'),
              ),
            ],
          ),
        );
      default:
        return Card(
          child: Column(
            children: [
              _item(
                icon: Icons.account_circle_outlined,
                title: 'Account',
                subtitle: 'Review your signed-in identity and session.',
                onTap: () => context.go('/settings/account'),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.contrast_rounded,
                title: 'Appearance',
                subtitle: 'Theme and display options.',
                onTap: () => context.go('/settings/appearance'),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.link_rounded,
                title: 'Connections',
                subtitle: 'Connected services and integrations.',
                onTap: () => context.go('/settings/connections'),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.notifications_active_outlined,
                title: 'Notifications',
                subtitle: 'In-app alerts and push-delivery status.',
                onTap: () => context.go('/settings/notifications'),
              ),
              const Divider(height: 1),
              _item(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy and safety',
                subtitle: 'Privacy policy and available safety controls.',
                onTap: () => context.go('/settings/privacy'),
              ),
            ],
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        Row(
          children: [
            if (widget.section != 'overview')
              IconButton(
                tooltip: 'Back to settings',
                onPressed: () => context.go('/settings'),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
            Expanded(
              child: Text(
                _title,
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (widget.section == 'overview')
          Text(
            'Manage your Testagram account and app preferences.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        const SizedBox(height: 12),
        _sectionContent(user),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        const SizedBox(height: 16),
        Center(child: Text('Testagram · Flutter', style: Theme.of(context).textTheme.bodySmall)),
      ],
    );
  }
}
