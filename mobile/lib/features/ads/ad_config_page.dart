import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Native Flutter control surface for the existing Testagram Ads admin
/// capability. Authorization remains enforced by the existing edge function.
class AdConfigPage extends StatefulWidget {
  const AdConfigPage({super.key});

  @override
  State<AdConfigPage> createState() => _AdConfigPageState();
}

class _AdConfigPageState extends State<AdConfigPage> {
  SupabaseClient get _db => Supabase.instance.client;
  List<Map<String, dynamic>> _campaigns = [];
  List<Map<String, dynamic>> _slots = [];
  List<Map<String, dynamic>> _creatives = [];
  bool _loading = true;
  String? _error;
  final Set<String> _busy = {};

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

  Future<void> _load() async {
    if (_db.auth.currentUser == null) {
      if (mounted) context.go('/auth');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await _db.functions
          .invoke('testagram-ads/admin', body: {'action': 'list'})
          .timeout(const Duration(seconds: 20));
      final data = response.data;
      if (response.status < 200 || response.status >= 300 ||
          data is! Map || data['ok'] != true) {
        throw StateError(data is Map
            ? '${data['error'] ?? 'You are not authorized to manage ad delivery.'}'
            : 'Ads administration returned an invalid response.');
      }
      if (!mounted) return;
      setState(() {
        _campaigns = (data['campaigns'] as List? ?? const [])
            .whereType<Map>()
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        _slots = (data['slots'] as List? ?? const [])
            .whereType<Map>()
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        _creatives = (data['creatives'] as List? ?? const [])
            .whereType<Map>()
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _campaigns = [];
          _slots = [];
          _creatives = [];
          _error = error is StateError
              ? '${error.message}'
              : 'Ads administration could not load. Retry when online.';
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleCampaign(Map<String, dynamic> campaign) async {
    final id = '${campaign['id'] ?? ''}';
    if (id.isEmpty || !_busy.add(id)) return;
    final next = campaign['status'] == 'active' ? 'paused' : 'active';
    setState(() {});
    try {
      final response = await _db.functions.invoke(
        'testagram-ads/admin',
        body: {'action': 'toggle_campaign', 'campaign_id': id, 'status': next},
      ).timeout(const Duration(seconds: 20));
      final data = response.data;
      if (response.status < 200 || response.status >= 300 ||
          data is! Map || data['ok'] != true) {
        throw StateError(data is Map
            ? '${data['error'] ?? 'Campaign status update failed.'}'
            : 'Invalid response from the ads service.');
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Campaign $next')),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(error is StateError
              ? error.message
              : 'Campaign status update failed. Retry.'),
        ));
      }
    } finally {
      _busy.remove(id);
      if (mounted) setState(() {});
    }
  }

  Future<void> _toggleSlot(Map<String, dynamic> slot) async {
    final id = '${slot['id'] ?? ''}';
    if (id.isEmpty || !_busy.add(id)) return;
    setState(() {});
    try {
      final response = await _db.functions.invoke(
        'testagram-ads/admin',
        body: {
          'action': 'toggle_slot',
          'slot_id': id,
          'enabled': slot['enabled'] != true,
        },
      ).timeout(const Duration(seconds: 20));
      final data = response.data;
      if (response.status < 200 || response.status >= 300 ||
          data is! Map || data['ok'] != true) {
        throw StateError(data is Map
            ? '${data['error'] ?? 'Placement update failed.'}'
            : 'Invalid response from the ads service.');
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Placement ${slot['enabled'] == true ? 'disabled' : 'enabled'}'),
      ));
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(error is StateError
              ? error.message
              : 'Placement update failed. Retry.'),
        ));
      }
    } finally {
      _busy.remove(id);
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Testagram Ads Engine'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
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
                        const Icon(Icons.admin_panel_settings_outlined, size: 44),
                        const SizedBox(height: 12),
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Text('Delivery control', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      const Text('Changes are submitted to the existing server-side ads control API. Server authorization remains authoritative.'),
                      const SizedBox(height: 16),
                      Wrap(spacing: 12, runSpacing: 12, children: [
                        _summary(theme, 'Campaigns', _campaigns.length.toString(), Icons.campaign_outlined),
                        _summary(theme, 'Active', _campaigns.where((c) => c['status'] == 'active').length.toString(), Icons.play_circle_outline),
                        _summary(theme, 'Enabled placements', _slots.where((s) => s['enabled'] == true).length.toString(), Icons.view_agenda_outlined),
                        _summary(theme, 'Creatives', _creatives.length.toString(), Icons.image_outlined),
                      ]),
                      const SizedBox(height: 24),
                      Row(children: [
                        Expanded(child: Text('Campaigns', style: theme.textTheme.titleLarge)),
                        TextButton.icon(onPressed: () => context.go('/create-ad'), icon: const Icon(Icons.add), label: const Text('Create')),
                      ]),
                      if (_campaigns.isEmpty) const Padding(
                        padding: EdgeInsets.symmetric(vertical: 18),
                        child: Text('No campaigns returned by the ads service.'),
                      ),
                      ..._campaigns.map((campaign) {
                        final id = '${campaign['id'] ?? ''}';
                        final status = '${campaign['status'] ?? 'unknown'}';
                        final paid = '${campaign['payment_status'] ?? 'unknown'}';
                        final busy = _busy.contains(id);
                        final canResume = status != 'active' && paid == 'funded';
                        return Card(
                          child: ListTile(
                            leading: const CircleAvatar(child: Icon(Icons.campaign_outlined)),
                            title: Text('${campaign['name'] ?? campaign['headline'] ?? 'Campaign'}'),
                            subtitle: Text('Status: $status · Payment: $paid'),
                            trailing: IconButton(
                              tooltip: status == 'active' ? 'Pause campaign' : 'Activate campaign',
                              onPressed: busy || (status != 'active' && !canResume) ? null : () => _toggleCampaign(campaign),
                              icon: busy
                                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                  : Icon(status == 'active' ? Icons.pause_circle_outline : Icons.play_circle_outline),
                            ),
                          ),
                        );
                      }),
                      const SizedBox(height: 24),
                      Text('Ad placements', style: theme.textTheme.titleLarge),
                      const SizedBox(height: 6),
                      const Text('Disable a placement to stop its eligibility in the existing decisioning engine.'),
                      if (_slots.isEmpty) const Padding(
                        padding: EdgeInsets.symmetric(vertical: 18),
                        child: Text('No placements returned by the ads service.'),
                      ),
                      ..._slots.map((slot) {
                        final id = '${slot['id'] ?? ''}';
                        final enabled = slot['enabled'] == true;
                        final busy = _busy.contains(id);
                        return Card(
                          child: SwitchListTile(
                            value: enabled,
                            onChanged: busy ? null : (_) => _toggleSlot(slot),
                            title: Text('${slot['code'] ?? slot['location'] ?? 'Ad placement'}'),
                            subtitle: Text('${slot['kind'] ?? slot['placement_type'] ?? 'Placement'} · ${enabled ? 'Enabled' : 'Disabled'}'),
                            secondary: busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.view_agenda_outlined),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
    );
  }

  Widget _summary(ThemeData theme, String label, String value, IconData icon) =>
      SizedBox(
        width: 155,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(icon, color: theme.colorScheme.primary),
              const SizedBox(height: 8),
              Text(value, style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
              Text(label, style: theme.textTheme.bodySmall),
            ]),
          ),
        ),
      );
}
