class MallCategory {
  const MallCategory(this.id, this.label, this.emoji, this.keywords);
  final String id;
  final String label;
  final String emoji;
  final List<String> keywords;
}

class MallPolicy {
  static const categories = <MallCategory>[
    MallCategory('all', 'All', '🛍️', []),
    MallCategory('electronics', 'Phones & Electronics', '📱', [
      'phone',
      'mobile',
      'electronics',
      'laptop',
      'tablet',
      'charger',
      'headphone',
      'earbud',
      'computer',
      'smartwatch',
      'tv',
    ]),
    MallCategory('fashion', 'Fashion', '👗', [
      'fashion',
      'clothes',
      'dress',
      'shirt',
      'shoe',
      'sneaker',
      'bag',
      'watch',
      'jewellery',
      'jewelry',
    ]),
    MallCategory('home', 'Home & Kitchen', '🏠', [
      'home',
      'kitchen',
      'furniture',
      'cookware',
      'storage',
      'bedding',
      'decor',
      'appliance',
    ]),
    MallCategory('beauty', 'Beauty', '💄', [
      'beauty',
      'skin',
      'makeup',
      'hair',
      'cosmetic',
      'perfume',
      'personal care',
    ]),
    MallCategory('handmade', 'Handmade', '🧶', [
      'handmade',
      'craft',
      'artisan',
      'knit',
      'woven',
    ]),
    MallCategory('art', 'Art & Decor', '🎨', [
      'art',
      'painting',
      'print',
      'decor',
    ]),
    MallCategory('books', 'Books', '📚', [
      'book',
      'novel',
      'textbook',
      'journal',
    ]),
    MallCategory('food', 'Food & Grocery', '🥑', [
      'food',
      'grocery',
      'snack',
      'coffee',
      'tea',
      'spice',
    ]),
    MallCategory('other', 'More', '✨', []),
  ];

  static MallCategory category(String id) => categories.firstWhere(
    (item) => item.id == id,
    orElse: () => categories.first,
  );

  static bool matchesCategory({
    required String selectedId,
    required String categoryValue,
    required String name,
    required String description,
  }) {
    if (selectedId == 'all') return true;
    final selected = MallPolicy.category(selectedId);
    if (selected.id == 'all') return true;
    final haystack = '$categoryValue $name $description'.toLowerCase();
    if (selectedId == 'other') {
      return !categories
          .where((item) => !{'all', 'other'}.contains(item.id))
          .any((item) => item.keywords.any(haystack.contains));
    }
    return selected.keywords.any(haystack.contains) ||
        categoryValue.toLowerCase() == selectedId;
  }

  static String? safeImageUrl(Object? value) {
    final uri = Uri.tryParse(value is String ? value.trim() : '');
    if (uri == null ||
        uri.scheme.toLowerCase() != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty) {
      return null;
    }
    final host = uri.host.toLowerCase();
    if (host == 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host == '::1' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        RegExp(r'^172\.(1[6-9]|2[0-9]|3[01])\.').hasMatch(host)) {
      return null;
    }
    return uri.toString();
  }
}
