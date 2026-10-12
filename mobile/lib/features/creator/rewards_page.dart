import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Reward history and daily claim UI. Reward amounts are always issued by RPC.
class RewardsPage extends StatefulWidget {
  const RewardsPage({super.key});

  @override
  State<RewardsPage> createState() => _RewardsPageState();
}

class _RewardsPageState extends State<RewardsPage> {
  final _client = Supabase.instance.client;
  bool _loading = true;
  bool _claiming = false;
  String? _error;
  int _credits = 0;
  int _streak = 0;
  DateTime? _lastClaim;
  List<Map<String, dynamic>> _events = const [];

  bool get _canClaim {
    final last = _lastClaim;
    if (last == null) return true;
    final now = DateTime.now().toUtc();
    final utc = last.toUtc();
    return utc.year != now.year || utc.month != now.month || utc.day != now.day;
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final user = _client.auth.currentUser;
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to view rewards.';
      });
      return;
    }
    try {
      final results = await Future.wait<dynamic>([
        _client
            .from('reward_events')
            .select('id,reward_type,amount_minor,currency,source,created_at')
            .eq('user_id', user.id)
            .order('created_at', ascending: false)
            .limit(100),
        _client
            .from('user_wallets')
            .select('credits')
            .eq('user_id', user.id)
            .maybeSingle(),
        _client
            .from('daily_rewards')
            .select('streak_day,last_claimed_at')
            .eq('user_id', user.id)
            .maybeSingle(),
      ]);
      final wallet = results[1] as Map<String, dynamic>?;
      final daily = results[2] as Map<String, dynamic>?;
      if (!mounted) return;
      setState(() {
        _events = (results[0] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _credits = int.tryParse('${wallet?['credits'] ?? 0}') ?? 0;
        _streak = int.tryParse('${daily?['streak_day'] ?? 0}') ?? 0;
        _lastClaim = DateTime.tryParse('${daily?['last_claimed_at'] ?? ''}');
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error =
            'Rewards could not be loaded. Check your connection and retry.';
      });
    }
  }

  Future<void> _claim() async {
    if (_claiming || !_canClaim || _client.auth.currentUser == null) return;
    setState(() {
      _claiming = true;
      _error = null;
    });
    try {
      final response = await _client.rpc('claim_daily_reward');
      final data =
          response is List && response.isNotEmpty ? response.first : response;
      if (data is Map && data['ok'] == false)
        throw StateError('The daily reward was not accepted.');
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Daily reward claimed. Refreshing your balance…'),
          ),
        );
      await _load();
    } catch (_) {
      if (mounted)
        setState(
          () => _error =
              'Reward claim was not confirmed. Refresh before trying again.',
        );
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = _events.fold<int>(
      0,
      (sum, event) =>
          sum + (int.tryParse('${event['amount_minor'] ?? 0}') ?? 0),
    );
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Rewards & earnings',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 14),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Available credits'),
                  const SizedBox(height: 6),
                  Text(
                    _loading ? '—' : _credits.toString(),
                    style: theme.textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text('Daily streak: $_streak day${_streak == 1 ? '' : 's'}'),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed:
                          _loading || _claiming || !_canClaim ? null : _claim,
                      icon: _claiming
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.card_giftcard),
                      label: Text(
                        _canClaim
                            ? 'Claim daily reward'
                            : 'Already claimed today',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.stars_outlined),
              title: const Text('Lifetime reward credits'),
              subtitle: const Text('Sum of the recorded reward events'),
              trailing: Text('$total'),
            ),
          ),
          const SizedBox(height: 10),
          Text('Reward history', style: theme.textTheme.titleLarge),
          if (!_loading && _events.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text('Your reward history will appear here.'),
              ),
            ),
          for (final event in _events)
            Card(
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.card_giftcard)),
                title: Text('${event['reward_type'] ?? 'Reward'}'),
                subtitle: Text(
                  '${event['source'] ?? 'Testagram'} • ${event['created_at'] ?? ''}',
                ),
                trailing: Text(
                  '${event['amount_minor'] ?? 0} ${event['currency'] ?? 'credits'}',
                ),
              ),
            ),
        ],
      ),
    );
  }
}
