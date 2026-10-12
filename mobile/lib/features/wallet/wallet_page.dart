import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'wallet_read_model.dart';

/// Read-only wallet overview/history. Monetary mutations must use audited
/// server-side wallet RPCs or payment Edge Functions.
class WalletPage extends StatefulWidget {
  const WalletPage({this.showHistory = false, super.key});
  final bool showHistory;

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  final SupabaseClient _client = Supabase.instance.client;
  WalletReadModel? _wallet;
  List<WalletTransactionReadModel> _transactions = const [];
  bool _loading = true;
  String? _error;
  String _filter = 'all';

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
        _error = 'Sign in to view your wallet.';
        _wallet = null;
        _transactions = const [];
      });
      return;
    }
    try {
      final walletResponse = await _client.rpc('get_my_wallet').maybeSingle();
      if (walletResponse == null) {
        throw StateError('Payment wallet is not provisioned for this account.');
      }
      final walletJson = Map<String, dynamic>.from(walletResponse);
      final response = await _client
          .from('wallet_transactions')
          .select('id,amount,type,status,reference,created_at,direction')
          .eq('user_id', user.id)
          .order('created_at', ascending: false)
          .limit(100);
      final transactions = (response as List<dynamic>)
          .map((row) => WalletTransactionReadModel.fromJson(
                Map<String, dynamic>.from(row as Map),
              ))
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _wallet = WalletReadModel.fromJson(walletJson);
        _transactions = transactions;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _friendlyError(error);
      });
    }
  }

  String _friendlyError(Object error) {
    final message = error.toString().toLowerCase();
    if (message.contains('provisioned')) {
      return 'Your wallet is not available yet. Refresh or contact support if this continues.';
    }
    if (message.contains('permission') ||
        message.contains('row-level security')) {
      return 'Your account is not permitted to read this wallet data.';
    }
    return 'We could not load wallet data. Check your connection and try again.';
  }

  List<WalletTransactionReadModel> get _visibleTransactions {
    if (_filter == 'incoming') {
      return _transactions.where((t) => t.isIncoming).toList();
    }
    if (_filter == 'outgoing') {
      return _transactions.where((t) => !t.isIncoming).toList();
    }
    return _transactions;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: PageStorageKey<String>(
            widget.showHistory ? 'wallet-history' : 'wallet-overview'),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.showHistory ? 'Wallet history' : 'My wallet',
                  style: theme.textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                tooltip: 'Refresh wallet',
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_error != null) _errorCard(theme),
          if (_loading && _wallet == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 64),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_wallet != null) ...[
            if (!widget.showHistory) ...[
              _balanceCard(theme, _wallet!),
              const SizedBox(height: 12),
              _statsGrid(theme, _wallet!),
              const SizedBox(height: 18),
              Text('Wallet actions',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              _actionGrid(context),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                      child: Text('Recent activity',
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700))),
                  TextButton(
                      onPressed: () => context.go('/wallet/history'),
                      child: const Text('View all')),
                ],
              ),
            ] else ...[
              _historySummary(theme),
              const SizedBox(height: 16),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'all', label: Text('All')),
                  ButtonSegment(value: 'incoming', label: Text('Incoming')),
                  ButtonSegment(value: 'outgoing', label: Text('Outgoing')),
                ],
                selected: {_filter},
                onSelectionChanged: (selection) =>
                    setState(() => _filter = selection.first),
              ),
              const SizedBox(height: 12),
            ],
            if (_visibleTransactions.isEmpty)
              _emptyActivity(theme)
            else
              ..._visibleTransactions
                  .take(widget.showHistory ? 100 : 8)
                  .map((item) => _transactionTile(theme, item)),
            const SizedBox(height: 18),
            Text(
              'Balances and transaction records are loaded from authenticated wallet services. This screen never edits balances directly.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }

  Widget _errorCard(ThemeData theme) => Card(
        color: theme.colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.error_outline),
              const SizedBox(height: 8),
              Text(_error!, style: theme.textTheme.bodyMedium),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Try again'),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _balanceCard(ThemeData theme, WalletReadModel wallet) => Card(
        clipBehavior: Clip.antiAlias,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                theme.colorScheme.primary,
                theme.colorScheme.primary.withValues(alpha: 0.72)
              ],
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.account_balance_wallet_outlined,
                      color: Colors.white),
                  const SizedBox(width: 8),
                  const Expanded(
                      child: Text('Available balance',
                          style: TextStyle(color: Colors.white70))),
                  Text(wallet.status,
                      style: const TextStyle(color: Colors.white)),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                formatWalletAmount(wallet.balance, wallet.currency),
                style: theme.textTheme.headlineMedium?.copyWith(
                    color: Colors.white, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 6),
              const Text('Canonical wallet balance',
                  style: TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          ),
        ),
      );

  Widget _statsGrid(ThemeData theme, WalletReadModel wallet) => GridView.count(
        crossAxisCount: MediaQuery.sizeOf(context).width > 600 ? 2 : 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 1.65,
        children: [
          _statCard(theme, 'Total deposited', wallet.totalDeposited,
              Icons.south_west, Colors.green),
          _statCard(theme, 'Total withdrawn', wallet.totalWithdrawn,
              Icons.north_east, Colors.orange),
        ],
      );

  Widget _statCard(ThemeData theme, String label, double amount, IconData icon,
          Color color) =>
      Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color),
              const SizedBox(height: 8),
              Text(label, style: theme.textTheme.bodySmall),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  formatWalletAmount(amount, _wallet?.currency ?? 'KES'),
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _actionGrid(BuildContext context) => GridView.count(
        crossAxisCount: MediaQuery.sizeOf(context).width > 600 ? 4 : 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 1.75,
        children: [
          _action(context, 'Send money', Icons.send_outlined, '/wallet/send'),
          _action(context, 'M-Pesa', Icons.phone_android, '/wallet/mpesa'),
          _action(
              context, 'Savings', Icons.savings_outlined, '/wallet/savings'),
          _action(
              context, 'Security', Icons.shield_outlined, '/wallet/security'),
        ],
      );

  Widget _action(
          BuildContext context, String label, IconData icon, String path) =>
      Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => context.go(path),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Icon(icon),
                const SizedBox(width: 10),
                Expanded(
                    child: Text(label,
                        style: const TextStyle(fontWeight: FontWeight.w700))),
                const Icon(Icons.chevron_right, size: 18),
              ],
            ),
          ),
        ),
      );

  Widget _historySummary(ThemeData theme) {
    final incoming = _transactions
        .where((t) => t.isIncoming)
        .fold<double>(0, (sum, t) => sum + t.amount);
    final outgoing = _transactions
        .where((t) => !t.isIncoming)
        .fold<double>(0, (sum, t) => sum + t.amount);
    return Row(
      children: [
        Expanded(
            child: _summaryChip(theme, 'Incoming', incoming, Colors.green)),
        const SizedBox(width: 10),
        Expanded(
            child: _summaryChip(theme, 'Outgoing', outgoing, Colors.orange)),
      ],
    );
  }

  Widget _summaryChip(
          ThemeData theme, String label, double amount, Color color) =>
      Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: theme.textTheme.bodySmall),
              const SizedBox(height: 5),
              Text(
                formatWalletAmount(amount, _wallet?.currency ?? 'KES'),
                style: theme.textTheme.titleSmall
                    ?.copyWith(color: color, fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
      );

  Widget _transactionTile(ThemeData theme, WalletTransactionReadModel item) {
    final incoming = item.isIncoming;
    final date = item.createdAt?.toLocal();
    final dateLabel = date == null
        ? 'Date unavailable'
        : '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year} · ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    final typeLabel = item.type.replaceAll('_', ' ');
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor:
              (incoming ? Colors.green : Colors.orange).withValues(alpha: 0.12),
          child: Icon(incoming ? Icons.south_west : Icons.north_east,
              color: incoming ? Colors.green : Colors.orange),
        ),
        title: Text(typeLabel[0].toUpperCase() + typeLabel.substring(1),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text([
          dateLabel,
          if (item.reference != null && item.reference!.isNotEmpty)
            'Ref: ${item.reference}',
          'Status: ${item.status}',
        ].join('\n')),
        isThreeLine: true,
        trailing: Text(
          '${incoming ? '+' : '-'}${formatWalletAmount(item.amount, _wallet?.currency ?? 'KES')}',
          style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w800,
              color: incoming ? Colors.green : null),
          textAlign: TextAlign.end,
        ),
      ),
    );
  }

  Widget _emptyActivity(ThemeData theme) => Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Icon(Icons.receipt_long_outlined, size: 40),
              const SizedBox(height: 10),
              Text('No transactions yet',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text('When wallet activity is recorded, it will appear here.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      );
}
