import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'admin_fraud_policy.dart';

/// Owner-only fraud alert queue. Alert resolution is written to the existing
/// fraud_alerts table and remains subject to server-side RLS.
class AdminFraudPage extends StatefulWidget {
  const AdminFraudPage({super.key});

  @override
  State<AdminFraudPage> createState() => _AdminFraudPageState();
}

class _AdminFraudPageState extends State<AdminFraudPage> {
  final SupabaseClient _db = Supabase.instance.client;
  List<Map<String, dynamic>> _alerts = const [];
  final Set<String> _busy = {};
  bool _loading = true;
  bool _authorized = false;
  String? _error;
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
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to access fraud alerts.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final owner =
          await _db.rpc('testagram_is_owner').timeout(const Duration(seconds: 12)) == true;
      if (!AdminFraudPolicy.canAccess(isOwner: owner)) {
        if (mounted && generation == _generation) {
          setState(() {
            _authorized = false;
            _alerts = const [];
          });
        }
        return;
      }
      final rows = await _db
          .from('fraud_alerts')
          .select(
            'id,user_id,alert_type,severity,details,resolved,created_at,user:profiles(username)',
          )
          .order('created_at', ascending: false)
          .limit(100)
          .timeout(const Duration(seconds: 20));
      final alerts = rows.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
      if (!mounted || generation != _generation) return;
      setState(() {
        _authorized = true;
        _alerts = alerts;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = 'Fraud alerts could not load. Verify owner access and retry.');
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _resolve(Map<String, dynamic> alert) async {
    final id = '${alert['id'] ?? ''}';
    if (!_authorized || id.isEmpty || _busy.contains(id) || AdminFraudPolicy.isResolved(alert)) {
      return;
    }
    setState(() => _busy.add(id));
    try {
      await _db
          .from('fraud_alerts')
          .update({'resolved': true, 'resolved_at': DateTime.now().toUtc().toIso8601String()})
          .eq('id', id)
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      setState(() => alert['resolved'] = true);
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Fraud alert marked resolved.')));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not resolve this alert. Check authorization and retry.'),
          ),
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
    final unresolved = _alerts.where((a) => !AdminFraudPolicy.isResolved(a)).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fraud Detection'),
        actions: [
          IconButton(
            tooltip: 'Refresh fraud alerts',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && _alerts.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : user == null
              ? _empty(
                  context,
                  Icons.lock_outline_rounded,
                  'Sign in required',
                  'Sign in to continue.',
                  FilledButton(onPressed: () => context.go('/auth'), child: const Text('Sign in')),
                )
              : (!_authorized && _error == null)
                  ? _empty(
                      context,
                      Icons.admin_panel_settings_outlined,
                      'Owner access required',
                      'Fraud alert resolution is restricted to the system owner.',
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
                            'Risk and fraud queue',
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                          const SizedBox(height: 4),
                          Text('$unresolved unresolved · showing latest ${_alerts.length} alerts'),
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            MaterialBanner(
                              content: Text(_error!),
                              actions: [TextButton(onPressed: _load, child: const Text('Retry'))],
                            ),
                          ],
                          const SizedBox(height: 12),
                          if (_alerts.isEmpty && _error == null)
                            const Card(child: ListTile(title: Text('No fraud alerts recorded.'))),
                          ..._alerts.map((alert) {
                            final id = '${alert['id'] ?? ''}';
                            final resolved = AdminFraudPolicy.isResolved(alert);
                            final userProfile = alert['user'] is Map
                                ? Map<String, dynamic>.from(alert['user'] as Map)
                                : <String, dynamic>{};
                            final severity = AdminFraudPolicy.severityLabel(alert['severity']);
                            return Card(
                              margin: const EdgeInsets.only(bottom: 8),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          resolved
                                              ? Icons.check_circle_outline_rounded
                                              : Icons.warning_amber_rounded,
                                          color: resolved
                                              ? Colors.green
                                              : Theme.of(context).colorScheme.error,
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            '${alert['alert_type'] ?? 'Fraud alert'}',
                                            style: Theme.of(context)
                                                .textTheme
                                                .titleMedium
                                                ?.copyWith(fontWeight: FontWeight.w800),
                                          ),
                                        ),
                                        Chip(label: Text(severity)),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Text('Account: @${userProfile['username'] ?? 'unknown'}'),
                                    Text(
                                      'Created: ${alert['created_at'] ?? 'unknown'}',
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                    if (alert['details'] != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 8),
                                        child: SelectableText('${alert['details']}', maxLines: 5),
                                      ),
                                    Align(
                                      alignment: Alignment.centerRight,
                                      child: FilledButton.tonalIcon(
                                        onPressed: resolved || _busy.contains(id)
                                            ? null
                                            : () => _resolve(alert),
                                        icon: _busy.contains(id)
                                            ? const SizedBox.square(
                                                dimension: 16,
                                                child: CircularProgressIndicator(strokeWidth: 2),
                                              )
                                            : Icon(resolved
                                                ? Icons.check_rounded
                                                : Icons.done_all_rounded),
                                        label: Text(resolved ? 'Resolved' : 'Mark resolved'),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
    );
  }

  Widget _empty(BuildContext context, IconData icon, String title, String body, Widget action) =>
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
