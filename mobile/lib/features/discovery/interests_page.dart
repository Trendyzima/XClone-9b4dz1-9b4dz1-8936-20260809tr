import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../migration_batch_policy.dart';

class InterestsPage extends StatefulWidget {
  const InterestsPage({super.key});
  @override
  State<InterestsPage> createState() => _InterestsPageState();
}

class _InterestsPageState extends State<InterestsPage> {
  final _db = Supabase.instance.client;
  static const _categories = <(String, List<String>)>[
    (
      'Tech & Science',
      [
        'technology',
        'ai',
        'programming',
        'science',
        'space',
        'physics',
        'crypto',
        'web3',
      ],
    ),
    (
      'Arts & Culture',
      [
        'art',
        'music',
        'photography',
        'film',
        'design',
        'fashion',
        'books',
        'poetry',
      ],
    ),
    (
      'Sports & Fitness',
      [
        'football',
        'basketball',
        'fitness',
        'running',
        'cycling',
        'tennis',
        'gaming',
        'esports',
      ],
    ),
    (
      'Lifestyle',
      [
        'food',
        'travel',
        'health',
        'nature',
        'cooking',
        'pets',
        'mindfulness',
        'sustainability',
      ],
    ),
    (
      'Business & Finance',
      [
        'startup',
        'investing',
        'entrepreneur',
        'marketing',
        'finance',
        'productivity',
        'leadership',
        'career',
      ],
    ),
    (
      'News & Society',
      [
        'news',
        'politics',
        'worldnews',
        'climate',
        'economics',
        'humanrights',
        'education',
        'community',
      ],
    ),
  ];
  Set<String> _selected = {};
  bool _loading = true;
  bool _saving = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to personalize your feed.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _db
          .from('user_interests')
          .select('hashtags(tag)')
          .eq('user_id', user.id)
          .timeout(const Duration(seconds: 15));
      final tags = <String>{};
      for (final row in rows) {
        final hashtag = row['hashtags'];
        if (hashtag is Map && hashtag['tag'] is String) {
          tags.add(hashtag['tag'] as String);
        }
      }
      if (mounted) setState(() => _selected = tags);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not load saved interests. Retry before saving.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (!MigrationBatchPolicy.hasEnoughInterests(_selected)) {
      setState(
        () => _error = 'Choose at least 3 interests to personalize your feed.',
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await _db
          .rpc('save_user_interests', params: {'p_tags': _selected.toList()})
          .timeout(const Duration(seconds: 20));
      if (result is! num || result < 3) {
        throw StateError('The server did not confirm all selected interests.');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Saved ${result.toInt()} interests.')),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Interests could not be saved. Your previous preferences remain unchanged.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Your interests'),
      actions: [
        IconButton(
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Select at least 3 topics (${_selected.length} selected). Your feed is personalized using these choices.',
                      ),
                    ),
                    const Icon(Icons.auto_awesome),
                  ],
                ),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  children: [
                    for (final category in _categories)
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                category.$1,
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 4,
                                children: [
                                  for (final tag in category.$2)
                                    FilterChip(
                                      label: Text('#$tag'),
                                      selected: _selected.contains(tag),
                                      onSelected: _saving
                                          ? null
                                          : (value) => setState(() {
                                              if (value) {
                                                _selected.add(tag);
                                              } else {
                                                _selected.remove(tag);
                                              }
                                            }),
                                    ),
                                ],
                              ),
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                  onPressed: _saving
                                      ? null
                                      : () => setState(() {
                                          final all = category.$2.every(
                                            _selected.contains,
                                          );
                                          if (all) {
                                            _selected.removeAll(category.$2);
                                          } else {
                                            _selected.addAll(category.$2);
                                          }
                                        }),
                                  child: const Text('Select / clear category'),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: const Text('Save interests'),
                    ),
                  ),
                ),
              ),
            ],
          ),
  );
}
