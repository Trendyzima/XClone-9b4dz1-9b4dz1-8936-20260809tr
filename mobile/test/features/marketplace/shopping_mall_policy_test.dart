import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/marketplace/shopping_mall_policy.dart';

void main() {
  group('MallPolicy category filtering', () {
    test('all category includes any product', () {
      expect(
        MallPolicy.matchesCategory(
          selectedId: 'all',
          categoryValue: 'other',
          name: 'Handmade basket',
          description: 'Woven locally',
        ),
        isTrue,
      );
    });

    test('category keywords find products even for older listings', () {
      expect(
        MallPolicy.matchesCategory(
          selectedId: 'electronics',
          categoryValue: 'other',
          name: 'Android smartphone with charger',
          description: 'Local seller',
        ),
        isTrue,
      );
      expect(
        MallPolicy.matchesCategory(
          selectedId: 'fashion',
          categoryValue: 'other',
          name: 'Leather sneakers',
          description: 'Everyday wear',
        ),
        isTrue,
      );
    });

    test('unrelated products do not leak into a selected category', () {
      expect(
        MallPolicy.matchesCategory(
          selectedId: 'books',
          categoryValue: 'other',
          name: 'Kitchen storage rack',
          description: 'Steel and durable',
        ),
        isFalse,
      );
    });

    test('unknown category safely falls back to all', () {
      expect(MallPolicy.category('invalid').id, 'all');
      expect(
        MallPolicy.matchesCategory(
          selectedId: 'invalid',
          categoryValue: 'other',
          name: 'Any product',
          description: '',
        ),
        isTrue,
      );
    });
  });

  group('MallPolicy image URL validation', () {
    test('accepts secure public image URLs', () {
      expect(
        MallPolicy.safeImageUrl('https://cdn.example.com/p/1.jpg'),
        'https://cdn.example.com/p/1.jpg',
      );
    });

    test('rejects unsafe or non-HTTPS URLs', () {
      expect(MallPolicy.safeImageUrl('http://cdn.example.com/p.jpg'), isNull);
      expect(MallPolicy.safeImageUrl('javascript:alert(1)'), isNull);
      expect(MallPolicy.safeImageUrl('https://user:pass@cdn.example.com/p.jpg'), isNull);
      expect(MallPolicy.safeImageUrl('https://127.0.0.1/private.jpg'), isNull);
      expect(MallPolicy.safeImageUrl('/relative/path.jpg'), isNull);
    });
  });
}
