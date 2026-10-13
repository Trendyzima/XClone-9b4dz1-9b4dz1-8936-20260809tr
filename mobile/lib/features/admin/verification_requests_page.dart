import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Owner-only queue backed by verification_requests. The migration explicitly
/// stores tier/status/evidence and review metadata; no legacy payment columns
/// are assumed. RLS is extended by the paired migration.
class VerificationRequestsPage extends StatefulWidget {
  const VerificationRequestsPage({super.key});
  @override
  State<VerificationRequestsPage> createState() =>
      _VerificationRequestsPageState();
}

class _VerificationRequestsPageState extends State<VerificationRequestsPage> {
  final db = Supabase.instance.client;
  List<Map<String, dynamic>> rows = const [];
  bool loading = true;
  bool owner = false;
  String filter = 'pending';
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
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    if (db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          loading = false;
          error = 'Sign in to continue.';
        });
      }
      return;
    }
    try {
      final result = await db
          .rpc('testagram_is_owner')
          .timeout(const Duration(seconds: 12));
      if (result != true) {
        if (mounted && run == generation) {
          setState(() {
            owner = false;
            rows = const [];
          });
        }
        return;
      }
      final data = await db
          .from('verification_requests')
          .select(
            'id,user_id,tier,status,evidence,reviewed_by,reviewed_at,created_at,updated_at',
          )
          .order('created_at', ascending: false)
          .limit(200)
          .timeout(const Duration(seconds: 20));
      final parsed = data
          .whereType<Map>()
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
      if (!mounted || run != generation) return;
      setState(() {
        owner = true;
        rows = parsed;
      });
    } catch (_) {
      if (mounted && run == generation) {
        setState(
          () => error =
              'Verification requests unavailable. Confirm the owner-review migration is applied and retry.',
        );
      }
    } finally {
      if (mounted && run == generation) setState(() => loading = false);
    }
  }

  Future<void> _decide(Map<String, dynamic> row, String status) async {
    final id = '${row['id'] ?? ''}';
    if (!owner || id.isEmpty || busyId != null) return;
    String notes = '';
    if (status == 'rejected') {
      final c = TextEditingController();
      final value = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Reject request'),
          content: TextField(
            controller: c,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(labelText: 'Reason (required)'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (c.text.trim().isNotEmpty) {
                  Navigator.pop(context, c.text.trim());
                }
              },
              child: const Text('Confirm'),
            ),
          ],
        ),
      );
      c.dispose();
      if (value == null || value.trim().isEmpty) return;
      notes = value.trim();
    }
    setState(() => busyId = id);
    try {
      final updates = <String, dynamic>{
        'status': status,
        'reviewed_by': db.auth.currentUser!.id,
        'reviewed_at': DateTime.now().toUtc().toIso8601String(),
      };
      final evidence = row['evidence'] is Map
          ? Map<String, dynamic>.from(row['evidence'] as Map)
          : <String, dynamic>{};
      if (notes.isNotEmpty) evidence['review_note'] = notes;
      updates['evidence'] = evidence;
      await db
          .from('verification_requests')
          .update(updates)
          .eq('id', id)
          .timeout(const Duration(seconds: 20));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Request marked $status.')));
      }
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Review failed. Check database migration, authorization, and retry.',
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
        title: const Text('Verification Requests'),
        actions: [
          IconButton(
            onPressed: loading ? null : _load,
            icon: const Icon(Icons.refresh),
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
              : !owner && error == null
                  ? _gate(
                      'Owner access required',
                      'Only the platform owner can review these requests.',
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
                            'Verification requests',
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 6),
                          const Text(
                            'Reviews update the recorded request status and audit metadata. Approval does not grant a badge or subscription unless a separate entitlement flow confirms it.',
                          ),
                          const SizedBox(height: 12),
                          SegmentedButton<String>(
                            segments: const [
                              ButtonSegment(
                                  value: 'pending', label: Text('Pending')),
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
                                title: Text('No requests in this filter.'),
                              ),
                            ),
                          ...filtered.map((row) {
                            final evidence = row['evidence'] is Map
                                ? Map<String, dynamic>.from(
                                    row['evidence'] as Map)
                                : <String, dynamic>{};
                            return Card(
                              child: Padding(
                                padding: const EdgeInsets.all(14),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${row['tier'] ?? 'standard'} tier',
                                            style: Theme.of(context)
                                                .textTheme
                                                .titleMedium,
                                          ),
                                        ),
                                        Chip(
                                          label: Text(
                                              '${row['status'] ?? 'pending'}'),
                                        ),
                                      ],
                                    ),
                                    SelectableText('Request: ${row['id']}'),
                                    SelectableText(
                                        'User ID: ${row['user_id']}'),
                                    Text(
                                      'Submitted: ${row['created_at'] ?? 'unknown'}',
                                      style:
                                          Theme.of(context).textTheme.bodySmall,
                                    ),
                                    if (evidence.isNotEmpty)
                                      const ListTile(
                                        dense: true,
                                        leading: Icon(Icons.lock_outline),
                                        title: Text(
                                            'Evidence metadata attached; contents hidden in this review list.'),
                                      ),
                                    if ('${row['status']}' == 'pending')
                                      Wrap(
                                        spacing: 8,
                                        children: [
                                          FilledButton.icon(
                                            onPressed: busyId == null
                                                ? () => _decide(row, 'approved')
                                                : null,
                                            icon: const Icon(Icons.check),
                                            label:
                                                const Text('Approve request'),
                                          ),
                                          OutlinedButton.icon(
                                            onPressed: busyId == null
                                                ? () => _decide(row, 'rejected')
                                                : null,
                                            icon: const Icon(Icons.close),
                                            label: const Text('Reject'),
                                          ),
                                        ],
                                      ),
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

  Widget _gate(String title, String message, Widget action) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.admin_panel_settings_outlined, size: 42),
              const SizedBox(height: 12),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              action,
            ],
          ),
        ),
      );
}
