import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:share_plus/share_plus.dart';

class NewsPage extends StatefulWidget {
  const NewsPage({super.key});
  @override
  State<NewsPage> createState() => _NewsPageState();
}

class _NewsPageState extends State<NewsPage> {
  SupabaseClient get _db => Supabase.instance.client;
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  String _geo = 'KE';
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
      final result = await _db.rpc('list_newsify_trending', params: {
        'p_limit': 50,
        'p_geo': _geo,
        'p_language': 'english'
      }).timeout(const Duration(seconds: 15));
      final payload = Map<String, dynamic>.from(result as Map);
      final items = (payload['items'] as List? ?? const [])
          .map((r) => Map<String, dynamic>.from(r as Map))
          .toList();
      if (mounted) setState(() => _items = items);
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'News could not load. The news feed service may be unavailable; retry shortly.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openStory(Map<String, dynamic> item, String raw) async {
    final id = '${item['id'] ?? ''}'.trim();
    if (id.isNotEmpty) {
      context.push('/news/${Uri.encodeComponent(id)}');
      return;
    }
    await _open(raw);
  }

  Future<void> _open(String? raw) async {
    final uri = Uri.tryParse(raw ?? '');
    if (uri == null ||
        !{'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('This article has no valid external link.')));
      }
      return;
    }
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open the article link.')));
    }
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Text('News',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        const Text('Trending stories from Testagram’s cached news feed.'),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
            initialValue: _geo,
            decoration: const InputDecoration(labelText: 'Region'),
            items: const [
              DropdownMenuItem(value: 'KE', child: Text('Kenya')),
              DropdownMenuItem(value: 'US', child: Text('United States')),
              DropdownMenuItem(value: 'GB', child: Text('United Kingdom')),
              DropdownMenuItem(value: 'IN', child: Text('India'))
            ],
            onChanged: (v) {
              if (v != null) {
                setState(() => _geo = v);
                _load();
              }
            }),
        if (_loading)
          const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator())),
        if (_error != null)
          Padding(
              padding: const EdgeInsets.all(12),
              child: Column(children: [
                Text(_error!),
                TextButton(onPressed: _load, child: const Text('Retry'))
              ])),
        if (!_loading && _items.isEmpty && _error == null)
          const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                  child: Text(
                      'No fresh stories for this region right now. Try another region.'))),
        ..._items.map((item) {
          final title =
              '${item['title'] ?? item['trend_title'] ?? 'News story'}';
          final source = '${item['source_name'] ?? 'Newsify'}';
          final url = '${item['detail_url'] ?? item['source_url'] ?? ''}';
          final image =
              '${item['metadata'] is Map ? (item['metadata'] as Map)['image_url'] ?? '' : ''}';
          return Card(
              margin: const EdgeInsets.only(bottom: 10),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                  onTap: () => _openStory(item, url),
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (image.startsWith('https://'))
                          Image.network(image,
                              height: 150,
                              width: double.infinity,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) =>
                                  const SizedBox.shrink()),
                        Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(source.toUpperCase(),
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelSmall
                                          ?.copyWith(
                                              fontWeight: FontWeight.w800)),
                                  const SizedBox(height: 5),
                                  Text(title,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleMedium
                                          ?.copyWith(
                                              fontWeight: FontWeight.w900)),
                                  if ('${item['excerpt'] ?? ''}'.isNotEmpty)
                                    Padding(
                                        padding: const EdgeInsets.only(top: 8),
                                        child: Text('${item['excerpt']}',
                                            maxLines: 4,
                                            overflow: TextOverflow.ellipsis)),
                                  const SizedBox(height: 8),
                                  Row(children: [
                                    Expanded(
                                        child: Text(
                                            '${item['published_at'] ?? ''}',
                                            style: Theme.of(context)
                                                .textTheme
                                                .bodySmall)),
                                    IconButton(
                                        tooltip: 'Share story',
                                        onPressed: () =>
                                            Share.share('$title\n$url'),
                                        icon: const Icon(Icons.share_rounded)),
                                    TextButton(
                                        onPressed: () => _openStory(item, url),
                                        child: const Text('Read story'))
                                  ])
                                ]))
                      ])));
        }),
      ]));
}
