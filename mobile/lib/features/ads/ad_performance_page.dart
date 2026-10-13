import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class AdPerformancePage extends StatefulWidget {
  const AdPerformancePage({super.key});
  @override
  State<AdPerformancePage> createState() => _AdPerformancePageState();
}

class _AdPerformancePageState extends State<AdPerformancePage> {
  final _db = Supabase.instance.client;
  bool _loading = true, _denied = false, _capped = false;
  String? _error;
  int _days = 30;
  List<Map<String, dynamic>> _placements = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

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
        _denied = false;
        _capped = false;
      });
    }
    try {
      final admin = await _db
          .from('admin_users')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
      if (admin == null) {
        if (mounted) {
          setState(() {
            _loading = false;
            _denied = true;
          });
        }
        return;
      }
      final placementRows = await _db
          .from('ad_placements')
          .select('id,location,placement_type,is_active')
          .eq('is_active', true)
          .order('location');
      final placements =
          placementRows.map((row) => Map<String, dynamic>.from(row)).toList();
      final ids = placements.map((row) => '${row['id']}').toList();
      final counts = <String, Map<String, int>>{};
      for (final id in ids) {
        counts[id] = {'impressions': 0, 'clicks': 0};
      }
      if (ids.isNotEmpty) {
        final since = DateTime.now()
            .subtract(Duration(days: _days))
            .toUtc()
            .toIso8601String();
        final events = await _db
            .from('ad_impressions')
            .select('ad_id,clicked,created_at')
            .inFilter('ad_id', ids)
            .gte('created_at', since)
            .order('created_at', ascending: false)
            .limit(5000);
        _capped = events.length >= 5000;
        for (final event in events) {
          final id = '${event['ad_id']}';
          final count = counts[id];
          if (count == null) {
            continue;
          }
          count['impressions'] = count['impressions']! + 1;
          if (event['clicked'] == true) {
            count['clicks'] = count['clicks']! + 1;
          }
        }
      }
      final result = placements.map((placement) {
        final id = '${placement['id']}';
        final count = counts[id] ?? const {'impressions': 0, 'clicks': 0};
        final impressions = count['impressions'] ?? 0;
        final clicks = count['clicks'] ?? 0;
        return {
          ...placement,
          'impressions': impressions,
          'clicks': clicks,
          'ctr': impressions == 0 ? 0.0 : clicks / impressions * 100.0
        };
      }).toList();
      result.sort((a, b) =>
          (b['impressions'] as int).compareTo(a['impressions'] as int));
      if (mounted) {
        setState(() {
          _placements = result;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error =
              'Ad placement performance could not be loaded. Confirm administrator access and retry.';
        });
      }
    }
  }

  int _total(String key) =>
      _placements.fold<int>(0, (sum, row) => sum + (row[key] as int? ?? 0));
  String _label(Map<String, dynamic> row) =>
      '${row['location'] ?? 'Unknown placement'}'.replaceAll('_', ' ');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final impressions = _total('impressions');
    final clicks = _total('clicks');
    final ctr = impressions == 0 ? 0.0 : clicks / impressions * 100;
    final bestCtr = _placements.isEmpty
        ? null
        : _placements.reduce(
            (a, b) => (a['ctr'] as double) >= (b['ctr'] as double) ? a : b);
    return Scaffold(
      appBar: AppBar(title: const Text('Ad performance'), actions: [
        IconButton(
            onPressed: _load,
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh))
      ]),
      body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Text('Placement comparison',
                style: theme.textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            const Text(
                'Administrator-only report. CTR uses recorded impression and click events. Revenue is intentionally omitted because this event feed does not provide a verified settlement amount.'),
            const SizedBox(height: 12),
            SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 7, label: Text('7 days')),
                  ButtonSegment(value: 30, label: Text('30 days')),
                  ButtonSegment(value: 90, label: Text('90 days'))
                ],
                selected: {
                  _days
                },
                onSelectionChanged: (value) {
                  setState(() => _days = value.first);
                  _load();
                }),
            const SizedBox(height: 12),
            if (_loading) const LinearProgressIndicator(),
            if (_denied)
              const Card(
                  child: ListTile(
                      leading: Icon(Icons.lock_outline),
                      title: Text('Administrator access required'),
                      subtitle: Text(
                          'This report is available to authorized platform administrators only.'))),
            if (_error != null)
              Card(
                  child: ListTile(
                      leading: const Icon(Icons.error_outline),
                      title: Text(_error!),
                      trailing: IconButton(
                          onPressed: _load, icon: const Icon(Icons.refresh)))),
            if (!_loading && !_denied && _error == null) ...[
              if (_capped)
                const Card(
                    child: ListTile(
                        leading: Icon(Icons.info_outline),
                        title: Text('Event sample limit reached'),
                        subtitle: Text(
                            'The report read the first 5,000 matching events. Totals may be lower than the complete period; narrow the date range to inspect a smaller window.'))),
              GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisCount: 2,
                  childAspectRatio: 1.7,
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                  children: [
                    _metric('Recorded impressions', '$impressions',
                        Icons.visibility_outlined),
                    _metric('Recorded clicks', '$clicks', Icons.ads_click),
                    _metric('Overall CTR', '${ctr.toStringAsFixed(2)}%',
                        Icons.trending_up),
                    _metric(
                        'Best placement CTR',
                        bestCtr == null
                            ? '—'
                            : '${(bestCtr['ctr'] as double).toStringAsFixed(2)}%',
                        Icons.emoji_events_outlined),
                  ]),
              const SizedBox(height: 12),
              Text('Active placements',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
              if (_placements.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No active ad placements were found.'))),
              for (final placement in _placements)
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(children: [
                                Expanded(
                                    child: Text(_label(placement),
                                        style: theme.textTheme.titleMedium
                                            ?.copyWith(
                                                fontWeight: FontWeight.w700))),
                                Text(
                                    '${(placement['ctr'] as double).toStringAsFixed(2)}%',
                                    style: theme.textTheme.titleMedium
                                        ?.copyWith(fontWeight: FontWeight.w800))
                              ]),
                              const SizedBox(height: 4),
                              Text(
                                  '${placement['placement_type'] ?? 'Placement'} • ${placement['impressions']} impressions • ${placement['clicks']} clicks',
                                  style: theme.textTheme.bodySmall),
                              const SizedBox(height: 8),
                              LinearProgressIndicator(
                                  value: (placement['ctr'] as double)
                                          .clamp(0, 100) /
                                      100),
                            ]))),
            ],
          ])),
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
                Text(value,
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w800),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                Text(label,
                    style: const TextStyle(fontSize: 12),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis)
              ])));
}
