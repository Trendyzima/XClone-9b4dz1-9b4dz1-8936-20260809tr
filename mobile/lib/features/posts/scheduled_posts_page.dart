import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ScheduledPostsPage extends StatefulWidget {
  const ScheduledPostsPage({super.key});
  @override
  State<ScheduledPostsPage> createState() => _ScheduledPostsPageState();
}

class _ScheduledPostsPageState extends State<ScheduledPostsPage> {
  final _db = Supabase.instance.client;
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  String? _error;
  String _filter = 'scheduled';
  String? _deleting;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to view scheduled posts.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _db
          .from('scheduled_posts')
          .select('id,body,scheduled_for,status,created_at')
          .eq('author_id', user.id)
          .order('scheduled_for')
          .limit(200)
          .timeout(const Duration(seconds: 20));
      if (mounted) {
        setState(
          () => _posts = rows
              .map((r) => Map<String, dynamic>.from(r as Map))
              .toList(),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Scheduled posts could not load. Check connection and permissions, then retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _cancel(Map<String, dynamic> post) async {
    final id = '${post['id']}';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel scheduled post?'),
        content: const Text(
          'This removes the scheduled item. It does not delete any already published post.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel post'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() {
      _deleting = id;
      _error = null;
    });
    try {
      final user = _db.auth.currentUser;
      if (user == null) throw StateError('Sign in required');
      await _db
          .from('scheduled_posts')
          .delete()
          .eq('id', id)
          .eq('author_id', user.id)
          .timeout(const Duration(seconds: 15));
      if (mounted) {
        setState(() => _posts.removeWhere((p) => '${p['id']}' == id));
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not cancel this post. It may already have been processed. Refresh and check its status.',
        );
      }
    } finally {
      if (mounted) setState(() => _deleting = null);
    }
  }

  String _date(dynamic value) {
    final d = DateTime.tryParse('$value')?.toLocal();
    return d == null
        ? 'Time unavailable'
        : '${MaterialLocalizations.of(context).formatFullDate(d)} · ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(d))}';
  }

  @override
  Widget build(BuildContext context) {
    final visible = _posts
        .where((p) => '${p['status'] ?? 'scheduled'}' == _filter)
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scheduled posts'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'scheduled',
                        label: Text('Upcoming'),
                      ),
                      ButtonSegment(
                        value: 'published',
                        label: Text('Published'),
                      ),
                      ButtonSegment(value: 'failed', label: Text('Failed')),
                    ],
                    selected: {_filter},
                    onSelectionChanged: (s) =>
                        setState(() => _filter = s.first),
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
                  const SizedBox(height: 8),
                  if (visible.isEmpty && _error == null)
                    const Card(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Center(
                          child: Text('No posts in this category.'),
                        ),
                      ),
                    ),
                  for (final post in visible)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${post['status'] ?? 'scheduled'}'
                                        .toUpperCase(),
                                    style: Theme.of(context)
                                        .textTheme
                                        .labelLarge,
                                  ),
                                ),
                                Text(_date(post['scheduled_for'])),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Text(
                              '${post['body'] ?? ''}',
                              maxLines: 8,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (_filter == 'scheduled')
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton.icon(
                                  onPressed: _deleting == '${post['id']}'
                                      ? null
                                      : () => _cancel(post),
                                  icon: const Icon(Icons.delete_outline),
                                  label: Text(
                                    _deleting == '${post['id']}'
                                        ? 'Cancelling…'
                                        : 'Cancel',
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
