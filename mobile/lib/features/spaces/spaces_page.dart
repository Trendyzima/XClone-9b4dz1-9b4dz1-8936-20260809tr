import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

class SpacesPage extends StatefulWidget {
  const SpacesPage({super.key, this.spaceId, this.recordingId});
  final String? spaceId;
  final String? recordingId;
  @override
  State<SpacesPage> createState() => _SpacesPageState();
}

class _SpacesPageState extends State<SpacesPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  String _tab = 'Live';
  bool _loading = true, _creating = false;
  String? _error;
  Map<String, dynamic>? _detail;
  List<Map<String, dynamic>> _spaces = [], _recordings = [];

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
      if (widget.recordingId != null) {
        final row = await _db
            .from('space_recordings')
            .select(
                'id,space_id,title,audio_url,video_url,duration,file_size,mime_type,created_at,expires_at,user_id')
            .eq('id', widget.recordingId!)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        if (row == null) {
          throw StateError('Recording not found');
        }
        if (mounted) {
          setState(() => _recordings = [Map<String, dynamic>.from(row)]);
        }
        return;
      }
      if (widget.spaceId != null) {
        final row = await _db
            .from('spaces')
            .select(
                'id,host_id,title,description,is_live,listener_count,started_at,ended_at,category,artwork_url,episode_number,chapters,tags,subscriber_only,room_name,created_at,is_archived,archived_at,has_video,is_recording,topic,language,scheduled_for,max_audience,recording_enabled,listener_requests_enabled')
            .eq('id', widget.spaceId!)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        if (row == null) throw StateError('Space not found');
        final host = await _db
            .from('profiles')
            .select('id,username,display_name,avatar_url,verified')
            .eq('id', '${row['host_id']}')
            .maybeSingle();
        final recordings = await _db
            .from('space_recordings')
            .select(
                'id,space_id,title,audio_url,video_url,duration,file_size,mime_type,created_at,expires_at,user_id')
            .eq('space_id', widget.spaceId!)
            .order('created_at', ascending: false)
            .limit(10);
        if (mounted) {
          setState(() {
            _detail = {...Map<String, dynamic>.from(row), 'host': host};
            _recordings = recordings.map((r) => Map<String, dynamic>.from(r as Map)).toList();
          });
        }
        return;
      }
      if (_tab == 'Recordings') {
        final rows = await _db
            .from('space_recordings')
            .select(
                'id,space_id,title,audio_url,video_url,duration,file_size,mime_type,created_at,expires_at,user_id')
            .order('created_at', ascending: false)
            .limit(50)
            .timeout(const Duration(seconds: 15));
        if (mounted) {
          setState(
              () => _recordings = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList());
        }
      } else {
        var query = _db
            .from('spaces')
            .select(
                'id,host_id,title,description,is_live,listener_count,started_at,ended_at,category,artwork_url,created_at,is_archived,has_video,is_recording,topic,language,scheduled_for,max_audience,recording_enabled,listener_requests_enabled')
            .eq('is_archived', false);
        if (_tab == 'Live') {
          query = query.eq('is_live', true);
        } else {
          query = query.eq('is_live', false);
        }
        final rows = await query
            .order(_tab == 'Live' ? 'started_at' : 'scheduled_for', ascending: _tab != 'Live')
            .limit(50)
            .timeout(const Duration(seconds: 15));
        final spaces = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        final hosts = spaces.map((s) => '${s['host_id']}').toSet().toList();
        final profiles = hosts.isEmpty
            ? <dynamic>[]
            : await _db
                .from('profiles')
                .select('id,username,display_name,avatar_url,verified')
                .inFilter('id', hosts);
        final byId = {for (final p in profiles) '${p['id']}': Map<String, dynamic>.from(p as Map)};
        for (final space in spaces) {
          space['host'] = byId['${space['host_id']}'];
        }
        if (mounted) setState(() => _spaces = spaces);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Spaces could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createSpace() async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final title = TextEditingController(),
        description = TextEditingController(),
        topic = TextEditingController();
    String category = 'general';
    DateTime? scheduledFor;
    bool recording = false;
    final result = await showDialog<bool>(
        context: context,
        builder: (ctx) => StatefulBuilder(
            builder: (ctx, update) => AlertDialog(
                    title: const Text('Prepare a Live Space'),
                    content: SingleChildScrollView(
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                      TextField(
                          controller: title,
                          maxLength: 100,
                          decoration: const InputDecoration(labelText: 'Title')),
                      TextField(
                          controller: topic,
                          maxLength: 120,
                          decoration: const InputDecoration(labelText: 'Topic')),
                      TextField(
                          controller: description,
                          maxLength: 1000,
                          maxLines: 3,
                          decoration: const InputDecoration(labelText: 'Description')),
                      DropdownButtonFormField<String>(
                          initialValue: category,
                          decoration: const InputDecoration(labelText: 'Category'),
                          items: const [
                            DropdownMenuItem(value: 'general', child: Text('General')),
                            DropdownMenuItem(value: 'music', child: Text('Music')),
                            DropdownMenuItem(value: 'education', child: Text('Education')),
                            DropdownMenuItem(value: 'news', child: Text('News')),
                            DropdownMenuItem(value: 'gaming', child: Text('Gaming'))
                          ],
                          onChanged: (v) {
                            if (v != null) update(() => category = v);
                          }),
                      SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Enable recording'),
                          value: recording,
                          onChanged: (v) => update(() => recording = v)),
                      ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(scheduledFor == null
                              ? 'Start time: not scheduled'
                              : 'Scheduled: ${scheduledFor!.toLocal()}'),
                          subtitle: const Text(
                              'This prepares the room; it does not start a live broadcast.'),
                          trailing: IconButton(
                              icon: const Icon(Icons.calendar_month_rounded),
                              onPressed: () async {
                                final date = await showDatePicker(
                                    context: ctx,
                                    initialDate: DateTime.now().add(const Duration(days: 1)),
                                    firstDate: DateTime.now(),
                                    lastDate: DateTime.now().add(const Duration(days: 365)));
                                if (date == null || !ctx.mounted) return;
                                final time = await showTimePicker(
                                    context: ctx,
                                    initialTime: const TimeOfDay(hour: 18, minute: 0));
                                if (time != null) {
                                  update(() => scheduledFor = DateTime(
                                          date.year, date.month, date.day, time.hour, time.minute)
                                      .toUtc());
                                }
                              })),
                      if (scheduledFor != null)
                        TextButton(
                            onPressed: () => update(() => scheduledFor = null),
                            child: const Text('Clear schedule'))
                    ])),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('Prepare room'))
                    ])));
    if (result != true) {
      title.dispose();
      description.dispose();
      topic.dispose();
      return;
    }
    if (!mounted) {
      title.dispose();
      description.dispose();
      topic.dispose();
      return;
    }
    if (title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('A space title is required.')));
      title.dispose();
      description.dispose();
      topic.dispose();
      return;
    }
    setState(() => _creating = true);
    try {
      final capability = await _db.rpc('get_audio_space_host_capability');
      if (capability is List && capability.isNotEmpty && capability.first['can_host'] != true) {
        throw StateError('SPACE_HOST_NOT_ELIGIBLE');
      }
      final row = await _db.rpc('create_audio_space', params: {
        'p_title': title.text.trim(),
        'p_description': description.text.trim(),
        'p_topic': topic.text.trim(),
        'p_visibility': 'public',
        'p_category': category,
        'p_language': 'en',
        'p_scheduled_for': scheduledFor?.toIso8601String(),
        'p_max_audience': 1000,
        'p_recording_enabled': recording,
        'p_listener_requests_enabled': true
      });
      final map = row is Map ? Map<String, dynamic>.from(row) : <String, dynamic>{};
      await _load();
      if (mounted && map['id'] != null) context.go('/spaces/${map['id']}');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text(
                'Space prepared. The Flutter audio transport must be verified before going live.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('$e'.contains('SPACE_HOST_NOT_ELIGIBLE')
                ? 'Your account is not currently eligible to host a Live Space.'
                : 'Could not prepare the space. Check permissions and retry.')));
      }
    } finally {
      title.dispose();
      description.dispose();
      topic.dispose();
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _openRecording(Map<String, dynamic> recording) async {
    final raw = '${recording['video_url'] ?? recording['audio_url'] ?? ''}';
    final uri = Uri.tryParse(raw);
    if (uri == null || !{'https', 'http'}.contains(uri.scheme) || uri.host.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Recording URL is unavailable.')));
      return;
    }
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Could not open this recording.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.recordingId != null) return _buildRecordingDetail(context);
    if (widget.spaceId != null) return _buildDetail(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          Expanded(
              child: Text('Live Spaces',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900))),
          FilledButton.icon(
              onPressed: _creating ? null : _createSpace,
              icon: const Icon(Icons.add_rounded),
              label: Text(_creating ? 'Preparing…' : 'Create space')),
        ]),
        const SizedBox(height: 4),
        const Text('Audio conversations, scheduled rooms and recordings.'),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'Live', label: Text('Live')),
            ButtonSegment(value: 'Upcoming', label: Text('Upcoming')),
            ButtonSegment(value: 'Recordings', label: Text('Replays'))
          ],
          selected: {_tab},
          onSelectionChanged: (v) {
            setState(() => _tab = v.first);
            _load();
          },
        ),
        if (_loading)
          const Padding(
              padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Text(_error!),
                TextButton(onPressed: _load, child: const Text('Retry'))
              ])),
        if (!_loading && _tab != 'Recordings' && _spaces.isEmpty && _error == null)
          Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                  child: Text(_tab == 'Live'
                      ? 'No spaces are live right now.'
                      : 'No upcoming rooms yet. Prepare one to get started.'))),
        if (!_loading && _tab == 'Recordings' && _recordings.isEmpty && _error == null)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('No recordings are available.'))),
        if (_tab == 'Recordings') ..._recordings.map(_recordingCard),
        if (_tab != 'Recordings') ..._spaces.map(_spaceCard),
      ]),
    );
  }

  Widget _spaceCard(Map<String, dynamic> s) {
    final host = (s['host'] as Map<String, dynamic>?) ?? {};
    final id = '${s['id']}';
    final avatar = '${host['avatar_url'] ?? ''}';
    final title = '${s['title'] ?? 'Live Space'}';
    return Card(
      margin: const EdgeInsets.only(bottom: 9),
      child: InkWell(
        onTap: () => context.go('/spaces/$id'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(
                  backgroundImage: avatar.startsWith('http') ? NetworkImage(avatar) : null,
                  child:
                      avatar.startsWith('http') ? null : const Icon(Icons.person_outline_rounded)),
              const SizedBox(width: 10),
              Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                Text('@${host['username'] ?? 'host'}', style: Theme.of(context).textTheme.bodySmall)
              ])),
              Chip(
                  label: Text(s['is_live'] == true ? 'LIVE' : 'UPCOMING'),
                  visualDensity: VisualDensity.compact),
            ]),
            if ('${s['topic'] ?? ''}'.isNotEmpty)
              Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child:
                      Text('${s['topic']}', style: const TextStyle(fontWeight: FontWeight.w700))),
            if ('${s['description'] ?? ''}'.isNotEmpty)
              Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('${s['description']}', maxLines: 3, overflow: TextOverflow.ellipsis)),
            const SizedBox(height: 8),
            Text(
                '${s['listener_count'] ?? 0} listeners · ${s['category'] ?? 'general'} · ${s['scheduled_for'] ?? s['started_at'] ?? 'Not scheduled'}',
                style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 8),
            Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton(
                    onPressed: () => context.go('/spaces/$id'), child: const Text('Room details'))),
          ]),
        ),
      ),
    );
  }

  Widget _recordingCard(Map<String, dynamic> r) => Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          leading: const CircleAvatar(child: Icon(Icons.headphones_rounded)),
          title: Text('${r['title'] ?? 'Space recording'}',
              style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text('${r['created_at'] ?? ''} · ${r['duration'] ?? 0}s'),
          trailing: IconButton(
              onPressed: () => _openRecording(r), icon: const Icon(Icons.play_arrow_rounded)),
        ),
      );

  Widget _buildDetail(BuildContext context) {
    final s = _detail;
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null || s == null) {
      return Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(_error ?? 'Space not found'),
        TextButton(onPressed: _load, child: const Text('Retry'))
      ]));
    }
    final host = (s['host'] as Map<String, dynamic>?) ?? {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          IconButton(
              onPressed: () => context.go('/spaces'), icon: const Icon(Icons.arrow_back_rounded)),
          Expanded(
              child: Text('Space details',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900)))
        ]),
        Card(
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${s['title']}',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w900)),
                  Text(
                      'Hosted by ${host['display_name'] ?? host['username'] ?? 'Testagram creator'}'),
                  const SizedBox(height: 10),
                  Text('${s['description'] ?? ''}'),
                  if ('${s['topic'] ?? ''}'.isNotEmpty)
                    Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text('Topic: ${s['topic']}')),
                  const SizedBox(height: 10),
                  Text('${s['listener_count'] ?? 0} listeners · ${s['category'] ?? 'general'}'),
                  const SizedBox(height: 8),
                  Text(s['is_live'] == true
                      ? 'This room is marked live by the server.'
                      : 'Scheduled: ${s['scheduled_for'] ?? 'Not scheduled'}'),
                  const SizedBox(height: 12),
                  const Text(
                      'Audio transport gate: Flutter has not yet completed WebRTC signaling, remote audio playback, microphone permission recovery, and speaker/host media readiness checks. Live audio controls remain disabled rather than pretending the room is connected.',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  if (s['is_live'] == true)
                    const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                            'Do not rely on this screen to listen or speak until the media gate is cleared.',
                            style: TextStyle(color: Colors.orange, fontWeight: FontWeight.w800))),
                ]))),
        if (_recordings.isNotEmpty)
          Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text('Recordings',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w900))),
        ..._recordings.map(_recordingCard),
      ]),
    );
  }

  Widget _buildRecordingDetail(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null || _recordings.isEmpty) {
      return Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(_error ?? 'Recording not found'),
        TextButton(onPressed: _load, child: const Text('Retry'))
      ]));
    }
    final recording = _recordings.first;
    return ListView(padding: const EdgeInsets.all(14), children: [
      Row(children: [
        IconButton(
            onPressed: () => context.go('/spaces'), icon: const Icon(Icons.arrow_back_rounded)),
        Expanded(
            child: Text('Space recording',
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w900)))
      ]),
      Card(
          child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.headphones_rounded, size: 48),
                const SizedBox(height: 12),
                Text('${recording['title'] ?? 'Space recording'}',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                Text('Created: ${recording['created_at'] ?? '—'}'),
                Text('Duration: ${recording['duration'] ?? 0} seconds'),
                if (recording['expires_at'] != null)
                  Text('Available until: ${recording['expires_at']}'),
                const SizedBox(height: 14),
                FilledButton.icon(
                    onPressed: () => _openRecording(recording),
                    icon: const Icon(Icons.play_arrow_rounded),
                    label: const Text('Open recording')),
              ]))),
    ]);
  }
}
