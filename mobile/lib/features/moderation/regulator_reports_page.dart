import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'moderation_workflow_policy.dart';

class RegulatorReportsPage extends StatefulWidget {
  const RegulatorReportsPage({super.key});

  @override
  State<RegulatorReportsPage> createState() => _RegulatorReportsPageState();
}

class _RegulatorReportsPageState extends State<RegulatorReportsPage> {
  final _db = Supabase.instance.client;
  final _note = TextEditingController();
  List<Map<String, dynamic>> _reports = [];
  final Set<String> _busy = {};
  bool _loading = true;
  bool _authorized = false;
  String _filter = 'open';
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
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_db.auth.currentUser == null) {
        throw const _AccessException(
          'Sign in with an authorized owner account to access platform reports.',
        );
      }
      final owner =
          await _db.rpc('testagram_is_owner').timeout(const Duration(seconds: 12)) == true;
      if (!owner) {
        if (mounted && generation == _generation) {
          setState(() {
            _authorized = false;
            _reports = [];
            _error = 'This console is restricted to the platform owner.';
          });
        }
        return;
      }
      final raw = await _db.rpc('testagram_list_platform_reports',
          params: {'p_status': _filter, 'p_limit': 100}).timeout(const Duration(seconds: 20));
      final rows = raw is List
          ? raw.whereType<Map>().map(Map<String, dynamic>.from).toList()
          : <Map<String, dynamic>>[];
      if (!mounted || generation != _generation) {
        return;
      }
      setState(() {
        _authorized = true;
        _reports = rows;
      });
    } on _AccessException catch (error) {
      if (mounted && generation == _generation) {
        setState(() {
          _authorized = false;
          _error = error.message;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(
          () => _error =
              'Reports could not be loaded. Verify the owner session, backend migration, and connection, then retry.',
        );
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _decide(Map<String, dynamic> report, String decision) async {
    final id = '${report['id'] ?? ''}';
    if (!ModerationWorkflowPolicy.canDecideReport(
          isOwner: _authorized,
          status: '${report['status'] ?? ''}',
          decision: decision,
          busy: _busy.contains(id),
        ) ||
        id.isEmpty ||
        !ModerationWorkflowPolicy.validAuditNote(_note.text)) {
      return;
    }
    setState(() {
      _busy.add(id);
      _error = null;
    });
    try {
      await _db.rpc(
        'testagram_resolve_platform_report',
        params: {
          'p_report_id': id,
          'p_decision': decision,
          'p_note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        },
      ).timeout(const Duration(seconds: 20));
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Report ${decision == 'resolved' ? 'resolved' : 'dismissed'}; audit entry recorded.',
          ),
        ),
      );
      _note.clear();
      await _load();
    } on PostgrestException catch (error) {
      if (mounted) {
        setState(() => _error = 'Decision rejected by the server: ${error.message}');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not update this report. Refresh before retrying.');
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  String _date(Object? value) {
    final date = DateTime.tryParse('$value')?.toLocal();
    if (date == null) return 'Date unavailable';
    return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Platform reports'),
          actions: [
            IconButton(
              onPressed: _loading ? null : _load,
              tooltip: 'Refresh reports',
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Review reports against posts. Every decision is authorized and audited on the server; the client never edits moderation rows directly.',
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: _filter,
                    decoration: const InputDecoration(
                      labelText: 'Report status',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'open', child: Text('Open queue')),
                      DropdownMenuItem(value: 'resolved', child: Text('Resolved')),
                      DropdownMenuItem(value: 'dismissed', child: Text('Dismissed')),
                      DropdownMenuItem(value: 'all', child: Text('All reports')),
                    ],
                    onChanged: _loading
                        ? null
                        : (value) {
                            if (value != null) {
                              setState(() => _filter = value);
                              _load();
                            }
                          },
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _note,
                    maxLength: 1000,
                    minLines: 1,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Audit note for next decision (optional)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Material(
                  color: Theme.of(context).colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        const Icon(Icons.warning_amber),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_error!)),
                        TextButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                ),
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : !_authorized
                      ? const Center(child: Text('Owner authorization required.'))
                      : _reports.isEmpty
                          ? const Center(
                              child: Padding(
                                padding: EdgeInsets.all(24),
                                child: Text('No reports match this filter.'),
                              ),
                            )
                          : RefreshIndicator(
                              onRefresh: _load,
                              child: ListView.builder(
                                padding: const EdgeInsets.all(12),
                                itemCount: _reports.length,
                                itemBuilder: (context, index) {
                                  final report = _reports[index];
                                  final id = '${report['id'] ?? ''}';
                                  final busy = _busy.contains(id);
                                  final open = report['status'] == 'open';
                                  return Card(
                                    margin: const EdgeInsets.only(bottom: 10),
                                    child: Padding(
                                      padding: const EdgeInsets.all(14),
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  '${report['reason'] ?? 'Unspecified reason'}',
                                                  style: Theme.of(context)
                                                      .textTheme
                                                      .titleMedium
                                                      ?.copyWith(fontWeight: FontWeight.w800),
                                                ),
                                              ),
                                              Chip(label: Text('${report['status'] ?? 'open'}')),
                                            ],
                                          ),
                                          Text(
                                            'Reported ${_date(report['created_at'])}',
                                            style: Theme.of(context).textTheme.labelSmall,
                                          ),
                                          const SizedBox(height: 10),
                                          Text(
                                              'Reported by: @${report['reporter_username'] ?? 'unknown'}'),
                                          Text(
                                              'Post author: @${report['post_author_username'] ?? 'unknown'}'),
                                          const SizedBox(height: 8),
                                          Container(
                                            width: double.infinity,
                                            padding: const EdgeInsets.all(10),
                                            decoration: BoxDecoration(
                                              color: Theme.of(context)
                                                  .colorScheme
                                                  .surfaceContainerHighest,
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Text(
                                              '${report['post_content'] ?? '[Post content unavailable]'}',
                                              maxLines: 8,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                          if ('${report['details'] ?? ''}'.trim().isNotEmpty)
                                            Padding(
                                              padding: const EdgeInsets.only(top: 8),
                                              child: Text('Reporter details: ${report['details']}'),
                                            ),
                                          if (open) ...[
                                            const SizedBox(height: 10),
                                            Row(
                                              children: [
                                                Expanded(
                                                  child: OutlinedButton.icon(
                                                    onPressed: busy
                                                        ? null
                                                        : () => _decide(report, 'dismissed'),
                                                    icon: const Icon(Icons.close),
                                                    label: const Text('Dismiss'),
                                                  ),
                                                ),
                                                const SizedBox(width: 8),
                                                Expanded(
                                                  child: FilledButton.icon(
                                                    onPressed: busy
                                                        ? null
                                                        : () => _decide(report, 'resolved'),
                                                    icon: busy
                                                        ? const SizedBox(
                                                            width: 16,
                                                            height: 16,
                                                            child: CircularProgressIndicator(
                                                                strokeWidth: 2),
                                                          )
                                                        : const Icon(Icons.done),
                                                    label: const Text('Resolve'),
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ],
                                        ],
                                      ),
                                    ),
                                  );
                                },
                              ),
                            ),
            ),
          ],
        ),
      );
}

class _AccessException implements Exception {
  const _AccessException(this.message);
  final String message;
}
