import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/wallet/wallet_read_model.dart';

void main() {
  group('WalletReadModel', () {
    test('parses numeric strings and preserves canonical currency', () {
      final wallet = WalletReadModel.fromJson({
        'balance': '1250.50',
        'total_deposited': 2500,
        'total_withdrawn': '1249.5',
        'currency': 'kes',
        'status': 'ACTIVE',
      });

      expect(wallet.balance, 1250.5);
      expect(wallet.totalDeposited, 2500);
      expect(wallet.totalWithdrawn, 1249.5);
      expect(wallet.currency, 'KES');
      expect(wallet.status, 'ACTIVE');
    });

    test('defaults invalid amounts and currency safely', () {
      final wallet = WalletReadModel.fromJson({
        'balance': 'not-a-number',
        'total_deposited': null,
        'total_withdrawn': double.infinity,
        'currency': 'K.E.S',
      });

      expect(wallet.balance, 0);
      expect(wallet.totalDeposited, 0);
      expect(wallet.totalWithdrawn, 0);
      expect(wallet.currency, 'KES');
    });
  });

  group('WalletTransactionReadModel', () {
    test('recognizes incoming types and parses timestamps', () {
      final incoming = WalletTransactionReadModel.fromJson({
        'id': 'txn-1',
        'amount': '500.00',
        'type': 'transfer',
        'direction': 'in',
        'status': 'POSTED',
        'reference': 'ref-1',
        'created_at': '2026-10-12T10:00:00Z',
      });
      final outgoing = WalletTransactionReadModel.fromJson({
        'id': 'txn-2',
        'amount': 50,
        'type': 'transfer',
        'direction': 'out',
        'status': 'pending',
      });

      expect(incoming.isIncoming, isTrue);
      expect(incoming.amount, 500);
      expect(incoming.createdAt, isNotNull);
      expect(outgoing.isIncoming, isFalse);
      expect(outgoing.createdAt, isNull);
    });
  });

  test('formats grouped amounts and rejects malformed currency codes', () {
    expect(formatWalletAmount(12345.6, 'KES'), 'KES 12,345.60');
    expect(formatWalletAmount(-1, 'bad-code'), 'KES 1.00');
  });
}
