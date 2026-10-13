/// Pure aggregation rules for the platform ad-performance comparison.
/// Revenue is derived only from recorded billable micros; no CPM/CPC estimates.
class AdPerformancePolicy {
  const AdPerformancePolicy._();

  static int asInt(dynamic value) {
    if (value is int) return value < 0 ? 0 : value;
    if (value is num) return value < 0 ? 0 : value.round();
    final parsed = int.tryParse('$value');
    return parsed == null || parsed < 0 ? 0 : parsed;
  }

  static double ctr({required int impressions, required int clicks}) =>
      impressions <= 0 ? 0 : clicks.clamp(0, impressions) * 100 / impressions;

  static double revenueKesFromMicros(int micros) =>
      (micros < 0 ? 0 : micros) / 1000000;

  static List<Map<String, dynamic>> aggregate({
    required List<Map<String, dynamic>> slots,
    required List<Map<String, dynamic>> impressions,
    required Set<String> clickedImpressionIds,
  }) {
    final bySlot = <String, List<Map<String, dynamic>>>{};
    for (final impression in impressions) {
      final code = '${impression['slot_code'] ?? ''}';
      if (code.isNotEmpty) (bySlot[code] ??= []).add(impression);
    }
    final result = <Map<String, dynamic>>[];
    for (final slot in slots) {
      final code = '${slot['code'] ?? ''}';
      if (code.isEmpty) continue;
      final rows = bySlot[code] ?? const <Map<String, dynamic>>[];
      final clicks = rows
          .where((row) =>
              clickedImpressionIds.contains('${row['impression_id'] ?? ''}'))
          .length;
      final spendMicros =
          rows.fold<int>(0, (sum, row) => sum + asInt(row['billable_micros']));
      result.add({
        'code': code,
        'kind': '${slot['kind'] ?? 'unknown'}',
        'impressions': rows.length,
        'clicks': clicks,
        'spend_micros': spendMicros,
        'revenue_kes': revenueKesFromMicros(spendMicros),
        'ctr': ctr(impressions: rows.length, clicks: clicks),
      });
    }
    result.sort((a, b) =>
        (b['spend_micros'] as int).compareTo(a['spend_micros'] as int));
    return result;
  }
}
