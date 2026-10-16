import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'ad_review_policy.dart';

/// Review queue for the Testagram-owned ad campaign contract. Moderation and
/// activation are server-side; approval never bypasses payment settlement.
class AdReviewPage extends StatefulWidget {
  const AdReviewPage({super.key});

  @override
  State<AdReviewPage> createState() => _AdReviewPageState();
}

class _AdReviewPageState extends State<AdReviewPage> {
  final _db = Supabase.instance.client;
  final Map<String, TextEditingController> _notes = {};
  List<Map<String, dynamic>> _campaigns = const [];
  bool _loading = true;
  bool _authorized = false;
  String _filter = 'pending';
  String? _error;
  String? _busyId;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _generation++;
    for (final controller in _notes.values) {
      controller.dispose();
    }
    super.dispose();
  }

  TextEditingController _noteFor(String id) => _notes.putIfAbsent(id, TextEditingController.new);

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _authorized = false;
      _campaigns = const [];
      _error = null;
    });
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to access ad review.';
        });
      }
      return;
    }
    try {
      final governance =
          await _db.rpc('testagram_get_governance').timeout(const Duration(seconds: 12));
      final state = governance is Map ? Map<String, dynamic>.from(governance) : <String, dynamic>{};
      final permissions = state['permissions'] is List
          ? (state['permissions'] as List).map((v) => '$v').toSet()
          : <String>{};
      final allowed = state['is_owner'] == true || permissions.contains('platform.ads');
      if (!allowed) {
        if (mounted && generation == _generation) {
          setState(() {
            _authorized = false;
            _loading = false;
          });
        }
        return;
      }
      final result = await _db.rpc('testagram_admin_list_ad_review_queue',
          params: {'p_status': _filter}).timeout(const Duration(seconds: 15));
      final rows = result is List
          ? result.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList()
          : <Map<String, dynamic>>[];
      if (!mounted || generation != _generation) return;
      setState(() {
        _authorized = true;
        _campaigns = rows;
        _loading = false;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _error = 'Ad review queue could not load. Verify your role and retry.';
        });
      }
    }
  }

  Future<void> _changeFilter(String filter) async {
    if (!AdReviewPolicy.filters.contains(filter) || _filter == filter) {
      return;
    }
    setState(() => _filter = filter);
    await _load();
  }

  Future<void> _review(Map<String, dynamic> campaign, String decision) async {
    final id = '${campaign['campaign_id'] ?? ''}';
    final note = _noteFor(id).text.trim();
    if (!AdReviewPolicy.canReview(
      authorized: _authorized,
      busy: _busyId != null,
      status: '${campaign['moderation_status'] ?? ''}',
    )) {
      return;
    }
    if (decision == 'rejected' && !AdReviewPolicy.canReject(note)) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Enter a rejection reason (1–500 characters).')));
      return;
    }
    if (decision != 'approved' && decision != 'rejected') {
      return;
    }
    setState(() {
      _busyId = id;
      _error = null;
    });
    try {
      final result = await _db.rpc(
        'testagram_admin_review_ad_campaign',
        params: {
          'p_campaign_id': id,
          'p_decision': decision,
          'p_note': note.isEmpty ? null : note,
        },
      ).timeout(const Duration(seconds: 20));
      final resultMap = result is Map ? Map<String, dynamic>.from(result) : <String, dynamic>{};
      if (mounted) {
        final campaignStatus = '${resultMap['campaign_status'] ?? 'updated'}';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              decision == 'approved' && campaignStatus == 'pending_payment'
                  ? 'Approved; payment is still required before serving.'
                  : 'Campaign $decision. Resulting status: $campaignStatus.',
            ),
          ),
        );
      }
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Review was rejected. Verify your advertising role and complete MFA verification, then retry.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busyId = null);
      }
    }
  }

  Future<void> _openCreative(String value) async {
    final uri = Uri.tryParse(value);
    if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http') || uri.host.isEmpty) {
      return;
    }
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ad review'),
        actions: [
          IconButton(
            tooltip: 'Refresh queue',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!),
                        const SizedBox(height: 12),
                        FilledButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : !_authorized
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.lock_outline, size: 44),
                            SizedBox(height: 12),
                            Text('Advertising administration permission required.'),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          const Card(
                            child: Padding(
                              padding: EdgeInsets.all(16),
                              child: Text(
                                'Campaign review is server-authorized. Approval does not mark a campaign paid: serving is only enabled after verified funding. Review actions require an MFA-verified session.',
                              ),
                            ),
                          ),
                          Wrap(
                            spacing: 8,
                            children: [
                              for (final filter in AdReviewPolicy.filters)
                                ChoiceChip(
                                  label: Text(filter[0].toUpperCase() + filter.substring(1)),
                                  selected: _filter == filter,
                                  onSelected: (_) => _changeFilter(filter),
                                ),
                            ],
                          ),
                          if (_campaigns.isEmpty)
                            const Padding(
                              padding: EdgeInsets.all(32),
                              child: Center(child: Text('No campaigns in this queue.')),
                            ),
                          for (final campaign in _campaigns) _campaignCard(campaign),
                        ],
                      ),
                    ),
    );
  }

  Widget _campaignCard(Map<String, dynamic> campaign) {
    final id = '${campaign['campaign_id'] ?? ''}';
    final payment = '${campaign['payment_status'] ?? 'unknown'}';
    final status = '${campaign['moderation_status'] ?? 'pending'}';
    final creativeUrl = '${campaign['click_through_url'] ?? ''}';
    return Card(
      margin: const EdgeInsets.only(top: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.campaign_outlined, size: 30),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${campaign['campaign_name'] ?? 'Unnamed campaign'}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(
                        '${campaign['advertiser_name'] ?? 'Advertiser'} · $status',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text('Objective: ${campaign['objective'] ?? 'traffic'}'),
            Text(
              'Budget: ${AdReviewPolicy.formatBudget(campaign['lifetime_budget_micros'], '${campaign['currency'] ?? 'KES'}')}',
            ),
            Text(
              'Payment: $payment · funded ${AdReviewPolicy.formatBudget(campaign['funded_micros'], '${campaign['currency'] ?? 'KES'}')}',
            ),
            if ('${campaign['headline'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${campaign['headline']}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
            if ('${campaign['creative_body'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('${campaign['creative_body']}'),
              ),
            if (creativeUrl.isNotEmpty)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _openCreative(creativeUrl),
                  icon: const Icon(Icons.open_in_new),
                  label: const Text('Open destination'),
                ),
              ),
            if (status == 'pending') ...[
              TextField(
                controller: _noteFor(id),
                maxLength: 500,
                maxLines: 2,
                decoration: const InputDecoration(
                  labelText: 'Review note (required for rejection)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: _busyId == null ? () => _review(campaign, 'approved') : null,
                    icon: const Icon(Icons.check_circle_outline),
                    label: const Text('Approve'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busyId == null ? () => _review(campaign, 'rejected') : null,
                    icon: const Icon(Icons.block),
                    label: const Text('Reject'),
                  ),
                  if (_busyId == id)
                    const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                ],
              ),
            ] else if ('${campaign['moderation_note'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Review note: ${campaign['moderation_note']}'),
              ),
          ],
        ),
      ),
    );
  }
}
