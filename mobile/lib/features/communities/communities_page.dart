import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class CommunitiesPage extends StatefulWidget {
  const CommunitiesPage({super.key});
  @override
  State<CommunitiesPage> createState() => _CommunitiesPageState();
}

class _CommunitiesPageState extends State<CommunitiesPage> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _communities = [];
  final Set<String> _joined = {};
  bool _loading = false, _creating = false;
  String _tab = 'Discover', _sort = 'Popular';
  String? _error;
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  @override
  void initState() {
    super.initState();
    _load();
    _search.addListener(_loadDebounced);
  }

  @override
  void dispose() {
    _search.removeListener(_loadDebounced);
    _search.dispose();
    super.dispose();
  }

  void _loadDebounced() {
    if (mounted) _load();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      var query = _db.from('communities').select(
            'id,name,display_name,description,icon_url,banner_url,is_private,member_count,post_count,created_at',
          );
      final q = _search.text.trim().replaceAll(',', ' ').replaceAll('%', '').replaceAll('_', ' ');
      final filtered = q.isNotEmpty
          ? query.or('display_name.ilike.%$q%,name.ilike.%$q%,description.ilike.%$q%')
          : query;
      final rows = await filtered
          .order(
            _sort == 'Newest'
                ? 'created_at'
                : _sort == 'Active'
                    ? 'post_count'
                    : 'member_count',
            ascending: false,
          )
          .limit(50)
          .timeout(const Duration(seconds: 15));
      final data = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      if (_uid != null && data.isNotEmpty) {
        final memberships = await _db
            .from('community_members')
            .select('community_id')
            .eq('user_id', _uid!)
            .eq('status', 'active')
            .inFilter('community_id', data.map((r) => '${r['id']}').toList());
        _joined.addAll(memberships.map((r) => '${r['community_id']}'));
      }
      if (!mounted) return;
      setState(
        () => _communities = _tab == 'Joined'
            ? data.where((c) => _joined.contains('${c['id']}')).toList()
            : _tab == 'Discover'
                ? data.where((c) => !_joined.contains('${c['id']}')).toList()
                : data,
      );
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Communities could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _membership(Map<String, dynamic> community) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final id = '${community['id']}';
    final joining = !_joined.contains(id);
    setState(() {
      joining ? _joined.add(id) : _joined.remove(id);
    });
    try {
      await _db.rpc(joining ? 'join_community' : 'leave_community', params: {'p_community_id': id});
      await _load();
    } catch (_) {
      if (mounted) {
        setState(() {
          joining ? _joined.remove(id) : _joined.add(id);
        });
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Membership update failed. Please retry.')));
      }
    }
  }

  Future<void> _create() async {
    if (_uid == null) {
      context.go('/auth');
      return;
    }
    final name = TextEditingController(),
        title = TextEditingController(),
        description = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Create a community'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(labelText: 'URL name', hintText: 'technology'),
              ),
              TextField(
                controller: title,
                decoration: const InputDecoration(labelText: 'Display name'),
              ),
              TextField(
                controller: description,
                maxLines: 3,
                decoration: const InputDecoration(labelText: 'Description'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Create')),
        ],
      ),
    );
    if (ok != true) return;
    final slug = name.text.trim().toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');
    if (!mounted) return;
    if (slug.isEmpty || title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('A URL name and display name are required.')));
      return;
    }
    setState(() => _creating = true);
    try {
      await _db.from('communities').insert({
        'name': slug,
        'display_name': title.text.trim(),
        'description': description.text.trim(),
        'owner_id': _uid,
        'is_private': false,
        'member_count': 1,
        'post_count': 0,
      });
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Community created')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not create community. Check the name and permissions.'),
          ),
        );
      }
    } finally {
      name.dispose();
      title.dispose();
      description.dispose();
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(14),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Communities',
                    style: Theme.of(context)
                        .textTheme
                        .headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                ),
                FilledButton.icon(
                  onPressed: _creating ? null : _create,
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('Create'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text('Find your people. Join conversations that matter to you.'),
            const SizedBox(height: 14),
            TextField(
              controller: _search,
              decoration: InputDecoration(
                hintText: 'Search communities',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  onPressed: () {
                    _search.clear();
                    _load();
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
              ),
            ),
            const SizedBox(height: 10),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'Discover', label: Text('Discover')),
                ButtonSegment(value: 'All', label: Text('All')),
                ButtonSegment(value: 'Joined', label: Text('Joined')),
              ],
              selected: {_tab},
              onSelectionChanged: (v) {
                setState(() => _tab = v.first);
                _load();
              },
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _sort,
              decoration: const InputDecoration(labelText: 'Sort communities'),
              items: const [
                DropdownMenuItem(value: 'Popular', child: Text('Most members')),
                DropdownMenuItem(value: 'Active', child: Text('Most active')),
                DropdownMenuItem(value: 'Newest', child: Text('Newest')),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() => _sort = v);
                  _load();
                }
              },
            ),
            if (_loading)
              const Padding(padding: EdgeInsets.all(18), child: LinearProgressIndicator()),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(_error!),
                    TextButton(onPressed: _load, child: const Text('Retry')),
                  ],
                ),
              ),
            ..._communities.map((c) {
              final id = '${c['id']}';
              final slug = '${c['name'] ?? ''}';
              final title = '${c['display_name'] ?? slug}';
              final icon = '${c['icon_url'] ?? ''}';
              final banner = '${c['banner_url'] ?? ''}';
              final joined = _joined.contains(id);
              return Card(
                margin: const EdgeInsets.only(top: 10),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  onTap: () => context.go('/c/${Uri.encodeComponent(slug)}'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (banner.startsWith('http'))
                        SizedBox(
                          height: 92,
                          width: double.infinity,
                          child: CachedNetworkImage(
                            imageUrl: banner,
                            fit: BoxFit.cover,
                            errorWidget: (_, __, ___) => const SizedBox.shrink(),
                          ),
                        ),
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            CircleAvatar(
                              radius: 25,
                              backgroundImage:
                                  icon.startsWith('http') ? CachedNetworkImageProvider(icon) : null,
                              child: icon.startsWith('http')
                                  ? null
                                  : Text(title.isEmpty ? 'T' : title[0].toUpperCase()),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    title,
                                    style:
                                        const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                                  ),
                                  Text('c/$slug', style: Theme.of(context).textTheme.bodySmall),
                                  if ('${c['description'] ?? ''}'.isNotEmpty)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 6),
                                      child: Text(
                                        '${c['description']}',
                                        maxLines: 3,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  const SizedBox(height: 8),
                                  Text(
                                    '${c['member_count'] ?? 0} members · ${c['post_count'] ?? 0} posts',
                                    style: Theme.of(context).textTheme.bodySmall,
                                  ),
                                ],
                              ),
                            ),
                            if (_uid != null)
                              OutlinedButton(
                                onPressed: () => _membership(c),
                                child: Text(joined ? 'Joined' : 'Join'),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
            if (!_loading && _communities.isEmpty && _error == null)
              Padding(
                padding: const EdgeInsets.all(28),
                child: Center(
                  child: Text(
                    _tab == 'Joined'
                        ? 'You have not joined any communities yet.'
                        : 'No communities found. Try another search.',
                  ),
                ),
              ),
          ],
        ),
      );
}
