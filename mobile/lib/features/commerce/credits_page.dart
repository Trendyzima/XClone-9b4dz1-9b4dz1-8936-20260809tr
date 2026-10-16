import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../migration_batch_policy.dart';

class CreditsPage extends StatefulWidget {
  const CreditsPage({super.key});
  @override
  State<CreditsPage> createState() => _CreditsPageState();
}

class _CreditsPageState extends State<CreditsPage> {
  final _db = Supabase.instance.client;
  int _credits = 0;
  int _streak = 0;
  DateTime? _lastClaim;
  List<Map<String, dynamic>> _history = [];
  bool _loading = true;
  bool _claiming = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to view your credits.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<dynamic>([
        _db.from('user_wallets').select('credits').eq('user_id', user.id).maybeSingle(),
        _db
            .from('daily_rewards')
            .select('streak_day,last_claimed_at')
            .eq('user_id', user.id)
            .maybeSingle(),
        _db
            .from('credit_transactions')
            .select('id,amount,reason,created_at')
            .eq('user_id', user.id)
            .order('created_at', ascending: false)
            .limit(30),
      ]).timeout(const Duration(seconds: 20));
      final wallet = results[0] as Map?;
      final reward = results[1] as Map?;
      final history = (results[2] as List).map((r) => Map<String, dynamic>.from(r as Map)).toList();
      if (mounted) {
        setState(() {
          _credits = (wallet?['credits'] as num?)?.toInt() ?? 0;
          _streak = (reward?['streak_day'] as num?)?.toInt() ?? 0;
          _lastClaim = DateTime.tryParse('${reward?['last_claimed_at'] ?? ''}');
          _history = history;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Credits could not load. Retry before claiming rewards.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _canClaim => MigrationBatchPolicy.canClaimDailyReward(lastClaimedAt: _lastClaim);

  Future<void> _claim() async {
    if (_claiming || !_canClaim) return;
    setState(() {
      _claiming = true;
      _error = null;
    });
    try {
      final result = await _db.rpc('claim_daily_reward').timeout(const Duration(seconds: 20));
      if (result is! Map || result['ok'] != true) {
        throw StateError('Reward claim was not accepted by the server.');
      }
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('+${result['credits_earned'] ?? 0} credits added')));
      }
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Daily reward was not confirmed. Refresh the balance before retrying.',
        );
      }
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Credits'),
          actions: [
            IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(22),
                        child: Column(
                          children: [
                            const Icon(Icons.monetization_on_outlined, size: 44),
                            const SizedBox(height: 8),
                            const Text('Your credit balance'),
                            Text(_credits.toString(),
                                style: Theme.of(context).textTheme.displaySmall),
                            Text('Daily streak: $_streak'),
                          ],
                        ),
                      ),
                    ),
                    if (_error != null)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.error_outline),
                          title: Text(_error!),
                          trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
                        ),
                      ),
                    FilledButton.icon(
                      onPressed: _claiming || !_canClaim ? null : _claim,
                      icon: _claiming
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.card_giftcard),
                      label: Text(
                        _claiming
                            ? 'Claiming…'
                            : _canClaim
                                ? 'Claim daily reward'
                                : 'Daily reward already claimed',
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text('Recent activity', style: Theme.of(context).textTheme.titleLarge),
                    if (_history.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(20),
                        child: Text('No credit transactions yet.'),
                      ),
                    for (final row in _history)
                      Card(
                        child: ListTile(
                          leading: Icon(
                            (row['amount'] as num? ?? 0) >= 0
                                ? Icons.add_circle_outline
                                : Icons.remove_circle_outline,
                          ),
                          title: Text('${row['reason'] ?? 'Credit transaction'}'),
                          subtitle: Text('${row['created_at'] ?? ''}'),
                          trailing: Text(
                            '${(row['amount'] as num?)?.toInt() ?? 0}',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
      );
}
