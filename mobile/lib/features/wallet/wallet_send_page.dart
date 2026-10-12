import 'dart:math';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'wallet_read_model.dart';

class WalletSendPage extends StatefulWidget {
  const WalletSendPage({super.key});

  @override
  State<WalletSendPage> createState() => _WalletSendPageState();
}

class _WalletSendPageState extends State<WalletSendPage> {
  final _client = Supabase.instance.client;
  final _searchController = TextEditingController();
  final _amountController = TextEditingController();
  final _noteController = TextEditingController();
  final _pinController = TextEditingController();
  List<Map<String, dynamic>> _users = const [];
  Map<String, dynamic>? _recipient;
  WalletReadModel? _wallet;
  bool _loading = true;
  bool _searching = false;
  bool _sending = false;
  bool _needsPin = false;
  String? _error;
  String? _receipt;
  String? _pendingIdempotencyKey;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _amountController.dispose();
    _noteController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _loadWallet() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await _client.rpc('get_my_wallet').maybeSingle();
      if (response == null) throw StateError('Wallet is not provisioned.');
      final wallet =
          WalletReadModel.fromJson(Map<String, dynamic>.from(response));
      final securityResponse = await _client.rpc('get_my_wallet_security');
      final security = Map<String, dynamic>.from(securityResponse as Map);
      if (security['pin_set'] != true) {
        if (!mounted) return;
        setState(() {
          _wallet = wallet;
          _loading = false;
          _needsPin = true;
          _error = 'Set a wallet PIN before sending money.';
        });
        return;
      }
      if (!mounted) return;
      setState(() {
        _wallet = wallet;
        _loading = false;
        _needsPin = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Wallet could not be loaded. Refresh and try again.';
      });
    }
  }

  Future<void> _searchUsers(String query) async {
    setState(() {
      _error = null;
      _recipient = null;
    });
    if (query.trim().length < 2) {
      setState(() => _users = const []);
      return;
    }
    setState(() => _searching = true);
    try {
      final result = await _client
          .from('profiles')
          .select('id,username,avatar_url,verified')
          .ilike('username',
              '%\${query.trim().replaceAll('%', '').replaceAll('_', '')}%')
          .neq('id', _client.auth.currentUser!.id)
          .limit(8);
      if (!mounted) return;
      setState(() {
        _users = (result as List<dynamic>)
            .map((row) => Map<String, dynamic>.from(row as Map))
            .toList(growable: false);
        _searching = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _searching = false;
        _error = 'Could not search users. Check your connection and retry.';
      });
    }
  }

  double? get _amount {
    final value = double.tryParse(_amountController.text.trim());
    if (value == null || !value.isFinite || value <= 0) return null;
    if (value * 100 != (value * 100).roundToDouble()) return null;
    return value;
  }

  String _idempotencyKey() {
    final random = Random.secure();
    final suffix = List<int>.generate(4, (_) => random.nextInt(1 << 32))
        .map((value) => value.toRadixString(16).padLeft(8, '0'))
        .join();
    return 'flutter-p2p-\${DateTime.now().microsecondsSinceEpoch}-$suffix';
  }

  Future<void> _confirmAndSend() async {
    final recipient = _recipient;
    final amount = _amount;
    final pin = _pinController.text;
    if (recipient == null) {
      setState(() => _error = 'Choose the recipient account first.');
      return;
    }
    if (amount == null) {
      setState(() => _error =
          'Enter a valid positive amount with no more than 2 decimal places.');
      return;
    }
    if (_wallet == null || amount > _wallet!.balance) {
      setState(() =>
          _error = 'The amount exceeds your currently available balance.');
      return;
    }
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin)) {
      setState(() => _error = 'Enter your 4–6 digit wallet PIN.');
      return;
    }

    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirm transfer'),
        content: Text(
          'Send \${formatWalletAmount(amount, _wallet!.currency)} to @\${recipient['username'] ?? 'user'}? This will move funds from your wallet.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Confirm send')),
        ],
      ),
    );
    if (accepted != true || !mounted) return;

    setState(() {
      _sending = true;
      _error = null;
      _receipt = null;
    });
    try {
      final raw = await _client.rpc('p2p_wallet_transfer_verified', params: {
        'p_to_user_id': recipient['id'],
        'p_amount': amount,
        'p_note': _noteController.text.trim().isEmpty
            ? null
            : _noteController.text.trim(),
        'p_pin': pin,
        'p_idempotency_key': _pendingIdempotencyKey ??= _idempotencyKey(),
      });
      final result = Map<String, dynamic>.from(raw as Map);
      if (result['success'] != true) {
        final code = (result['code'] ?? 'TRANSFER_REJECTED').toString();
        if (code == 'PIN_NOT_SET') {
          throw StateError('Set your wallet PIN before sending money.');
        }
        if (code == 'INVALID_PIN' || code == 'PIN_LOCKED') {
          throw StateError(code == 'PIN_LOCKED'
              ? 'Your wallet PIN is temporarily locked after repeated failures.'
              : 'Wallet PIN is incorrect. Check it and try again.');
        }
        if (code == 'INSUFFICIENT_FUNDS') {
          throw StateError(
              'Your available balance is insufficient for this transfer.');
        }
        throw StateError('Transfer was rejected ($code). No success was recorded.');
      }
      final reference = (result['reference'] ?? '').toString();
      if (!mounted) return;
      setState(() {
        _sending = false;
        _receipt = 'Transfer confirmed by server. Reference: $reference';
        _pendingIdempotencyKey = null;
        _pinController.clear();
        _amountController.clear();
        _noteController.clear();
        _searchController.clear();
        _users = const [];
        _recipient = null;
      });
      await _loadWallet();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = error.toString().replaceFirst('Bad state: ', '');
        _pinController.clear();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            IconButton(
                onPressed: () => context.go('/wallet'),
                icon: const Icon(Icons.arrow_back),
                tooltip: 'Back to wallet'),
            Expanded(
                child: Text('Send money',
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w800))),
            IconButton(
                onPressed: _loading || _sending ? null : _loadWallet,
                icon: const Icon(Icons.refresh),
                tooltip: 'Refresh wallet'),
          ],
        ),
        const SizedBox(height: 8),
        if (_loading)
          const Center(
              child: Padding(
                  padding: EdgeInsets.all(32),
                  child: CircularProgressIndicator()))
        else ...[
          if (_wallet != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.account_balance_wallet_outlined),
                title: const Text('Available balance'),
                subtitle: Text(
                    formatWalletAmount(_wallet!.balance, _wallet!.currency)),
                trailing: const Icon(Icons.lock_outline),
              ),
            ),
          if (_error != null)
            _message(_error!, theme.colorScheme.errorContainer,
                theme.colorScheme.onErrorContainer),
          if (_needsPin)
            FilledButton.icon(
              onPressed: () => context.go('/wallet/security'),
              icon: const Icon(Icons.shield_outlined),
              label: const Text('Set wallet PIN'),
            ),
          if (_receipt != null)
            _message(_receipt!, theme.colorScheme.primaryContainer,
                theme.colorScheme.onPrimaryContainer),
          const SizedBox(height: 8),
          Text('Recipient',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          TextField(
            controller: _searchController,
            enabled: !_sending,
            textInputAction: TextInputAction.search,
            onChanged: (value) {
              _pendingIdempotencyKey = null;
              _searchUsers(value);
            },
            decoration: InputDecoration(
              labelText: 'Search by username',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searching
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2)))
                  : null,
              border: const OutlineInputBorder(),
            ),
          ),
          if (_recipient != null)
            Card(
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                title:
                    Text('@\${_recipient!['username'] ?? 'user'}'),
                subtitle: const Text('Selected recipient'),
                trailing: IconButton(
                    onPressed: _sending
                        ? null
                        : () => setState(() => _recipient = null),
                    icon: const Icon(Icons.close)),
              ),
            )
          else
            ..._users.map((user) => Card(
                  child: ListTile(
                    leading:
                        const CircleAvatar(child: Icon(Icons.person_outline)),
                    title: Text('@\${user['username'] ?? 'user'}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _sending
                        ? null
                        : () => setState(() {
                              _recipient = user;
                              _searchController.text =
                                  '@\${user['username'] ?? ''}';
                              _users = const [];
                            }),
                  ),
                )),
          const SizedBox(height: 12),
          TextField(
            controller: _amountController,
            enabled: !_sending,
            onChanged: (_) => _pendingIdempotencyKey = null,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
                labelText: 'Amount (\${_wallet?.currency ?? 'KES'})',
                border: const OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _noteController,
            enabled: !_sending,
            onChanged: (_) => _pendingIdempotencyKey = null,
            maxLength: 240,
            decoration: const InputDecoration(
                labelText: 'Note (optional)', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _pinController,
            enabled: !_sending,
            keyboardType: TextInputType.number,
            obscureText: true,
            maxLength: 6,
            decoration: const InputDecoration(
                labelText: 'Wallet PIN',
                helperText: 'Verified by the server before funds move.',
                border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _sending || _wallet == null ? null : _confirmAndSend,
            icon: _sending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.send),
            label: Text(_sending ? 'Processing securely…' : 'Review and send'),
          ),
          const SizedBox(height: 10),
          const Text(
            'Transfers are submitted through a server-side PIN gate and canonical wallet transaction function. If the response is uncertain, check wallet history before trying again.',
            style: TextStyle(fontSize: 12),
          ),
        ],
      ],
    );
  }

  Widget _message(String message, Color background, Color foreground) => Card(
        color: background,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Text(message, style: TextStyle(color: foreground)),
        ),
      );
}
