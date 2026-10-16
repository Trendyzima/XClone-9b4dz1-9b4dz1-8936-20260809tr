import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});
  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = false;
  bool _loadInFlight = false;
  String? _error;
  int _loadGeneration = 0;
  RealtimeChannel? _channel;
  SupabaseClient get _client => Supabase.instance.client;
  String get _uid => _client.auth.currentUser!.id;

  @override
  void initState() {
    super.initState();
    _load();
    _channel = _client
        .channel('flutter-notifications-$_uid')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'notifications',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'recipient_id',
            value: _uid,
          ),
          callback: (_) {
            if (mounted) unawaited(_load());
          },
        )
        .subscribe();
  }

  @override
  void dispose() {
    final channel = _channel;
    if (channel != null) unawaited(_client.removeChannel(channel));
    super.dispose();
  }

  Future<void> _load() async {
    if (_loadInFlight) return;
    _loadInFlight = true;
    final generation = ++_loadGeneration;
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final rows = await _client
          .from('notifications')
          .select('*')
          .eq('recipient_id', _uid)
          .order('created_at', ascending: false)
          .limit(50)
          .timeout(const Duration(seconds: 15));
      if (mounted && generation == _loadGeneration) {
        setState(
          () => _items = rows
              .map((row) => Map<String, dynamic>.from(row as Map))
              .toList(),
        );
      }
    } catch (_) {
      if (mounted && generation == _loadGeneration) {
        setState(
          () => _error =
              'Notifications are temporarily unavailable. Retry to reconnect.',
        );
      }
    } finally {
      _loadInFlight = false;
      if (mounted && generation == _loadGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _markRead(Map<String, dynamic> item) async {
    final id = '${item['id']}';
    final previous = item['read'] == true || item['read_at'] != null;
    if (previous) return;
    setState(() => item['read'] = true);
    try {
      await _client
          .from('notifications')
          .update({
            'read': true,
            'read_at': DateTime.now().toUtc().toIso8601String(),
          })
          .eq('id', id)
          .eq('recipient_id', _uid);
    } catch (error) {
      if (mounted) {
        setState(() => item['read'] = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not mark as read: $error')),
        );
      }
    }
  }

  Future<void> _markAllRead() async {
    final unread = _items
        .where((item) => item['read'] != true && item['read_at'] == null)
        .toList();
    setState(() {
      for (final item in unread) {
        item['read'] = true;
        item['read_at'] = DateTime.now().toIso8601String();
      }
    });
    try {
      await _client
          .from('notifications')
          .update({
            'read': true,
            'read_at': DateTime.now().toUtc().toIso8601String(),
          })
          .eq('recipient_id', _uid);
    } catch (error) {
      if (mounted) {
        await _load();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not mark all as read: $error')),
        );
      }
    }
  }

  IconData _icon(String kind) {
    if (kind.contains('like')) return Icons.favorite_outline_rounded;
    if (kind.contains('follow')) return Icons.person_add_alt_1_rounded;
    if (kind.contains('message')) return Icons.chat_bubble_outline_rounded;
    if (kind.contains('mention') || kind.contains('reply')) {
      return Icons.alternate_email_rounded;
    }
    if (kind.contains('payment') ||
        kind.contains('wallet') ||
        kind.contains('payout')) {
      return Icons.account_balance_wallet_outlined;
    }
    return Icons.notifications_none_rounded;
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
                'Notifications',
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            TextButton(
              onPressed:
                  _items.any(
                    (item) => item['read'] != true && item['read_at'] == null,
                  )
                  ? _markAllRead
                  : null,
              child: const Text('Mark all read'),
            ),
          ],
        ),
        if (_loading && _items.isEmpty)
          const Padding(
            padding: EdgeInsets.all(30),
            child: Center(child: CircularProgressIndicator()),
          ),
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
        if (!_loading && _items.isEmpty && _error == null)
          const Padding(
            padding: EdgeInsets.all(28),
            child: Center(child: Text('You’re all caught up.')),
          ),
        ..._items.map((item) {
          final kind = '${item['kind'] ?? item['type'] ?? 'activity'}';
          final data = item['data'] is Map
              ? Map<String, dynamic>.from(item['data'] as Map)
              : <String, dynamic>{};
          final actor =
              '${data['username'] ?? data['display_name'] ?? 'Someone'}';
          final detail =
              '${data['preview'] ?? data['message'] ?? kind.replaceAll('.', ' ')}';
          final isRead = item['read'] == true || item['read_at'] != null;
          final created = DateTime.tryParse('${item['created_at'] ?? ''}');
          return Card(
            margin: const EdgeInsets.only(top: 8),
            color: isRead
                ? null
                : Theme.of(context).colorScheme.primary
                      .withValues(alpha: 0.055),
            child: ListTile(
              onTap: () => _markRead(item),
              leading: CircleAvatar(
                backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                child: Icon(_icon(kind)),
              ),
              title: Text(
                '$actor · $detail',
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontWeight: isRead ? FontWeight.normal : FontWeight.w700,
                ),
              ),
              subtitle: Text(created == null ? kind : '${created.toLocal()}'),
              trailing: isRead
                  ? null
                  : Icon(
                      Icons.circle,
                      size: 9,
                      color: Theme.of(context).colorScheme.primary,
                    ),
            ),
          );
        }),
      ],
    ),
  );
}
