import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Native blocked/muted account controls backed by per-user RLS policies.
class BlockedUsersPage extends StatefulWidget {
  const BlockedUsersPage({super.key});

  @override
  State<BlockedUsersPage> createState() => _BlockedUsersPageState();
}

class _BlockedUsersPageState extends State<BlockedUsersPage> {
  final _db = Supabase.instance.client;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  int _tab = 0;
  List<Map<String, dynamic>> _blocked = const [];
  List<Map<String, dynamic>> _muted = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to manage blocked and muted accounts.';
      });
      return;
    }
    try {
      final responses = await Future.wait<dynamic>([
        _db
            .from('user_blocks')
            .select('id,blocked_id,created_at')
            .eq('blocker_id', user.id)
            .order('created_at', ascending: false)
            .limit(500),
        _db
            .from('user_mutes')
            .select('id,muted_id,created_at')
            .eq('muter_id', user.id)
            .order('created_at', ascending: false)
            .limit(500),
      ]);
      final blockedRows = (responses[0] as List)
          .whereType<Map>()
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
      final mutedRows = (responses[1] as List)
          .whereType<Map>()
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
      final ids = <String>{
        ...blockedRows.map((r) => '${r['blocked_id']}'),
        ...mutedRows.map((r) => '${r['muted_id']}'),
      };
      final profiles = ids.isEmpty
          ? <dynamic>[]
          : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url,verified')
                .inFilter('id', ids.toList());
      final byId = {for (final p in profiles) '${p['id']}': Map<String, dynamic>.from(p)};
      if (!mounted) return;
      setState(() {
        _blocked = blockedRows.map((r) => {...r, 'profile': byId['${r['blocked_id']}']}).toList();
        _muted = mutedRows.map((r) => {...r, 'profile': byId['${r['muted_id']}']}).toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Privacy controls could not be loaded. Check your connection and retry.';
      });
    }
  }

  Future<void> _remove(Map<String, dynamic> row) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final table = _tab == 0 ? 'user_blocks' : 'user_mutes';
      await _db
          .from(table)
          .delete()
          .eq('id', row['id'])
          .eq(_tab == 0 ? 'blocker_id' : 'muter_id', _db.auth.currentUser!.id);
      if (!mounted) return;
      setState(() {
        if (_tab == 0) {
          _blocked = _blocked.where((r) => '${r['id']}' != '${row['id']}').toList();
        } else {
          _muted = _muted.where((r) => '${r['id']}' != '${row['id']}').toList();
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tab == 0 ? 'Account unblocked.' : 'Account unmuted.')),
      );
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _tab == 0 ? 'Account was not unblocked.' : 'Account was not unmuted.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rows = _tab == 0 ? _blocked : _muted;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Blocked & muted accounts',
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          const Text(
            'Manage who can interact with you and whose activity is filtered from your experience.',
          ),
          const SizedBox(height: 14),
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 0, label: Text('Blocked'), icon: Icon(Icons.block)),
              ButtonSegment(value: 1, label: Text('Muted'), icon: Icon(Icons.volume_off_outlined)),
            ],
            selected: {_tab},
            onSelectionChanged: (selected) => setState(() => _tab = selected.first),
          ),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(_error!),
                trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
              ),
            ),
          if (!_loading && rows.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  children: [
                    Icon(_tab == 0 ? Icons.shield_outlined : Icons.volume_up_outlined, size: 40),
                    const SizedBox(height: 10),
                    Text(_tab == 0 ? 'No blocked accounts' : 'No muted accounts'),
                    const SizedBox(height: 6),
                    const Text('Accounts you block or mute will appear here.'),
                  ],
                ),
              ),
            ),
          for (final row in rows) _accountTile(row),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => context.go('/settings/privacy'),
            icon: const Icon(Icons.privacy_tip_outlined),
            label: const Text('Privacy settings'),
          ),
        ],
      ),
    );
  }

  Widget _accountTile(Map<String, dynamic> row) {
    final profile = row['profile'] is Map
        ? Map<String, dynamic>.from(row['profile'] as Map)
        : <String, dynamic>{};
    final username = '${profile['username'] ?? 'unknown'}';
    final avatar = profile['avatar_url']?.toString();
    return Card(
      child: ListTile(
        leading: avatar != null && avatar.startsWith('http')
            ? CircleAvatar(
                backgroundImage: NetworkImage(avatar),
                onBackgroundImageError: (_, __) {},
              )
            : CircleAvatar(child: Text(username.isEmpty ? '?' : username[0].toUpperCase())),
        title: Text('@$username'),
        subtitle: Text('${profile['display_name'] ?? ''} • ${row['created_at'] ?? ''}'),
        trailing: TextButton(
          onPressed: _busy ? null : () => _remove(row),
          child: Text(_tab == 0 ? 'Unblock' : 'Unmute'),
        ),
        onTap: () => context.push('/profile/$username'),
      ),
    );
  }
}
