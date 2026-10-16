import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'ad_performance_policy.dart';

/// Platform-ad-admin comparison based on recorded ZenAd slot/impression/event
/// contracts. RLS is the authorization boundary; errors fail closed.
class AdPerformancePage extends StatefulWidget {
  const AdPerformancePage({super.key});

  @override
  State<AdPerformancePage> createState() => _AdPerformancePageState();
}

class _AdPerformancePageState extends State<AdPerformancePage> {
  final SupabaseClient _db = Supabase.instance.client;
  String _range = '30d';
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _metrics = const [];
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    if (_db.auth.currentUser == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/auth');
      });
    } else {
      _load();
    }
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _readAll({
    required String table,
    required String columns,
    required DateTime start,
  }) async {
    const pageSize = 500;
    final all = <Map<String, dynamic>>[];
    for (var offset = 0; offset < 100000; offset += pageSize) {
      final rows = await _db
          .from(table)
          .select(columns)
          .gte('created_at', start.toUtc().toIso8601String())
          .order('created_at', ascending: true)
          .order('id', ascending: true)
          .range(offset, offset + pageSize - 1)
          .timeout(const Duration(seconds: 20));
      final page = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      all.addAll(page);
      if (page.length < pageSize) return all;
    }
    throw StateError(
      'The selected range is too large to load safely. Narrow the range.',
    );
  }

  Future<void> _load() async {
    final generation = ++_generation;
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to continue.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final adminResponse = await _db
          .rpc('is_platform_ad_admin')
          .timeout(const Duration(seconds: 12));
      if (adminResponse != true) {
        throw StateError('Platform ad administrator access is required.');
      }
      final days = int.parse(_range.replaceAll('d', ''));
      final start = DateTime.now().toUtc().subtract(Duration(days: days));
      // The ZenAd RLS policies remain the final authorization boundary.
      final results = await Future.wait<dynamic>([
        _db
            .from('zenad_slots')
            .select('id,app_id,code,kind,enabled')
            .eq('enabled', true)
            .order('code')
            .timeout(const Duration(seconds: 20)),
        _readAll(
          table: 'zenad_impressions',
          columns: 'id,impression_id,slot_code,billable_micros,created_at',
          start: start,
        ),
        _readAll(
          table: 'zenad_events',
          columns: 'id,impression_id,event_type,created_at',
          start: start,
        ),
      ]).timeout(const Duration(seconds: 90));
      final slots = (results[0] as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      final impressions = (results[1] as List).cast<Map<String, dynamic>>();
      final events = (results[2] as List).cast<Map<String, dynamic>>();
      final ids = events
          .where((event) => event['event_type'] == 'click')
          .map((event) => '${event['impression_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet();
      final metrics = AdPerformancePolicy.aggregate(
        slots: slots,
        impressions: impressions,
        clickedImpressionIds: ids,
      );
      if (!mounted || generation != _generation) return;
      setState(() {
        _metrics = metrics;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _metrics = const [];
          _error = 'Ad performance is unavailable. Confirm platform ad-admin access and retry.';
        });
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  String _number(dynamic value) => AdPerformancePolicy.asInt(value).toString();
  String _moneyMicros(dynamic value) =>
      'KES ${AdPerformancePolicy.revenueKesFromMicros(AdPerformancePolicy.asInt(value)).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final totalImpressions = _metrics.fold<int>(
      0,
      (sum, row) => sum + AdPerformancePolicy.asInt(row['impressions']),
    );
    final totalClicks = _metrics.fold<int>(
      0,
      (sum, row) => sum + AdPerformancePolicy.asInt(row['clicks']),
    );
    final totalMicros = _metrics.fold<int>(
      0,
      (sum, row) => sum + AdPerformancePolicy.asInt(row['spend_micros']),
    );
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ad Performance'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Recorded delivery metrics',
              style: theme.textTheme.headlineSmall,
            ),
            const SizedBox(height: 6),
            Text(
              'Spend is the sum of recorded billable micros. No estimated CPM/CPC revenue is shown.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: '7d', label: Text('7 days')),
                ButtonSegment(value: '30d', label: Text('30 days')),
                ButtonSegment(value: '90d', label: Text('90 days')),
              ],
              selected: {_range},
              onSelectionChanged: _loading
                  ? null
                  : (value) {
                      setState(() => _range = value.first);
                      _load();
                    },
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(36),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (!_loading && _error != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      const Icon(Icons.lock_outline, size: 36),
                      const SizedBox(height: 8),
                      Text(_error!, textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
            if (!_loading && _error == null) ...[
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _summaryCard(
                    'Impressions',
                    _number(totalImpressions),
                    Icons.visibility_outlined,
                  ),
                  _summaryCard('Clicks', _number(totalClicks), Icons.ads_click),
                  _summaryCard(
                    'CTR',
                    '${AdPerformancePolicy.ctr(impressions: totalImpressions, clicks: totalClicks).toStringAsFixed(2)}%',
                    Icons.trending_up,
                  ),
                  _summaryCard(
                    'Recorded spend',
                    'KES ${AdPerformancePolicy.revenueKesFromMicros(totalMicros).toStringAsFixed(2)}',
                    Icons.payments_outlined,
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                'Performance by placement',
                style: theme.textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              if (_metrics.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(18),
                    child: Text(
                      'No enabled placements or recorded impressions in this period.',
                    ),
                  ),
                ),
              ..._metrics.map(
                (row) => Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${row['code']}',
                                style: theme.textTheme.titleMedium,
                              ),
                            ),
                            Chip(label: Text('${row['kind']}')),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 18,
                          runSpacing: 8,
                          children: [
                            Text('Impressions: ${_number(row['impressions'])}'),
                            Text('Clicks: ${_number(row['clicks'])}'),
                            Text(
                              'CTR: ${(row['ctr'] as num).toStringAsFixed(2)}%',
                            ),
                            Text(
                              'Recorded spend: ${_moneyMicros(row['spend_micros'])}',
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _summaryCard(String label, String value, IconData icon) => SizedBox(
    width: 155,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon),
            const SizedBox(height: 8),
            Text(value, style: Theme.of(context).textTheme.titleLarge),
            Text(label, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
    ),
  );
}
