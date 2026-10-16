import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Referral dashboard backed by the canonical referral RPCs.
class ReferralPage extends StatefulWidget {
  const ReferralPage({super.key});

  @override
  State<ReferralPage> createState() => _ReferralPageState();
}

class _ReferralPageState extends State<ReferralPage> {
  final _client = Supabase.instance.client;
  String? _code;
  String? _error;
  bool _loading = true;
  int _credits = 0;
  List<Map<String, dynamic>> _referrals = const [];
  List<Map<String, dynamic>> _leaders = const [];

  String get _link => 'https://testagram.site/auth?ref=${Uri.encodeComponent(_code ?? '')}';

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
    if (_client.auth.currentUser == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to manage referrals.';
      });
      return;
    }
    try {
      final code = await _client.rpc('ensure_referral_code');
      final status = await _client.rpc('get_referral_status');
      final referrals = await _client.rpc('list_referrals');
      final leaders = await _client.rpc('referral_leaderboard');
      if (!mounted) return;
      setState(() {
        _code = code?.toString();
        _credits = status is Map ? int.tryParse('${status['earned_credits'] ?? 0}') ?? 0 : 0;
        _referrals = referrals is Map && referrals['items'] is List
            ? (referrals['items'] as List)
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList()
            : const [];
        _leaders = leaders is Map && leaders['items'] is List
            ? (leaders['items'] as List)
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .take(10)
                  .toList()
            : const [];
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Referral details are unavailable. Check your connection and retry.';
      });
    }
  }

  Future<void> _copy() async {
    if (_code == null || _code!.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: _link));
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Referral link copied')));
    }
  }

  Future<void> _share() async {
    if (_code == null || _code!.isEmpty) return;
    await Share.share('Join me on Testagram. Use my referral link: $_link');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Refer & earn',
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          const Text(
            'Invite friends. Referral rewards are confirmed by Testagram’s server, not by this screen.',
          ),
          const SizedBox(height: 16),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(_error!),
                trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Credits earned', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(
                    '$_credits',
                    style: theme.textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 12),
                  Text('Your code: ${_code ?? (_loading ? 'Loading…' : 'Unavailable')}'),
                  const SizedBox(height: 12),
                  SelectableText(_link, style: theme.textTheme.bodySmall),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _code == null ? null : _copy,
                        icon: const Icon(Icons.copy),
                        label: const Text('Copy link'),
                      ),
                      FilledButton.icon(
                        onPressed: _code == null ? null : _share,
                        icon: const Icon(Icons.share),
                        label: const Text('Share'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text('Your referrals', style: theme.textTheme.titleLarge),
          if (!_loading && _referrals.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text('No referrals yet. Share your link to get started.'),
              ),
            ),
          for (final item in _referrals)
            Card(
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                title: Text('${item['username'] ?? item['invited_user'] ?? 'New member'}'),
                subtitle: Text('Joined ${item['created_at'] ?? 'recently'}'),
                trailing: Text('+${item['credits_awarded'] ?? 0}'),
              ),
            ),
          const SizedBox(height: 12),
          Text('Referral leaderboard', style: theme.textTheme.titleLarge),
          if (!_loading && _leaders.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(18),
                child: Text('Leaderboard data is not available yet.'),
              ),
            ),
          for (var i = 0; i < _leaders.length; i++)
            Card(
              child: ListTile(
                leading: CircleAvatar(child: Text('${i + 1}')),
                title: Text('@${_leaders[i]['username'] ?? 'member'}'),
                subtitle: Text(
                  '${_leaders[i]['count'] ?? _leaders[i]['referrals'] ?? 0} referrals',
                ),
                trailing: Text('${_leaders[i]['credits'] ?? 0} credits'),
              ),
            ),
        ],
      ),
    );
  }
}
