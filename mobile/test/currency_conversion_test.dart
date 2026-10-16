import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/wallet/currency_converter_page.dart';

void main() {
  group('CurrencyConversion', () {
    test('converts using rates expressed against the same base currency', () {
      final converted = CurrencyConversion.convert(
        amount: 100,
        fromRate: 150,
        toRate: 1,
      );
      expect(converted, closeTo(100 / 150, 0.000001));
    });

    test('supports conversion between two non-base currencies', () {
      final converted = CurrencyConversion.convert(
        amount: 10,
        fromRate: 2,
        toRate: 3,
      );
      expect(converted, 15);
    });

    test('returns zero for a zero amount', () {
      expect(
        CurrencyConversion.convert(amount: 0, fromRate: 150, toRate: 1),
        0,
      );
    });

    test('rejects invalid amounts and unavailable or invalid rates', () {
      expect(
        CurrencyConversion.convert(amount: double.nan, fromRate: 1, toRate: 2),
        isNull,
      );
      expect(
        CurrencyConversion.convert(amount: 1, fromRate: 0, toRate: 2),
        isNull,
      );
      expect(
        CurrencyConversion.convert(amount: 1, fromRate: 1, toRate: null),
        isNull,
      );
    });
  });
}
