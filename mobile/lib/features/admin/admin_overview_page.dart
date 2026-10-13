import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'admin_overview_policy.dart';

/// Owner-only platform overview using the same canonical tables as the web
/// AdminPanel. It deliberately avoids estimated platform revenue: only direct
/// database counts and pending queues are displayed here.
class AdminOverviewPage extends StatefulWidget {
  const AdminOverviewPage({super.key});

  @override
  State<AdminOverviewPage> createState() => _AdminOverviewPageState();
}

class _AdminOverviewPageState extends State<AdminOverviewPage> {
  final SupabaseClient _db = Supabase.instance.client;
  bool _loading = true;
  bool _authorized = false;
  String? _error;
  Map<String, int> _counts = const {};
  List<Map<String, dynamic>> _pendingAds = const [];
  List<Map<String, dynamic>> _fraudAlerts = const [];
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _authorized = false;
          _error = 'Sign in to access the administration overview.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final ownerResponse = await _db
          .rpc('testagram_is_owner')
          .timeout(const Duration(seconds: 12));
      final isOwner = ownerResponse == true;
      if (!AdminOverviewPolicy.canAccess(isOwner: isOwner)) {
        if (mounted && generation == _generation) {
          setState(() {
            _authorized = false;
            _counts = const {};
            _pendingAds = const [];
            _fraudAlerts = const [];
          });
        }
        return;
      }

      final results = await Future.wait<dynamic>([
        _db.from('profiles').select('id').count(CountOption.exact),
        _db.from('posts').select('id').count(CountOption.exact),
        _db.from('communities').select('id').count(CountOption.exact),
        _db
            .from('verification_requests')
            .select('id')
            .eq('status', 'pending')
            .count(CountOption.exact),
        _db
            .from('user_ads')
            .select('id')
            .eq('status', 'pending')
            .count(CountOption.exact),
        _db
            .from('fraud_alerts')
            .select('id')
            .eq('resolved', false)
            .count(CountOption.exact),
        _db
            .from('live_streams')
            .select('id')
            .eq('is_live', true)
            .count(CountOption.exact),
        _db
            .from('user_ads')
            .select('id,title,status,budget,created_at')
            .eq('status', 'pending')
            .order('created_at', ascending: false)
            .limit(5),
        _db
            .from('fraud_alerts')
            .select('id,alert_type,severity,created_at,resolved')
            .eq('resolved', false)
            .order('created_at', ascending: false)
            .limit(5),
      ]).timeout(const Duration(seconds: 25));

      final counts = <String, int>{
        'Users': AdminOverviewPolicy.safeCount((results[0] as dynamic).count),
        'Posts': AdminOverviewPolicy.safeCount((results[1] as dynamic).count),
        'Communities':
            AdminOverviewPolicy.safeCount((results[2] as dynamic).count),
        'Pending verifications':
            AdminOverviewPolicy.safeCount((results[3] as dynamic).count),
        'Pending ads':
            AdminOverviewPolicy.safeCount((results[4] as dynamic).count),
        'Open fraud alerts':
            AdminOverviewPolicy.safeCount((results[5] as dynamic).count),
        'Live streams':
            AdminOverviewPolicy.safeCount((results[6] as dynamic).count),
      };
      final ads = (results[7] as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      final alerts = (results[8] as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      if (!mounted || generation != _generation) return;
      setState(() {
        _authorized = true;
        _counts = counts;
        _pendingAds = ads;
        _fraudAlerts = alerts;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _error =
              'Admin overview could not load. Verify owner access and retry.';
        });
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = _db.auth.currentUser;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Administration Overview'),
        actions: [
          IconButton(
            tooltip: 'Refresh overview',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && _counts.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : user == null
              ? _empty(
                  context,
                  Icons.lock_outline_rounded,
                  'Sign in required',
                  'Sign in to continue to the administration console.',
                  FilledButton(
                    onPressed: () => context.go('/auth'),
                    child: const Text('Sign in'),
                  ),
                )
              : !_authorized && _error == null
                  ? _empty(
                      context,
                      Icons.admin_panel_settings_outlined,
                      'Owner access required',
                      'The full platform command center is restricted to the system owner. Delegated administrators can use the governance console.',
                      FilledButton.tonal(
                        onPressed: () => context.go('/admin/governance'),
                        child: const Text('Open Governance'),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Text(
                            'Platform health at a glance',
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Live counts from Testagram’s existing database. Revenue estimates are intentionally excluded.',
                            style: theme.textTheme.bodyMedium,
                          ),
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            MaterialBanner(
                              content: Text(_error!),
                              actions: [
                                TextButton(
                                    onPressed: _load,
                                    child: const Text('Retry')),
                              ],
                            ),
                          ],
                          const SizedBox(height: 16),
                          GridView.count(
                            crossAxisCount:
                                MediaQuery.sizeOf(context).width >= 700 ? 3 : 2,
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                            childAspectRatio: 1.55,
                            children: [
                              for (final item in _counts.entries)
                                _metric(context, item.key, item.value),
                            ],
                          ),
                          const SizedBox(height: 22),
                          _sectionTitle(
                              context, 'Pending ad review', _pendingAds.length),
                          if (_pendingAds.isEmpty)
                            const Card(
                                child: ListTile(
                                    title: Text(
                                        'No pending ads in the preview queue.'))),
                          ..._pendingAds.map((ad) => Card(
                                child: ListTile(
                                  leading: const Icon(Icons.campaign_outlined),
                                  title: Text('${ad['title'] ?? 'Untitled ad'}',
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis),
                                  subtitle: Text(
                                      'Budget: ${ad['budget'] ?? '—'} · ${ad['created_at'] ?? ''}'),
                                  trailing:
                                      const Icon(Icons.chevron_right_rounded),
                                  onTap: () => context.go('/admin/ads-review'),
                                ),
                              )),
                          const SizedBox(height: 18),
                          _sectionTitle(context, 'Open fraud alerts',
                              _fraudAlerts.length),
                          if (_fraudAlerts.isEmpty)
                            const Card(
                                child: ListTile(
                                    title: Text(
                                        'No unresolved fraud alerts in the preview queue.'))),
                          ..._fraudAlerts.map((alert) => Card(
                                child: ListTile(
                                  leading: Icon(
                                    Icons.warning_amber_rounded,
                                    color: theme.colorScheme.error,
                                  ),
                                  title: Text(
                                      '${alert['alert_type'] ?? 'Fraud alert'}'),
                                  subtitle: Text(
                                      '${alert['severity'] ?? 'Unclassified'} · ${alert['created_at'] ?? ''}'),
                                  trailing:
                                      const Icon(Icons.chevron_right_rounded),
                                  onTap: () => context.go('/admin/fraud'),
                                ),
                              )),
                          const SizedBox(height: 16),
                          OutlinedButton.icon(
                            onPressed: () => context.go('/admin/governance'),
                            icon: const Icon(Icons.shield_outlined),
                            label:
                                const Text('Open governance and role controls'),
                          ),
                        ],
                      ),
                    ),
    );
  }

  Widget _metric(BuildContext context, String label, int value) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('$value',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              Text(label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium),
            ],
          ),
        ),
      );

  Widget _sectionTitle(BuildContext context, String title, int count) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Expanded(
                child: Text(title,
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800))),
            Chip(label: Text('$count')),
          ],
        ),
      );

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
