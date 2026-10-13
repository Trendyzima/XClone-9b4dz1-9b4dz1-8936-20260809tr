import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class PollsPage extends StatefulWidget {
  const PollsPage({super.key});
  @override
  State<PollsPage> createState() => _PollsPageState();
}

class _PollsPageState extends State<PollsPage> {
  final _db = Supabase.instance.client;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  List<Map<String, dynamic>> _polls = const [];
  final _question = TextEditingController();
  final _description = TextEditingController();
  final List<TextEditingController> _options = [
    TextEditingController(),
    TextEditingController(),
  ];
  DateTime? _endsAt;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _question.dispose();
    _description.dispose();
    for (final c in _options) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _db
          .from('polls')
          .select('id,question,description,status,ends_at,created_at,post_id')
          .order('created_at', ascending: false)
          .limit(40);
      final polls = <Map<String, dynamic>>[];
      for (final row in rows) {
        final result = await _db.rpc(
          'poll_results',
          params: {'p_poll_id': row['id']},
        );
        final stats = result is Map
            ? Map<String, dynamic>.from(result)
            : <String, dynamic>{};
        polls.add({
          ...Map<String, dynamic>.from(row),
          'options': (stats['options'] as List? ?? const [])
              .whereType<Map>()
              .map((v) => Map<String, dynamic>.from(v))
              .toList(),
          'total_votes': int.tryParse('${stats['total_votes'] ?? 0}') ?? 0,
          'effective_status': stats['status'] ?? row['status'],
        });
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _polls = polls;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Polls could not be loaded. Refresh to retry.';
        });
      }
    }
  }

  Future<void> _create() async {
    if (_db.auth.currentUser == null || _busy) {
      return;
    }
    final options =
        _options.map((c) => c.text.trim()).where((v) => v.isNotEmpty).toList();
    if (_question.text.trim().length < 5 ||
        options.length < 2 ||
        options.length > 8) {
      setState(
        () => _error =
            'Enter a question of at least 5 characters and 2–8 non-empty options.',
      );
      return;
    }
    if (_endsAt != null && !_endsAt!.isAfter(DateTime.now())) {
      setState(() => _error = 'Poll closing time must be in the future.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _db.rpc(
        'create_poll',
        params: {
          'p_question': _question.text.trim(),
          'p_options': options,
          'p_description': _description.text.trim().isEmpty
              ? null
              : _description.text.trim(),
          'p_ends_at': _endsAt?.toUtc().toIso8601String(),
          'p_allow_multiple': false,
          'p_visibility': 'public',
          'p_media_asset_id': null,
        },
      );
      _question.clear();
      _description.clear();
      for (final c in _options) {
        c.dispose();
      }
      _options
        ..clear()
        ..addAll([TextEditingController(), TextEditingController()]);
      _endsAt = null;
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Poll published.')));
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Poll could not be published. Confirm your session and try again.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _vote(Map<String, dynamic> poll, String optionId) async {
    if (_db.auth.currentUser == null ||
        _busy ||
        '${poll['effective_status']}' != 'open') {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _db.rpc(
        'cast_poll_vote',
        params: {
          'p_poll_id': poll['id'],
          'p_option_ids': [optionId],
        },
      );
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Vote recorded.')));
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Your vote was not recorded. You may already have voted, or the poll may have closed.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _chooseEndTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _endsAt ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) {
      return;
    }
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(
        _endsAt ?? now.add(const Duration(days: 1)),
      ),
    );
    if (time != null && mounted) {
      setState(
        () => _endsAt = DateTime(
          date.year,
          date.month,
          date.day,
          time.hour,
          time.minute,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Community polls',
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Publish a question, cast a vote, and see server-calculated results.',
          ),
          const SizedBox(height: 12),
          if (_db.auth.currentUser != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Create a poll',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _question,
                      maxLength: 500,
                      decoration: const InputDecoration(
                        labelText: 'Question',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _description,
                      maxLength: 1000,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: 'Description (optional)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    for (var i = 0; i < _options.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _options[i],
                                maxLength: 200,
                                decoration: InputDecoration(
                                  labelText: 'Option ${i + 1}',
                                  border: const OutlineInputBorder(),
                                  counterText: '',
                                ),
                              ),
                            ),
                            if (_options.length > 2)
                              IconButton(
                                onPressed: _busy
                                    ? null
                                    : () => setState(() {
                                          _options.removeAt(i).dispose();
                                        }),
                                icon: const Icon(Icons.remove_circle_outline),
                              ),
                          ],
                        ),
                      ),
                    if (_options.length < 8)
                      TextButton.icon(
                        onPressed: _busy
                            ? null
                            : () => setState(
                                  () => _options.add(TextEditingController()),
                                ),
                        icon: const Icon(Icons.add),
                        label: const Text('Add option'),
                      ),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _chooseEndTime,
                      icon: const Icon(Icons.schedule),
                      label: Text(
                        _endsAt == null
                            ? 'Optional closing time'
                            : 'Closes ${MaterialLocalizations.of(context).formatMediumDate(_endsAt!)} ${TimeOfDay.fromDateTime(_endsAt!).format(context)}',
                      ),
                    ),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _create,
                        icon: const Icon(Icons.poll_outlined),
                        label: Text(_busy ? 'Working…' : 'Publish poll'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          if (_loading) const LinearProgressIndicator(),
          if (!_loading && _polls.isEmpty && _error == null)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(20),
                child: Text(
                  'No polls are available yet. Create the first community poll.',
                ),
              ),
            ),
          for (final poll in _polls) _pollCard(poll, theme),
        ],
      ),
    );
  }

  Widget _pollCard(Map<String, dynamic> poll, ThemeData theme) {
    final options = (poll['options'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .toList();
    final total = int.tryParse('${poll['total_votes'] ?? 0}') ?? 0;
    final open = '${poll['effective_status']}' == 'open' &&
        (poll['ends_at'] == null ||
            DateTime.tryParse('${poll['ends_at']}')?.isAfter(DateTime.now()) ==
                true);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${poll['question'] ?? 'Poll'}',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            if ('${poll['description'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('${poll['description']}'),
              ),
            const SizedBox(height: 12),
            for (final option in options)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: OutlinedButton(
                  onPressed: open && !_busy
                      ? () => _vote(poll, '${option['id']}')
                      : null,
                  child: Row(
                    children: [
                      Expanded(child: Text('${option['label'] ?? ''}')),
                      Text('${option['votes'] ?? 0} votes'),
                    ],
                  ),
                ),
              ),
            Row(
              children: [
                const Icon(Icons.people_outline, size: 16),
                const SizedBox(width: 5),
                Text('$total votes'),
                const Spacer(),
                Text(
                  open ? 'Voting open' : 'Closed',
                  style: TextStyle(
                    color: open
                        ? Colors.green
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            if (poll['ends_at'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Closes ${DateTime.tryParse('${poll['ends_at']}')?.toLocal() ?? poll['ends_at']}',
                  style: theme.textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
