import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'admin_users_policy.dart';

/// Native owner-only user administration port. The database's RLS policies
/// remain the authority for profile reads and block-state mutations.
class AdminUsersPage extends StatefulWidget {
  const AdminUsersPage({super.key});

  @override
  State<AdminUsersPage> createState() => _AdminUsersPageState();
}

class _AdminUsersPageState extends State<AdminUsersPage> {
  final SupabaseClient _db = Supabase.instance.client;
  final TextEditingController _search = TextEditingController();
  List<Map<String, dynamic>> _users = const [];
  final Set<String> _busy = {};
  bool _loading = true;
  bool _authorized = false;
  String? _error;
  int _generation = 0;

  List<Map<String, dynamic>> get _filtered => _users
      .where((user) => AdminUsersPolicy.matchesSearch(user, _search.text))
      .toList();

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearchChanged);
    _load();
  }

  @override
  void dispose() {
    _generation++;
    _search
      ..removeListener(_onSearchChanged)
      ..dispose();
    super.dispose();
  }

  void _onSearchChanged() => setState(() {});

  Future<void> _load() async {
    final generation = ++_generation;
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to manage platform users.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final owner = await _db
              .rpc('testagram_is_owner')
              .timeout(const Duration(seconds: 12)) ==
          true;
      if (!AdminUsersPolicy.canAccess(isOwner: owner)) {
        if (mounted && generation == _generation) {
          setState(() {
            _authorized = false;
            _users = const [];
          });
        }
        return;
      }
      final rows = await _db
          .from('profiles')
          .select('id,username,email,is_blocked,follower_count,created_at')
          .order('created_at', ascending: false)
          .limit(200)
          .timeout(const Duration(seconds: 20));
      final users = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      if (!mounted || generation != _generation) return;
      setState(() {
        _authorized = true;
        _users = users;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _error =
              'User administration could not load. Verify owner access and retry.';
        });
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _toggleBlock(Map<String, dynamic> user) async {
    final id = '${user['id'] ?? ''}';
    if (!_authorized || id.isEmpty || !_busy.add(id)) return;
    final wasBlocked = AdminUsersPolicy.isBlocked(user);
    setState(() {});
    try {
      await _db
          .from('profiles')
          .update({'is_blocked': !wasBlocked})
          .eq('id', id)
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      setState(() => user['is_blocked'] = !wasBlocked);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(wasBlocked ? 'User unblocked.' : 'User blocked.')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text(
                  'Could not update this user. Check authorization and retry.')),
        );
      }
    } finally {
      _busy.remove(id);
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = _db.auth.currentUser;
    return Scaffold(
      appBar: AppBar(
        title: const Text('User Management'),
        actions: [
          IconButton(
            tooltip: 'Refresh users',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && _users.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : user == null
              ? _empty(
                  context,
                  Icons.lock_outline_rounded,
                  'Sign in required',
                  'Sign in to continue.',
                  FilledButton(
                    onPressed: () => context.go('/auth'),
                    child: const Text('Sign in'),
                  ),
                )
              : (!_authorized && _error == null)
                  ? _empty(
                      context,
                      Icons.admin_panel_settings_outlined,
                      'Owner access required',
                      'Blocking and unblocking accounts is restricted to the system owner.',
                      FilledButton.tonal(
                        onPressed: () => context.go('/admin/governance'),
                        child: const Text('Open Governance'),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(14),
                        children: [
                          Text(
                            'Accounts',
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                          const SizedBox(height: 4),
                          Text(
                              'Showing the latest ${_users.length} profiles; changes are saved through the existing profile policy.'),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _search,
                            decoration: InputDecoration(
                              prefixIcon: const Icon(Icons.search_rounded),
                              hintText: 'Search username, email, or ID',
                              suffixIcon: _search.text.isEmpty
                                  ? null
                                  : IconButton(
                                      tooltip: 'Clear search',
                                      onPressed: _search.clear,
                                      icon: const Icon(Icons.clear_rounded),
                                    ),
                              border: const OutlineInputBorder(),
                            ),
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            MaterialBanner(
                              content: Text(_error!),
                              actions: [
                                TextButton(
                                    onPressed: _load,
                                    child: const Text('Retry'))
                              ],
                            ),
                          ],
                          const SizedBox(height: 12),
                          if (_filtered.isEmpty && _error == null)
                            const Card(
                                child: ListTile(
                                    title: Text('No matching users.'))),
                          ..._filtered.map((user) {
                            final id = '${user['id'] ?? ''}';
                            final blocked = AdminUsersPolicy.isBlocked(user);
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: ListTile(
                                leading: CircleAvatar(
                                  child: Text(
                                      '${user['username'] ?? '?'}'.isEmpty
                                          ? '?'
                                          : '${user['username'] ?? '?'}'[0]
                                              .toUpperCase()),
                                ),
                                title: Text('@${user['username'] ?? 'unknown'}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis),
                                subtitle: Text(
                                    '${user['email'] ?? 'No email'}\n${user['follower_count'] ?? 0} followers · ${blocked ? 'Blocked' : 'Active'}'),
                                isThreeLine: true,
                                trailing: IconButton(
                                  tooltip:
                                      blocked ? 'Unblock user' : 'Block user',
                                  onPressed: _busy.contains(id)
                                      ? null
                                      : () => _toggleBlock(user),
                                  icon: _busy.contains(id)
                                      ? const SizedBox.square(
                                          dimension: 20,
                                          child: CircularProgressIndicator(
                                              strokeWidth: 2))
                                      : Icon(blocked
                                          ? Icons.lock_open_rounded
                                          : Icons.block_rounded),
                                ),
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
    );
  }

  Widget _empty(BuildContext context, IconData icon, String title, String body,
          Widget action) =>
      Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 52),
              const SizedBox(height: 14),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(body, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              action,
            ],
          ),
        ),
      );
}
