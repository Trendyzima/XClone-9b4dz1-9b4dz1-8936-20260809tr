import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'moderation_workflow_policy.dart';

class AppealsPage extends StatefulWidget {
  const AppealsPage({super.key});

  @override
  State<AppealsPage> createState() => _AppealsPageState();
}

class _AppealsPageState extends State<AppealsPage> {
  final _db = Supabase.instance.client;
  final _reason = TextEditingController();
  List<Map<String, dynamic>> _appeals = [];
  Map<String, dynamic>? _activeBan;
  bool _loading = true;
  bool _submitting = false;
  bool _refreshing = false;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _generation++;
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load({bool manual = false}) async {
    final generation = ++_generation;
    final user = _db.auth.currentUser;
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to view or submit an appeal.';
      });
      return;
    }
    setState(() {
      _error = null;
      _loading = !manual && _appeals.isEmpty;
      _refreshing = manual;
    });
    try {
      final results = await Future.wait<dynamic>([
        _db
            .rpc('testagram_list_my_moderation_appeals')
            .timeout(const Duration(seconds: 15)),
        _db
            .from('user_bans')
            .select(
              'id,ban_type,reason,strike_count,duration_hours,expires_at,banned_at',
            )
            .eq('user_id', user.id)
            .eq('is_active', true)
            .order('banned_at', ascending: false)
            .limit(1)
            .maybeSingle()
            .timeout(const Duration(seconds: 15)),
      ]);
      final rows = results[0] is List
          ? (results[0] as List)
                .whereType<Map>()
                .map(Map<String, dynamic>.from)
                .toList()
          : <Map<String, dynamic>>[];
      final ban = results[1] is Map
          ? Map<String, dynamic>.from(results[1] as Map)
          : null;
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _appeals = rows;
        _activeBan = ban;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = 'Appeal history could not be loaded. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _submit() async {
    final reason = _reason.text.trim();
    if (_db.auth.currentUser == null ||
        _submitting ||
        !ModerationWorkflowPolicy.validAppealReason(reason)) {
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await _db
          .rpc(
            'testagram_submit_moderation_appeal',
            params: {'p_reason': reason},
          )
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;
      _reason.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Appeal submitted. A reviewer will respond in your platform inbox.',
          ),
        ),
      );
      await _load(manual: true);
    } on PostgrestException catch (error) {
      if (mounted) {
        setState(
          () => _error = error.message.contains('pending appeal already exists')
              ? 'You already have an appeal under review.'
              : 'Appeal was not submitted: ${error.message}',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Appeal submission failed. Retry when your connection is stable.',
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _date(Object? value) {
    final parsed = DateTime.tryParse('$value');
    if (parsed == null) return 'Date unavailable';
    final local = parsed.toLocal();
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final user = _db.auth.currentUser;
    final pending = _appeals.any((a) => a['status'] == 'pending');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Account appeals'),
        actions: [
          IconButton(
            onPressed: _refreshing ? null : () => _load(manual: true),
            tooltip: 'Refresh appeals',
            icon: _refreshing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _load(manual: true),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.shield_outlined, size: 32),
                    const SizedBox(height: 10),
                    Text(
                      'A fair review starts with your explanation',
                      style: Theme.of(context).textTheme.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Explain why you believe an account restriction or enforcement decision was incorrect. The review team makes the decision on the server; this page cannot directly change moderation status.',
                    ),
                  ],
                ),
              ),
            ),
            if (user == null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      const Text('Sign in to view your appeal history.'),
                      const SizedBox(height: 8),
                      FilledButton(
                        onPressed: () => context.go('/auth'),
                        child: const Text('Sign in'),
                      ),
                    ],
                  ),
                ),
              )
            else ...[
              const SizedBox(height: 8),
              if (_activeBan != null)
                Card(
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Active account restriction',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Type: ${_activeBan!['ban_type'] ?? 'Account restriction'}',
                        ),
                        Text(
                          'Reason: ${_activeBan!['reason'] ?? 'Policy enforcement'}',
                        ),
                        if (_activeBan!['expires_at'] != null)
                          Text('Expires: ${_date(_activeBan!['expires_at'])}'),
                      ],
                    ),
                  ),
                ),
              if (!pending)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Submit an appeal',
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _reason,
                          minLines: 4,
                          maxLines: 7,
                          maxLength: 800,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            hintText: 'Describe what happened and why you believe the decision should be reviewed.',
                          ),
                          onChanged: (_) => setState(() {}),
                        ),
                        Text(
                          '${_reason.text.trim().length}/800 · At least 20 characters',
                        ),
                        const SizedBox(height: 10),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed:
                                !ModerationWorkflowPolicy.canSubmitAppeal(
                                  authenticated: true,
                                  submitting: _submitting,
                                  hasPendingAppeal: pending,
                                  reason: _reason.text,
                                )
                                ? null
                                : _submit,
                            icon: _submitting
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.send_outlined),
                            label: Text(
                              _submitting ? 'Submitting…' : 'Submit appeal',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              else
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.hourglass_top),
                    title: Text('Appeal under review'),
                    subtitle: Text(
                      'You already have a pending appeal. Check your history and platform inbox for the decision.',
                    ),
                  ),
                ),
              const SizedBox(height: 18),
              Text(
                'Appeal history',
                style: Theme.of(context).textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              if (_loading && _appeals.isEmpty)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_error != null && _appeals.isEmpty)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        Text(_error!),
                        TextButton.icon(
                          onPressed: () => _load(manual: true),
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              else if (_appeals.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('No appeals have been submitted yet.'),
                  ),
                )
              else
                ..._appeals.map((appeal) {
                  final status = '${appeal['status'] ?? 'pending'}';
                  final color = status == 'approved'
                      ? Colors.green
                      : status == 'denied'
                      ? Theme.of(context).colorScheme.error
                      : Colors.orange;
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  status.toUpperCase(),
                                  style: TextStyle(
                                    color: color,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              Text(
                                _date(appeal['created_at']),
                                style: Theme.of(context).textTheme.labelSmall,
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text('${appeal['reason'] ?? ''}'),
                          if ('${appeal['regulator_note'] ?? ''}'
                              .trim()
                              .isNotEmpty) ...[
                            const Divider(),
                            const Text(
                              'Reviewer response',
                              style: TextStyle(fontWeight: FontWeight.bold),
                            ),
                            Text('${appeal['regulator_note']}'),
                          ],
                          if (appeal['reviewed_at'] != null)
                            Text(
                              'Reviewed ${_date(appeal['reviewed_at'])}',
                              style: Theme.of(context).textTheme.labelSmall,
                            ),
                        ],
                      ),
                    ),
                  );
                }),
            ],
            if (_error != null && _appeals.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
