import 'dart:math';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class WalletSavingsSummary {
  const WalletSavingsSummary({
    required this.walletBalance,
    required this.savingsBalance,
    required this.savingsLimit,
    required this.currency,
    required this.status,
  });

  final double walletBalance;
  final double savingsBalance;
  final double savingsLimit;
  final String currency;
  final String status;

  double get remainingCapacity => max(0.0, savingsLimit - savingsBalance);

  factory WalletSavingsSummary.fromJson(Map<String, dynamic> json) {
    return WalletSavingsSummary(
      walletBalance: _amount(json['balance_kes']),
      savingsBalance: _amount(json['savings_kes']),
      savingsLimit: _amount(json['savings_limit_kes'], fallback: 20000),
      currency: 'KES',
      status: (json['status'] ?? 'unknown').toString(),
    );
  }

  static double _amount(Object? value, {double fallback = 0}) {
    if (value is num && value.isFinite) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? fallback;
    return fallback;
  }
}

class WalletSavingsPage extends StatefulWidget {
  const WalletSavingsPage({super.key});

  @override
  State<WalletSavingsPage> createState() => _WalletSavingsPageState();
}

class _WalletSavingsPageState extends State<WalletSavingsPage> {
  final _client = Supabase.instance.client;
  final _amountController = TextEditingController();
  final _goalNameController = TextEditingController();
  final _goalTargetController = TextEditingController();
  WalletSavingsSummary? _summary;
  List<Map<String, dynamic>> _goals = const [];
  bool _loading = true;
  bool _busy = false;
  bool _showGoalForm = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _goalNameController.dispose();
    _goalTargetController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    if (_client.auth.currentUser == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to manage savings.';
        _summary = null;
        _goals = const [];
      });
      return;
    }
    try {
      final rawSummary = await _client.rpc('get_user_wallet_summary');
      if (rawSummary is! Map) {
        throw const FormatException('Unexpected savings summary response');
      }
      final summary = WalletSavingsSummary.fromJson(
        Map<String, dynamic>.from(rawSummary),
      );
      final userId = _client.auth.currentUser!.id;
      final goalsResponse = await _client
          .from('wallet_savings_goals')
          .select(
            'id,name,emoji,color,target_amount,current_amount,deadline,is_completed,created_at',
          )
          .eq('user_id', userId)
          .order('created_at', ascending: false)
          .limit(50);
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _goals = (goalsResponse as List<dynamic>)
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList(growable: false);
        _loading = false;
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
    if (message.contains('permission') ||
        message.contains('row-level security')) {
      return 'Your account is not permitted to access savings.';
    }
    if (message.contains('get_user_wallet_summary') ||
        message.contains('function')) {
      return 'Savings services are not available on this backend yet. Please try again later.';
    }
    return 'Savings could not be loaded. Check your connection and retry.';
  }

  String _idempotencyKey() {
    final random = Random.secure().nextInt(1 << 32);
    return 'savings-flutter-${DateTime.now().microsecondsSinceEpoch}-$random';
  }

  Future<void> _moveFunds({required bool deposit}) async {
    final summary = _summary;
    final amount = double.tryParse(_amountController.text.trim());
    if (summary == null || amount == null || !amount.isFinite || amount <= 0) {
      _message('Enter a valid amount greater than zero.');
      return;
    }
    if (deposit && amount > summary.walletBalance) {
      _message('There is not enough money in your wallet for this deposit.');
      return;
    }
    if (deposit && amount > summary.remainingCapacity) {
      _message(
        'This deposit exceeds your remaining KES 20,000 savings capacity.',
      );
      return;
    }
    if (!deposit && amount > summary.savingsBalance) {
      _message('The savings balance is too low for this withdrawal.');
      return;
    }
    final action = deposit ? 'move into savings' : 'return to your wallet';
    final approved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          deposit ? 'Confirm savings deposit' : 'Confirm savings withdrawal',
        ),
        content: Text('Move KES ${amount.toStringAsFixed(2)} $action?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (approved != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await _client.rpc(
        deposit ? 'save_to_wallet_savings' : 'withdraw_from_wallet_savings',
        params: {'p_amount': amount, 'p_idempotency_key': _idempotencyKey()},
      );
      if (!mounted) return;
      _amountController.clear();
      _message(
        deposit
            ? 'Funds moved to savings successfully.'
            : 'Funds returned to your wallet successfully.',
      );
      await _load();
    } catch (error) {
      if (mounted) {
        _message(_financialError(error));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _financialError(Object error) {
    final message = error.toString().toLowerCase();
    if (message.contains('insufficient'))
      return 'Insufficient balance for this operation.';
    if (message.contains('limit'))
      return 'The savings limit would be exceeded.';
    if (message.contains('authentication'))
      return 'Your session expired. Sign in again.';
    return 'The savings operation was not confirmed. Refresh balances before retrying.';
  }

  Future<void> _createGoal() async {
    final name = _goalNameController.text.trim();
    final target = double.tryParse(_goalTargetController.text.trim());
    if (name.isEmpty ||
        name.length > 60 ||
        target == null ||
        !target.isFinite ||
        target <= 0) {
      _message('Enter a goal name and a valid target amount.');
      return;
    }
    final user = _client.auth.currentUser;
    if (user == null) {
      _message('Sign in to create a savings goal.');
      return;
    }
    setState(() => _busy = true);
    try {
      final wallet = await _client
          .from('wallets')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
      if (wallet == null || wallet['id'] == null) {
        throw StateError('Wallet not provisioned');
      }
      await _client.from('wallet_savings_goals').insert({
        'wallet_id': wallet['id'],
        'user_id': user.id,
        'name': name,
        'target_amount': target,
        'current_amount': 0,
        'emoji': '🎯',
        'color': 'blue',
      });
      if (!mounted) return;
      _goalNameController.clear();
      _goalTargetController.clear();
      setState(() => _showGoalForm = false);
      _message('Savings goal created.');
      await _load();
    } catch (error) {
      if (mounted) _message(_friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteGoal(Map<String, dynamic> goal) async {
    final approved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete savings goal?'),
        content: Text(
          'Remove “${goal['name']}”? This does not move any money.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete goal'),
          ),
        ],
      ),
    );
    if (approved != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await _client
          .from('wallet_savings_goals')
          .delete()
          .eq('id', goal['id'].toString())
          .eq('user_id', _client.auth.currentUser!.id);
      if (!mounted) return;
      _message('Savings goal deleted.');
      await _load();
    } catch (error) {
      if (mounted) _message(_friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _message(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  String _money(double amount) =>
      'KES ${amount.toStringAsFixed(2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',')}';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final summary = _summary;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Savings',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Refresh savings',
                onPressed: _loading || _busy ? null : _load,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_error != null) _errorCard(theme),
          if (_loading && summary == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 56),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (summary != null) ...[
            _balanceCard(theme, summary),
            const SizedBox(height: 12),
            _limitsCard(theme, summary),
            const SizedBox(height: 16),
            Text(
              'Move money',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _amountController,
              enabled: !_busy,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Amount (KES)',
                hintText: '0.00',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy ? null : () => _moveFunds(deposit: true),
                    icon: const Icon(Icons.savings_outlined),
                    label: const Text('Save funds'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _moveFunds(deposit: false),
                    icon: const Icon(Icons.account_balance_wallet_outlined),
                    label: const Text('Withdraw'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Savings goals',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _busy
                      ? null
                      : () => setState(() => _showGoalForm = !_showGoalForm),
                  icon: Icon(_showGoalForm ? Icons.close : Icons.add),
                  label: Text(_showGoalForm ? 'Cancel' : 'New goal'),
                ),
              ],
            ),
            if (_showGoalForm) _goalForm(theme),
            if (_goals.isEmpty)
              _emptyGoals(theme)
            else
              ..._goals.map((goal) => _goalCard(theme, goal)),
            const SizedBox(height: 16),
            Text(
              'Savings transfers use server-side ledger RPCs. Goal tracking is separate; this screen does not claim a goal contribution unless the backend records one.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
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
          Text(_error!),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: _loading || _busy ? null : _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _balanceCard(ThemeData theme, WalletSavingsSummary summary) => Card(
    clipBehavior: Clip.antiAlias,
    child: Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.colorScheme.primary,
            theme.colorScheme.primary.withValues(alpha: 0.72),
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.savings_outlined, color: Colors.white),
              SizedBox(width: 8),
              Text('Savings balance', style: TextStyle(color: Colors.white70)),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            _money(summary.savingsBalance),
            style: theme.textTheme.headlineMedium?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Wallet available: ${_money(summary.walletBalance)}',
            style: const TextStyle(color: Colors.white70),
          ),
        ],
      ),
    ),
  );

  Widget _limitsCard(ThemeData theme, WalletSavingsSummary summary) {
    final progress = summary.savingsLimit <= 0
        ? 0.0
        : (summary.savingsBalance / summary.savingsLimit)
              .clamp(0.0, 1.0)
              .toDouble();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(child: Text('Savings limit')),
                Text(
                  '${_money(summary.savingsBalance)} / ${_money(summary.savingsLimit)}',
                ),
              ],
            ),
            const SizedBox(height: 10),
            LinearProgressIndicator(value: progress),
            const SizedBox(height: 6),
            Text(
              '${_money(summary.remainingCapacity)} remaining',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _goalForm(ThemeData theme) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          TextField(
            controller: _goalNameController,
            maxLength: 60,
            enabled: !_busy,
            decoration: const InputDecoration(
              labelText: 'Goal name',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _goalTargetController,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Target amount (KES)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _busy ? null : _createGoal,
              child: const Text('Create goal'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _goalCard(ThemeData theme, Map<String, dynamic> goal) {
    final target = _readAmount(goal['target_amount']);
    final current = _readAmount(goal['current_amount']);
    final progress = target <= 0
        ? 0.0
        : (current / target).clamp(0.0, 1.0).toDouble();
    return Card(
      child: ListTile(
        leading: CircleAvatar(child: Text((goal['emoji'] ?? '🎯').toString())),
        title: Text((goal['name'] ?? 'Savings goal').toString()),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LinearProgressIndicator(value: progress),
              const SizedBox(height: 6),
              Text('${_money(current)} of ${_money(target)}'),
              if (goal['deadline'] != null)
                Text('Deadline: ${goal['deadline']}'),
            ],
          ),
        ),
        isThreeLine: true,
        trailing: IconButton(
          tooltip: 'Delete goal',
          onPressed: _busy ? null : () => _deleteGoal(goal),
          icon: const Icon(Icons.delete_outline),
        ),
      ),
    );
  }

  Widget _emptyGoals(ThemeData theme) => Card(
    child: Padding(
      padding: const EdgeInsets.all(22),
      child: Column(
        children: [
          const Icon(Icons.flag_outlined, size: 36),
          const SizedBox(height: 8),
          Text('No savings goals yet', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('Create a goal to track a financial milestone.'),
        ],
      ),
    ),
  );

  double _readAmount(Object? value) {
    if (value is num && value.isFinite) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }
}
