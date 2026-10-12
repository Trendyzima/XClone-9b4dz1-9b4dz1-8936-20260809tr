import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Native Flutter campaign creation, advertiser campaign list and analytics.
/// Payment activation is only shown after the server-side M-Pesa callback and
/// campaign ledger agree; the client never marks a campaign funded itself.
class AdCampaignsPage extends StatefulWidget {
  const AdCampaignsPage({super.key, this.mode = AdCampaignsMode.list});
  final AdCampaignsMode mode;

  @override
  State<AdCampaignsPage> createState() => _AdCampaignsPageState();
}

enum AdCampaignsMode { create, list, analytics }

class _AdCampaignsPageState extends State<AdCampaignsPage> {
  static const _minimumBudgetKes = 500;
  static const _interests = <String>[
    'Tech', 'Fashion', 'Food', 'Travel', 'Sports', 'Music',
    'Business', 'Art', 'Gaming', 'Health', 'Education', 'Finance',
  ];
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;

  final _title = TextEditingController();
  final _description = TextEditingController();
  final _targetUrl = TextEditingController(text: 'https://testagram.site');
  final _budget = TextEditingController();
  final _dailyBudget = TextEditingController();
  final _phone = TextEditingController();
  final Set<String> _selectedInterests = {};
  final List<Map<String, dynamic>> _campaigns = [];
  final Map<String, Map<String, dynamic>> _creatives = {};
  final Map<String, Map<String, dynamic>> _metrics = {};
  Timer? _paymentTimer;
  String _objective = 'traffic';
  String _cta = 'Learn more';
  String _format = 'display';
  DateTime? _startsAt;
  DateTime? _endsAt;
  String? _campaignId;
  String? _checkoutId;
  String? _error;
  bool _loading = false;
  bool _submitting = false;
  bool _checkingPayment = false;
  bool _paymentFailed = false;
  bool _paymentVerified = false;
  int _pollAttempts = 0;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    if (widget.mode != AdCampaignsMode.create) {
      _loadCampaigns();
    } else if (_uid == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/auth');
      });
    }
  }

  @override
  void dispose() {
    _paymentTimer?.cancel();
    _title.dispose();
    _description.dispose();
    _targetUrl.dispose();
    _budget.dispose();
    _dailyBudget.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _loadCampaigns() async {
    final generation = ++_loadGeneration;
    final uid = _uid;
    if (uid == null) {
      if (mounted) context.go('/auth');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final advertisers = await _db
          .from('testagram_advertisers')
          .select('id')
          .eq('owner_user_id', uid)
          .timeout(const Duration(seconds: 15));
      final advertiserIds = advertisers.map((r) => '${r['id']}').toList();
      if (advertiserIds.isEmpty) {
        if (mounted && generation == _loadGeneration) {
          setState(() {
            _campaigns.clear();
            _creatives.clear();
            _metrics.clear();
          });
        }
        return;
      }
      final rows = await _db
          .from('testagram_ad_campaigns')
          .select('id,name,status,payment_status,currency,lifetime_budget_micros,starts_at,ends_at,created_at')
          .inFilter('advertiser_id', advertiserIds)
          .order('created_at', ascending: false)
          .timeout(const Duration(seconds: 15));
      final campaigns = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      final ids = campaigns.map((r) => '${r['id']}').toList();
      final creativeRows = ids.isEmpty
          ? <dynamic>[]
          : await _db
              .from('testagram_ad_creatives')
              .select('id,campaign_id,headline,asset_url,click_through_url')
              .inFilter('campaign_id', ids)
              .order('created_at', ascending: true)
              .timeout(const Duration(seconds: 15));
      final creatives = <String, Map<String, dynamic>>{};
      for (final row in creativeRows) {
        final creative = Map<String, dynamic>.from(row as Map);
        creatives.putIfAbsent('${creative['campaign_id']}', () => creative);
      }
      final metrics = <String, Map<String, dynamic>>{};
      for (final id in ids) {
        final result = await _db.rpc('get_my_ad_campaign_metrics',
            params: {'p_campaign_id': id}).timeout(const Duration(seconds: 15));
        metrics[id] = result is Map
            ? Map<String, dynamic>.from(result)
            : <String, dynamic>{};
      }
      if (!mounted || generation != _loadGeneration) return;
      setState(() {
        _campaigns
          ..clear()
          ..addAll(campaigns);
        _creatives
          ..clear()
          ..addAll(creatives);
        _metrics
          ..clear()
          ..addAll(metrics);
      });
    } catch (_) {
      if (mounted && generation == _loadGeneration) {
        setState(() => _error =
            'Campaigns could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted && generation == _loadGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _createCampaign() async {
    final title = _title.text.trim();
    final description = _description.text.trim();
    final budget = double.tryParse(_budget.text.trim());
    final dailyBudget = double.tryParse(_dailyBudget.text.trim());
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    if (title.isEmpty || description.isEmpty || budget == null ||
        !budget.isFinite || budget < _minimumBudgetKes) {
      _showMessage('Complete all required fields. Minimum budget is KES $_minimumBudgetKes.');
      return;
    }
    if (_dailyBudget.text.trim().isNotEmpty &&
        (dailyBudget == null || !dailyBudget.isFinite ||
            dailyBudget <= 0 || dailyBudget > budget)) {
      _showMessage('Daily budget must be positive and cannot exceed total budget.');
      return;
    }
    final start = _startsAt ?? DateTime.now();
    final end = _endsAt ?? DateTime.now().add(const Duration(days: 30));
    if (!end.isAfter(start)) {
      _showMessage('Campaign end must be after its start.');
      return;
    }
    final url = Uri.tryParse(_targetUrl.text.trim());
    if (url == null || !url.hasScheme ||
        !{'http', 'https'}.contains(url.scheme.toLowerCase()) ||
        url.host.isEmpty) {
      _showMessage('Enter a valid HTTP or HTTPS landing page.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final result = await _db.functions.invoke('testagram-ad-campaign',
          body: <String, dynamic>{
            'name': title,
            'headline': title,
            'description': description,
            'click_through_url': url.toString(),
            'budget_kes': budget,
            if (dailyBudget != null) 'daily_budget_kes': dailyBudget,
            'objective': _objective,
            'cta': _cta,
            'start_at': start.toUtc().toIso8601String(),
            'end_at': end.toUtc().toIso8601String(),
            'format': _format,
            'targeting': {
              'countries': <String>[],
              'devices': <String>[],
              'genres': <String>[],
              'keywords': <String>[],
              'segments': <String>[],
              'interests': _selectedInterests.map((v) => v.toLowerCase()).toList(),
            },
          }).timeout(const Duration(seconds: 30));
      final data = result.data;
      if (result.status < 200 || result.status >= 300 ||
          data is! Map || data['ok'] != true ||
          data['campaign'] is! Map || data['campaign']['id'] == null ||
          data['creative'] is! Map || data['creative']['id'] == null) {
        throw StateError(data is Map
            ? '${data['error'] ?? 'Campaign creation failed.'}'
            : 'Campaign creation returned an invalid response.');
      }
      if (!mounted) return;
      setState(() {
        _campaignId = '${data['campaign']['id']}';
        _checkingPayment = false;
        _paymentFailed = false;
        _paymentVerified = false;
      });
      _showMessage('Campaign draft created. Complete M-Pesa payment to activate it.');
    } catch (error) {
      if (mounted) setState(() => _error = error is StateError
          ? error.message
          : 'Campaign could not be created. Check your connection and retry.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String? _normalizePhone(String value) {
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('254') && digits.length == 12) return digits;
    if (digits.startsWith('0') && digits.length == 10) return '254${digits.substring(1)}';
    if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length == 9) {
      return '254$digits';
    }
    return null;
  }

  Future<void> _requestPayment() async {
    final campaignId = _campaignId;
    final phone = _normalizePhone(_phone.text.trim());
    final budget = double.tryParse(_budget.text.trim());
    if (campaignId == null || phone == null || budget == null ||
        budget < _minimumBudgetKes || _submitting) {
      _showMessage(phone == null
          ? 'Enter a valid Kenyan M-Pesa phone number.'
          : 'Create a campaign first and check the budget.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
      _paymentFailed = false;
    });
    try {
      final result = await _db.functions.invoke('mpesa-ad-payment',
          body: {'ad_id': campaignId, 'amount_kes': budget.ceil(), 'phone': phone})
          .timeout(const Duration(seconds: 30));
      final data = result.data;
      if (result.status < 200 || result.status >= 300 || data is! Map ||
          data['success'] != true || data['status'] != 'pending' ||
          data['checkout_request_id'] == null) {
        throw StateError(data is Map
            ? '${data['error'] ?? 'M-Pesa request was not accepted.'}'
            : 'M-Pesa returned an invalid response.');
      }
      if (!mounted) return;
      setState(() {
        _checkoutId = '${data['checkout_request_id']}';
        _checkingPayment = true;
        _paymentFailed = false;
        _pollAttempts = 0;
      });
      _pollPayment();
    } catch (error) {
      if (mounted) setState(() => _error = error is StateError
          ? error.message
          : 'M-Pesa request failed. Retry after checking your phone.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _pollPayment() {
    _paymentTimer?.cancel();
    _paymentTimer = Timer(const Duration(seconds: 5), () async {
      final uid = _uid;
      final campaignId = _campaignId;
      final checkoutId = _checkoutId;
      if (!mounted || uid == null || campaignId == null || checkoutId == null ||
          !_checkingPayment) return;
      try {
        final payment = await _db
            .from('testagram_ad_payments')
            .select('id,user_id,campaign_id,amount_kes,status,result_code,mpesa_receipt_number,checkout_request_id')
            .eq('checkout_request_id', checkoutId)
            .eq('campaign_id', campaignId)
            .eq('user_id', uid)
            .maybeSingle()
            .timeout(const Duration(seconds: 12));
        if (payment != null && payment['status'] == 'completed') {
          final campaign = await _db
              .from('testagram_ad_campaigns')
              .select('id,payment_status,status,payment_reference')
              .eq('id', campaignId)
              .maybeSingle()
              .timeout(const Duration(seconds: 12));
          final amount = double.tryParse(_budget.text.trim()) ?? 0;
          final valid = payment['checkout_request_id'] == checkoutId &&
              payment['campaign_id'] == campaignId &&
              payment['user_id'] == uid &&
              payment['mpesa_receipt_number'] != null &&
              '${payment['result_code']}' == '0' &&
              (double.tryParse('${payment['amount_kes']}') ?? -1) == amount.ceilToDouble() &&
              campaign != null &&
              campaign['payment_status'] == 'funded' &&
              campaign['payment_reference'] == payment['mpesa_receipt_number'] &&
              campaign['status'] == 'active';
          if (!valid) throw StateError('Payment has not yet been verified against the campaign ledger.');
          if (!mounted) return;
          setState(() {
            _checkingPayment = false;
            _paymentVerified = true;
            _paymentFailed = false;
          });
          return;
        }
        if (payment != null && payment['status'] == 'failed') {
          if (mounted) setState(() {
            _checkingPayment = false;
            _paymentFailed = true;
            _error = 'M-Pesa payment failed. You can retry payment.';
          });
          return;
        }
      } catch (_) {
        // The ledger remains authoritative. Transient reads are retried below.
      }
      if (!mounted) return;
      _pollAttempts++;
      if (_pollAttempts >= 24) {
        setState(() {
          _checkingPayment = false;
          _error = 'Payment verification is delayed. Your campaign has not been marked paid. Retry verification later.';
        });
      } else {
        _pollPayment();
      }
    });
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  String _money(dynamic micros, [String currency = 'KES']) {
    final value = (double.tryParse('${micros ?? 0}') ?? 0) / 1000000;
    return '$currency ${value.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    switch (widget.mode) {
      case AdCampaignsMode.create:
        return _buildCreate();
      case AdCampaignsMode.list:
        return _buildList(analytics: false);
      case AdCampaignsMode.analytics:
        return _buildList(analytics: true);
    }
  }

  Widget _buildCreate() {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Create an ad campaign')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Reach Testagram audiences', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('Campaigns remain inactive until the server confirms M-Pesa settlement. Minimum budget: KES 500.'),
          const SizedBox(height: 20),
          TextField(controller: _title, maxLength: 100, decoration: const InputDecoration(labelText: 'Campaign title', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _description, maxLength: 1000, maxLines: 4, decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _targetUrl, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Landing page URL', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextField(controller: _budget, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Total budget (KES)', border: OutlineInputBorder()))),
            const SizedBox(width: 12),
            Expanded(child: TextField(controller: _dailyBudget, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Daily budget (KES)', border: OutlineInputBorder(), helperText: 'Optional'))),
          ]),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _objective,
            decoration: const InputDecoration(labelText: 'Campaign objective', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'traffic', child: Text('Website traffic')),
              DropdownMenuItem(value: 'engagement', child: Text('Engagement')),
              DropdownMenuItem(value: 'awareness', child: Text('Brand awareness')),
            ],
            onChanged: (value) => setState(() => _objective = value ?? _objective),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _cta,
            decoration: const InputDecoration(labelText: 'Call to action', border: OutlineInputBorder()),
            items: const ['Learn more', 'Shop now', 'Sign up', 'Download', 'Contact us']
                .map((value) => DropdownMenuItem(value: value, child: Text(value))).toList(),
            onChanged: (value) => setState(() => _cta = value ?? _cta),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _format,
            decoration: const InputDecoration(labelText: 'Ad format', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'display', child: Text('Feed / display')),
              DropdownMenuItem(value: 'story', child: Text('Story placement')),
            ],
            onChanged: (value) => setState(() => _format = value ?? _format),
          ),
          const SizedBox(height: 12),
          Text('Audience interests', style: theme.textTheme.titleMedium),
          Wrap(spacing: 8, runSpacing: 4, children: _interests.map((interest) => FilterChip(
            label: Text(interest),
            selected: _selectedInterests.contains(interest),
            onSelected: (selected) => setState(() => selected ? _selectedInterests.add(interest) : _selectedInterests.remove(interest)),
          )).toList()),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () async {
              final picked = await showDatePicker(context: context, initialDate: _startsAt ?? DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 1)), lastDate: DateTime.now().add(const Duration(days: 365)));
              if (picked != null && mounted) setState(() => _startsAt = picked);
            },
            icon: const Icon(Icons.calendar_today_outlined),
            label: Text(_startsAt == null ? 'Start date: today' : 'Start date: ${_startsAt!.toLocal().toString().split(' ').first}'),
          ),
          OutlinedButton.icon(
            onPressed: () async {
              final initial = _endsAt ?? DateTime.now().add(const Duration(days: 30));
              final picked = await showDatePicker(context: context, initialDate: initial, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 730)));
              if (picked != null && mounted) setState(() => _endsAt = picked);
            },
            icon: const Icon(Icons.event_outlined),
            label: Text(_endsAt == null ? 'End date: in 30 days' : 'End date: ${_endsAt!.toLocal().toString().split(' ').first}'),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
          const SizedBox(height: 12),
          FilledButton.icon(onPressed: _submitting || _campaignId != null ? null : _createCampaign, icon: _submitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.campaign_outlined), label: Text(_submitting ? 'Creating campaign…' : 'Create campaign draft')),
          if (_campaignId != null) ...[
            const Divider(height: 32),
            Text('Campaign ready for payment', style: theme.textTheme.titleLarge),
            Text('Reference: $_campaignId'),
            const SizedBox(height: 8),
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'M-Pesa phone number', hintText: '07XXXXXXXX or 2547XXXXXXXX', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            if (_checkingPayment) const LinearProgressIndicator(),
            if (_checkingPayment) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Waiting for server-confirmed M-Pesa settlement…')),
            if (_paymentVerified) const ListTile(leading: Icon(Icons.check_circle, color: Colors.green), title: Text('Payment verified'), subtitle: Text('The campaign ledger confirms settlement and activation.')),
            if (_error != null && !_checkingPayment) Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            FilledButton.icon(onPressed: _submitting || _checkingPayment || _paymentVerified ? null : _requestPayment, icon: const Icon(Icons.phone_android), label: Text(_paymentVerified ? 'Campaign activated' : _paymentFailed ? 'Retry M-Pesa payment' : 'Pay with M-Pesa')),
            if (_paymentVerified) OutlinedButton(onPressed: () => context.go('/my-ads'), child: const Text('View my campaigns')),
          ],
        ],
      ),
    );
  }

  Widget _buildList({required bool analytics}) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(analytics ? 'Ad analytics' : 'My ads'), actions: [
        IconButton(tooltip: 'Refresh', onPressed: _loading ? null : _loadCampaigns, icon: const Icon(Icons.refresh)),
        IconButton(tooltip: 'Create campaign', onPressed: () => context.go('/create-ad'), icon: const Icon(Icons.add_circle_outline)),
      ]),
      body: _loading && _campaigns.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : _error != null && _campaigns.isEmpty
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: _loadCampaigns, child: const Text('Retry')),
                ])))
              : _campaigns.isEmpty
                  ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.campaign_outlined, size: 48),
                      const SizedBox(height: 12),
                      Text(analytics ? 'No campaign analytics yet' : 'No campaigns yet', style: theme.textTheme.titleLarge),
                      const SizedBox(height: 8),
                      const Text('Create a campaign to see verified delivery and spend metrics.', textAlign: TextAlign.center),
                      const SizedBox(height: 12),
                      FilledButton(onPressed: () => context.go('/create-ad'), child: const Text('Create campaign')),
                    ])))
                  : RefreshIndicator(
                      onRefresh: _loadCampaigns,
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
                          ..._campaigns.map((campaign) {
                            final id = '${campaign['id']}';
                            final creative = _creatives[id] ?? const <String, dynamic>{};
                            final metric = _metrics[id] ?? const <String, dynamic>{};
                            final currency = '${campaign['currency'] ?? 'KES'}';
                            final payment = '${campaign['payment_status'] ?? 'pending'}';
                            final status = '${campaign['status'] ?? 'draft'}';
                            final impressions = int.tryParse('${metric['impressions'] ?? 0}') ?? 0;
                            final clicks = int.tryParse('${metric['clicks'] ?? 0}') ?? 0;
                            final ctr = double.tryParse('${metric['ctr'] ?? 0}') ?? 0;
                            final spend = metric['spend_micros'] ?? 0;
                            return Card(
                              margin: const EdgeInsets.only(bottom: 12),
                              clipBehavior: Clip.antiAlias,
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    const CircleAvatar(child: Icon(Icons.campaign_outlined)),
                                    const SizedBox(width: 12),
                                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text('${campaign['name'] ?? 'Untitled campaign'}', style: theme.textTheme.titleMedium),
                                      if (creative['headline'] != null) Text('${creative['headline']}', style: theme.textTheme.bodyMedium),
                                    ])),
                                    Chip(label: Text(payment != 'funded' ? 'Awaiting payment' : status.replaceAll('_', ' '))),
                                  ]),
                                  const SizedBox(height: 12),
                                  if (creative['asset_url'] != null && '${creative['asset_url']}'.startsWith('https://'))
                                    ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network('${creative['asset_url']}', height: 160, width: double.infinity, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox.shrink())),
                                  if (analytics) ...[
                                    const Divider(height: 24),
                                    Wrap(spacing: 10, runSpacing: 10, children: [
                                      _metric(theme, 'Impressions', impressions.toString()),
                                      _metric(theme, 'Clicks', clicks.toString()),
                                      _metric(theme, 'CTR', '${ctr.toStringAsFixed(2)}%'),
                                      _metric(theme, 'Spend', _money(spend, currency)),
                                    ]),
                                  ],
                                  const SizedBox(height: 12),
                                  Row(children: [
                                    const Expanded(child: Text('Lifetime budget')),
                                    Text(_money(campaign['lifetime_budget_micros'], currency), style: theme.textTheme.titleSmall),
                                  ]),
                                  if (creative['click_through_url'] != null)
                                    Align(alignment: Alignment.centerRight, child: TextButton.icon(
                                      onPressed: () async {
                                        final uri = Uri.tryParse('${creative['click_through_url']}');
                                        if (uri != null && {'https', 'http'}.contains(uri.scheme) && uri.host.isNotEmpty) {
                                          await launchUrl(uri, mode: LaunchMode.externalApplication);
                                        }
                                      },
                                      icon: const Icon(Icons.open_in_new, size: 16),
                                      label: const Text('Open landing page'),
                                    )),
                                ]),
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
    );
  }

  Widget _metric(ThemeData theme, String label, String value) => Container(
    width: 145,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      border: Border.all(color: theme.dividerColor),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(value, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: 4),
      Text(label, style: theme.textTheme.bodySmall),
    ]),
  );
}
