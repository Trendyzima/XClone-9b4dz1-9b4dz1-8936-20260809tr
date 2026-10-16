import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../migration_batch_policy.dart';

class PremiumPage extends StatefulWidget {
  const PremiumPage({super.key, this.returnToken});
  final String? returnToken;
  @override
  State<PremiumPage> createState() => _PremiumPageState();
}

class _PremiumPageState extends State<PremiumPage> {
  final _db = Supabase.instance.client;
  Map<String, dynamic> _status = {'is_active': false};
  bool _loading = true;
  bool _busy = false;
  String _plan = 'annual';
  String? _error;
  @override
  void initState() {
    super.initState();
    _refresh();
    if (widget.returnToken != null && widget.returnToken!.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _capture(widget.returnToken!));
    }
  }

  Future<void> _refresh() async {
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to manage Premium.';
        });
      }
      return;
    }
    try {
      final result = await _db.rpc('get_my_premium_status').timeout(const Duration(seconds: 15));
      if (result is! Map) throw StateError('Invalid Premium status response');
      if (mounted) {
        setState(() {
          _status = Map<String, dynamic>.from(result);
          _error = null;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Premium status could not be verified. Retry before making a payment.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _subscribe() async {
    if (_db.auth.currentUser == null) {
      setState(() => _error = 'Sign in before starting checkout.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _db.functions.invoke('premium-paypal-create-order',
          body: {'plan': _plan}).timeout(const Duration(seconds: 25));
      final data = result.data;
      if (result.status < 200 || result.status >= 300 || data is! Map || data['error'] != null) {
        throw StateError(
          data is Map
              ? '${data['error'] ?? 'Checkout could not be started'}'
              : 'Checkout response was invalid.',
        );
      }
      final url = Uri.tryParse('${data['approvalUrl'] ?? ''}');
      if (!MigrationBatchPolicy.isValidPremiumApprovalUrl(url)) {
        throw StateError('Secure payment approval URL was not returned.');
      }
      final launched = await launchUrl(url!, mode: LaunchMode.externalApplication);
      if (!launched) {
        throw StateError('Could not open the secure payment page.');
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => _error =
              e is StateError ? e.message : 'Could not start secure checkout. Please retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _capture(String orderId) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _db.functions.invoke('premium-paypal-capture-order',
          body: {'orderId': orderId}).timeout(const Duration(seconds: 30));
      final data = result.data;
      if (result.status < 200 || result.status >= 300 || data is Map && data['error'] != null) {
        throw StateError(
          data is Map ? '${data['error'] ?? 'Payment capture failed'}' : 'Payment capture failed.',
        );
      }
      await _refresh();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Payment could not be verified. Your Premium status was not changed locally. Refresh after checkout or contact support.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel Premium?'),
        content: const Text('Benefits may remain active until the current period ends.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel subscription'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result =
          await _db.rpc('cancel_premium_subscription').timeout(const Duration(seconds: 15));
      if (result != true) {
        throw StateError('No active subscription was cancelled.');
      }
      await _refresh();
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Subscription could not be cancelled. Refresh status and retry.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = _status['is_active'] == true;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Testagram Premium'),
        actions: [
          IconButton(onPressed: _loading ? null : _refresh, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(22),
                      child: Column(
                        children: [
                          const Icon(Icons.workspace_premium, size: 54),
                          const SizedBox(height: 8),
                          Text(
                            active ? 'Premium active' : 'Upgrade to Premium',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            active
                                ? '${_status['plan'] ?? 'Active'} plan · expires ${_status['expires_at'] ?? 'as confirmed by the server'}'
                                : 'Secure checkout · server-verified entitlement',
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_error != null)
                    Card(
                      child: ListTile(
                        leading: const Icon(Icons.error_outline),
                        title: Text(_error!),
                        trailing: IconButton(onPressed: _refresh, icon: const Icon(Icons.refresh)),
                      ),
                    ),
                  if (!active) ...[
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'monthly', label: Text('Monthly · USD 4.99')),
                        ButtonSegment(value: 'annual', label: Text('Annual · USD 39.99')),
                      ],
                      selected: {_plan},
                      onSelectionChanged:
                          _busy ? null : (value) => setState(() => _plan = value.first),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _busy ? null : _subscribe,
                      icon: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.lock_outline),
                      label: Text(_busy ? 'Working…' : 'Continue to secure checkout'),
                    ),
                  ] else
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _cancel,
                      icon: const Icon(Icons.cancel_outlined),
                      label: const Text('Cancel subscription'),
                    ),
                  const SizedBox(height: 18),
                  const Text(
                    'Premium is activated only after the payment provider and server verify the transaction. This screen never grants entitlement from a client-side flag.',
                  ),
                ],
              ),
            ),
    );
  }
}
