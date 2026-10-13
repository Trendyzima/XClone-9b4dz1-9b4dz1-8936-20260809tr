import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'post_interaction_policy.dart';

/// Native quote composer. Local quotes use the posts.quoted_post_id contract;
/// remote quotes use the existing Testagram API /quote capability.
class PostQuoteComposerPage extends StatefulWidget {
  const PostQuoteComposerPage({super.key, required this.postId});
  final String postId;
  @override
  State<PostQuoteComposerPage> createState() => _PostQuoteComposerPageState();
}

class _PostQuoteComposerPageState extends State<PostQuoteComposerPage> {
  SupabaseClient get _db => Supabase.instance.client;
  final _text = TextEditingController();
  Map<String, dynamic>? _post;
  bool _loading = true;
  bool _sending = false;
  String? _error;
  int _generation = 0;
  bool get _remote =>
      Uri.tryParse(widget.postId)?.hasScheme == true &&
      widget.postId.toLowerCase().startsWith('https://');

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant PostQuoteComposerPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.postId != widget.postId) _load();
  }

  @override
  void dispose() {
    _generation++;
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (widget.postId.trim().isEmpty) {
        throw StateError('A quote target is required.');
      }
      final dynamic row;
      if (_remote) {
        row = await _db
            .from('federated_objects')
            .select(
                'uri,actor_uri,content,summary,published_at,quote_uri,object_type,deleted_at,tombstone')
            .eq('uri', widget.postId)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        if (row == null ||
            row['deleted_at'] != null ||
            row['tombstone'] == true) {
          throw StateError('This federated post is unavailable.');
        }
      } else {
        row = await _db
            .from('posts')
            .select('id,content,author_id,user_id,created_at,deleted_at')
            .eq('id', widget.postId)
            .isFilter('deleted_at', null)
            .maybeSingle()
            .timeout(const Duration(seconds: 15));
        if (row == null) throw StateError('This post is unavailable.');
      }
      if (!mounted || generation != _generation) return;
      setState(() => _post = Map<String, dynamic>.from(row as Map));
    } catch (e) {
      if (mounted && generation == _generation) {
        setState(() => _error = e is StateError
            ? e.message.toString()
            : 'The quote target could not be loaded. Retry when connected.');
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _submit() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      context.go('/auth');
      return;
    }
    final content = _text.text.trim();
    if (PostInteractionPolicy.validateComposerText(content) != null ||
        _sending) {
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      if (_remote) {
        final response = await _db.functions.invoke('testagram-api', body: {
          'path': '/quote',
          'method': 'POST',
          'body': {'post_id': widget.postId, 'content': content},
        }).timeout(const Duration(seconds: 30));
        if (response.data is Map && (response.data as Map)['error'] != null) {
          throw StateError('The federation service rejected this quote.');
        }
      } else {
        final result = await _db.rpc('create_post_atomic', params: {
          'p_input': {
            'content': content,
            'quoted_post_id': widget.postId,
            'visibility': 'public',
          },
        }).timeout(const Duration(seconds: 20));
        if (result is! Map ||
            result['created'] != true ||
            result['post_id'] == null) {
          throw StateError(
              'The post service did not confirm the quote was created.');
        }
        if (!mounted) return;
        context.go('/post/${Uri.encodeComponent('${result['post_id']}')}');
        return;
      }
      if (!mounted) return;
      context.go(_remote
          ? '/post-remote?postId=${Uri.encodeComponent(widget.postId)}'
          : '/post/${Uri.encodeComponent(widget.postId)}');
    } catch (e) {
      if (mounted) {
        setState(() => _error = e is StateError
            ? e.message.toString()
            : 'Quote could not be published. Check your connection and permissions, then retry.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Quote post')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(16), children: [
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Retry loading')),
                const SizedBox(height: 12),
              ],
              if (_post != null)
                Card(
                    child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(_remote ? 'Federated post' : 'Post',
                                  style: theme.textTheme.labelLarge),
                              const SizedBox(height: 8),
                              SelectableText(
                                  '${_post!['content'] ?? _post!['summary'] ?? ''}'),
                            ]))),
              const SizedBox(height: 16),
              TextField(
                  controller: _text,
                  minLines: 4,
                  maxLines: 10,
                  maxLength: 5000,
                  enabled: _post != null && !_sending,
                  decoration: const InputDecoration(
                      labelText: 'Add your comment',
                      border: OutlineInputBorder(),
                      alignLabelWithHint: true)),
              const SizedBox(height: 12),
              FilledButton.icon(
                  onPressed:
                      _post == null || _sending || _text.text.trim().isEmpty
                          ? null
                          : _submit,
                  icon: _sending
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.format_quote),
                  label: Text(_sending ? 'Publishing…' : 'Publish quote')),
            ]),
    );
  }
}
