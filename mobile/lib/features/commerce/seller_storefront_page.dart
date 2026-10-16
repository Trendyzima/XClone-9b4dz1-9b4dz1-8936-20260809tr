import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../migration_batch_policy.dart';

class SellerStorefrontPage extends StatefulWidget {
  const SellerStorefrontPage({super.key, required this.username});
  final String username;
  @override
  State<SellerStorefrontPage> createState() => _SellerStorefrontPageState();
}

class _SellerStorefrontPageState extends State<SellerStorefrontPage> {
  final _db = Supabase.instance.client;
  Map<String, dynamic>? _seller;
  List<Map<String, dynamic>> _products = [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant SellerStorefrontPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.username != widget.username) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final seller = await _db
          .from('profiles')
          .select('id,username,display_name,avatar_url,bio,verified_tier')
          .eq('username', widget.username)
          .maybeSingle()
          .timeout(const Duration(seconds: 15));
      if (seller == null) {
        if (mounted) {
          setState(() {
            _seller = null;
            _products = [];
            _error = 'This seller could not be found.';
          });
        }
        return;
      }
      final products = await _db
          .from('products')
          .select(
            'id,seller_id,name,description,price_minor,currency,status,created_at',
          )
          .eq('seller_id', seller['id'])
          .eq('status', 'active')
          .order('created_at', ascending: false)
          .limit(100)
          .timeout(const Duration(seconds: 20));
      if (mounted) {
        setState(() {
          _seller = Map<String, dynamic>.from(seller);
          _products = products
              .map((r) => Map<String, dynamic>.from(r as Map))
              .toList();
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Storefront is unavailable. Check connection and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _price(Map<String, dynamic> p) =>
      MigrationBatchPolicy.formatMinorPrice(
        p['price_minor'],
        currency: '${p['currency'] ?? 'KES'}',
      );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text('${widget.username} store'),
      actions: [
        IconButton(
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: _loading
        ? const Center(child: CircularProgressIndicator())
        : RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_seller != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 30,
                            backgroundImage: _seller!['avatar_url'] is String
                                ? NetworkImage(_seller!['avatar_url'] as String)
                                : null,
                            child: _seller!['avatar_url'] is String
                                ? null
                                : const Icon(Icons.store),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${_seller!['display_name'] ?? _seller!['username']}',
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                                Text('@${_seller!['username']}'),
                                if (_seller!['bio'] is String)
                                  Text('${_seller!['bio']}'),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_error != null)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.info_outline),
                      title: Text(_error!),
                    ),
                  ),
                Text('Products', style: Theme.of(context).textTheme.titleLarge),
                if (_products.isEmpty && _error == null)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'This seller has no active products right now.',
                    ),
                  ),
                for (final p in _products)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.shopping_bag_outlined),
                      title: Text('${p['name'] ?? 'Product'}'),
                      subtitle: Text(
                        '${p['description'] ?? ''}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: Text(
                        _price(p),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ),
                  ),
              ],
            ),
          ),
  );
}
