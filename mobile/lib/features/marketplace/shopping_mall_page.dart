import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'shopping_mall_policy.dart';

class _MallProduct {
  const _MallProduct({
    required this.id,
    required this.sellerId,
    required this.name,
    required this.description,
    required this.priceMinor,
    required this.currency,
    required this.category,
    required this.inventory,
    required this.localDelivery,
    required this.deliveryFeeMinor,
    required this.deliveryEta,
    required this.salesCount,
    required this.createdAt,
    required this.imageUrl,
    required this.sellerName,
    required this.sellerUsername,
  });

  final String id;
  final String sellerId;
  final String name;
  final String description;
  final int priceMinor;
  final String currency;
  final String category;
  final int inventory;
  final bool localDelivery;
  final int deliveryFeeMinor;
  final String deliveryEta;
  final int salesCount;
  final DateTime? createdAt;
  final String? imageUrl;
  final String sellerName;
  final String sellerUsername;

  factory _MallProduct.fromRow(Map<String, dynamic> row) => _MallProduct(
        id: '${row['id'] ?? ''}',
        sellerId: '${row['seller_id'] ?? ''}',
        name: '${row['name'] ?? 'Product'}',
        description: '${row['description'] ?? ''}',
        priceMinor: int.tryParse('${row['price_minor'] ?? 0}') ?? 0,
        currency: '${row['currency'] ?? 'KES'}',
        category: '${row['category'] ?? ''}',
        inventory: (int.tryParse('${row['available_inventory'] ?? 0}') ?? 0)
            .clamp(0, 1 << 30)
            .toInt(),
        localDelivery: row['local_delivery'] == true,
        deliveryFeeMinor:
            int.tryParse('${row['delivery_fee_minor'] ?? 0}') ?? 0,
        deliveryEta: '${row['delivery_eta'] ?? ''}',
        salesCount: int.tryParse('${row['sales_count'] ?? 0}') ?? 0,
        createdAt: DateTime.tryParse('${row['created_at'] ?? ''}'),
        imageUrl: MallPolicy.safeImageUrl(row['media_url']),
        sellerName:
            '${row['seller_display_name'] ?? row['seller_username'] ?? 'Testagram seller'}',
        sellerUsername: '${row['seller_username'] ?? 'seller'}',
      );

  String get price => '$_currencyPrefix ${_formatMinor(priceMinor)}';
  String get _currencyPrefix => currency.toUpperCase();

  static String _formatMinor(int minor) => (minor / 100).toStringAsFixed(2);
}

class ShoppingMallPage extends StatefulWidget {
  const ShoppingMallPage({super.key});

  @override
  State<ShoppingMallPage> createState() => _ShoppingMallPageState();
}

