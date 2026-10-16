import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'team_chat_policy.dart';

/// Native staff-only team chat. Supabase RLS remains the authority for every
/// read/write; this client-side gate is an additional UX and least-privilege
/// boundary, not a replacement for database policies.
class TeamChatPage extends StatefulWidget {
  const TeamChatPage({super.key});

  @override
  State<TeamChatPage> createState() => _TeamChatPageState();
}

class _TeamChatPageState extends State<TeamChatPage> {
  final SupabaseClient _db = Supabase.instance.client;
  final TextEditingController _composer = TextEditingController();
  final ScrollController _scroll = ScrollController();
  List<Map<String, dynamic>> _messages = const [];
  Map<String, dynamic>? _job;
  bool _loading = true;
  bool _sending = false;
  bool _isEmployee = false;
  bool _isOwner = false;
  bool _isRegulator = false;
  String? _error;
  Map<String, dynamic>? _replyTo;
  int _generation = 0;

  bool get _canModerate => TeamChatPolicy.canModerate(isOwner: _isOwner, isRegulator: _isRegulator);
  String? get _userId => _db.auth.currentUser?.id;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _generation++;
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    final userId = _userId;
    if (userId == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to access internal team chat.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      var governance = <String, dynamic>{};
      var owner = false;
      try {
        final governanceResult = await Future.wait<dynamic>([
          _db.rpc('testagram_get_governance'),
          _db.rpc('testagram_is_owner'),
        ]).timeout(const Duration(seconds: 15));
        governance = governanceResult.first is Map
            ? Map<String, dynamic>.from(governanceResult.first as Map)
            : <String, dynamic>{};
        owner = governanceResult[1] == true || governance['is_owner'] == true;
      } catch (_) {
        // If governance is unavailable, the active employee assignment below
        // can still grant ordinary staff access; privileged status stays false.
      }
      // Do not infer regulator privileges from a role label. Only an explicit
      // server authorization flag can supplement owner status.
      final regulator = governance['is_regulator'] == true;

      Map<String, dynamic>? job;
      if (!owner && !regulator) {
        final assignment = await _db
            .from('employee_assignments')
            .select('id,job_title,department,permissions')
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        job = assignment == null ? null : Map<String, dynamic>.from(assignment);
      }
      final isEmployee = TeamChatPolicy.canAccess(
        isOwner: owner,
        isRegulator: regulator,
        hasActiveAssignment: job != null,
      );
      if (!isEmployee) {
        if (!mounted || generation != _generation) return;
        setState(() {
          _isEmployee = false;
          _isOwner = owner;
          _isRegulator = regulator;
          _job = job;
          _messages = const [];
          _loading = false;
        });
        return;
      }

      final results = await _db
          .from('team_chat_messages')
          .select(
            'id,user_id,message,department,reply_to_id,created_at,edited_at,user_profiles:user_id(id,username,avatar_url,verified)',
          )
          .order('created_at', ascending: true)
          .limit(100)
          .timeout(const Duration(seconds: 20));
      final messages = (results as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      if (!mounted || generation != _generation) return;
      setState(() {
        _isEmployee = true;
        _isOwner = owner;
        _isRegulator = regulator;
        _job = job;
        _messages = messages;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scroll.hasClients) {
          _scroll.jumpTo(_scroll.position.maxScrollExtent);
        }
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _error = 'Team chat could not load. Check staff access and connection, then retry.';
        });
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _send() async {
    final userId = _userId;
    final text = TeamChatPolicy.composeMessage(_composer.text);
    if (userId == null || text.isEmpty || _sending || !_isEmployee) return;
    setState(() => _sending = true);
    try {
      final reply = _replyTo;
      final replyId = reply?['id'];
      final replyLabel = reply == null
          ? text
          : '[Reply to @${reply['username'] ?? 'team member'}] $text';
      await _db
          .from('team_chat_messages')
          .insert({
            'user_id': userId,
            'message': replyLabel,
            'department':
                _job?['department'] ??
                (_isOwner ? 'System Owner' : (_isRegulator ? 'Regulator' : null)),
            'reply_to_id': replyId,
          })
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      _composer.clear();
      setState(() => _replyTo = null);
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Message was not sent. Check your access and retry.')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> message) async {
    if (!_canModerate || message['id'] == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete team message?'),
        content: const Text('This removes the message from the staff channel.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _db
          .from('team_chat_messages')
          .delete()
          .eq('id', message['id'].toString())
          .timeout(const Duration(seconds: 15));
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Message could not be deleted.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final userId = _userId;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Team Chat'),
        actions: [
          IconButton(
            tooltip: 'Refresh messages',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading && _messages.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : userId == null
          ? _notice(
              context,
              Icons.lock_outline_rounded,
              'Sign in required',
              'Sign in with your Testagram account to continue.',
              action: FilledButton(
                onPressed: () => context.go('/auth'),
                child: const Text('Sign in'),
              ),
            )
          : (!_isEmployee && _error != null)
          ? _notice(
              context,
              Icons.cloud_off_outlined,
              'Team chat unavailable',
              _error!,
              action: FilledButton.tonal(onPressed: _load, child: const Text('Retry')),
            )
          : !_isEmployee
          ? _notice(
              context,
              Icons.admin_panel_settings_outlined,
              'Employees only',
              'This confidential channel is limited to active staff, the system owner, and authorized regulators.',
              action: FilledButton.tonal(
                onPressed: () => context.go('/jobs'),
                child: const Text('View jobs'),
              ),
            )
          : Column(
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: Row(
                    children: [
                      const Icon(Icons.shield_outlined),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Confidential staff channel${_job?['department'] == null ? '' : ' · ${_job!['department']}'}',
                          style: theme.textTheme.labelLarge,
                        ),
                      ),
                      Text('${_messages.length}/100'),
                    ],
                  ),
                ),
                if (_error != null)
                  MaterialBanner(
                    content: Text(_error!),
                    actions: [TextButton(onPressed: _load, child: const Text('Retry'))],
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: _messages.isEmpty
                        ? ListView(
                            controller: _scroll,
                            children: const [
                              SizedBox(height: 100),
                              Center(child: Text('No team messages yet. Start the conversation.')),
                            ],
                          )
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.all(12),
                            itemCount: _messages.length,
                            itemBuilder: (context, index) {
                              final message = _messages[index];
                              final profile = message['user_profiles'] is Map
                                  ? Map<String, dynamic>.from(message['user_profiles'] as Map)
                                  : <String, dynamic>{};
                              final authorId = '${message['user_id'] ?? ''}';
                              final own = authorId == userId;
                              final name =
                                  '${profile['username'] ?? (own ? 'You' : 'Team member')}';
                              final created = DateTime.tryParse('${message['created_at'] ?? ''}');
                              return Card(
                                margin: const EdgeInsets.only(bottom: 8),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          CircleAvatar(
                                            radius: 15,
                                            child: Text(name.isEmpty ? '?' : name[0].toUpperCase()),
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(name, style: theme.textTheme.labelLarge),
                                                Text(
                                                  '${message['department'] ?? 'Team'}${created == null ? '' : ' · ${created.toLocal().toString().substring(0, 16)}'}',
                                                  style: theme.textTheme.bodySmall,
                                                ),
                                              ],
                                            ),
                                          ),
                                          if (_canModerate)
                                            IconButton(
                                              tooltip: 'Delete message',
                                              onPressed: () => _delete(message),
                                              icon: const Icon(Icons.delete_outline_rounded),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      SelectableText('${message['message'] ?? ''}'),
                                      Align(
                                        alignment: Alignment.centerRight,
                                        child: TextButton.icon(
                                          onPressed: () => setState(
                                            () =>
                                                _replyTo = {'id': message['id'], 'username': name},
                                          ),
                                          icon: const Icon(Icons.reply_rounded, size: 18),
                                          label: const Text('Reply'),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ),
                if (_replyTo != null)
                  Material(
                    color: theme.colorScheme.secondaryContainer,
                    child: ListTile(
                      dense: true,
                      title: Text('Replying to @${_replyTo!['username']}'),
                      trailing: IconButton(
                        onPressed: () => setState(() => _replyTo = null),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ),
                  ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _composer,
                            minLines: 1,
                            maxLines: 5,
                            textCapitalization: TextCapitalization.sentences,
                            decoration: const InputDecoration(
                              hintText: 'Message the team…',
                              border: OutlineInputBorder(),
                            ),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          tooltip: 'Send message',
                          onPressed: _sending ? null : _send,
                          icon: _sending
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.send_rounded),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _notice(
    BuildContext context,
    IconData icon,
    String title,
    String body, {
    Widget? action,
  }) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 52),
          const SizedBox(height: 14),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(body, textAlign: TextAlign.center),
          if (action != null) ...[const SizedBox(height: 16), action],
        ],
      ),
    ),
  );
}
