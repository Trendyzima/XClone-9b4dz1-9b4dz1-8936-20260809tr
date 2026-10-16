import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'podcast_analytics_policy.dart';

/// Native Flutter port of Podcast Analytics, backed by the existing recording,
/// tip, and per-user feature-unlock tables. All data remains subject to RLS.
class PodcastAnalyticsPage extends StatefulWidget {
  const PodcastAnalyticsPage({super.key});

  @override
  State<PodcastAnalyticsPage> createState() => _PodcastAnalyticsPageState();
}

class _PodcastAnalyticsPageState extends State<PodcastAnalyticsPage> {
  final SupabaseClient _db = Supabase.instance.client;
  List<Map<String, dynamic>> _recordings = const [];
  bool _loading = true;
  bool _locked = false;
  bool _featureResolved = false;
  String? _error;
  double _tipsEarned = 0;
  int _generation = 0;

  int get _listeners => _recordings.fold<int>(
    0,
    (sum, row) => sum + PodcastAnalyticsPolicy.asCount(row['listener_count']),
  );

  int get _duration =>
      _recordings.fold<int>(0, (sum, row) => sum + PodcastAnalyticsPolicy.asCount(row['duration']));

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
          _error = 'Sign in to view podcast analytics.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      var owner = false;
      try {
        owner = await _db.rpc('testagram_is_owner').timeout(const Duration(seconds: 10)) == true;
      } catch (_) {
        // Non-owner users are still evaluated using their explicit feature lock.
      }
      dynamic unlockRecord;
      try {
        unlockRecord = await _db
            .from('user_feature_unlocks')
            .select('is_locked')
            .eq('user_id', user.id)
            .eq('feature_key', 'podcast_analytics')
            .maybeSingle()
            .timeout(const Duration(seconds: 12));
      } catch (_) {
        // A missing row is the documented unlocked default; a failed lookup is
        // not equivalent to a missing row. Fail closed until access is known.
        if (mounted && generation == _generation) {
          setState(() {
            _featureResolved = true;
            _recordings = const [];
            _tipsEarned = 0;
            _error = 'Podcast analytics access could not be verified. Retry when connected.';
          });
        }
        return;
      }
      final locked = !owner && PodcastAnalyticsPolicy.isLocked(unlockRecord);
      if (locked) {
        if (mounted && generation == _generation) {
          setState(() {
            _locked = true;
            _featureResolved = true;
            _recordings = const [];
            _tipsEarned = 0;
          });
        }
        return;
      }

      final rows = await _db
          .from('space_recordings')
          .select(
            'id,title,duration,listener_count,created_at,audio_url,spaces(title,artwork_url,category,episode_number)',
          )
          .eq('user_id', user.id)
          .order('listener_count', ascending: false)
          .limit(50)
          .timeout(const Duration(seconds: 20));
      final recordings = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();

      var tipsEarned = 0.0;
      try {
        final since = DateTime.now().toUtc().subtract(const Duration(days: 30)).toIso8601String();
        final tips = await _db
            .from('tips')
            .select('amount')
            .eq('to_user_id', user.id)
            .gte('created_at', since)
            .limit(2000)
            .timeout(const Duration(seconds: 15));
        tipsEarned = tips.fold<double>(
          0,
          (sum, row) => sum + PodcastAnalyticsPolicy.asAmount((row as Map)['amount']),
        );
      } catch (_) {
        // Analytics remain useful if tip visibility is restricted by RLS.
      }
      if (!mounted || generation != _generation) return;
      setState(() {
        _locked = false;
        _featureResolved = true;
        _recordings = recordings;
        _tipsEarned = tipsEarned;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _error = 'Podcast analytics could not load. Retry when connected.';
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
        title: const Text('Podcast Analytics'),
        actions: [
          IconButton(
            tooltip: 'Refresh analytics',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && !_featureResolved
          ? const Center(child: CircularProgressIndicator())
          : user == null
          ? _emptyState(
              context,
              Icons.lock_outline_rounded,
              'Sign in required',
              'Sign in to view your podcast and recording performance.',
              action: FilledButton(
                onPressed: () => context.go('/auth'),
                child: const Text('Sign in'),
              ),
            )
          : _locked
          ? _emptyState(
              context,
              Icons.lock_outline_rounded,
              'Feature locked',
              'Podcast Analytics is locked for this account. Contact the platform owner to request access.',
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    'Your podcast performance',
                    style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Based on your latest 50 recordings and tips received in the last 30 days.',
                    style: theme.textTheme.bodyMedium,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    MaterialBanner(
                      content: Text(_error!),
                      actions: [TextButton(onPressed: _load, child: const Text('Retry'))],
                    ),
                  ],
                  const SizedBox(height: 16),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 1.7,
                    children: [
                      _metric(context, 'Listeners', '$_listeners', Icons.headphones_rounded),
                      _metric(
                        context,
                        'Total duration',
                        PodcastAnalyticsPolicy.formatDuration(_duration),
                        Icons.schedule_rounded,
                      ),
                      _metric(context, 'Episodes', '${_recordings.length}', Icons.podcasts_rounded),
                      _metric(
                        context,
                        'Tips · 30 days',
                        _tipsEarned.toStringAsFixed(2),
                        Icons.volunteer_activism_outlined,
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Text(
                    'Top recordings',
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  if (_recordings.isEmpty && _error == null)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(22),
                        child: Text('No recordings found for this account yet.'),
                      ),
                    ),
                  ..._recordings.map((recording) {
                    final space = recording['spaces'] is Map
                        ? Map<String, dynamic>.from(recording['spaces'] as Map)
                        : <String, dynamic>{};
                    final title = '${recording['title'] ?? space['title'] ?? 'Untitled recording'}';
                    final listeners = PodcastAnalyticsPolicy.asCount(recording['listener_count']);
                    final created = DateTime.tryParse('${recording['created_at'] ?? ''}');
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: const CircleAvatar(child: Icon(Icons.podcasts_rounded)),
                        title: Text(title, maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                          '${space['category'] ?? 'Podcast'} · ${PodcastAnalyticsPolicy.formatDuration(recording['duration'])}${created == null ? '' : ' · ${created.toLocal().toString().substring(0, 10)}'}',
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              '$listeners',
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text('listeners', style: theme.textTheme.labelSmall),
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

  Widget _metric(BuildContext context, String label, String value, IconData icon) => Card(
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 6),
          Text(
            value,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    ),
  );

  Widget _emptyState(
    BuildContext context,
    IconData icon,
    String title,
    String body, {
    Widget? action,
  }) => Center(
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
          if (action != null) ...[const SizedBox(height: 16), action],
        ],
      ),
    ),
  );
}
