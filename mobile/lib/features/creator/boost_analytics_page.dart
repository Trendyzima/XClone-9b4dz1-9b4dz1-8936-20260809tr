import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class BoostAnalyticsPage extends StatefulWidget {
  const BoostAnalyticsPage({required this.postId, super.key});
  final String postId;
  @override
  State<BoostAnalyticsPage> createState() => _BoostAnalyticsPageState();
}

class _BoostAnalyticsPageState extends State<BoostAnalyticsPage> {
  final _db = Supabase.instance.client;
  final _amount = TextEditingController(text: '500');
  bool _loading = true, _busy = false;
  String? _error;
  Map<String, dynamic>? _boost, _post;
  List<Map<String, dynamic>> _campaigns = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  int _int(dynamic value) => int.tryParse('$value') ?? 0;
  double _kes(dynamic minor) => _int(minor) / 100;
  String _money(double amount) => 'KES ${amount.toStringAsFixed(2)}';

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) context.go('/auth');
      return;
    }
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final result = await Future.wait<dynamic>([
        _db
            .from('boosts')
            .select(
              'id,user_id,post_id,budget_minor,spent_minor,impressions,clicks,currency,status,boost_type,funding_source,credit_budget,credit_spent,created_at,starts_at,ends_at',
            )
            .eq('post_id', widget.postId)
            .eq('user_id', user.id)
            .order('created_at', ascending: false)
            .limit(1)
            .maybeSingle(),
        _db
            .from('posts')
            .select('id,content,image_url,video_url')
            .eq('id', widget.postId)
            .eq('user_id', user.id)
            .maybeSingle(),
        _db
            .from('boosts')
            .select(
              'id,post_id,budget_minor,spent_minor,impressions,clicks,currency,status,boost_type,funding_source,credit_budget,credit_spent,created_at',
            )
            .eq('user_id', user.id)
            .order('created_at', ascending: false)
            .limit(30),
      ]);
      if (!mounted) {
        return;
      }
      setState(() {
        _boost = result[0] == null
            ? null
            : Map<String, dynamic>.from(result[0] as Map);
        _post = result[1] == null
            ? null
            : Map<String, dynamic>.from(result[1] as Map);
        _campaigns = (result[2] as List)
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        _loading = false;
      });
      if (_boost == null && _post == null) {
        setState(
          () =>
              _error = 'No campaign or owned post was found for this address.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Boost analytics could not be loaded. Refresh to retry.';
        });
      }
    }
  }

  Future<void> _toggleStatus() async {
    final user = _db.auth.currentUser;
    final boost = _boost;
    if (user == null) {
      if (mounted) context.go('/auth');
      return;
    }
    if (boost == null || _busy) {
      return;
    }
    final current = '${boost['status'] ?? 'draft'}';
    final next = current == 'active' ? 'paused' : 'active';
    setState(() => _busy = true);
    try {
      final updated = await _db
          .from('boosts')
          .update({'status': next})
          .eq('id', boost['id'])
          .eq('user_id', user.id)
          .select(
            'id,user_id,post_id,budget_minor,spent_minor,impressions,clicks,currency,status,boost_type,funding_source,credit_budget,credit_spent,created_at,starts_at,ends_at',
          )
          .maybeSingle();
      if (updated == null) {
        throw StateError('Campaign update was not confirmed.');
      }
      if (mounted) {
        setState(() {
          _boost = Map<String, dynamic>.from(updated);
          _campaigns = _campaigns
              .map(
                (row) => row['id'] == updated['id']
                    ? Map<String, dynamic>.from(updated)
                    : row,
              )
              .toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              next == 'active' ? 'Campaign resumed.' : 'Campaign paused.',
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Campaign status could not be changed. Check permissions and retry.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _addBudget() async {
    final user = _db.auth.currentUser;
    final boost = _boost;
    if (user == null) {
      if (mounted) context.go('/auth');
      return;
    }
    if (boost == null ||
        _busy ||
        '${boost['funding_source'] ?? 'wallet'}' == 'credits') {
      return;
    }
    final kes = double.tryParse(_amount.text.trim());
    if (kes == null || !kes.isFinite || kes < 100 || kes > 10000000) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Enter a valid amount between KES 100 and KES 10,000,000.',
          ),
        ),
      );
      return;
    }
    final minor = (kes * 100).round();
    setState(() => _busy = true);
    try {
      final updated = await _db.rpc(
        'add_boost_budget',
        params: {'p_boost_id': boost['id'], 'p_amount_minor': minor},
      );
      if (updated == null) {
        throw StateError('Budget top-up was not confirmed.');
      }
      if (mounted) {
        await _load();
        if (!mounted) {
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${_money(kes)} added from your wallet.')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Budget was not added. Check your wallet balance and retry.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final boost = _boost;
    final budget = _kes(boost?['budget_minor']);
    final spent = _kes(boost?['spent_minor']);
    final impressions = _int(boost?['impressions']);
    final clicks = _int(boost?['clicks']);
    final ctr = impressions == 0 ? 0.0 : clicks / impressions * 100;
    final credits = '${boost?['funding_source'] ?? 'wallet'}' == 'credits';
    final creditBudget = _int(boost?['credit_budget']);
    final creditSpent = _int(boost?['credit_spent']);
    final progress = budget <= 0 ? 0.0 : (spent / budget).clamp(0.0, 1.0);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Boost analytics'),
        actions: [
          IconButton(
            onPressed: _load,
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading) const LinearProgressIndicator(),
            if (_error != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.info_outline),
                  title: Text(_error!),
                  trailing: IconButton(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh),
                  ),
                ),
              ),
            if (!_loading && boost == null && _error != null)
              const SizedBox(height: 180),
            if (boost != null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${boost['status'] ?? 'Campaign'}'.toUpperCase(),
                              style: theme.textTheme.labelLarge?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          const Icon(Icons.campaign_outlined),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${_post?['content'] ?? 'Boost campaign'}',
                        maxLines: 4,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Objective: ${boost['boost_type'] ?? boost['target_type'] ?? 'promotion'}',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 16),
                      LinearProgressIndicator(value: progress),
                      const SizedBox(height: 6),
                      Text(
                        credits
                            ? '$creditSpent of $creditBudget credits used'
                            : '${_money(spent)} spent of ${_money(budget)} funded',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Created ${boost['created_at'] ?? 'date unavailable'}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 2,
                childAspectRatio: 1.7,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                children: [
                  _metric(
                    'Impressions',
                    '$impressions',
                    Icons.visibility_outlined,
                  ),
                  _metric('Clicks', '$clicks', Icons.ads_click),
                  _metric(
                    'Click-through rate',
                    '${ctr.toStringAsFixed(2)}%',
                    Icons.trending_up,
                  ),
                  _metric(
                    credits ? 'Credit budget' : 'Funded budget',
                    credits ? '$creditBudget credits' : _money(budget),
                    Icons.account_balance_wallet_outlined,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Campaign controls',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _toggleStatus,
                            icon: Icon(
                              '${boost['status']}' == 'active'
                                  ? Icons.pause
                                  : Icons.play_arrow,
                            ),
                            label: Text(
                              '${boost['status']}' == 'active'
                                  ? 'Pause campaign'
                                  : 'Resume campaign',
                            ),
                          ),
                          if (!credits)
                            SizedBox(
                              width: 140,
                              child: TextField(
                                controller: _amount,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                  decimal: true,
                                ),
                                decoration: const InputDecoration(
                                  labelText: 'Top-up (KES)',
                                  border: OutlineInputBorder(),
                                ),
                              ),
                            ),
                          if (!credits)
                            FilledButton.icon(
                              onPressed: _busy ? null : _addBudget,
                              icon: const Icon(Icons.add),
                              label: const Text('Add budget'),
                            ),
                        ],
                      ),
                      if (credits)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            'This campaign is credit-funded. Wallet top-up is disabled to avoid charging the wrong funding source.',
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              'Your campaigns',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            if (_campaigns.isEmpty && !_loading)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('No other campaigns found.'),
                ),
              ),
            for (final campaign in _campaigns)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.campaign_outlined),
                  title: Text('${campaign['boost_type'] ?? 'Campaign'}'),
                  subtitle: Text(
                    '${campaign['status'] ?? 'unknown'} • ${campaign['impressions'] ?? 0} impressions • ${campaign['created_at'] ?? ''}',
                  ),
                  trailing: Text(
                    campaign['funding_source'] == 'credits'
                        ? '${campaign['credit_budget'] ?? 0} credits'
                        : _money(_kes(campaign['budget_minor'])),
                  ),
                  onTap: campaign['post_id'] == null
                      ? null
                      : () => context.go(
                            '/boost-analytics/${campaign['post_id']}',
                          ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _metric(String label, String value, IconData icon) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 20),
              const SizedBox(height: 6),
              Text(
                value,
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              Text(
                label,
                style: const TextStyle(fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      );
}
