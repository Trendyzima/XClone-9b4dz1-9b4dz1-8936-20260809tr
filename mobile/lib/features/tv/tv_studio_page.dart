import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Native broadcast metadata/control surface. The actual camera compositor,
/// WebRTC guest bridge and encoder hand-off are separate release gates; this
/// page intentionally never marks a stream live without that media pipeline.
class TvStudioPage extends StatefulWidget {
  const TvStudioPage({super.key, this.streamId, this.guestsOnly = false});

  final String? streamId;
  final bool guestsOnly;
  @override
  State<TvStudioPage> createState() => _TvStudioPageState();
}

class _TvStudioPageState extends State<TvStudioPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  List<Map<String, dynamic>> _streams = [];
  bool _loading = true, _creating = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final uid = _uid;
    if (uid == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to access TV production.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      var query = _db
          .from('live_streams')
          .select(
            'id,title,description,category,is_live,started_at,ended_at,viewer_count,created_at',
          )
          .eq('user_id', uid);
      final requestedStreamId = widget.streamId;
      if (requestedStreamId != null && requestedStreamId.isNotEmpty) {
        query = query.eq('id', requestedStreamId);
      }
      final rows = await query
          .order('created_at', ascending: false)
          .limit(30)
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      setState(() => _streams = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList());
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Your broadcast list could not load. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createDraft() async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final title = TextEditingController(), description = TextEditingController();
    String category = 'general';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => AlertDialog(
          title: const Text('Prepare a TV broadcast'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: title,
                  maxLength: 100,
                  decoration: const InputDecoration(labelText: 'Broadcast title'),
                ),
                TextField(
                  controller: description,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: const InputDecoration(labelText: 'Description'),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: category,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: const [
                    DropdownMenuItem(value: 'general', child: Text('General')),
                    DropdownMenuItem(value: 'news', child: Text('News')),
                    DropdownMenuItem(value: 'sports', child: Text('Sports')),
                    DropdownMenuItem(value: 'music', child: Text('Music')),
                    DropdownMenuItem(value: 'education', child: Text('Education')),
                    DropdownMenuItem(value: 'gaming', child: Text('Gaming')),
                  ],
                  onChanged: (v) {
                    if (v != null) update(() => category = v);
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Prepare')),
          ],
        ),
      ),
    );
    if (ok != true) {
      title.dispose();
      description.dispose();
      return;
    }
    if (!mounted) {
      title.dispose();
      description.dispose();
      return;
    }
    if (title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('A broadcast title is required.')));
      title.dispose();
      description.dispose();
      return;
    }
    setState(() => _creating = true);
    try {
      await _db.from('live_streams').insert({
        'user_id': uid,
        'title': title.text.trim(),
        'description': description.text.trim(),
        'category': category,
        'is_live': false,
      });
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Broadcast draft prepared. Production media setup is still required before going on air.',
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not prepare the broadcast. Check your permissions and retry.'),
          ),
        );
      }
    } finally {
      title.dispose();
      description.dispose();
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_uid == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.live_tv_rounded, size: 48),
              const SizedBox(height: 12),
              const Text('TV production requires an account.'),
              const SizedBox(height: 12),
              FilledButton(onPressed: () => context.go('/auth'), child: const Text('Sign in')),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Testagram TV Studio',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          const Text('Manage broadcast details and review your sessions.'),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.info_outline_rounded, color: Colors.amber),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Safety gate: this Flutter screen can prepare broadcast metadata, but camera composition, audio mixing, guest WebRTC, encoder authorization and verified on-air transitions must pass device tests before native “Go live” is enabled.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _creating ? null : _createDraft,
            icon: const Icon(Icons.add_circle_outline_rounded),
            label: Text(_creating ? 'Preparing…' : 'Prepare broadcast'),
          ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (widget.guestsOnly)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(14),
                child: Text(
                  'This route is scoped to the selected broadcast. Guest invitation and moderation controls still need their dedicated backend contract; no guest state is fabricated here.',
                ),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            ),
          if (!_loading && _streams.isEmpty && _error == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: Text('No broadcast sessions yet. Prepare your first broadcast.'),
              ),
            ),
          ..._streams.map((s) {
            final live = s['is_live'] == true;
            final id = '${s['id']}';
            return Card(
              margin: const EdgeInsets.only(top: 10),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          live ? Icons.sensors_rounded : Icons.movie_creation_outlined,
                          color: live ? Colors.red : null,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            '${s['title'] ?? 'Untitled broadcast'}',
                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                          ),
                        ),
                        Chip(
                          label: Text(live ? 'LIVE' : 'DRAFT'),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                    if ('${s['description'] ?? ''}'.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text('${s['description']}'),
                      ),
                    const SizedBox(height: 8),
                    Text(
                      'Category: ${s['category'] ?? 'general'} · ${s['viewer_count'] ?? 0} viewers',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        if (live)
                          OutlinedButton.icon(
                            onPressed: () => context.go('/tv/live/$id'),
                            icon: const Icon(Icons.play_arrow_rounded),
                            label: const Text('Open live page'),
                          ),
                        OutlinedButton.icon(
                          onPressed: () => context.go('/tv'),
                          icon: const Icon(Icons.live_tv_rounded),
                          label: const Text('Preview TV catalog'),
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
    );
  }
}
