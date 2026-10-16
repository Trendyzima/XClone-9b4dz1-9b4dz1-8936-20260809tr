import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ProfileFeaturesPage extends StatefulWidget {
  const ProfileFeaturesPage({super.key});
  @override
  State<ProfileFeaturesPage> createState() => _ProfileFeaturesPageState();
}

class _ProfileFeaturesPageState extends State<ProfileFeaturesPage> {
  final _db = Supabase.instance.client;
  static const _features = <(String, String, String)>[
    ('analytics', 'Analytics', 'Profile and content performance tools'),
    ('monetization', 'Monetization', 'Subscriptions, tips and earnings tools'),
    ('podcasts', 'Podcasts', 'Podcast presence on your profile'),
    ('series', 'Series', 'Multi-part content collections'),
    ('achievements', 'Achievements', 'Creator milestones and badges'),
    ('highlights', 'Story highlights', 'Saved story collections'),
    ('social-links', 'Social links', 'External social profiles'),
    ('tips', 'Tips', 'Allow visitors to discover tipping'),
  ];
  Map<String, bool> _settings = {for (final f in _features) f.$1: true};
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
      setState(() {
        _loading = false;
        _error = 'Sign in to manage profile features.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final row = await _db
          .from('profiles')
          .select('profile_features')
          .eq('id', user.id)
          .maybeSingle()
          .timeout(const Duration(seconds: 15));
      final stored = row?['profile_features'];
      final merged = {for (final f in _features) f.$1: true};
      if (stored is Map) {
        for (final f in _features) {
          final value = stored[f.$1];
          if (value is bool) merged[f.$1] = value;
        }
      }
      if (mounted) setState(() => _settings = merged);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not load settings. Check access and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggle(String key, bool value) async {
    final user = _db.auth.currentUser;
    if (user == null || _saving) return;
    final previous = Map<String, bool>.from(_settings);
    final next = {..._settings, key: value};
    setState(() {
      _settings = next;
      _saving = true;
    });
    try {
      await _db
          .from('profiles')
          .update({'profile_features': next})
          .eq('id', user.id)
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      if (mounted) {
        setState(() {
          _settings = previous;
          _error = 'Settings were not saved. Your previous values were restored.';
        });
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Profile features'),
          actions: [
            IconButton(onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    const Text(
                      'Choose which optional features appear on your profile. Changes are saved to your account.',
                    ),
                    if (_saving) const LinearProgressIndicator(),
                    if (_error != null)
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.error_outline),
                          title: Text(_error!),
                          trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
                        ),
                      ),
                    const SizedBox(height: 12),
                    ..._features.map(
                      (f) => Card(
                        child: SwitchListTile(
                          value: _settings[f.$1] ?? true,
                          onChanged: _saving ? null : (value) => _toggle(f.$1, value),
                          title: Text(f.$2),
                          subtitle: Text(f.$3),
                          secondary: const Icon(Icons.tune),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
      );
}
