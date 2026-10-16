import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/config/app_config.dart';
import 'seo_audit_policy.dart';

/// Owner-only declared SEO coverage audit plus a live community sitemap probe.
class SeoAuditPage extends StatefulWidget {
  const SeoAuditPage({super.key});

  @override
  State<SeoAuditPage> createState() => _SeoAuditPageState();
}

class _SeoAuditPageState extends State<SeoAuditPage> {
  final _db = Supabase.instance.client;
  final _search = TextEditingController();
  bool _loading = true;
  bool _owner = false;
  bool _sitemapLoading = false;
  String _filter = 'all';
  String? _error;
  String? _sitemapError;
  int? _sitemapUrlCount;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _authorize();
  }

  @override
  void dispose() {
    _generation++;
    _search.dispose();
    super.dispose();
  }

  Future<void> _authorize() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _owner = false;
      _error = null;
    });
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to access SEO diagnostics.';
        });
      }
      return;
    }
    try {
      final result = await _db.rpc('testagram_is_owner').timeout(const Duration(seconds: 12));
      if (!mounted || generation != _generation) return;
      setState(() {
        _owner = result == true;
        _loading = false;
      });
      if (result == true) {
        await _probeSitemap();
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _error = 'Owner authorization could not be verified. Diagnostics remain locked.';
        });
      }
    }
  }

  Future<void> _probeSitemap() async {
    final session = _db.auth.currentSession;
    if (!AppConfig.isConfigured || session == null) {
      if (mounted) {
        setState(() => _sitemapError = 'Supabase runtime configuration is unavailable.');
      }
      return;
    }
    setState(() {
      _sitemapLoading = true;
      _sitemapError = null;
    });
    try {
      final base = AppConfig.supabaseUrl.replaceFirst(RegExp(r'/v1/?$'), '');
      final uri = Uri.parse('$base/functions/v1/community-sitemap');
      final response = await http
          .get(
            uri,
            headers: {
              'apikey': AppConfig.supabasePublishableKey,
              'Authorization': 'Bearer ${session.accessToken}',
            },
          )
          .timeout(const Duration(seconds: 15));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError('Sitemap returned HTTP ${response.statusCode}.');
      }
      final count = RegExp(r'<url>').allMatches(utf8.decode(response.bodyBytes)).length;
      if (mounted) {
        setState(() => _sitemapUrlCount = count);
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _sitemapError = 'Sitemap could not be fetched. Retry to check the live endpoint.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _sitemapLoading = false);
      }
    }
  }

  String _statusLabel(SeoRouteStatus status) => switch (status) {
    SeoRouteStatus.good => 'Good',
    SeoRouteStatus.warn => 'Warn',
    SeoRouteStatus.missing => 'Missing',
    SeoRouteStatus.noindex => 'Noindex',
  };

  IconData _statusIcon(SeoRouteStatus status) => switch (status) {
    SeoRouteStatus.good => Icons.check_circle_outline,
    SeoRouteStatus.warn => Icons.warning_amber_rounded,
    SeoRouteStatus.missing => Icons.error_outline,
    SeoRouteStatus.noindex => Icons.shield_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final indexable = seoRouteContracts.where((route) => !route.noindex).toList();
    final good = indexable.where((route) => route.status == SeoRouteStatus.good).length;
    final score = indexable.isEmpty ? 0 : (good * 100 / indexable.length).round();
    final filtered = seoRouteContracts.where((route) {
      final matchesStatus = _filter == 'all' || _statusLabel(route.status).toLowerCase() == _filter;
      final query = _search.text.trim().toLowerCase();
      return matchesStatus &&
          (query.isEmpty ||
              route.path.toLowerCase().contains(query) ||
              route.label.toLowerCase().contains(query));
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('SEO & sitemap audit'),
        actions: [
          IconButton(
            tooltip: 'Refresh diagnostics',
            onPressed: _loading ? null : _authorize,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error!),
                    const SizedBox(height: 12),
                    FilledButton(onPressed: _authorize, child: const Text('Retry')),
                  ],
                ),
              ),
            )
          : !_owner
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.lock_outline, size: 44),
                    SizedBox(height: 12),
                    Text('System owner access required.'),
                    SizedBox(height: 6),
                    Text('SEO diagnostics are restricted to the platform owner.'),
                  ],
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _authorize,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          const Icon(Icons.travel_explore, size: 36),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Declared SEO coverage',
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                                Text(
                                  '$score% of indexable manifest routes score good',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                          Text(
                            '$good/${indexable.length}',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ],
                      ),
                    ),
                  ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          const Icon(Icons.public, size: 30),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Live community sitemap',
                                  style: Theme.of(context).textTheme.titleSmall,
                                ),
                                Text(
                                  _sitemapError ??
                                      (_sitemapUrlCount == null
                                          ? 'Not checked yet'
                                          : '$_sitemapUrlCount community URLs returned'),
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            tooltip: 'Probe sitemap',
                            onPressed: _sitemapLoading ? null : _probeSitemap,
                            icon: _sitemapLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.sync),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      'The route score reflects the checked-in SEO contract, not a live crawl of every rendered page. The sitemap card is a live endpoint check.',
                    ),
                  ),
                  TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      labelText: 'Filter routes',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final filter in ['all', 'good', 'warn', 'missing'])
                        ChoiceChip(
                          label: Text(filter[0].toUpperCase() + filter.substring(1)),
                          selected: _filter == filter,
                          onSelected: (_) => setState(() => _filter = filter),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  for (final route in filtered)
                    Card(
                      margin: const EdgeInsets.only(top: 6),
                      child: ListTile(
                        leading: Icon(_statusIcon(route.status)),
                        title: Text(route.label),
                        subtitle: Text(
                          '${route.path}\n${route.group} · ${route.hasUseSeo ? 'useSEO declared' : 'missing useSEO'} · ${route.hasStructuredData ? 'structured data declared' : 'no structured data'}',
                          maxLines: 3,
                        ),
                        isThreeLine: true,
                        trailing: Text(_statusLabel(route.status)),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
