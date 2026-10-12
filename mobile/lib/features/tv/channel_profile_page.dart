import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ChannelProfilePage extends StatefulWidget {
  const ChannelProfilePage({super.key, required this.handle});
  final String handle;

  @override
  State<ChannelProfilePage> createState() => _ChannelProfilePageState();
}

class _ChannelProfilePageState extends State<ChannelProfilePage> {
  SupabaseClient get _db => Supabase.instance.client;
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _streams = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final profile = await _db
          .from('profiles')
          .select('*')
          .eq('username', widget.handle)
          .maybeSingle()
          .timeout(const Duration(seconds: 12));
      if (profile == null) {
        if (mounted) {
          setState(() => _error = 'This channel could not be found.');
        }
        return;
      }
      final rows = await _db
          .from('live_streams')
          .select(
              'id,title,description,category,is_live,started_at,viewer_count,created_at')
          .eq('user_id', profile['id'])
          .eq('is_live', true)
          .order('started_at', ascending: false)
          .limit(30)
          .timeout(const Duration(seconds: 12));
      if (mounted) {
        setState(() {
          _profile = Map<String, dynamic>.from(profile);
          _streams = rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Channel details could not load. Please retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = _profile ?? const <String, dynamic>{};
    final displayName = '${profile['display_name'] ?? profile['full_name'] ?? widget.handle}';
    final avatar = '${profile['avatar_url'] ?? ''}';
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => context.go('/tv'),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              Expanded(
                child: Text(
                  'Channel',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                ),
              ),
              IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded)),
            ],
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 36,
                    backgroundImage: avatar.startsWith('http') ? NetworkImage(avatar) : null,
                    child: avatar.startsWith('http') ? null : const Icon(Icons.tv_rounded, size: 32),
                  ),
                  const SizedBox(height: 12),
                  Text(displayName, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
                  Text('@${widget.handle}', style: Theme.of(context).textTheme.bodyMedium),
                  if ('${profile['bio'] ?? ''}'.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text('${profile['bio']}', textAlign: TextAlign.center),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Live now', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          if (_loading) const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
          if (_error != null) Padding(
            padding: const EdgeInsets.all(12),
            child: Column(children: [
              Text(_error!, textAlign: TextAlign.center),
              TextButton(onPressed: _load, child: const Text('Retry')),
            ]),
          ),
          if (!_loading && _error == null && _streams.isEmpty)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: Text('This channel has no live broadcast at the moment.')),
            ),
          ..._streams.map((stream) => Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: ListTile(
              leading: const CircleAvatar(child: Icon(Icons.live_tv_rounded)),
              title: Text('${stream['title'] ?? 'Live broadcast'}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('${stream['description'] ?? stream['category'] ?? 'Live on Testagram'}'),
              trailing: const Icon(Icons.play_circle_fill_rounded),
              onTap: () => context.go('/stream/${stream['id']}'),
            ),
          )),
        ],
      ),
    );
  }
}
