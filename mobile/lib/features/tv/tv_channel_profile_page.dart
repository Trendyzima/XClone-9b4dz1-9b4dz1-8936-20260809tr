import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class TvChannelProfilePage extends StatefulWidget {
  const TvChannelProfilePage({super.key, required this.handle});

  final String handle;

  @override
  State<TvChannelProfilePage> createState() => _TvChannelProfilePageState();
}

class _TvChannelProfilePageState extends State<TvChannelProfilePage> {
  SupabaseClient get _db => Supabase.instance.client;
  Map<String, dynamic>? _channel;
  Map<String, dynamic>? _owner;
  bool _loading = true;
  String? _error;

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
      final result = await _db
          .from('channel_profiles')
          .select('*')
          .eq('handle', widget.handle)
          .maybeSingle()
          .timeout(const Duration(seconds: 15));
      if (!mounted) return;
      if (result == null) {
        setState(() {
          _channel = null;
          _owner = null;
          _error = 'Channel not found.';
        });
        return;
      }
      final channel = Map<String, dynamic>.from(result);
      Map<String, dynamic>? owner;
      final ownerId = '${channel['owner_id'] ?? ''}';
      if (ownerId.isNotEmpty) {
        final profile = await _db
            .from('profiles')
            .select('username,display_name,avatar_url')
            .eq('id', ownerId)
            .maybeSingle()
            .timeout(const Duration(seconds: 10));
        if (profile != null) {
          owner = Map<String, dynamic>.from(profile);
        }
      }
      if (!mounted) return;
      setState(() {
        _channel = channel;
        _owner = owner;
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'This channel could not be loaded. Check your connection and retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _networkImage(String? url, {double? width, double? height}) {
    if (url == null || !url.startsWith('https://')) {
      return const SizedBox.shrink();
    }
    return Image.network(
      url,
      width: width,
      height: height,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final channel = _channel;
    if (channel == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Channel profile')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.live_tv_rounded,
                  size: 48,
                  color: theme.colorScheme.outline,
                ),
                const SizedBox(height: 12),
                Text(
                  _error ?? 'Channel not found.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () => context.go('/tv'),
                  icon: const Icon(Icons.explore_rounded),
                  label: const Text('Discover channels'),
                ),
                if (_error != null)
                  TextButton(onPressed: _load, child: const Text('Retry')),
              ],
            ),
          ),
        ),
      );
    }

    final isTv = channel['channel_type'] == 'tv';
    final owner = _owner;
    final createdAt = DateTime.tryParse('${channel['created_at'] ?? ''}');
    final avatarUrl = '${channel['avatar_url'] ?? ''}';
    final bannerUrl = '${channel['banner_url'] ?? ''}';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Channel profile'),
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () => context.pop(),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            SizedBox(
              height: 170,
              width: double.infinity,
              child: bannerUrl.startsWith('https://')
                  ? _networkImage(
                      bannerUrl,
                      height: 170,
                      width: double.infinity,
                    )
                  : Container(color: theme.colorScheme.surfaceContainerHighest),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Transform.translate(
                    offset: const Offset(0, -28),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Container(
                          width: 78,
                          height: 78,
                          clipBehavior: Clip.antiAlias,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            border: Border.all(
                              color: theme.scaffoldBackgroundColor,
                              width: 4,
                            ),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: avatarUrl.startsWith('https://')
                              ? _networkImage(avatarUrl, width: 78, height: 78)
                              : Icon(
                                  isTv
                                      ? Icons.live_tv_rounded
                                      : Icons.mic_rounded,
                                ),
                        ),
                        const Spacer(),
                        FilledButton.icon(
                          onPressed: () => context.go(isTv ? '/tv' : '/spaces'),
                          icon: const Icon(Icons.play_arrow_rounded),
                          label: const Text('Discover live'),
                        ),
                      ],
                    ),
                  ),
                  Transform.translate(
                    offset: const Offset(0, -18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${channel['name'] ?? 'Channel'}',
                          style: theme.textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          '@${channel['handle'] ?? widget.handle}',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        if ('${channel['bio'] ?? ''}'.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text('${channel['bio']}'),
                          ),
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 14,
                          runSpacing: 10,
                          children: [
                            Chip(
                              avatar: const Icon(
                                Icons.people_alt_outlined,
                                size: 18,
                              ),
                              label: Text(
                                '${channel['follower_count'] ?? 0} followers',
                              ),
                            ),
                            Chip(
                              label: Text(
                                '${channel['channel_type'] ?? 'creator'} channel',
                              ),
                            ),
                            if ('${channel['category'] ?? ''}'.isNotEmpty)
                              Chip(label: Text('${channel['category']}')),
                            if (createdAt != null)
                              Chip(
                                avatar: const Icon(
                                  Icons.calendar_today_rounded,
                                  size: 16,
                                ),
                                label: Text(
                                  'Created ${createdAt.toLocal().toString().split(' ').first}',
                                ),
                              ),
                          ],
                        ),
                        if (owner != null)
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: CircleAvatar(
                              backgroundImage:
                                  '${owner['avatar_url'] ?? ''}'.startsWith(
                                    'https://',
                                  )
                                  ? NetworkImage('${owner['avatar_url']}')
                                  : null,
                              child:
                                  '${owner['avatar_url'] ?? ''}'.startsWith(
                                    'https://',
                                  )
                                  ? null
                                  : const Icon(Icons.person_outline_rounded),
                            ),
                            title: Text(
                              'Hosted by ${owner['display_name'] ?? owner['username'] ?? 'Testagram creator'}',
                            ),
                            subtitle: owner['username'] == null
                                ? null
                                : Text('@${owner['username']}'),
                            onTap: owner['username'] == null
                                ? null
                                : () => context.go(
                                    '/profile/${owner['username']}',
                                  ),
                          ),
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'About this channel',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  isTv
                                      ? 'This Testagram TV channel broadcasts live. Finished broadcasts are not stored as videos by Testagram.'
                                      : 'This Testagram audio channel hosts live conversations and spaces. Recordings follow the channel and host recording settings.',
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
