import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Server-backed wishlist using the authenticated user's RLS-protected rows.
class WishlistPage extends StatefulWidget {
  const WishlistPage({super.key});

  @override
  State<WishlistPage> createState() => _WishlistPageState();
}

class _WishlistPageState extends State<WishlistPage> {
  final _client = Supabase.instance.client;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _products = const [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final user = _client.auth.currentUser;
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to view your wishlist.';
      });
      return;
    }
    try {
      final rows = await _client
          .from('wishlists')
          .select('product_id,created_at')
          .eq('user_id', user.id)
          .order('created_at', ascending: false)
          .limit(100);
      final ids = rows.map((r) => '${r['product_id']}').where((id) => id.isNotEmpty).toList();
      if (ids.isEmpty) {
        if (mounted) {
          setState(() {
            _products = const [];
            _loading = false;
          });
        }
        return;
      }
      final products = await _client
          .from('products')
          .select('id,name,description,price,image_url,is_featured,user_id')
          .inFilter('id', ids)
          .eq('is_active', true);
      final byId = {for (final row in products) '${row['id']}': Map<String, dynamic>.from(row)};
      if (!mounted) return;
      setState(() {
        _products = ids.map((id) => byId[id]).whereType<Map<String, dynamic>>().toList();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Wishlist could not be loaded. Check your connection and retry.';
      });
    }
  }

  Future<void> _remove(String productId) async {
    final user = _client.auth.currentUser;
    if (user == null || _busy) return;
    setState(() => _busy = true);
    try {
      await _client.from('wishlists').delete().eq('user_id', user.id).eq('product_id', productId);
      if (mounted) {
        setState(() => _products = _products.where((p) => '${p['id']}' != productId).toList());
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Item was not removed. Please retry.')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = _products.fold<double>(
      0,
      (sum, p) => sum + (double.tryParse('${p['price'] ?? 0}') ?? 0),
    );
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Wishlist',
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            '${_products.length} saved item${_products.length == 1 ? '' : 's'} • total ${total.toStringAsFixed(2)}',
          ),
          const SizedBox(height: 12),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(_error!),
                trailing: IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
              ),
            ),
          if (!_loading && _error == null && _products.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  children: [
                    const Icon(Icons.favorite_border, size: 42),
                    const SizedBox(height: 10),
                    const Text('Your wishlist is empty'),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      onPressed: () => context.go('/products'),
                      icon: const Icon(Icons.storefront_outlined),
                      label: const Text('Browse products'),
                    ),
                  ],
                ),
              ),
            ),
          for (final product in _products)
            Card(
              child: ListTile(
                leading:
                    product['image_url'] is String && '${product['image_url']}'.startsWith('http')
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.network(
                          '${product['image_url']}',
                          width: 56,
                          height: 56,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Icon(Icons.shopping_bag_outlined),
                        ),
                      )
                    : const CircleAvatar(child: Icon(Icons.shopping_bag_outlined)),
                title: Text(
                  '${product['name'] ?? 'Product'}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  '${product['price'] ?? '—'} • ${product['description'] ?? ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () => context.go('/p/${product['id']}'),
                trailing: IconButton(
                  tooltip: 'Remove from wishlist',
                  onPressed: _busy ? null : () => _remove('${product['id']}'),
                  icon: const Icon(Icons.delete_outline),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
