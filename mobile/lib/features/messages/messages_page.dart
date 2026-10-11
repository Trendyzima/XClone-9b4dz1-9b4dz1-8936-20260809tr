import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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
  SupabaseClient get _client => Supabase.instance.client;
  String get _uid => _client.auth.currentUser!.id;

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
      final rows = await _client
          .from('conversation_members')
          .select(
              'conversation_id,joined_at,left_at,conversations(id,title,kind,updated_at,created_by)')
          .eq('user_id', _uid)
          .order('joined_at', ascending: false)
          .limit(80);
      final values = <Map<String, dynamic>>[];
      for (final row in rows) {
        final value = Map<String, dynamic>.from(row as Map);
        if (value['left_at'] != null || value['conversations'] == null) {
          continue;
        }
        value['conversation'] =
            Map<String, dynamic>.from(value['conversations'] as Map);
        values.add(value);
      }
      if (mounted) setState(() => _conversations = values);
    } catch (error) {
      if (mounted) {
        setState(() => _error =
            'Your encrypted conversation list could not be loaded. Retry when online.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(14), children: [
          Text('Messages',
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text(
              'Private conversations are handled through Testagram’s encrypted communication service.'),
          const SizedBox(height: 12),
          if (_loading && _conversations.isEmpty)
            const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator())),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.all(16),
                child: Column(children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry'))
                ])),
          if (!_loading && _conversations.isEmpty && _error == null)
            const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: Text('No conversations yet.'))),
          ..._conversations.map((item) {
            final conversation = item['conversation'] as Map<String, dynamic>;
            final kind = '${conversation['kind'] ?? 'direct'}';
            final title =
                '${conversation['title'] ?? (kind == 'group' ? 'Group conversation' : 'Private conversation')}';
            return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: CircleAvatar(
                      child: Icon(kind == 'group'
                          ? Icons.groups_rounded
                          : Icons.lock_outline_rounded)),
                  title:
                      Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: const Text(
                      'Encrypted conversation · open on the current client until native E2EE parity is verified'),
                  trailing: const Icon(Icons.open_in_new_rounded),
                  onTap: () {
                    showDialog<void>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Secure messaging parity gate'),
                        content: const Text(
                            'Native message composition, key handling, delivery receipts, typing/presence, voice notes and calls will be enabled only after the existing encrypted communication capability API is ported and verified. No plaintext fallback is used.'),
                        actions: [
                          TextButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Understood'))
                        ],
                      ),
                    );
                  },
                ));
          }),
        ]),
      );
}
