import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/api/testagram_capability_client.dart';

/// The conversation index uses the existing membership table. Message send/read
/// is deliberately not implemented by writing plaintext to the messages table:
/// Testagram's production communication path is capability-based and encrypted.
class MessagesPage extends StatefulWidget {
  const MessagesPage({super.key});
  @override
  State<MessagesPage> createState() => _MessagesPageState();
}

class _MessagesPageState extends State<MessagesPage> {
  List<Map<String, dynamic>> _conversations = [];
  bool _loading = false;
  String? _error;
  int _loadGeneration = 0;
  SupabaseClient get _client => Supabase.instance.client;
  late final TestagramCapabilityClient _capabilities;

  @override
  void initState() {
    super.initState();
    _capabilities = TestagramCapabilityClient.fromAppConfig();
    _load();
  }

  @override
  void dispose() {
    _loadGeneration++;
    _capabilities.close();
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_loadGeneration;
    if (_client.auth.currentUser == null) {
      setState(() {
        _conversations = [];
        _loading = false;
        _error = 'Sign in to access your encrypted conversations.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await _capabilities.call<Map<String, dynamic>>(
        'testagram.conversations.list',
        input: const {'limit': 80},
      );
      final rows = response['items'];
      if (rows is! List) {
        throw const TestagramCapabilityException(
          'The conversation service returned an invalid list.',
          code: 'INVALID_RESPONSE',
        );
      }
      final values = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      if (!mounted || generation != _loadGeneration) return;
      setState(() => _conversations = values);
    } catch (error) {
      if (mounted && generation == _loadGeneration) {
        setState(
          () => _error = error is TestagramCapabilityException ? error.message : 'Your encrypted conversation list could not be loaded. Retry when online.',
        );
      }
    } finally {
      if (mounted && generation == _loadGeneration) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(14),
      children: [
        Text(
          'Messages',
          style: Theme.of(context).textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        const Text(
          'Private conversations are handled through Testagram’s encrypted communication service.',
        ),
        const SizedBox(height: 12),
        if (_loading && _conversations.isEmpty)
          const Padding(
            padding: EdgeInsets.all(24),
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
        if (!_loading && _conversations.isEmpty && _error == null)
          const Padding(
            padding: EdgeInsets.all(28),
            child: Center(child: Text('No conversations yet.')),
          ),
        ..._conversations.map((item) {
          final conversation = item['conversation'] is Map
              ? Map<String, dynamic>.from(item['conversation'] as Map)
              : item;
          final kind = '${conversation['kind'] ?? 'direct'}';
          final title =
              '${conversation['title'] ?? (kind == 'group' ? 'Group conversation' : 'Private conversation')}';
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: CircleAvatar(
                child: Icon(
                  kind == 'group'
                      ? Icons.groups_rounded
                      : Icons.lock_outline_rounded,
                ),
              ),
              title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: const Text(
                'Encrypted conversation · open on the current client until native E2EE parity is verified',
              ),
              trailing: const Icon(Icons.open_in_new_rounded),
              onTap: () {
                showDialog<void>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('Secure messaging parity gate'),
                    content: const Text(
                      'Native message composition, key handling, delivery receipts, typing/presence, voice notes and calls will be enabled only after the existing encrypted communication capability API is ported and verified. No plaintext fallback is used.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Understood'),
                      ),
                    ],
                  ),
                );
              },
            ),
          );
        }),
      ],
    ),
  );
}
