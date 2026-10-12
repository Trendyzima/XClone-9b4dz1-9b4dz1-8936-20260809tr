/// Pure parsing and display helpers for the read-only wallet surfaces.
/// Monetary actions must remain on the server-side wallet RPC/Edge Function path.
class WalletReadModel {
  const WalletReadModel({
    required this.balance,
    required this.totalDeposited,
    required this.totalWithdrawn,
    required this.currency,
    required this.status,
  });

  final double balance;
  final double totalDeposited;
  final double totalWithdrawn;
  final String currency;
  final String status;

  factory WalletReadModel.fromJson(Map<String, dynamic> json) {
    return WalletReadModel(
      balance: _asAmount(json['balance']),
      totalDeposited: _asAmount(json['total_deposited']),
      totalWithdrawn: _asAmount(json['total_withdrawn']),
      currency: _safeCurrency(json['currency'] ?? json['preferred_currency']),
      status: (json['status'] ?? 'unknown').toString(),
    );
  }

  static double _asAmount(Object? value) {
    if (value is num && value.isFinite) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }

  static String _safeCurrency(Object? value) {
    final currency = value?.toString().trim().toUpperCase() ?? '';
    return RegExp(r'^[A-Z]{3}$').hasMatch(currency) ? currency : 'KES';
  }
}

class WalletTransactionReadModel {
  const WalletTransactionReadModel({
    required this.id,
    required this.amount,
    required this.type,
    required this.status,
    required this.reference,
    required this.createdAt,
  });

  final String id;
  final double amount;
  final String type;
  final String status;
  final String? reference;
  final DateTime? createdAt;

  factory WalletTransactionReadModel.fromJson(Map<String, dynamic> json) {
    final rawDate = json['created_at']?.toString();
    return WalletTransactionReadModel(
      id: (json['id'] ?? '').toString(),
      amount: WalletReadModel._asAmount(json['amount']),
      type: (json['type'] ?? 'transaction').toString().toLowerCase(),
      status: (json['status'] ?? 'unknown').toString().toLowerCase(),
      reference: json['reference']?.toString(),
      createdAt: rawDate == null ? null : DateTime.tryParse(rawDate),
    );
  }

  bool get isIncoming =>
      type == 'deposit' || type == 'earnings' || type == 'credit';
}

String formatWalletAmount(double amount, String currency) {
  final safeCurrency = WalletReadModel._safeCurrency(currency);
  final fixed = amount.abs().toStringAsFixed(2);
  final parts = fixed.split('.');
  final whole = parts.first;
  final grouped = whole.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
  return '$safeCurrency $grouped.${parts.last}';
}
