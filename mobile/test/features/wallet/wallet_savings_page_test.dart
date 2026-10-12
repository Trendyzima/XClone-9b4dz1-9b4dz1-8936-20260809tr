import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/wallet/wallet_savings_page.dart';

void main() {
  group('WalletSavingsSummary', () {
    test('parses canonical KES wallet and savings balances', () {
      final summary = WalletSavingsSummary.fromJson({
        'balance_kes': '1500.25',
        'savings_kes': 2500,
        'savings_limit_kes': 20000,
        'currency': 'KES',
        'status': 'ACTIVE',
      });

      expect(summary.walletBalance, 1500.25);
      expect(summary.savingsBalance, 2500);
      expect(summary.savingsLimit, 20000);
      expect(summary.currency, 'KES');
      expect(summary.status, 'ACTIVE');
      expect(summary.remainingCapacity, 17500);
    });

    test(
      'defaults malformed amounts safely and prevents negative capacity',
      () {
        final summary = WalletSavingsSummary.fromJson({
          'balance_kes': 'invalid',
          'savings_kes': 25000,
          'savings_limit_kes': null,
          'currency': 'USD',
        });

        expect(summary.walletBalance, 0);
        expect(summary.savingsBalance, 25000);
        expect(summary.savingsLimit, 20000);
        expect(summary.remainingCapacity, 0);
        expect(summary.currency, 'KES');
        expect(summary.status, 'unknown');
      },
    );
  });
}
