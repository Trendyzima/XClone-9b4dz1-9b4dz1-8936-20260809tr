import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class CreatorStudioPage extends StatefulWidget {
  const CreatorStudioPage({super.key, this.section = 'overview'});
  final String section;
  @override
  State<CreatorStudioPage> createState() => _CreatorStudioPageState();
}

class _CreatorStudioPageState extends State<CreatorStudioPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  bool _loading = true, _saving = false;
  String? _error;
  Map<String, dynamic> _profile = {};
  List<Map<String, dynamic>> _posts = [];
  List<Map<String, dynamic>> _earnings = [];
  double _goal = 0;
  final _goalInput = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _goalInput.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final uid = _uid;
    if (uid == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to access Creator Studio.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await Future.wait<dynamic>([
        _db
            .from('profiles')
            .select(
                'id,username,display_name,follower_count,is_creator,can_monetize')
            .eq('id', uid)
            .maybeSingle(),
        _db
            .from('posts')
            .select(
                'id,content,views_count,likes_count,reposts_count,replies_count,is_video,is_monetized,price,created_at,video_url')
            .eq('user_id', uid)
            .order('created_at', ascending: false)
            .limit(30),
        _db
            .from('creator_earnings')
            .select('amount,source,status,created_at')
            .eq('creator_id', uid)
            .order('created_at', ascending: false)
            .limit(60),
        _db
            .from('user_monetization')
            .select('monthly_tip_goal')
            .eq('user_id', uid)
            .maybeSingle(),
      ]).timeout(const Duration(seconds: 20));
      if (!mounted) return;
      setState(() {
        _profile = Map<String, dynamic>.from((result[0] as Map?) ?? {});
        _posts = (result[1] as List)
            .map((r) => Map<String, dynamic>.from(r as Map))
            .toList();
        _earnings = (result[2] as List)
            .map((r) => Map<String, dynamic>.from(r as Map))
            .toList();
        _goal = double.tryParse(
                '${(result[3] as Map?)?['monthly_tip_goal'] ?? 0}') ??
            0;
        _goalInput.text = _goal == 0 ? '' : _goal.toStringAsFixed(2);
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Creator data could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  double get _totalEarnings =>
      _earnings.where((e) => e['status'] == 'paid').fold<double>(
          0, (sum, e) => sum + (double.tryParse('${e['amount']}') ?? 0));
  int get _views => _posts.fold<int>(
      0, (sum, p) => sum + (int.tryParse('${p['views_count'] ?? 0}') ?? 0));
  int get _likes => _posts.fold<int>(
      0, (sum, p) => sum + (int.tryParse('${p['likes_count'] ?? 0}') ?? 0));

  Future<void> _toggleMonetization(Map<String, dynamic> post) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final id = '${post['id']}';
    final old = post['is_monetized'] == true;
    setState(() => post['is_monetized'] = !old);
    try {
      await _db
          .from('posts')
          .update({'is_monetized': !old})
          .eq('id', id)
          .eq('user_id', uid);
    } catch (_) {
      if (mounted) {
        setState(() => post['is_monetized'] = old);
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not update monetization.')));
      }
    }
  }

  Future<void> _saveGoal() async {
    final uid = _uid;
    if (uid == null) return;
    final value = double.tryParse(_goalInput.text.trim());
    if (value == null || value < 0) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enter a valid non-negative goal.')));
      return;
    }
    setState(() => _saving = true);
    try {
      await _db.from('user_monetization').upsert(
          {'user_id': uid, 'monthly_tip_goal': value},
          onConflict: 'user_id');
      if (mounted) {
        setState(() => _goal = value);
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Monthly goal saved')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not save your goal.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tab = widget.section;
    if (_uid == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.video_settings_rounded, size: 48),
            const SizedBox(height: 12),
            const Text('Creator Studio requires an account.'),
            const SizedBox(height: 12),
            FilledButton(
                onPressed: () => context.go('/auth'),
                child: const Text('Sign in')),
          ]),
        ),
      );
    }
    final creatorName =
        '${_profile['display_name'] ?? _profile['username'] ?? 'Creator'}';
    final avatarLabel =
        creatorName.isEmpty ? 'C' : creatorName[0].toUpperCase();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Text('Creator Studio',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Text('Your content, audience, and earnings in one workspace.',
            style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 14),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final item in const [
            ('overview', 'Overview'),
            ('analytics', 'Analytics'),
            ('videos', 'Videos'),
            ('earnings', 'Earnings'),
            ('revenue', 'Revenue')
          ])
            ChoiceChip(
                label: Text(item.$2),
                selected: tab == item.$1,
                onSelected: (_) => context.go(item.$1 == 'overview'
                    ? '/creator-studio'
                    : '/creator-studio/${item.$1}')),
        ]),
        if (_loading)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Text(_error!),
                TextButton(onPressed: _load, child: const Text('Retry'))
              ])),
        if (!_loading && _error == null) ...[
          const SizedBox(height: 12),
          Card(
              child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(children: [
                    CircleAvatar(radius: 26, child: Text(avatarLabel)),
                    const SizedBox(width: 12),
                    Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                          Text(creatorName,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w900, fontSize: 17)),
                          Text(
                              '@${_profile['username'] ?? 'creator'} · ${_profile['follower_count'] ?? 0} followers'),
                        ])),
                  ]))),
          if (tab == 'overview' || tab == 'analytics')
            Wrap(spacing: 8, runSpacing: 8, children: [
              _stat('Views', _views.toString()),
              _stat('Likes', _likes.toString()),
              _stat('Posts', _posts.length.toString()),
              _stat('Paid earnings', _totalEarnings.toStringAsFixed(2))
            ]),
          if (tab == 'overview' || tab == 'earnings' || tab == 'revenue')
            Card(
                margin: const EdgeInsets.only(top: 12),
                child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Earnings',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 6),
                          Text(
                              'Paid total: ${_totalEarnings.toStringAsFixed(2)}',
                              style: const TextStyle(
                                  fontWeight: FontWeight.w800, fontSize: 22)),
                          const SizedBox(height: 8),
                          if (_earnings.isEmpty)
                            const Text('No earnings recorded yet.')
                          else
                            ..._earnings.take(12).map((e) => ListTile(
                                contentPadding: EdgeInsets.zero,
                                dense: true,
                                leading: const Icon(Icons.payments_outlined),
                                title: Text(
                                    '${e['source'] ?? 'Creator earnings'}'),
                                subtitle: Text(
                                    '${e['created_at'] ?? ''} · ${e['status'] ?? 'pending'}'),
                                trailing: Text('${e['amount'] ?? 0}'))),
                        ]))),
          if (tab == 'overview' || tab == 'analytics')
            Card(
                margin: const EdgeInsets.only(top: 12),
                child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Monthly tip goal',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(fontWeight: FontWeight.w800)),
                          const SizedBox(height: 8),
                          Row(children: [
                            Expanded(
                                child: TextField(
                                    controller: _goalInput,
                                    keyboardType:
                                        const TextInputType.numberWithOptions(
                                            decimal: true),
                                    decoration: const InputDecoration(
                                        prefixText: 'KES ',
                                        hintText: 'Set your goal'))),
                            const SizedBox(width: 8),
                            FilledButton(
                                onPressed: _saving ? null : _saveGoal,
                                child: Text(_saving ? 'Saving…' : 'Save'))
                          ]),
                          if (_goal > 0)
                            Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: LinearProgressIndicator(
                                    value:
                                        (_totalEarnings / _goal).clamp(0, 1))),
                        ]))),
          if (tab == 'overview' || tab == 'videos')
            Padding(
                padding: const EdgeInsets.only(top: 16, bottom: 6),
                child: Text('Your content',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w900))),
          if (tab == 'overview' || tab == 'videos')
            ..._posts
                .where((p) => tab != 'videos' || p['is_video'] == true)
                .map((p) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: Icon(p['is_video'] == true
                            ? Icons.play_circle_outline_rounded
                            : Icons.article_outlined),
                        title: Text('${p['content'] ?? 'Untitled post'}',
                            maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                            '${p['views_count'] ?? 0} views · ${p['likes_count'] ?? 0} likes · ${p['created_at'] ?? ''}'),
                        trailing: p['is_video'] == true
                            ? Switch(
                                value: p['is_monetized'] == true,
                                onChanged: (_) => _toggleMonetization(p))
                            : null,
                        onTap: () => context.go('/post/${p['id']}'),
                      ),
                    )),
          if (tab == 'overview')
            Card(
                margin: const EdgeInsets.only(top: 8),
                child: Column(children: [
                  ListTile(
                      leading: const Icon(Icons.live_tv_rounded),
                      title: const Text('TV production studio'),
                      subtitle: const Text('Broadcast and guest controls'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.go('/tv-studio')),
                  ListTile(
                      leading: const Icon(Icons.schedule_rounded),
                      title: const Text('Scheduled posts'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.go('/scheduled')),
                  ListTile(
                      leading: const Icon(Icons.insights_rounded),
                      title: const Text('Monetization dashboard'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => context.go('/monetization')),
                ])),
        ],
      ]),
    );
  }

  Widget _stat(String label, String value) => SizedBox(
      width: 155,
      child: Card(
          child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 6),
                    Text(value,
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontWeight: FontWeight.w900))
                  ]))));
}
