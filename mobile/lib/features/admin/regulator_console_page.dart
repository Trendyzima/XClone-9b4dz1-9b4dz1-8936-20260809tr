import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Read-only, owner-gated native regulator views using verified governance RPCs
/// and tables. High-impact mutations stay in their separately hardened flows.
class RegulatorConsolePage extends StatefulWidget {
  const RegulatorConsolePage({required this.routePath, super.key});
  final String routePath;
  @override
  State<RegulatorConsolePage> createState() => _RegulatorConsolePageState();
}

class _RegulatorConsolePageState extends State<RegulatorConsolePage> {
  final db = Supabase.instance.client;
  bool loading = true;
  bool owner = false;
  String? error;
  List<Map<String, dynamic>> rows = const [];
  Map<String, int> counts = const {};
  List<String> permissions = const [];
  int generation = 0;

  String get section {
    final parts = widget.routePath.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'regulator' : parts.last;
  }

  String get title => switch (section) {
        'audit' => 'Governance Audit',
        'employees' => 'Governance Administrators',
        'features' => 'Governance Permissions',
        'wallets' => 'Wallet Oversight',
        'analytics' => 'Platform Analytics',
        'platform' => 'Platform Overview',
        _ => 'Regulator Console',
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    generation++;
    super.dispose();
  }

  Future<void> _load() async {
    final run = ++generation;
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    if (db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          loading = false;
          error = 'Sign in to continue.';
        });
      }
      return;
    }
    try {
      final response =
          await db.rpc('testagram_get_governance').timeout(const Duration(seconds: 12));
      final governance =
          response is Map ? Map<String, dynamic>.from(response) : <String, dynamic>{};
      final allowed = governance['is_owner'] == true;
      if (!allowed) {
        if (mounted && run == generation) {
          setState(() {
            owner = false;
            rows = const [];
            permissions = const [];
            counts = const {};
          });
        }
        return;
      }
      final nextPermissions = governance['permissions'] is List
          ? (governance['permissions'] as List).map((v) => '$v').toList()
          : <String>[];
      List<Map<String, dynamic>> nextRows = const [];
      Map<String, int> nextCounts = const {};
      if (section == 'audit') {
        final result = await db.rpc('testagram_governance_audit',
            params: {'p_limit': 100}).timeout(const Duration(seconds: 20));
        nextRows =
            (result as List).whereType<Map>().map((r) => Map<String, dynamic>.from(r)).toList();
      } else if (section == 'employees') {
        final result = await db.rpc('testagram_list_admins').timeout(const Duration(seconds: 20));
        nextRows =
            (result as List).whereType<Map>().map((r) => Map<String, dynamic>.from(r)).toList();
      } else if (section == 'wallets') {
        final result = await db
            .from('user_wallets')
            .select('user_id,credits,updated_at')
            .order('credits', ascending: false)
            .limit(100)
            .timeout(const Duration(seconds: 20));
        nextRows = result.whereType<Map>().map((r) => Map<String, dynamic>.from(r)).toList();
      } else if (section == 'features') {
        // This page displays the authenticated owner's explicit permission keys,
        // not a fabricated platform feature-flag table.
      } else {
        final results = await Future.wait<dynamic>([
          db
              .from('profiles')
              .select('id')
              .count(CountOption.exact)
              .timeout(const Duration(seconds: 20)),
          db
              .from('posts')
              .select('id')
              .isFilter('deleted_at', null)
              .count(CountOption.exact)
              .timeout(const Duration(seconds: 20)),
          db
              .from('spaces')
              .select('id')
              .eq('is_live', true)
              .count(CountOption.exact)
              .timeout(const Duration(seconds: 20)),
        ]).timeout(const Duration(seconds: 30));
        nextCounts = {
          'users': results[0].count ?? 0,
          'posts': results[1].count ?? 0,
          'live_spaces': results[2].count ?? 0,
        };
      }
      if (!mounted || run != generation) return;
      setState(() {
        owner = true;
        rows = nextRows;
        counts = nextCounts;
        permissions = nextPermissions;
      });
    } catch (_) {
      if (mounted && run == generation) {
        setState(
          () => error =
              'This regulator view could not load. Confirm the relevant migration and owner authorization, then retry.',
        );
      }
    } finally {
      if (mounted && run == generation) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final body = <Widget>[
      Text(title, style: theme.textTheme.headlineSmall),
      const SizedBox(height: 6),
      Text(switch (section) {
        'audit' => 'Recent governance actions returned by the audited server RPC.',
        'employees' =>
          'Active governance administrator assignments; this is not the separate employee payroll roster.',
        'features' => 'Explicit permission keys assigned to the current owner/admin session.',
        'wallets' => 'Read-only wallet credits from the owner-restricted data view.',
        _ =>
          'Live counts from the current database. These are not estimated revenue or inferred engagement metrics.',
      }),
    ];
    if (error != null) {
      body.add(const SizedBox(height: 12));
      body.add(
        MaterialBanner(
          content: Text(error!),
          actions: [TextButton(onPressed: _load, child: const Text('Retry'))],
        ),
      );
    }
    if (counts.isNotEmpty) {
      body.add(const SizedBox(height: 14));
      body.add(
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: counts.entries
              .map(
                (entry) => SizedBox(
                  width: 150,
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            entry.key.replaceAll('_', ' ').toUpperCase(),
                            style: theme.textTheme.labelSmall,
                          ),
                          const SizedBox(height: 8),
                          Text('${entry.value}', style: theme.textTheme.headlineMedium),
                        ],
                      ),
                    ),
                  ),
                ),
              )
              .toList(),
        ),
      );
    }
    if (section == 'features') {
      body.add(const SizedBox(height: 14));
      if (permissions.isEmpty) {
        body.add(
          const Card(
            child: ListTile(
              title: Text(
                'No explicit permission keys returned. Owner privileges are enforced separately by the server.',
              ),
            ),
          ),
        );
      } else {
        body.addAll(
          permissions.map(
            (permission) => Card(
              child: ListTile(
                leading: const Icon(Icons.verified_user_outlined),
                title: Text(permission),
              ),
            ),
          ),
        );
      }
    }
    if (rows.isNotEmpty) {
      body.add(const SizedBox(height: 14));
      body.add(
        Text(
          section == 'audit'
              ? 'Recent audit events'
              : section == 'employees'
                  ? 'Governance administrators'
                  : 'Wallets (latest 100)',
          style: theme.textTheme.titleLarge,
        ),
      );
      body.addAll(
        rows.map(
          (row) => Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: row.entries
                    .where((entry) => !{'metadata', 'avatar_url'}.contains(entry.key))
                    .take(10)
                    .map(
                      (entry) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Text(
                          '${entry.key.replaceAll('_', ' ')}: ${entry.value ?? '—'}',
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
        ),
      );
    }
    if (rows.isEmpty && counts.isEmpty && permissions.isEmpty && error == null) {
      body.add(const Card(child: ListTile(title: Text('No records returned for this section.'))));
    }
    final signedOut = db.auth.currentUser == null;
    final denied = !owner && error == null;
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            onPressed: loading ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: loading && rows.isEmpty && counts.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : signedOut
              ? _gate(
                  'Sign in required',
                  'Sign in to continue.',
                  FilledButton(onPressed: () => context.go('/auth'), child: const Text('Sign in')),
                )
              : denied
                  ? _gate(
                      'Owner access required',
                      'Privileged regulator data is locked unless the server confirms platform-owner access.',
                      FilledButton.tonal(
                        onPressed: () => context.go('/admin/governance'),
                        child: const Text('Open governance'),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(16), children: body),
                    ),
    );
  }

  Widget _gate(String title, String detail, Widget action) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.shield_outlined, size: 42),
              const SizedBox(height: 12),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(detail, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              action,
            ],
          ),
        ),
      );
}

