import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ActiveSessionsPage extends StatefulWidget {
  const ActiveSessionsPage({super.key});
  @override
  State<ActiveSessionsPage> createState() => _ActiveSessionsPageState();
}

class _ActiveSessionsPageState extends State<ActiveSessionsPage> {
  final _db = Supabase.instance.client;
  bool _busy = false;
  String? _error;

  DateTime? get _expiry {
    final token = _db.auth.currentSession?.accessToken;
    if (token == null) {
      return null;
    }
    try {
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))),
      ) as Map<String, dynamic>;
      final exp = payload['exp'];
      if (exp is num) {
        return DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000).toLocal();
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  Future<void> _signOut({required bool allDevices}) async {
    if (_busy) {
      return;
    }
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(allDevices ? 'Sign out all devices?' : 'Sign out this device?'),
        content: Text(
          allDevices
              ? 'This invalidates the account sessions supported by the authentication provider. You will need to sign in again.'
              : 'You will be signed out on this device.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _db.auth.signOut(scope: allDevices ? SignOutScope.global : SignOutScope.local);
      if (mounted) {
        context.go('/auth');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Sign-out was not confirmed. Check your connection and retry.');
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = _db.auth.currentSession;
    final user = _db.auth.currentUser;
    final expiry = _expiry;
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Active sessions',
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        const Text(
          'Review the current signed-in session and revoke access if you suspect account compromise.',
        ),
        const SizedBox(height: 12),
        if (_error != null)
          Card(
            child: ListTile(leading: const Icon(Icons.error_outline), title: Text(_error!)),
          ),
        if (session == null || user == null)
          const Card(
            child: ListTile(
              leading: Icon(Icons.lock_outline),
              title: Text('No active session'),
              subtitle: Text('Sign in to manage session security.'),
            ),
          ),
        if (session != null && user != null)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.verified_user_outlined, size: 28),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Current session',
                          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                        ),
                      ),
                      const Chip(label: Text('Active')),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _detail('Account', user.email ?? user.phone ?? 'Signed-in account'),
                  _detail(
                    'User ID',
                    '${user.id.substring(0, user.id.length < 8 ? user.id.length : 8)}…',
                  ),
                  _detail(
                    'Account created',
                    user.createdAt.isEmpty ? 'Unavailable' : user.createdAt,
                  ),
                  _detail('Session expiry', expiry?.toString() ?? 'Provider-managed / unavailable'),
                  const SizedBox(height: 8),
                  const Text(
                    'This screen can revoke the current session and request a provider-level global sign-out. It does not claim to enumerate every device session.',
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _busy || session == null ? null : () => _signOut(allDevices: false),
          icon: const Icon(Icons.logout),
          label: Text(_busy ? 'Signing out…' : 'Sign out this device'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _busy || session == null ? null : () => _signOut(allDevices: true),
          icon: const Icon(Icons.devices_outlined),
          label: const Text('Sign out all devices'),
        ),
      ],
    );
  }

  Widget _detail(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 120,
              child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            Expanded(child: SelectableText(value)),
          ],
        ),
      );
}
