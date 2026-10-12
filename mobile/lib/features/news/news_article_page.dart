import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';

class NewsArticlePage extends StatefulWidget {
  const NewsArticlePage({super.key, required this.articleId});

  final String articleId;

  @override
  State<NewsArticlePage> createState() => _NewsArticlePageState();
}

class _NewsArticlePageState extends State<NewsArticlePage> {
  Map<String, dynamic>? _item;
  bool _loading = true;
  String? _error;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant NewsArticlePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.articleId != widget.articleId) _load();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _item = null;
    });
    try {
      final endpoint = Uri.parse(AppConfig.supabaseUrl)
          .resolve('/functions/v1/testagram-rss-feed')
          .replace(queryParameters: {'id': widget.articleId});
      final response = await http.get(endpoint, headers: {
        'Accept': 'application/json',
        'apikey': AppConfig.supabasePublishableKey,
      }).timeout(const Duration(seconds: 15));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('The publisher feed returned ${response.statusCode}.');
      }
      final decoded = jsonDecode(response.body);
      if (decoded is! Map) {
        throw const FormatException('Invalid news response.');
      }
      final items = decoded['items'];
      final item = items is List && items.isNotEmpty && items.first is Map
          ? Map<String, dynamic>.from(items.first as Map)
          : null;
      if (item == null) {
        throw StateError('This publisher story is no longer available.');
      }
      if (mounted && generation == _generation) setState(() => _item = item);
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _error = error is StateError
            ? error.message
            : 'The story could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _openPublisher(String? raw) async {
    final uri = Uri.tryParse(raw ?? '');
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('This story has no valid HTTPS publisher link.'),
        ));
      }
      return;
    }
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Could not open the publisher link.'),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = _item;
    final title = '${item?['title'] ?? 'News story'}';
    final sourceProfile = item?['testagram_rss_source_profiles'];
    final source = sourceProfile is Map
        ? '${sourceProfile['display_name'] ?? 'Publisher'}'
        : '${item?['source_name'] ?? 'Publisher'}';
    final canonicalUrl = '${item?['canonical_url'] ?? ''}';
    final image = '${item?['image_url'] ?? ''}';
    final excerpt = '${item?['excerpt'] ?? ''}';
    final published = DateTime.tryParse('${item?['published_at'] ?? ''}');

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              IconButton(
                tooltip: 'Back to news',
                onPressed: () => Navigator.of(context).maybePop(),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              Expanded(
                child: Text(
                  'News story',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
            ],
          ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(28),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Story unavailable',
                        style: TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Text(_error!),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text('Retry'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (!_loading && item != null)
            Card(
              clipBehavior: Clip.antiAlias,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (image.startsWith('https://'))
                    Image.network(
                      image,
                      height: 220,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.newspaper_rounded, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(source,
                                  style: Theme.of(context)
                                      .textTheme
                                      .labelLarge
                                      ?.copyWith(fontWeight: FontWeight.w800)),
                            ),
                            IconButton(
                              tooltip: 'Share story',
                              onPressed: canonicalUrl.isEmpty
                                  ? null
                                  : () => Share.share('$title\n$canonicalUrl'),
                              icon: const Icon(Icons.share_rounded),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Text(
                          title,
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        if (published != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Text(
                              published.toLocal().toString(),
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        if ('${item['author'] ?? ''}'.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text('By ${item['author']}'),
                          ),
                        const SizedBox(height: 18),
                        Text(
                          excerpt.isEmpty
                              ? [
                                  'The publisher did not provide an article excerpt',
                                  'in its RSS feed.',
                                ].join(' ')
                              : excerpt,
                          style: Theme.of(context)
                              .textTheme
                              .bodyLarge
                              ?.copyWith(height: 1.55),
                        ),
                        const SizedBox(height: 18),
                        const Divider(),
                        const SizedBox(height: 8),
                        Text(
                          [
                            'This story is provided by its publisher.',
                            'Testagram shows the available feed excerpt and links to the original article.',
                          ].join(' '),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: () => _openPublisher(canonicalUrl),
                            icon: const Icon(Icons.open_in_new_rounded),
                            label: Text('Read on $source'),
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
    );
  }
}