class IdentityVerificationStatusPage extends StatefulWidget {
  const IdentityVerificationStatusPage({super.key});
  @override
  State<IdentityVerificationStatusPage> createState() => _IdentityVerificationStatusPageState();
}

class _IdentityVerificationStatusPageState extends State<IdentityVerificationStatusPage> {
  final db = Supabase.instance.client;
  bool loading = true;
  String? status;
  String? error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          loading = false;
          error = 'Sign in to check identity verification.';
        });
      }
      return;
    }
    try {
      final result =
          await db.rpc('get_my_identity_verification_status').timeout(const Duration(seconds: 12));
      if (mounted) {
        setState(() => status = result is Map ? '${result['status'] ?? 'pending'}' : 'pending');
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error =
              'Identity status is unavailable. Retry after the identity service is healthy.',
        );
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Identity Verification'),
          actions: [IconButton(onPressed: loading ? null : _load, icon: const Icon(Icons.refresh))],
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: loading
                ? const CircularProgressIndicator()
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.verified_user_outlined, size: 48),
                      const SizedBox(height: 12),
                      Text(
                        'Identity status: ${status ?? 'unavailable'}',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        error ??
                            'Status is read from the authenticated identity service. Identity documents and national-ID numbers are not requested or stored by this screen.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      if (error != null)
                        FilledButton.tonal(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
          ),
        ),
      );
}
