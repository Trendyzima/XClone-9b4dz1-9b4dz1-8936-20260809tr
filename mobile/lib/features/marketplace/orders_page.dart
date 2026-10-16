import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class OrdersPage extends StatefulWidget {
  const OrdersPage({super.key});
  @override
  State<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends State<OrdersPage> {
  SupabaseClient get _db => Supabase.instance.client;
  String? get _uid => _db.auth.currentUser?.id;
  List<Map<String, dynamic>> _orders = [];
  Map<String, String> _productNames = {};
  bool _loading = true;
  String? _error;
  String _tab = 'Purchases';
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final uid = _uid;
    if (uid == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Sign in to view your orders.';
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
          .from('orders')
          .select(
            'id,buyer_id,seller_id,product_id,quantity,total_minor,currency,status,created_at,delivery_mode,delivery_status,delivery_address',
          )
          .or('buyer_id.eq.$uid,seller_id.eq.$uid')
          .order('created_at', ascending: false)
          .limit(100)
          .timeout(const Duration(seconds: 15));
      final ids = rows
          .map((r) => '${r['product_id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      final products = ids.isEmpty
          ? <dynamic>[]
          : await _db.from('products').select('id,name').inFilter('id', ids);
      if (!mounted) return;
      setState(() {
        _orders = rows.map((r) => Map<String, dynamic>.from(r as Map)).toList();
        _productNames = {for (final p in products) '${p['id']}': '${p['name']}'};
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Order history could not load. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = _uid;
    if (uid == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.receipt_long_rounded, size: 48),
              const SizedBox(height: 12),
              const Text('Sign in to view your purchases and sales.'),
              const SizedBox(height: 12),
              FilledButton(onPressed: () => context.go('/auth'), child: const Text('Sign in')),
            ],
          ),
        ),
      );
    }
    final visible = _orders
        .where((o) => _tab == 'Purchases' ? '${o['buyer_id']}' == uid : '${o['seller_id']}' == uid)
        .toList();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => context.go('/products'),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              Expanded(
                child: Text(
                  'Orders',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              IconButton(
                onPressed: _load,
                tooltip: 'Refresh',
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'Purchases', label: Text('Purchases')),
              ButtonSegment(value: 'Sales', label: Text('Sales')),
            ],
            selected: {_tab},
            onSelectionChanged: (v) => setState(() => _tab = v.first),
          ),
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
          if (!_loading && visible.isEmpty && _error == null)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text(
                  _tab == 'Purchases'
                      ? 'You have not purchased anything yet.'
                      : 'You have no sales yet.',
                ),
              ),
            ),
          ...visible.map((o) {
            final id = '${o['id']}';
            final productId = '${o['product_id'] ?? ''}';
            final status = '${o['status'] ?? 'pending'}';
            final deliveryStatus = '${o['delivery_status'] ?? 'pending'}';
            final total = (int.tryParse('${o['total_minor'] ?? 0}') ?? 0) / 100;
            final currency = '${o['currency'] ?? 'KES'}';
            return Card(
              margin: const EdgeInsets.only(top: 8),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.receipt_long_rounded),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _productNames[productId] ??
                                (productId.isEmpty ? 'Order' : 'Product $productId'),
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ),
                        Chip(
                          label: Text(status.toUpperCase()),
                          visualDensity: VisualDensity.compact,
                        ),
                      ],
                    ),
                    Text('Order $id', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 8),
                    Text(
                      '$currency ${total.toStringAsFixed(2)} · Quantity ${o['quantity'] ?? 1}',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Created: ${o['created_at'] ?? '—'}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const Divider(height: 20),
                    Row(
                      children: [
                        const Icon(Icons.local_shipping_outlined, size: 18),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text('${o['delivery_mode'] ?? 'Delivery'} · $deliveryStatus'),
                        ),
                        if (productId.isNotEmpty)
                          TextButton(
                            onPressed: () => context.go('/p/$productId'),
                            child: const Text('Product'),
                          ),
                      ],
                    ),
                    if (_tab == 'Purchases' && '${o['delivery_address'] ?? ''}'.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          'Delivery address: ${o['delivery_address']}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}