class _ShoppingMallPageState extends State<ShoppingMallPage> {
  SupabaseClient get _db => Supabase.instance.client;
  final _search = TextEditingController();
  final _catalogKey = GlobalKey();
  Timer? _searchDebounce;
  List<_MallProduct> _products = [];
  final Set<String> _wishlist = {};
  final Set<String> _checkoutBusyProducts = {};
  Map<String, int> _cart = {};
  String _category = 'all';
  String _sort = 'Popular';
  String? _error;
  bool _loading = true;
  bool _refreshing = false;
  bool _walletLoading = false;
  double? _walletBalance;
  String _walletCurrency = 'KES';
  int _requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    _restoreCart();
    _loadWishlist();
    _loadWallet();
    _loadProducts();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _restoreCart() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('testagram.mall.cart.v1');
      if (raw == null) return;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final cart = <String, int>{};
      decoded.forEach((key, value) {
        final quantity = int.tryParse('$value') ?? 0;
        if (key is String &&
            key.isNotEmpty &&
            quantity > 0 &&
            quantity <= 100) {
          cart[key] = quantity;
        }
      });
      if (mounted) setState(() => _cart = cart);
    } catch (_) {
      // A corrupt local cart must never block the Mall or checkout.
    }
  }

  Future<void> _persistCart() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('testagram.mall.cart.v1', jsonEncode(_cart));
    } catch (_) {
      if (mounted) _message('Cart could not be saved on this device.');
    }
  }

  Future<void> _loadWishlist() async {
    final user = _db.auth.currentUser;
    if (user == null) return;
    try {
      final rows = await _db
          .from('wishlists')
          .select('product_id')
          .eq('user_id', user.id)
          .limit(500)
          .timeout(const Duration(seconds: 12));
      if (mounted) {
        setState(
          () => _wishlist.addAll(rows.map((row) => '${row['product_id']}')),
        );
      }
    } catch (_) {
      // Wishlist is optional; product browsing stays available.
    }
  }

  Future<void> _loadWallet() async {
    if (_db.auth.currentUser == null) {
      if (mounted) {
        setState(() {
          _walletBalance = null;
          _walletLoading = false;
        });
      }
      return;
    }
    if (mounted) setState(() => _walletLoading = true);
    try {
      final result =
          await _db.rpc('get_my_wallet').timeout(const Duration(seconds: 12));
      dynamic wallet = result;
      if (wallet is List) wallet = wallet.isEmpty ? null : wallet.first;
      if (wallet is Map) {
        if (mounted) {
          setState(() {
            _walletBalance = double.tryParse('${wallet['balance'] ?? ''}');
            _walletCurrency = '${wallet['currency'] ?? 'KES'}';
          });
        }
      }
    } catch (_) {
      if (mounted) setState(() => _walletBalance = null);
    } finally {
      if (mounted) setState(() => _walletLoading = false);
    }
  }

  Future<void> _loadProducts({bool refresh = false}) async {
    final generation = ++_requestGeneration;
    if (mounted) {
      setState(() {
        _error = null;
        _loading = _products.isEmpty;
        _refreshing = refresh;
      });
    }
    try {
      final term = _search.text.trim();
      final orderColumn = _sort == 'Newest'
          ? 'created_at'
          : _sort == 'Price: low to high' || _sort == 'Price: high to low'
              ? 'price_minor'
              : 'sales_count';
      List<dynamic> rows;
      try {
        rows = await _fetchCatalogRows(
          includeCategory: true,
          term: term,
          orderColumn: orderColumn,
        );
      } catch (error) {
        final message = '$error'.toLowerCase();
        final missingCategoryProjection = message.contains('pgrst204') ||
            message.contains('42703') ||
            (message.contains('category') && message.contains('column'));
        if (!missingCategoryProjection) rethrow;
        // The category projection migration may not yet be deployed in an
        // existing environment. Keep browsing operational while categories
        // fall back to safe keyword matching until the migration is applied.
        rows = await _fetchCatalogRows(
          includeCategory: false,
          term: term,
          orderColumn: orderColumn,
        );
      }
      final products = rows
          .map(
            (row) =>
                _MallProduct.fromRow(Map<String, dynamic>.from(row as Map)),
          )
          .where((p) => p.id.isNotEmpty)
          .toList();
      if (!mounted || generation != _requestGeneration) return;
      setState(() => _products = products);
    } catch (_) {
      if (!mounted || generation != _requestGeneration) return;
      setState(
        () => _error =
            'The Mall could not refresh. Check your connection and retry.',
      );
    } finally {
      if (mounted && generation == _requestGeneration) {
        setState(() {
          _loading = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<List<dynamic>> _fetchCatalogRows({
    required bool includeCategory,
    required String term,
    required String orderColumn,
  }) async {
    final columns = includeCategory
        ? 'id,seller_id,name,description,price_minor,currency,status,created_at,available_inventory,local_delivery,delivery_fee_minor,delivery_eta,sales_count,media_url,seller_username,seller_display_name,seller_avatar_url,category'
        : 'id,seller_id,name,description,price_minor,currency,status,created_at,available_inventory,local_delivery,delivery_fee_minor,delivery_eta,sales_count,media_url,seller_username,seller_display_name,seller_avatar_url';
    dynamic query = _db.from('marketplace_public_products').select(columns);
    if (term.isNotEmpty) {
      final safe = term.replaceAll(RegExp(r'[^a-zA-Z0-9\s-]'), ' ').trim();
      if (safe.isNotEmpty) {
        query = query.or(
          'name.ilike.%$safe%,description.ilike.%$safe%,seller_username.ilike.%$safe%',
        );
      }
    }
    final rows = await query
        .order(orderColumn, ascending: _sort == 'Price: low to high')
        .limit(100)
        .timeout(const Duration(seconds: 18));
    return List<dynamic>.from(rows as List);
  }

  List<_MallProduct> get _visibleProducts {
    final products = _products
        .where(
          (product) => MallPolicy.matchesCategory(
            selectedId: _category,
            categoryValue: product.category,
            name: product.name,
            description: product.description,
          ),
        )
        .toList();
    if (_sort == 'Price: low to high') {
      products.sort((a, b) => a.priceMinor.compareTo(b.priceMinor));
    }
    if (_sort == 'Price: high to low') {
      products.sort((a, b) => b.priceMinor.compareTo(a.priceMinor));
    }
    if (_sort == 'Newest') {
      products.sort(
        (a, b) => (b.createdAt ?? DateTime(1970)).compareTo(
          a.createdAt ?? DateTime(1970),
        ),
      );
    }
    if (_sort == 'Popular') {
      products.sort((a, b) => b.salesCount.compareTo(a.salesCount));
    }
    return products;
  }

  List<_MallProduct> get _hotDeals {
    final products = _visibleProducts.where((p) => p.inventory > 0).toList()
      ..sort((a, b) => b.salesCount.compareTo(a.salesCount));
    return products.take(12).toList();
  }

  int get _cartCount => _cart.values.fold(0, (sum, value) => sum + value);

  void _setCategory(String id) {
    setState(() => _category = id);
    // Category matching is done against the public catalog projection; no new
    // database endpoint or privilege is required for a category carousel.
  }

  void _showAllProducts() {
    setState(() => _category = 'all');
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _catalogKey.currentContext;
      if (target != null) {
        Scrollable.ensureVisible(
          target,
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeOutCubic,
          alignment: .03,
        );
      }
    });
  }

  void _onSearchChanged(String _) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(
      const Duration(milliseconds: 350),
      () => _loadProducts(refresh: true),
    );
    setState(() {});
  }

  void _addToCart(_MallProduct product) {
    if (product.inventory < 1) {
      _message('This product is out of stock.');
      return;
    }
    setState(() {
      _cart[product.id] = ((_cart[product.id] ?? 0) + 1)
          .clamp(1, product.inventory.clamp(1, 100))
          .toInt();
    });
    unawaited(_persistCart());
    _message('Added to your cart');
  }

  void _changeCart(_MallProduct product, int delta) {
    setState(() {
      final next = ((_cart[product.id] ?? 0) + delta)
          .clamp(0, product.inventory.clamp(0, 100))
          .toInt();
      if (next == 0) {
        _cart.remove(product.id);
      } else {
        _cart[product.id] = next;
      }
    });
    unawaited(_persistCart());
  }

  Future<void> _toggleWishlist(_MallProduct product) async {
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) context.go('/auth');
      return;
    }
    final existed = _wishlist.contains(product.id);
    setState(
      () => existed ? _wishlist.remove(product.id) : _wishlist.add(product.id),
    );
    try {
      if (existed) {
        await _db
            .from('wishlists')
            .delete()
            .eq('user_id', user.id)
            .eq('product_id', product.id)
            .timeout(const Duration(seconds: 12));
      } else {
        await _db
            .from('wishlists')
            .insert({'user_id': user.id, 'product_id': product.id}).timeout(
                const Duration(seconds: 12));
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => existed
              ? _wishlist.add(product.id)
              : _wishlist.remove(product.id),
        );
        _message('Wishlist update failed. Please retry.');
      }
    }
  }

  String _newCheckoutToken() {
    final random = math.Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return 'mall-${bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
  }

  String _pendingCheckoutPreferenceKey(String userId, String productId) =>
      'testagram.mall.pending_checkout.v1.$userId.$productId';

  Future<String> _loadOrCreatePendingCheckoutKey(
    String userId,
    String productId,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    final preferenceKey = _pendingCheckoutPreferenceKey(userId, productId);
    final existing = prefs.getString(preferenceKey)?.trim();
    if (existing != null && existing.length >= 16) return existing;
    final key = _newCheckoutToken();
    final saved = await prefs.setString(preferenceKey, key);
    if (!saved) {
      throw StateError('CHECKOUT_RECOVERY_KEY_NOT_PERSISTED');
    }
    return key;
  }

  Future<bool> _clearPendingCheckoutKey(String userId, String productId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return await prefs.remove(
        _pendingCheckoutPreferenceKey(userId, productId),
      );
    } catch (_) {
      return false;
    }
  }

  Future<void> _buy(_MallProduct product, {int initialQuantity = 1}) async {
    final user = _db.auth.currentUser;
    if (user == null) {
      context.go('/auth');
      return;
    }
    if (product.inventory < 1) {
      _message('This product is out of stock.');
      return;
    }
    final quantity = TextEditingController(
      text: '${initialQuantity.clamp(1, product.inventory.clamp(1, 100))}',
    );
    final address = TextEditingController();
    final note = TextEditingController();
    var delivery = 'seller_delivery';
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('Secure wallet checkout'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    const Icon(Icons.verified_user_outlined),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        product.name,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  'Unit price: ${product.price}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: quantity,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Quantity (max 100)',
                  ),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: delivery,
                  decoration: const InputDecoration(
                    labelText: 'Delivery option',
                  ),
                  items: [
                    const DropdownMenuItem(
                      value: 'pickup',
                      child: Text('Pickup'),
                    ),
                    const DropdownMenuItem(
                      value: 'seller_delivery',
                      child: Text('Seller delivery'),
                    ),
                    if (product.localDelivery)
                      const DropdownMenuItem(
                        value: 'local_delivery',
                        child: Text('Local delivery'),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) update(() => delivery = value);
                  },
                ),
                if (delivery != 'pickup')
                  TextField(
                    controller: address,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Delivery address',
                    ),
                  ),
                TextField(
                  controller: note,
                  decoration: const InputDecoration(
                    labelText: 'Delivery note (optional)',
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'The server validates stock, wallet balance, and the final charge in one transaction.',
                  style: TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, {
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
    if (qty == null || qty < 1 || qty > 100 || qty > product.inventory) {
      _message('Enter a valid quantity within available stock.');
      return;
    }
    if (result['delivery'] != 'pickup' &&
        (result['address'] as String).isEmpty) {
      _message('Enter a delivery address or choose pickup.');
      return;
    }
    if (_checkoutBusyProducts.contains(product.id)) {
      _message('Checkout for this product is already in progress.');
      return;
    }
    setState(() {
      _checkoutBusyProducts.add(product.id);
      _refreshing = true;
    });
    try {
      // Persist one idempotency key per signed-in buyer/product until the
      // server confirms an order. If the response is lost after commit, a
      // retry reuses the key and the database returns the original order
      // instead of charging the wallet twice.
      final idempotency = await _loadOrCreatePendingCheckoutKey(
        user.id,
        product.id,
      );
      final reservationKey = _newCheckoutToken();
      await _db.rpc(
        'reserve_marketplace_inventory',
        params: {
          'p_product_id': product.id,
          'p_quantity': qty,
          'p_reservation_key': reservationKey,
          'p_ttl_seconds': 600,
        },
      ).timeout(const Duration(seconds: 15));
      final orderId = await _db.rpc(
        'place_marketplace_order',
        params: {
          'p_product_id': product.id,
          'p_quantity': qty,
          'p_idempotency_key': idempotency,
          'p_delivery_mode': result['delivery'],
          'p_delivery_address':
              (result['address'] as String).isEmpty ? null : result['address'],
          'p_delivery_note':
              (result['note'] as String).isEmpty ? null : result['note'],
          'p_reservation_key': reservationKey,
        },
      ).timeout(const Duration(seconds: 25));
      if (!mounted) return;
      final cleared = await _clearPendingCheckoutKey(user.id, product.id);
      _changeCart(product, -qty);
      await _loadWallet();
      await _loadProducts(refresh: true);
      if (mounted) {
        _message(
          cleared
              ? 'Order placed securely. Reference: $orderId'
              : 'Order placed securely. Reference: $orderId. Check Orders before retrying this item.',
        );
      }
    } catch (error) {
      if (mounted) _message(_checkoutError('$error'));
    } finally {
      if (mounted) {
        setState(() {
          _checkoutBusyProducts.remove(product.id);
          _refreshing = false;
        });
      }
    }
  }

  String _checkoutError(String error) {
    if (error.contains('AUTH_REQUIRED')) {
      return 'Please sign in before checkout.';
    }
    if (error.contains('INSUFFICIENT_WALLET_BALANCE')) {
      return 'Your wallet balance is insufficient.';
    }
    if (error.contains('INSUFFICIENT_STOCK')) {
      return 'Stock changed. Refresh and try again.';
    }
    if (error.contains('PRODUCT_UNAVAILABLE')) {
      return 'This product is no longer available.';
    }
    if (error.contains('WALLET_NOT_FOUND')) {
      return 'Set up your Testagram Wallet before checkout.';
    }
    if (error.contains('SELF_PURCHASE_NOT_ALLOWED')) {
      return 'You cannot buy your own listing.';
    }
    if (error.contains('DELIVERY_ADDRESS_REQUIRED')) {
      return 'A delivery address is required for this option.';
    }
    if (error.contains('UNSUPPORTED_CURRENCY')) {
      return 'This wallet or product currency is not supported.';
    }
    return 'Checkout failed safely. Your wallet was not charged unless the server confirmed the order. Please refresh and check Orders.';
  }

  void _message(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visibleProducts;
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1200
        ? 5
        : width >= 800
            ? 4
            : width >= 520
                ? 3
                : 2;
    return RefreshIndicator(
      onRefresh: () async {
        await Future.wait([_loadProducts(refresh: true), _loadWallet()]);
      },
      child: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(child: _topBar(context)),
          SliverToBoxAdapter(child: _hero(context)),
          SliverToBoxAdapter(child: _benefits(context)),
          if (_db.auth.currentUser != null)
            SliverToBoxAdapter(child: _walletCard(context)),
          SliverToBoxAdapter(child: _categoryShelf(context)),
          SliverToBoxAdapter(child: _promoCarousel(context)),
          SliverToBoxAdapter(
            child: _horizontalShelf(
              context,
              title: 'Hot deals',
              subtitle: 'Popular picks from Testagram sellers',
              products: _hotDeals,
              badge: 'HOT',
            ),
          ),
          SliverToBoxAdapter(
            child: _horizontalShelf(
              context,
              title: 'Trending with the community',
              subtitle: 'Discover products from local creators and sellers',
              products: [..._visibleProducts]
                ..sort((a, b) => b.salesCount.compareTo(a.salesCount)),
              badge: 'TRENDING',
            ),
          ),
          SliverToBoxAdapter(
            key: _catalogKey,
            child: _catalogHeader(context, visible.length),
          ),
          if (_error != null && _products.isEmpty)
            SliverToBoxAdapter(child: _errorPanel(context))
          else if (_loading && _products.isEmpty)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              ),
            )
          else if (visible.isEmpty)
            SliverToBoxAdapter(child: _emptyPanel(context))
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
              sliver: SliverGrid(
                delegate: SliverChildBuilderDelegate(
                  (context, index) => _productCard(context, visible[index]),
                  childCount: visible.length,
                ),
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  mainAxisSpacing: 10,
                  crossAxisSpacing: 10,
                  childAspectRatio: width < 400
                      ? .57
                      : width < 700
                          ? .62
                          : .68,
                ),
              ),
            ),
          if (_error != null && _products.isNotEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Text(
                  'Showing the last loaded catalog because refresh failed.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _topBar(BuildContext context) => Container(
        color: Theme.of(context).colorScheme.surface,
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primary,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: const Icon(
                    Icons.shopping_bag_rounded,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'TESTAGRAM MALL',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1.1,
                            ),
                      ),
                      Text(
                        'Shop local. Discover more.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => context.go('/orders'),
                  tooltip: 'My orders',
                  icon: const Icon(Icons.receipt_long_outlined),
                ),
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    IconButton(
                      onPressed: _openCart,
                      tooltip: 'Shopping cart',
                      icon: const Icon(Icons.shopping_cart_outlined),
                    ),
                    if (_cartCount > 0)
                      Positioned(
                        right: 0,
                        top: 0,
                        child: Container(
                          padding: const EdgeInsets.all(4),
                          decoration: const BoxDecoration(
                            color: Colors.red,
                            shape: BoxShape.circle,
                          ),
                          child: Text(
                            '$_cartCount',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _search,
              onChanged: _onSearchChanged,
              onSubmitted: (_) => _loadProducts(refresh: true),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search products, brands and sellers…',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        onPressed: () {
                          _search.clear();
                          _onSearchChanged('');
                        },
                        icon: const Icon(Icons.close_rounded),
                      ),
                filled: true,
                fillColor: Theme.of(
                  context,
                ).colorScheme.surfaceContainerHighest.withValues(alpha: .5),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ],
        ),
      );

  Widget _hero(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
        child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Theme.of(context).colorScheme.primary,
                Theme.of(context).colorScheme.primary.withValues(alpha: .78),
                const Color(0xFF172554),
              ],
            ),
          ),
          child: Stack(
            children: [
              Positioned(
                right: -10,
                bottom: -30,
                child: Icon(
                  Icons.shopping_bag_rounded,
                  size: 180,
                  color: Colors.white.withValues(alpha: .09),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .16),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text(
                        'THE COMMUNITY MARKETPLACE',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 10,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Shop. Discover.\nSupport creators.',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 29,
                        height: 1.08,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -.7,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Great finds from local sellers, creators and brands across Testagram.',
                      style: TextStyle(color: Colors.white, height: 1.4),
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        FilledButton.icon(
                          onPressed: () {
                            setState(() => _category = 'all');
                          },
                          icon: const Icon(Icons.bolt_rounded),
                          label: const Text('Explore deals'),
                          style: FilledButton.styleFrom(
                            backgroundColor: Colors.white,
                            foregroundColor:
                                Theme.of(context).colorScheme.primary,
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: () => context.go('/products'),
                          icon: const Icon(Icons.storefront_outlined),
                          label: const Text('Sell on Testagram'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white,
                            side: const BorderSide(color: Colors.white54),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Widget _benefits(BuildContext context) => SizedBox(
        height: 96,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          children: [
            _benefit(
              context,
              Icons.local_shipping_outlined,
              'Local delivery',
              'Seller-set options',
            ),
            _benefit(
              context,
              Icons.verified_user_outlined,
              'Wallet checkout',
              'Server-validated',
            ),
            _benefit(
              context,
              Icons.storefront_outlined,
              'Trusted sellers',
              'Community profiles',
            ),
            _benefit(
              context,
              Icons.support_agent_rounded,
              'Help & support',
              'We’re here to help',
            ),
          ],
        ),
      );

  Widget _benefit(
    BuildContext context,
    IconData icon,
    String title,
    String subtitle,
  ) =>
      Container(
        width: 205,
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border.all(
            color: Theme.of(context).dividerColor.withValues(alpha: .45),
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Icon(icon, color: Theme.of(context).colorScheme.primary, size: 23),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(fontSize: 10),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _walletCard(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 2, 12, 10),
        child: Container(
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: Theme.of(
              context,
            ).colorScheme.primaryContainer.withValues(alpha: .55),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color:
                  Theme.of(context).colorScheme.primary.withValues(alpha: .18),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  Icons.account_balance_wallet_outlined,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'TESTAGRAM WALLET',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            letterSpacing: .9,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _walletLoading
                          ? 'Loading balance…'
                          : _walletBalance == null
                              ? 'Balance unavailable'
                              : '$_walletCurrency ${_walletBalance!.toStringAsFixed(2)}',
                      style: Theme.of(
                        context,
                      )
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: () => context.go('/wallet'),
                child: const Text('Add funds'),
              ),
            ],
          ),
        ),
      );

  Widget _categoryShelf(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _sectionHeading(
                context,
                'Shop by category',
                'Find your next favourite',
                trailing: TextButton(
                  onPressed: () => _setCategory('all'),
                  child: const Text('View all'),
                ),
              ),
            ),
            SizedBox(
              height: 112,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
                children: MallPolicy.categories
                    .map(
                      (category) => GestureDetector(
                        onTap: () => _setCategory(category.id),
                        child: Container(
                          width: 100,
                          margin: const EdgeInsets.only(right: 8),
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: _category == category.id
                                ? Theme.of(context).colorScheme.primaryContainer
                                : Theme.of(context).colorScheme.surface,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(
                              color: _category == category.id
                                  ? Theme.of(context).colorScheme.primary
                                  : Theme.of(
                                      context,
                                    ).dividerColor.withValues(alpha: .45),
                            ),
                          ),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                category.emoji,
                                style: const TextStyle(fontSize: 27),
                              ),
                              const SizedBox(height: 7),
                              Text(
                                category.label,
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
        ),
      );

  Widget _promoCarousel(BuildContext context) => SizedBox(
        height: 135,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          children: [
            _promoCard(
              context,
              '01',
              'FLASH FINDS',
              'Deals worth discovering',
              Icons.bolt_rounded,
              const Color(0xFFB91C1C),
              () => _loadProducts(refresh: true),
            ),
            _promoCard(
              context,
              '02',
              'MADE LOCALLY',
              'Shop Kenyan creators',
              Icons.handshake_outlined,
              const Color(0xFF047857),
              () => _setCategory('handmade'),
            ),
            _promoCard(
              context,
              '03',
              'STYLE YOUR DAY',
              'Fashion and accessories',
              Icons.checkroom_outlined,
              const Color(0xFF6D28D9),
              () => _setCategory('fashion'),
            ),
            _promoCard(
              context,
              '04',
              'HOME REFRESH',
              'Small upgrades, big impact',
              Icons.chair_alt_outlined,
              const Color(0xFF1D4ED8),
              () => _setCategory('home'),
            ),
          ],
        ),
      );

  Widget _promoCard(
    BuildContext context,
    String number,
    String eyebrow,
    String title,
    IconData icon,
    Color color,
    VoidCallback onTap,
  ) =>
      InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          width: 265,
          margin: const EdgeInsets.only(right: 10),
          padding: const EdgeInsets.all(15),
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Stack(
            children: [
              Positioned(
                right: 0,
                bottom: -7,
                child: Icon(
                  icon,
                  size: 78,
                  color: Colors.white.withValues(alpha: .15),
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    eyebrow,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Row(
                    children: [
                      Text(
                        'Explore now',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      SizedBox(width: 5),
                      Icon(
                        Icons.arrow_forward_rounded,
                        color: Colors.white,
                        size: 14,
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      );

  Widget _sectionHeading(
    BuildContext context,
    String title,
    String subtitle, {
    Widget? trailing,
  }) =>
      Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(
                    context,
                  )
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 2),
                Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          if (trailing != null) trailing,
        ],
      );

  Widget _horizontalShelf(
    BuildContext context, {
    required String title,
    required String subtitle,
    required List<_MallProduct> products,
    required String badge,
  }) =>
      Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _sectionHeading(
                context,
                title,
                subtitle,
                trailing: _refreshing
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : TextButton(
                        onPressed: _showAllProducts,
                        child: const Text('See all'),
                      ),
              ),
            ),
            SizedBox(
              height: 294,
              child: products.isEmpty
                  ? Center(
                      child: Text(
                        _loading
                            ? 'Loading products…'
                            : 'New products are arriving soon.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    )
                  : ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
                      children: products
                          .map(
                            (p) => SizedBox(
                              width: 174,
                              child: _productCard(
                                context,
                                p,
                                horizontal: true,
                                badge: badge,
                              ),
                            ),
                          )
                          .toList(),
                    ),
            ),
          ],
        ),
      );

  Widget _catalogHeader(BuildContext context, int count) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _category == 'all'
                        ? 'Explore the Mall'
                        : MallPolicy.category(_category).label,
                    style: Theme.of(
                      context,
                    )
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  Text(
                    '$count products · discover something good',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _sort,
                isDense: true,
                items: const [
                  DropdownMenuItem(value: 'Popular', child: Text('Popular')),
                  DropdownMenuItem(value: 'Newest', child: Text('Newest')),
                  DropdownMenuItem(
                    value: 'Price: low to high',
                    child: Text('Price ↑'),
                  ),
                  DropdownMenuItem(
                    value: 'Price: high to low',
                    child: Text('Price ↓'),
                  ),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _sort = value);
                },
              ),
            ),
          ],
        ),
      );

  Widget _productCard(
    BuildContext context,
    _MallProduct product, {
    bool horizontal = false,
    String? badge,
  }) {
    final wished = _wishlist.contains(product.id);
    final theme = Theme.of(context);
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withValues(alpha: .45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 5,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Material(
                  color: theme.colorScheme.surfaceContainerHighest,
                  child: InkWell(
                    onTap: () => context.go('/p/${product.id}'),
                    child: product.imageUrl == null
                        ? Center(
                            child: Icon(
                              Icons.shopping_bag_outlined,
                              size: 42,
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: .25,
                              ),
                            ),
                          )
                        : Image.network(
                            product.imageUrl!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                              child: Icon(
                                Icons.image_not_supported_outlined,
                                size: 36,
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: .35,
                                ),
                              ),
                            ),
                            loadingBuilder: (context, child, progress) =>
                                progress == null
                                    ? child
                                    : const Center(
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      ),
                          ),
                  ),
                ),
                if (badge != null)
                  Positioned(
                    left: 7,
                    top: 7,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        borderRadius: BorderRadius.circular(7),
                      ),
                      child: Text(
                        badge,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                if (product.inventory > 0 && product.inventory <= 5)
                  Positioned(
                    left: 7,
                    bottom: 7,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.black87,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Only ${product.inventory} left',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  right: 4,
                  top: 4,
                  child: Material(
                    color: theme.colorScheme.surface.withValues(alpha: .92),
                    shape: const CircleBorder(),
                    child: IconButton(
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints.tightFor(
                        width: 32,
                        height: 32,
                      ),
                      padding: EdgeInsets.zero,
                      onPressed: () => _toggleWishlist(product),
                      icon: Icon(
                        wished
                            ? Icons.favorite_rounded
                            : Icons.favorite_border_rounded,
                        size: 17,
                        color:
                            wished ? Colors.red : theme.colorScheme.onSurface,
                      ),
                      tooltip:
                          wished ? 'Remove from wishlist' : 'Add to wishlist',
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 4,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(9, 8, 9, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        Icons.storefront_outlined,
                        size: 12,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 3),
                      Expanded(
                        child: Text(
                          '@${product.sellerUsername}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 10,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  Text(
                    product.price,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w900,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: product.inventory < 1
                              ? null
                              : () => _addToCart(product),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            minimumSize: const Size(0, 32),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: const Icon(
                            Icons.add_shopping_cart_rounded,
                            size: 16,
                          ),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: FilledButton(
                          onPressed: product.inventory < 1 ||
                                  _checkoutBusyProducts.contains(product.id)
                              ? null
                              : () => _buy(product),
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            minimumSize: const Size(0, 32),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 16,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _errorPanel(BuildContext context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(Icons.cloud_off_rounded, size: 44),
            const SizedBox(height: 10),
            Text(_error ?? 'Catalog unavailable'),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => _loadProducts(refresh: true),
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
  Widget _emptyPanel(BuildContext context) => Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            const Icon(Icons.search_off_rounded, size: 44),
            const SizedBox(height: 10),
            const Text(
              'No products found',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 5),
            const Text('Try another search or category.'),
            TextButton(
              onPressed: () {
                _search.clear();
                setState(() {
                  _category = 'all';
                  _sort = 'Popular';
                });
                _loadProducts(refresh: true);
              },
              child: const Text('Clear filters'),
            ),
          ],
        ),
      );

  Future<void> _openCart() async {
    final missing =
        _cart.keys.where((id) => !_products.any((p) => p.id == id)).toList();
    if (missing.isNotEmpty) {
      try {
        final rows = await _db
            .from('marketplace_public_products')
            .select(
              'id,seller_id,name,description,price_minor,currency,status,created_at,available_inventory,local_delivery,delivery_fee_minor,delivery_eta,sales_count,media_url,seller_username,seller_display_name,seller_avatar_url',
            )
            .inFilter('id', missing)
            .timeout(const Duration(seconds: 15));
        final loaded = rows
            .map(
              (row) =>
                  _MallProduct.fromRow(Map<String, dynamic>.from(row as Map)),
            )
            .toList();
        if (mounted) {
          setState(() {
            _products = [
              ..._products.where((p) => !loaded.any((item) => item.id == p.id)),
              ...loaded,
            ];
            final available = loaded.map((p) => p.id).toSet();
            for (final id in missing.where((id) => !available.contains(id))) {
              _cart.remove(id);
            }
          });
        }
        unawaited(_persistCart());
      } catch (_) {
        if (mounted) {
          _message('Some cart items could not be refreshed. Please retry.');
        }
      }
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, update) {
          final products = <MapEntry<MapEntry<String, int>, _MallProduct>>[];
          for (final entry in _cart.entries) {
            for (final product in _products.where((p) => p.id == entry.key)) {
              products.add(MapEntry(entry, product));
              break;
            }
          }
          return SafeArea(
            child: SizedBox(
              height: MediaQuery.sizeOf(context).height * .72,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        const Icon(Icons.shopping_cart_outlined),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Your cart ($_cartCount)',
                            style: Theme.of(context)
                                .textTheme
                                .titleLarge
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                        ),
                        TextButton(
                          onPressed: () {
                            setState(() => _cart.clear());
                            unawaited(_persistCart());
                            update(() {});
                          },
                          child: const Text('Clear'),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: products.isEmpty
                        ? const Center(child: Text('Your cart is empty.'))
                        : ListView.separated(
                            padding: const EdgeInsets.all(12),
                            itemCount: products.length,
                            separatorBuilder: (_, __) => const Divider(),
                            itemBuilder: (context, index) {
                              final entry = products[index];
                              final product = entry.value;
                              final quantity = entry.key.value;
                              return Row(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(10),
                                    child: SizedBox(
                                      width: 64,
                                      height: 64,
                                      child: product.imageUrl == null
                                          ? const Icon(
                                              Icons.shopping_bag_outlined,
                                            )
                                          : Image.network(
                                              product.imageUrl!,
                                              fit: BoxFit.cover,
                                              errorBuilder: (_, __, ___) =>
                                                  const Icon(
                                                Icons
                                                    .image_not_supported_outlined,
                                              ),
                                            ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          product.name,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w800,
                                          ),
                                        ),
                                        Text(product.price),
                                        Row(
                                          children: [
                                            IconButton(
                                              onPressed: () {
                                                _changeCart(product, -1);
                                                update(() {});
                                              },
                                              icon: const Icon(
                                                Icons.remove_circle_outline,
                                              ),
                                              visualDensity:
                                                  VisualDensity.compact,
                                            ),
                                            Text('$quantity'),
                                            IconButton(
                                              onPressed: () {
                                                _changeCart(product, 1);
                                                update(() {});
                                              },
                                              icon: const Icon(
                                                Icons.add_circle_outline,
                                              ),
                                              visualDensity:
                                                  VisualDensity.compact,
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                  FilledButton(
                                    onPressed: () {
                                      Navigator.pop(sheetContext);
                                      _buy(product, initialQuantity: quantity);
                                    },
                                    child: const Text('Checkout'),
                                  ),
                                ],
                              );
                            },
                          ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(
                      'Each checkout is validated and settled atomically by the server for that product. Multi-product checkout is not represented as a single transaction.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
