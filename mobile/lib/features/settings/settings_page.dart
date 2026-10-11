import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  bool _busy = false;
  String? _error;

  Future<void> _openSite() async {
    final uri = Uri.parse(AppConfig.siteUrl);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
        mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open the website.')));
    }
  }

  Future<void> _signOut() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Supabase.instance.client.auth
          .signOut()
          .timeout(const Duration(seconds: 10));
      if (mounted) context.go('/auth');
    } catch (error) {
      if (mounted) {
        setState(() =>
            _error = 'Sign-out could not complete. Retry when connected.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    return ListView(padding: const EdgeInsets.all(14), children: [
      Text('Settings',
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 12),
      Card(
          child: Column(children: [
        ListTile(
            leading: const Icon(Icons.account_circle_outlined),
            title: const Text('Signed-in account'),
            subtitle: Text(user?.email ??
                user?.phone ??
                'Authenticated Testagram account'),
            isThreeLine: false),
        const Divider(height: 1),
        ListTile(
            leading: const Icon(Icons.contrast_rounded),
            title: const Text('Appearance'),
            subtitle: const Text(
                'Use the appearance control in the top bar to choose light, dark or system mode.'),
            onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Use the contrast icon in the top bar to change appearance.')))),
        const Divider(height: 1),
        ListTile(
            leading: const Icon(Icons.language_rounded),
            title: const Text('Open Testagram website'),
            subtitle: const Text(AppConfig.siteUrl),
            trailing: const Icon(Icons.open_in_new_rounded),
            onTap: _openSite),
      ])),
      const SizedBox(height: 12),
      Card(
          child: Column(children: [
        ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: const Text('Privacy and safety'),
            subtitle: const Text(
                'Account privacy, blocks, reports and session controls are being ported behind parity checks.'),
            onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Privacy and safety settings remain available on the current website until the native parity phase is complete.')))),
        const Divider(height: 1),
        ListTile(
            leading: const Icon(Icons.notifications_active_outlined),
            title: const Text('Notification preferences'),
            subtitle: const Text(
                'Push registration and per-category preferences are part of the native notifications phase.'),
            onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text(
                    'Native notification preferences will be enabled after FCM token and delivery verification.')))),
      ])),
      const SizedBox(height: 14),
      FilledButton.tonalIcon(
          onPressed: _busy ? null : _signOut,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.logout_rounded),
          label: Text(_busy ? 'Signing out…' : 'Sign out')),
      if (_error != null)
        Padding(
            padding: const EdgeInsets.all(12),
            child: Text(_error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error))),
      const SizedBox(height: 12),
      Center(
          child: Text('Testagram · Flutter migration preview',
              style: Theme.of(context).textTheme.bodySmall)),
    ]);
  }
}
