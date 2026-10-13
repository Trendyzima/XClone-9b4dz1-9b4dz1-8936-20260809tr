import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ListsPage extends StatefulWidget {
  const ListsPage({super.key});
  @override
  State<ListsPage> createState() => _ListsPageState();
}

class _ListsPageState extends State<ListsPage> {
  final _db = Supabase.instance.client;
  bool _loading = true, _busy = false;
  String? _error;
  List<Map<String, dynamic>> _lists = const [];
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    if (_db.auth.currentUser == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to view and manage lists.';
      });
      return;
    }
    try {
      final rows = await _db
          .from('lists')
          .select(
            'id,owner_id,name,description,is_private,member_count,updated_at',
          )
          .order('updated_at', ascending: false)
          .limit(100);
      if (mounted)
        setState(() {
          _lists = rows.map((r) => Map<String, dynamic>.from(r)).toList();
          _loading = false;
        });
    } catch (_) {
      if (mounted)
        setState(() {
          _loading = false;
          _error = 'Lists could not be loaded. Refresh to retry.';
        });
    }
  }

  Future<void> _create() async {
    final user = _db.auth.currentUser;
    if (user == null || _busy) return;
    final name = TextEditingController(), description = TextEditingController();
    var isPrivate = false;
    final valid = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Create list'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  maxLength: 100,
                  decoration: const InputDecoration(
                    labelText: 'List name',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: description,
                  maxLength: 500,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Description (optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: isPrivate,
                  title: const Text('Private list'),
                  onChanged: (v) => setDialogState(() => isPrivate = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () =>
                  Navigator.pop(dialogContext, name.text.trim().isNotEmpty),
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
    if (valid != true || !mounted) {
      name.dispose();
      description.dispose();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final row = await _db
          .from('lists')
          .insert({
            'owner_id': user.id,
            'name': name.text.trim(),
            'description': description.text.trim().isEmpty
                ? null
                : description.text.trim(),
            'is_private': isPrivate,
          })
          .select('id')
          .single();
      name.dispose();
      description.dispose();
      await _load();
      if (mounted) context.push('/lists/${row['id']}');
    } catch (_) {
      if (mounted)
        setState(
          () =>
              _error = 'List was not created. Check your connection and retry.',
        );
    } finally {
      if (mounted) setState(() => _busy = false);
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
          Row(
            children: [
              Expanded(
                child: Text(
                  'Your lists',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              FilledButton.icon(
                onPressed: _busy ? null : _create,
                icon: const Icon(Icons.add),
                label: const Text('Create'),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text('Organize accounts into public or private lists.'),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          if (!_loading && _error == null && _lists.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(Icons.list_alt_outlined, size: 42),
                    const SizedBox(height: 10),
                    const Text('No lists yet'),
                    const SizedBox(height: 8),
                    FilledButton.icon(
                      onPressed: _create,
                      icon: const Icon(Icons.add),
                      label: const Text('Create your first list'),
                    ),
                  ],
                ),
              ),
            ),
          for (final item in _lists)
            Card(
              child: ListTile(
                leading: CircleAvatar(
                  child: Icon(
                    item['is_private'] == true
                        ? Icons.lock_outline
                        : Icons.public,
                  ),
                ),
                title: Text('${item['name']}'),
                subtitle: Text(
                  '${item['description'] ?? ''}\n${item['member_count'] ?? 0} members',
                ),
                isThreeLine: true,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/lists/${item['id']}'),
              ),
            ),
        ],
      ),
    );
  }
}

class ListDetailPage extends StatefulWidget {
  const ListDetailPage({required this.listId, super.key});
  final String listId;
  @override
  State<ListDetailPage> createState() => _ListDetailPageState();
}

class _ListDetailPageState extends State<ListDetailPage> {
  final _db = Supabase.instance.client;
  bool _loading = true, _busy = false;
  String? _error;
  String _tab = 'posts';
  Map<String, dynamic>? _list;
  List<Map<String, dynamic>> _members = const [],
      _posts = const [],
      _matches = const [];
  final _search = TextEditingController();
  bool get _isOwner => _list?['owner_id'] == _db.auth.currentUser?.id;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Future.wait<dynamic>([
        _db
            .from('lists')
            .select('id,owner_id,name,description,is_private,member_count')
            .eq('id', widget.listId)
            .maybeSingle(),
        _db
            .from('list_members')
            .select('user_id,created_at')
            .eq('list_id', widget.listId)
            .order('created_at', ascending: false)
            .limit(300),
        _db.rpc(
          'get_list_timeline',
          params: {'p_list_id': widget.listId, 'p_limit': 50, 'p_offset': 0},
        ),
      ]);
      final list = result[0] == null
          ? null
          : Map<String, dynamic>.from(result[0] as Map);
      final rows = (result[1] as List)
          .whereType<Map>()
          .map((r) => Map<String, dynamic>.from(r))
          .toList();
      final ids = rows.map((r) => '${r['user_id']}').toList();
      final profiles = ids.isEmpty
          ? <dynamic>[]
          : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url,verified')
                .inFilter('id', ids);
      final byId = {
        for (final p in profiles) '${p['id']}': Map<String, dynamic>.from(p),
      };
      final timeline = result[2] is List ? result[2] as List : <dynamic>[];
      if (mounted)
        setState(() {
          _list = list;
          _members = ids
              .map((id) => byId[id])
              .whereType<Map<String, dynamic>>()
              .toList();
          _posts = timeline
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
          _loading = false;
          if (list == null)
            _error = 'List is unavailable or access is restricted.';
        });
    } catch (_) {
      if (mounted)
        setState(() {
          _loading = false;
          _error = 'List details could not be loaded. Refresh to retry.';
        });
    }
  }

  Future<void> _searchUsers() async {
    final q = _search.text.trim().replaceAll('%', '').replaceAll('_', '');
    if (!_isOwner || q.length < 2) {
      setState(() => _matches = const []);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final rows = await _db
          .from('profiles')
          .select('id,username,display_name,avatar_url,verified')
          .ilike('username', '%$q%')
          .limit(20);
      final existing = _members.map((m) => '${m['id']}').toSet();
      if (mounted)
        setState(
          () => _matches = rows
              .map((r) => Map<String, dynamic>.from(r))
              .where((r) => !existing.contains('${r['id']}'))
              .toList(),
        );
    } catch (_) {
      if (mounted) setState(() => _error = 'User search failed. Retry.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeMember(
    Map<String, dynamic> member, {
    required bool add,
  }) async {
    if (!_isOwner || _busy) return;
    setState(() => _busy = true);
    try {
      if (add) {
        await _db.from('list_members').insert({
          'list_id': widget.listId,
          'user_id': member['id'],
        });
      } else {
        await _db
            .from('list_members')
            .delete()
            .eq('list_id', widget.listId)
            .eq('user_id', member['id']);
      }
      if (mounted) {
        setState(() {
          _matches = const [];
          _search.clear();
        });
        await _load();
      }
    } catch (_) {
      if (mounted)
        setState(
          () => _error = add
              ? 'Account could not be added.'
              : 'Account could not be removed.',
        );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    if (!_isOwner) return;
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this list?'),
        content: const Text(
          'The list and its membership records will be deleted.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    try {
      await _db
          .from('lists')
          .delete()
          .eq('id', widget.listId)
          .eq('owner_id', _db.auth.currentUser!.id);
      if (mounted) context.go('/lists');
    } catch (_) {
      if (mounted) setState(() => _error = 'List could not be deleted.');
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
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          if (!_loading && _list != null) ...[
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${_list!['name']}',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                if (_isOwner)
                  IconButton(
                    onPressed: _delete,
                    tooltip: 'Delete list',
                    icon: const Icon(Icons.delete_outline),
                  ),
              ],
            ),
            if ('${_list!['description'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('${_list!['description']}'),
              ),
            Text(
              '${_list!['member_count'] ?? _members.length} members • ${_list!['is_private'] == true ? 'Private' : 'Public'}',
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(
                  value: 'posts',
                  label: Text('Posts'),
                  icon: Icon(Icons.article_outlined),
                ),
                ButtonSegment(
                  value: 'members',
                  label: Text('Members'),
                  icon: Icon(Icons.people_outline),
                ),
              ],
              selected: {_tab},
              onSelectionChanged: (v) => setState(() => _tab = v.first),
            ),
            const SizedBox(height: 12),
            if (_tab == 'posts') ...[
              if (_posts.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(18),
                    child: Text(
                      'No posts in this list yet. Add members to populate the timeline.',
                    ),
                  ),
                ),
              for (final post in _posts)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '@${post['username'] ?? 'member'}',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        const SizedBox(height: 8),
                        Text('${post['body'] ?? post['content'] ?? ''}'),
                        const SizedBox(height: 6),
                        Text(
                          '${post['created_at'] ?? ''}',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ),
            ] else ...[
              if (_isOwner)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      children: [
                        TextField(
                          controller: _search,
                          decoration: const InputDecoration(
                            labelText: 'Search username to add',
                            border: OutlineInputBorder(),
                          ),
                          onSubmitted: (_) => _searchUsers(),
                        ),
                        const SizedBox(height: 8),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _searchUsers,
                            icon: const Icon(Icons.search),
                            label: const Text('Search users'),
                          ),
                        ),
                        for (final user in _matches)
                          ListTile(
                            title: Text('@${user['username'] ?? 'unknown'}'),
                            subtitle: Text('${user['display_name'] ?? ''}'),
                            trailing: IconButton(
                              onPressed: _busy
                                  ? null
                                  : () => _changeMember(user, add: true),
                              icon: const Icon(Icons.person_add_alt_1),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              if (_members.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(18),
                    child: Text('This list has no members yet.'),
                  ),
                ),
              for (final member in _members)
                Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      child: Text(
                        '${member['username'] ?? '?'}'
                            .substring(0, 1)
                            .toUpperCase(),
                      ),
                    ),
                    title: Text('@${member['username'] ?? 'unknown'}'),
                    subtitle: Text('${member['display_name'] ?? ''}'),
                    trailing: _isOwner
                        ? IconButton(
                            onPressed: _busy
                                ? null
                                : () => _changeMember(member, add: false),
                            tooltip: 'Remove member',
                            icon: const Icon(Icons.person_remove_outlined),
                          )
                        : null,
                    onTap: () => context.push('/profile/${member['username']}'),
                  ),
                ),
            ],
          ],
        ],
      ),
    );
  }
}
