import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class CreatorSeriesPage extends StatefulWidget {
  const CreatorSeriesPage({super.key});
  @override
  State<CreatorSeriesPage> createState() => _CreatorSeriesPageState();
}

class _CreatorSeriesPageState extends State<CreatorSeriesPage> {
  final _db = Supabase.instance.client;
  List<Map<String, dynamic>> _series = [];
  List<Map<String, dynamic>> _posts = [];
  bool _loading = true;
  bool _working = false;
  String? _error;
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
          _error = 'Sign in to manage your content series.';
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
          .from('post_series')
          .select('id,owner_id,title,description,created_at,updated_at')
          .eq('owner_id', user.id)
          .order('updated_at', ascending: false)
          .limit(100)
          .timeout(const Duration(seconds: 20));
      if (mounted) {
        setState(() => _series = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList());
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Your series could not load. Confirm access and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _create() async {
    final title = TextEditingController();
    final description = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create a series'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: title,
              maxLength: 100,
              decoration: const InputDecoration(labelText: 'Title'),
            ),
            TextField(
              controller: description,
              maxLength: 500,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Description (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Create')),
        ],
      ),
    );
    if (ok != true || title.text.trim().isEmpty) {
      title.dispose();
      description.dispose();
      return;
    }
    final user = _db.auth.currentUser;
    if (user == null) {
      title.dispose();
      description.dispose();
      return;
    }
    setState(() => _working = true);
    try {
      await _db.from('post_series').insert({
        'owner_id': user.id,
        'title': title.text.trim(),
        'description': description.text.trim().isEmpty ? null : description.text.trim(),
      }).timeout(const Duration(seconds: 15));
      if (mounted) await _load();
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Series was not created. Check the title and try again.');
      }
    } finally {
      title.dispose();
      description.dispose();
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _showItems(Map<String, dynamic> series) async {
    setState(() {
      _posts = [];
      _working = true;
      _error = null;
    });
    try {
      final rows = await _db
          .from('post_series_items')
          .select('series_id,post_id,sort_order,posts(id,content,created_at)')
          .eq('series_id', series['id'])
          .order('sort_order')
          .timeout(const Duration(seconds: 15));
      if (mounted) {
        setState(() => _posts = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList());
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Series episodes could not load.');
    } finally {
      if (mounted) setState(() => _working = false);
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * .72,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  '${series['title']}',
                  style: Theme.of(sheetContext).textTheme.titleLarge,
                ),
              ),
              Expanded(
                child: _posts.isEmpty
                    ? const Center(child: Text('No posts have been added to this series yet.'))
                    : ListView(
                        children: [
                          for (final row in _posts)
                            ListTile(
                              leading: const Icon(Icons.article_outlined),
                              title: Text(
                                '${(row['posts'] is Map ? (row['posts'] as Map)['content'] : null) ?? 'Post unavailable'}',
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text('Order ${row['sort_order'] ?? 0}'),
                            ),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _delete(Map<String, dynamic> series) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete series?'),
        content: const Text(
          'The series and its membership records will be removed; individual posts are not deleted.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (yes != true) return;
    setState(() => _working = true);
    try {
      final user = _db.auth.currentUser;
      if (user == null) throw StateError('AUTH_REQUIRED');
      await _db
          .from('post_series')
          .delete()
          .eq('id', '${series['id']}')
          .eq('owner_id', user.id)
          .timeout(const Duration(seconds: 15));
      if (mounted) {
        setState(() => _series.removeWhere((s) => s['id'] == series['id']));
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not delete the series. Refresh and retry.');
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Creator series'),
          actions: [
            IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _working ? null : _create,
          icon: const Icon(Icons.add),
          label: const Text('New series'),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 90),
                  children: [
                    const Text(
                      'Organize your posts into ordered collections. Series access is limited to the signed-in owner under the current database policy.',
                    ),
                    if (_working) const LinearProgressIndicator(),
                    if (_error != null)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.error_outline),
                          title: Text(_error!),
                          trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
                        ),
                      ),
                    if (_series.isEmpty && _error == null)
                      const Card(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Text('You have not created a series yet.'),
                        ),
                      ),
                    for (final s in _series)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.auto_stories_outlined),
                          title: Text('${s['title'] ?? 'Untitled series'}'),
                          subtitle: Text('${s['description'] ?? 'No description'}'),
                          onTap: () => _showItems(s),
                          trailing: PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'delete') {
                                _delete(s);
                              } else {
                                _showItems(s);
                              }
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'open', child: Text('View episodes')),
                              PopupMenuItem(value: 'delete', child: Text('Delete series')),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
      );
}
