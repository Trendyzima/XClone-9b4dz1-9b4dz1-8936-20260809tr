import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Owner-only review of identity metadata. The UI never requests or renders
/// raw identity documents or national-ID numbers; the database RPC is the gate.
class IdentityVerificationReviewPage extends StatefulWidget {
  const IdentityVerificationReviewPage({super.key});

  @override
  State<IdentityVerificationReviewPage> createState() =>
      _IdentityVerificationReviewPageState();
}

class _IdentityVerificationReviewPageState
    extends State<IdentityVerificationReviewPage> {
  final db = Supabase.instance.client;
  List<Map<String, dynamic>> rows = const [];
  bool loading = true;
  bool authorized = false;
  String filter = 'submitted';
  String? error;
  String? busyId;
  int generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    generation++;
    super.dispose();
  }

  Future<void> _load() async {
    final run = ++generation;
    if (!mounted) return;
    setState(() {
      loading = true;
      error = null;
    });
    if (db.auth.currentUser == null) {
      setState(() {
        loading = false;
        error = 'Sign in to continue.';
      });
      return;
    }
    try {
      final owner = await db
          .rpc('testagram_is_owner')
          .timeout(const Duration(seconds: 12));
      if (owner != true) {
        if (mounted && run == generation) {
          setState(() {
            authorized = false;
            rows = const [];
            loading = false;
          });
        }
        return;
      }
      final result = await db
          .rpc('list_identity_verifications_for_owner')
          .timeout(const Duration(seconds: 20));
      final parsed = (result as List)
          .whereType<Map>()
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
      if (!mounted || run != generation) return;
      setState(() {
        authorized = true;
        rows = parsed;
      });
    } catch (_) {
      if (mounted && run == generation) {
        setState(
          () => error =
              'Identity review queue unavailable. Confirm owner authorization and retry.',
        );
      }
    } finally {
      if (mounted && run == generation) setState(() => loading = false);
    }
  }

  Future<void> _review(Map<String, dynamic> row, String decision) async {
    final id = '${row['id'] ?? ''}';
    if (!authorized || id.isEmpty || busyId != null) return;
    String notes = '';
    if (decision != 'approved') {
      final controller = TextEditingController();
      final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            decision == 'blocked'
                ? 'Block verification'
                : 'Reject verification',
          ),
          content: TextField(
            controller: controller,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Reason (required)',
              border: OutlineInputBorder(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (controller.text.trim().isNotEmpty) {
                  Navigator.pop(context, controller.text.trim());
                }
              },
              child: const Text('Confirm'),
            ),
          ],
        ),
      );
      controller.dispose();
      if (value == null || value.trim().isEmpty) return;
      notes = value.trim();
    }
    setState(() => busyId = id);
    try {
      final result = await db.rpc(
        'review_identity_verification',
        params: {
          'p_verification_id': id,
          'p_decision': decision,
          'p_notes': notes.isEmpty ? null : notes,
        },
      ).timeout(const Duration(seconds: 20));
      if (result is Map && result['ok'] != true) {
        throw StateError('Review was not accepted.');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Identity verification $decision.')),
        );
      }
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Review failed. The server rejected the action or is unavailable.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = rows
        .where((r) => filter == 'all' || '${r['status']}' == filter)
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Identity Verification'),
        actions: [
          IconButton(
            onPressed: loading ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: loading && rows.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : db.auth.currentUser == null
              ? _gate(
                  'Sign in required',
                  'Sign in to continue.',
                  FilledButton(
                    onPressed: () => context.go('/auth'),
                    child: const Text('Sign in'),
                  ),
                )
              : !authorized && error == null
                  ? _gate(
                      'Owner access required',
                      'Only the platform owner can review identity checks.',
                      FilledButton.tonal(
                        onPressed: () => context.go('/admin/governance'),
                        child: const Text('Open governance'),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Text(
                            'Identity review queue',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 6),
                          const Text(
                            'Only masked metadata is shown. Identity documents and full ID numbers are never displayed here.',
                          ),
                          const SizedBox(height: 12),
                          SegmentedButton<String>(
                            segments: const [
                              ButtonSegment(
                                value: 'submitted',
                                label: Text('Submitted'),
                              ),
                              ButtonSegment(
                                value: 'under_review',
                                label: Text('In review'),
                              ),
                              ButtonSegment(
                                  value: 'approved', label: Text('Approved')),
                              ButtonSegment(
                                  value: 'rejected', label: Text('Rejected')),
                              ButtonSegment(value: 'all', label: Text('All')),
                            ],
                            selected: {filter},
                            onSelectionChanged: (v) =>
                                setState(() => filter = v.first),
                          ),
                          if (error != null) ...[
                            const SizedBox(height: 12),
                            MaterialBanner(
                              content: Text(error!),
                              actions: [
                                TextButton(
                                  onPressed: _load,
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          ],
                          const SizedBox(height: 12),
                          if (filtered.isEmpty && error == null)
                            const Card(
                              child: ListTile(
                                title: Text(
                                  'No identity verification records in this filter.',
                                ),
                              ),
                            ),
                          ...filtered.map(
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
                                            '@${row['username'] ?? 'unknown'}',
                                            style: Theme.of(context)
                                                .textTheme
                                                .titleMedium,
                                          ),
                                        ),
                                        Chip(
                                          label: Text(
                                              '${row['status'] ?? 'unknown'}'),
                                        ),
                                      ],
                                    ),
                                    Text(
                                      '${row['display_name'] ?? ''}  •  ${row['country_code'] ?? '—'}',
                                    ),
                                    Text(
                                      'ID ending ${row['id_number_last4'] ?? '••••'}  •  ${row['id_type'] ?? 'unknown'}',
                                    ),
                                    Text(
                                      'Submitted: ${row['submitted_at'] ?? 'unknown'}',
                                      style:
                                          Theme.of(context).textTheme.bodySmall,
                                    ),
                                    if (row['rejection_reason'] != null)
                                      Text(
                                          'Review note: ${row['rejection_reason']}'),
                                    if ([
                                      'submitted',
                                      'under_review',
                                    ].contains('${row['status']}'))
                                      Wrap(
                                        spacing: 8,
                                        children: [
                                          FilledButton.icon(
                                            onPressed: busyId == null
                                                ? () => _review(row, 'approved')
                                                : null,
                                            icon: const Icon(Icons.check),
                                            label: const Text('Approve'),
                                          ),
                                          OutlinedButton.icon(
                                            onPressed: busyId == null
                                                ? () => _review(row, 'rejected')
                                                : null,
                                            icon: const Icon(Icons.close),
                                            label: const Text('Reject'),
                                          ),
                                          TextButton(
                                            onPressed: busyId == null
                                                ? () => _review(row, 'blocked')
                                                : null,
                                            child: const Text('Block'),
                                          ),
                                        ],
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
    );
  }

  Widget _gate(String title, String detail, Widget action) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.shield_outlined, size: 42),
              const SizedBox(height: 12),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(detail, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              action,
            ],
          ),
        ),
      );
}
