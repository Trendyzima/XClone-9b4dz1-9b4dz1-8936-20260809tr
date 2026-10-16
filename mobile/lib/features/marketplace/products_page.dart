import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class ProductsPage extends StatefulWidget {
  const ProductsPage({super.key, this.productId});
  final String? productId;
  @override
  State<ProductsPage> createState() => _ProductsPageState();
}

class _ProductsPageState extends State<ProductsPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  final _search = TextEditingController();
  List<Map<String, dynamic>> _products = [];
  final Set<String> _wishlisted = {};
  bool _loading = true, _working = false;
  String _sort = 'Popular';
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _wishlisted.clear();
    });
    try {
      var query = _db.from('marketplace_public_products').select(
            'id,seller_id,name,description,price_minor,currency,status,created_at,available_inventory,local_delivery,delivery_fee_minor,delivery_eta,sales_count,media_url,seller_username,seller_display_name,seller_avatar_url',
          );
      if (widget.productId != null) {
        query = query.eq('id', widget.productId!);
      }
      final q = _search.text.trim().replaceAll(RegExp(r'[^a-zA-Z0-9\s-]'), ' ');
      if (widget.productId == null && q.isNotEmpty) {
        query = query.or('name.ilike.%$q%,description.ilike.%$q%');
      }
      final orderColumn = _sort == 'Newest'
          ? 'created_at'
          : _sort == 'Price: low to high'
              ? 'price_minor'
              : _sort == 'Price: high to low'
                  ? 'price_minor'
                  : 'sales_count';
      final rows = await query
          .order(orderColumn, ascending: _sort == 'Price: low to high')
          .limit(widget.productId == null ? 60 : 1)
          .timeout(const Duration(seconds: 15));
      final products = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
      if (_uid != null && products.isNotEmpty) {
        final saved = await _db
            .from('wishlists')
            .select('product_id')
            .eq('user_id', _uid!)
            .inFilter('product_id', products.map((p) => '${p['id']}').toList());
        _wishlisted.addAll(saved.map((r) => '${r['product_id']}'));
      }
      if (mounted) setState(() => _products = products);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Marketplace could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _available(Map<String, dynamic> p) =>
      (int.tryParse('${p['available_inventory'] ?? 0}') ?? 0).clamp(0, 1 << 30);

  Future<void> _toggleWishlist(Map<String, dynamic> product) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final id = '${product['id']}';
    final wasSaved = _wishlisted.contains(id);
    setState(() {
      wasSaved ? _wishlisted.remove(id) : _wishlisted.add(id);
    });
    try {
      if (wasSaved) {
        await _db.from('wishlists').delete().eq('user_id', uid).eq('product_id', id);
      } else {
        await _db.from('wishlists').insert({'user_id': uid, 'product_id': id});
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          wasSaved ? _wishlisted.add(id) : _wishlisted.remove(id);
        });
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Wishlist update failed. Please retry.')));
      }
    }
  }

  Future<void> _purchase(Map<String, dynamic> product) async {
    final uid = _uid;
    if (uid == null) {
      context.go('/auth');
      return;
    }
    final quantity = TextEditingController(text: '1'),
        address = TextEditingController(),
        note = TextEditingController();
    String delivery = 'seller_delivery';
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, update) => AlertDialog(
          title: const Text('Secure wallet checkout'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Total is calculated and validated by the server before wallet debit.'),
                TextField(
                  controller: quantity,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Quantity'),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: delivery,
                  decoration: const InputDecoration(labelText: 'Delivery'),
                  items: [
                    const DropdownMenuItem(value: 'pickup', child: Text('Pickup')),
                    const DropdownMenuItem(
                      value: 'seller_delivery',
                      child: Text('Seller delivery'),
                    ),
                    if (product['local_delivery'] == true)
                      const DropdownMenuItem(
                        value: 'local_delivery',
                        child: Text('Local delivery'),
                      ),
                  ],
                  onChanged: (v) {
                    if (v != null) update(() => delivery = v);
                  },
                ),
                if (delivery != 'pickup')
                  TextField(
                    controller: address,
                    maxLines: 2,
                    decoration: const InputDecoration(labelText: 'Delivery address'),
                  ),
                TextField(
                  controller: note,
                  decoration: const InputDecoration(labelText: 'Delivery note (optional)'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, {
                'quantity': int.tryParse(quantity.text),
                'delivery': delivery,
                'address': address.text.trim(),
                'note': note.text.trim(),
              }),
              child: const Text('Place order'),
            ),
          ],
        ),
      ),
    );
    quantity.dispose();
    address.dispose();
    note.dispose();
    if (result == null || !mounted) return;
    final qty = result['quantity'] as int?;
    if (qty == null || qty < 1 || qty > 100) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Quantity must be between 1 and 100.')));
      return;
    }
    if (result['delivery'] != 'pickup' && (result['address'] as String).isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('A delivery address is required.')));
      return;
    }
    setState(() => _working = true);
    try {
      final orderId = await _db.rpc(
        'place_marketplace_order',
        params: {
          'p_product_id': '${product['id']}',
          'p_quantity': qty,
          'p_idempotency_key': '$uid-${product['id']}-${DateTime.now().microsecondsSinceEpoch}',
          'p_delivery_mode': result['delivery'],
          'p_delivery_address': (result['address'] as String).isEmpty ? null : result['address'],
          'p_delivery_note': (result['note'] as String).isEmpty ? null : result['note'],
        },
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Order placed securely. Order reference: $orderId')));
        await _load();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_purchaseError('$e'))));
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  String _purchaseError(String error) {
    if (error.contains('INSUFFICIENT_WALLET_BALANCE')) {
      return 'Your wallet balance is insufficient for this purchase.';
    }
    if (error.contains('INSUFFICIENT_STOCK')) {
      return 'There is not enough stock for that quantity.';
    }
    if (error.contains('PRODUCT_UNAVAILABLE')) {
      return 'This product is no longer available.';
    }
    if (error.contains('WALLET_NOT_FOUND')) {
      return 'Set up your Testagram wallet before checkout.';
    }
    if (error.contains('SELF_PURCHASE_NOT_ALLOWED')) {
      return 'You cannot buy your own product.';
    }
    if (error.contains('LOCAL_DELIVERY_UNAVAILABLE')) {
      return 'Local delivery is not offered for this product.';
    }
    return 'Checkout failed safely; your order was not confirmed. Please retry.';
  }

  @override
  Widget build(BuildContext context) {
    final detail = widget.productId != null;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              if (detail)
                IconButton(
                  onPressed: () => context.go('/products'),
                  icon: const Icon(Icons.arrow_back_rounded),
                ),
              Expanded(
                child: Text(
                  detail ? 'Product details' : 'Marketplace',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              IconButton(
                tooltip: 'My orders',
                onPressed: () => context.go('/orders'),
                icon: const Icon(Icons.receipt_long_rounded),
              ),
            ],
          ),
          if (!detail) ...[
            TextField(
              controller: _search,
              onSubmitted: (_) => _load(),
              decoration: InputDecoration(
                hintText: 'Search products',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(
                  onPressed: () {
                    _search.clear();
                    _load();
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
              ),
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _sort,
              decoration: const InputDecoration(labelText: 'Sort'),
              items: const [
                DropdownMenuItem(value: 'Popular', child: Text('Best selling')),
                DropdownMenuItem(value: 'Newest', child: Text('Newest')),
                DropdownMenuItem(value: 'Price: low to high', child: Text('Price: low to high')),
                DropdownMenuItem(value: 'Price: high to low', child: Text('Price: high to low')),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() => _sort = v);
                  _load();
                }
              },
            ),
          ],
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Text(_error!),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            ),
          if (!_loading && _products.isEmpty && _error == null)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('No products are available right now.')),
            ),
          ..._products.map((p) {
            final id = '${p['id']}';
            final image = '${p['media_url'] ?? ''}';
            final currency = '${p['currency'] ?? 'KES'}';
            final amount = (int.tryParse('${p['price_minor'] ?? 0}') ?? 0) / 100;
            final available = _available(p);
            return Card(
              margin: const EdgeInsets.only(top: 10),
              clipBehavior: Clip.antiAlias,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (image.startsWith('http'))
                    Image.network(
                      image,
                      height: detail ? 260 : 170,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const SizedBox(
                        height: 100,
                        child: Center(child: Icon(Icons.inventory_2_outlined, size: 42)),
                      ),
                    )
                  else
                    SizedBox(
                      height: detail ? 180 : 110,
                      child: const Center(child: Icon(Icons.inventory_2_outlined, size: 42)),
                    ),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${p['name'] ?? 'Product'}',
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${p['seller_display_name'] ?? p['seller_username'] ?? 'Testagram seller'} · ${p['seller_username'] == null ? '' : '@${p['seller_username']}'}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '$currency ${amount.toStringAsFixed(2)}',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        if ('${p['description'] ?? ''}'.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              '${p['description']}',
                              maxLines: detail ? 20 : 3,
                              overflow: detail ? TextOverflow.visible : TextOverflow.ellipsis,
                            ),
                          ),
                        const SizedBox(height: 8),
                        Text(
                          available > 0 ? '$available available' : 'Out of stock',
                          style: TextStyle(
                            color: available > 0 ? Colors.green : Colors.red,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Wrap(
                          spacing: 8,
                          children: [
                            if (!detail)
                              OutlinedButton(
                                onPressed: () => context.go('/p/$id'),
                                child: const Text('Details'),
                              ),
                            IconButton(
                              tooltip: _wishlisted.contains(id)
                                  ? 'Remove from wishlist'
                                  : 'Save to wishlist',
                              onPressed: () => _toggleWishlist(p),
                              icon: Icon(
                                _wishlisted.contains(id) ? Icons.favorite : Icons.favorite_border,
                                color: _wishlisted.contains(id) ? Colors.pink : null,
                              ),
                            ),
                            if (detail)
                              FilledButton.icon(
                                onPressed: _working || available < 1 ? null : () => _purchase(p),
                                icon: const Icon(Icons.shopping_bag_outlined),
                                label: Text(_working ? 'Processing…' : 'Buy securely'),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
