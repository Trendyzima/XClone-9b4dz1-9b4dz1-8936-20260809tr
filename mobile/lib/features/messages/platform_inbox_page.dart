import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'platform_inbox_policy.dart';

/// Native Wise Brain inbox backed by the existing platform_inbox RLS contract.
class PlatformInboxPage extends StatefulWidget {
  const PlatformInboxPage({super.key});

  @override
  State<PlatformInboxPage> createState() => _PlatformInboxPageState();
}

class _PlatformInboxPageState extends State<PlatformInboxPage> {
  final _db = Supabase.instance.client;
  List<Map<String, dynamic>> _messages = const [];
  String _filter = 'all';
  String? _error;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = true;
  String? _actionId;
  int _generation = 0;

  String? get _userId => _db.auth.currentUser?.id;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  Future<void> _load({bool append = false}) async {
    final userId = _userId;
    if (userId == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to access your platform inbox.';
        });
      }
      return;
    }
    if (append && (_loadingMore || !_hasMore)) return;
    final generation = ++_generation;
    final offset = append ? _messages.length : 0;
    setState(() {
      if (append) {
        _loadingMore = true;
      } else {
        _loading = true;
        _messages = const [];
      }
      _error = null;
    });
    try {
      final rows = await _db
          .from('platform_inbox')
          .select(
            'id,user_id,type,subject,body,icon_emoji,cta_label,cta_url,read,sent_at,created_at,metadata',
          )
          .eq('user_id', userId)
          .order('sent_at', ascending: false)
          .range(offset, offset + PlatformInboxPolicy.pageSize - 1)
          .timeout(const Duration(seconds: 15));
      if (!mounted || generation != _generation) return;
      final next =
          rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
      setState(() {
        _messages = append ? [..._messages, ...next] : next;
        _hasMore = next.length == PlatformInboxPolicy.pageSize;
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(
          () => _error =
              'Your inbox could not be loaded. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  Future<void> _mutate(
    String id,
    Future<void> Function(String userId) action,
  ) async {
    final userId = _userId;
    if (userId == null || _actionId != null) return;
    setState(() => _actionId = id);
    try {
      await action(userId);
      if (mounted) {
        if (id == 'all') {
          setState(() {
            for (final message in _messages) {
              message['read'] = true;
            }
          });
        } else if (id.startsWith('delete:')) {
          final messageId = id.substring('delete:'.length);
          setState(
            () => _messages =
                _messages.where((m) => '${m['id']}' != messageId).toList(),
          );
        } else {
          setState(() {
            for (final message in _messages) {
              if ('${message['id']}' == id) message['read'] = true;
            }
          });
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('That inbox action failed. Please retry.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _actionId = null);
    }
  }

  Future<void> _markRead(Map<String, dynamic> message) async {
    if (message['read'] == true) return;
    final id = '${message['id']}';
    await _mutate(id, (userId) async {
      await _db
          .from('platform_inbox')
          .update({'read': true})
          .eq('id', id)
          .eq('user_id', userId);
    });
  }

  Future<void> _markAllRead() async => _mutate('all', (userId) async {
        await _db
            .from('platform_inbox')
            .update({'read': true})
            .eq('user_id', userId)
            .eq('read', false);
      });

  Future<void> _delete(String id) async =>
      _mutate('delete:$id', (userId) async {
        await _db
            .from('platform_inbox')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
      });

  Future<void> _generateDigest() async {
    if (_actionId != null) return;
    setState(() => _actionId = 'digest');
    try {
      await _db
          .rpc('generate_platform_inbox_digest')
          .timeout(const Duration(seconds: 20));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Wise Brain digest refreshed.')),
        );
      }
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Digest generation is unavailable. Retry later.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _actionId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_userId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Platform inbox')),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.lock_outline, size: 44),
              const SizedBox(height: 12),
              const Text('Sign in to access your inbox.'),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: () => context.go('/auth?returnTo=%2Fplatform-inbox'),
                child: const Text('Sign in'),
              ),
            ],
          ),
        ),
      );
    }
    final visible = _messages
        .where((m) => PlatformInboxPolicy.matchesFilter(m, _filter))
        .toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Wise Brain Inbox'),
        actions: [
          IconButton(
            tooltip: 'Refresh inbox',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
          PopupMenuButton<String>(
            tooltip: 'Inbox actions',
            onSelected: (value) {
              if (value == 'digest') _generateDigest();
              if (value == 'read') _markAllRead();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'digest', child: Text('Generate digest')),
              PopupMenuItem(value: 'read', child: Text('Mark all as read')),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const CircleAvatar(
                      child: Icon(Icons.auto_awesome_outlined),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Your activity, clearly explained',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${PlatformInboxPolicy.unreadCount(_messages)} unread · Personal activity, wallet context and platform updates',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Generate digest',
                      onPressed: _actionId == null ? _generateDigest : null,
                      icon: _actionId == 'digest'
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.auto_awesome),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final filter in [
                    'all',
                    'unread',
                    'trending',
                    'payment',
                    'news',
                    'update',
                    'tip',
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(
                          filter[0].toUpperCase() + filter.substring(1),
                        ),
                        selected: _filter == filter,
                        onSelected: (_) => setState(() => _filter = filter),
                      ),
                    ),
                ],
              ),
            ),
            if (_loading && _messages.isEmpty)
              const Padding(
                padding: EdgeInsets.all(36),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_error != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Text(_error!),
                      TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
            if (!_loading && _error == null && visible.isEmpty)
              Padding(
                padding: const EdgeInsets.all(32),
                child: Center(
                  child: Text(
                    _filter == 'unread'
                        ? 'You are all caught up.'
                        : 'No inbox messages in this view.',
                  ),
                ),
              ),
            for (final message in visible)
              Card(
                margin: const EdgeInsets.only(top: 8),
                color: message['read'] == true
                    ? null
                    : Theme.of(context)
                        .colorScheme
                        .primaryContainer
                        .withValues(alpha: .35),
                child: ListTile(
                  isThreeLine: true,
                  leading: CircleAvatar(
                    foregroundColor: Theme.of(context).colorScheme.primary,
                    child: Text(
                      '${message['icon_emoji'] ?? ''}'.isNotEmpty
                          ? '${message['icon_emoji']}'
                          : '🦉',
                      style: const TextStyle(fontSize: 18),
                    ),
                  ),
                  title: Text(
                    '${message['subject'] ?? 'Testagram update'}',
                    style: TextStyle(
                      fontWeight: message['read'] == true
                          ? FontWeight.normal
                          : FontWeight.w700,
                    ),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 5),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${message['body'] ?? ''}',
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 5),
                        Text(
                          '${message['sent_at'] ?? message['created_at'] ?? ''}',
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                        if (message['cta_label'] is String &&
                            PlatformInboxPolicy.safeInternalPath(
                                  message['cta_url'],
                                ) !=
                                null)
                          TextButton.icon(
                            onPressed: () {
                              final path = PlatformInboxPolicy.safeInternalPath(
                                message['cta_url'],
                              );
                              if (path != null) context.go(path);
                            },
                            icon: const Icon(Icons.open_in_new, size: 16),
                            label: Text('${message['cta_label']}'),
                          ),
                      ],
                    ),
                  ),
                  trailing: PopupMenuButton<String>(
                    tooltip: 'Message actions',
                    onSelected: (action) {
                      final id = '${message['id']}';
                      if (action == 'read') _markRead(message);
                      if (action == 'delete') _delete(id);
                    },
                    itemBuilder: (_) => [
                      if (message['read'] != true)
                        const PopupMenuItem(
                          value: 'read',
                          child: Text('Mark as read'),
                        ),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Text('Delete'),
                      ),
                    ],
                  ),
                ),
              ),
            if (_hasMore && _error == null && !_loading)
              Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: OutlinedButton(
                    onPressed: _loadingMore ? null : () => _load(append: true),
                    child: _loadingMore
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Load more'),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
