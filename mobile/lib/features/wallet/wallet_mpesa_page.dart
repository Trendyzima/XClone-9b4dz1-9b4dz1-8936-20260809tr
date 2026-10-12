import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'wallet_read_model.dart';

class WalletMpesaPage extends StatefulWidget {
  const WalletMpesaPage({super.key});

  @override
  State<WalletMpesaPage> createState() => _WalletMpesaPageState();
}

class _WalletMpesaPageState extends State<WalletMpesaPage> {
  final _client = Supabase.instance.client;
  final _phoneController = TextEditingController();
  final _amountController = TextEditingController();
  final _pinController = TextEditingController();
  Timer? _pollTimer;
  WalletReadModel? _wallet;
  String? _checkoutId;
  String? _message;
  String _status = 'idle';
  bool _loading = true;
  bool _submitting = false;
  bool _checkingStatus = false;
  bool _pinSet = false;
  int _elapsedSeconds = 0;

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _phoneController.dispose();
    _amountController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _loadWallet() async {
    setState(() => _loading = true);
    try {
      final data = await _client.rpc('get_my_wallet').maybeSingle();
      if (data == null) throw StateError('Wallet is not provisioned.');
      final wallet = WalletReadModel.fromJson(Map<String, dynamic>.from(data));
      final securityResponse = await _client.rpc('get_my_wallet_security');
      final security = Map<String, dynamic>.from(securityResponse as Map);
      if (!mounted) return;
      setState(() {
        _wallet = wallet;
        _pinSet = security['pin_set'] == true;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _message = 'Wallet data could not be loaded. Refresh and retry.';
      });
    }
  }

  Future<void> _startTopUp() async {
    final wallet = _wallet;
    final user = _client.auth.currentUser;
    final amount = double.tryParse(_amountController.text.trim());
    final phone = _phoneController.text.trim();
    if (wallet == null || user == null) {
      setState(() => _message =
          'Sign in and load your wallet before requesting a payment.');
      return;
    }
    if (amount == null ||
        !amount.isFinite ||
        amount < 10 ||
        amount > 150000 ||
        amount != amount.roundToDouble()) {
      setState(() =>
          _message = 'Enter a whole-number amount from KES 10 to KES 150,000.');
      return;
    }
    if (phone.replaceAll(RegExp(r'\D'), '').length < 9) {
      setState(() => _message = 'Enter a valid Kenyan M-Pesa phone number.');
      return;
    }
    if (!_pinSet) {
      setState(() =>
          _message = 'Set a wallet PIN before requesting an M-Pesa top-up.');
      return;
    }
    final pin = _pinController.text;
    if (!RegExp(r'^\\d{4,6}$').hasMatch(pin)) {
      setState(() => _message = 'Enter your 4–6 digit wallet PIN.');
      return;
    }
    try {
      final verification =
          await _client.rpc('verify_wallet_pin', params: {'p_pin': pin});
      final result = Map<String, dynamic>.from(verification as Map);
      if (result['success'] != true) {
        final code = (result['code'] ?? 'INVALID_PIN').toString();
        setState(() => _message = code == 'PIN_LOCKED'
            ? 'Wallet PIN is temporarily locked.'
            : 'Wallet PIN was not accepted.');
        _pinController.clear();
        return;
      }
    } catch (_) {
      setState(() => _message =
          'Wallet PIN could not be verified. No M-Pesa prompt was requested.');
      return;
    }
    if (!mounted) return;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Request M-Pesa payment'),
        content: Text(
          'Request KES ${amount.toStringAsFixed(0)} from $phone. Confirm the payment prompt on your phone. Funds are added only after the provider callback is verified.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Send prompt')),
        ],
      ),
    );
    if (accepted != true || !mounted) return;

    setState(() {
      _submitting = true;
      _message = null;
      _status = 'sending';
    });
    try {
      final response = await _client.functions.invoke('mpesa-stk-push', body: {
        'phone': phone,
        'amount': amount,
        'purpose': 'wallet_topup',
        'metadata': {'wallet_id': wallet.id},
      });
      final data = response.data;
      if (response.status >= 400 ||
          data is! Map ||
          data['checkout_request_id'] == null) {
        final message = data is Map ? (data['error'] ?? data['message']) : null;
        throw StateError(
            (message ?? 'M-Pesa did not confirm the request was accepted.')
                .toString());
      }
      if (!mounted) return;
      setState(() {
        _checkoutId = data['checkout_request_id'].toString();
        _status = 'pending';
        _submitting = false;
        _elapsedSeconds = 0;
        _message = (data['customer_message'] ??
                'Payment prompt sent. Enter your M-Pesa PIN on your phone.')
            .toString();
      });
      _beginPolling();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _status = 'failed';
        _message = 'Could not confirm the M-Pesa request: ${error.toString().replaceFirst('Bad state: ', '')}';
      });
    }
  }

  void _beginPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      _elapsedSeconds += 4;
      if (_elapsedSeconds >= 120) {
        _pollTimer?.cancel();
        if (mounted && _status == 'pending') {
          setState(() => _message =
              'Still awaiting confirmation. Use “Check status” before starting another payment.');
        }
        return;
      }
      _checkStatus(silent: true);
    });
  }

  Future<void> _checkStatus({bool silent = false}) async {
    final checkout = _checkoutId;
    if (checkout == null || checkout.isEmpty || _checkingStatus) return;
    _checkingStatus = true;
    if (!silent && mounted) {
      setState(() => _message = 'Checking provider status…');
    }
    try {
      final response = await _client.functions.invoke(
        'mpesa-stk-status',
        body: {'checkout_request_id': checkout},
      );
      final data = response.data;
      if (response.status >= 400 || data is! Map || data['ok'] != true) {
        if (!silent && mounted) {
          setState(() => _message = 'Status is not confirmed yet. Retry the status check.');
        }
        return;
      }
      final status = (data['status'] ?? 'pending').toString().toLowerCase();
      if (!mounted) return;
      if (status == 'completed') {
        _pollTimer?.cancel();
        await _loadWallet();
        if (!mounted) return;
        setState(() {
          _status = 'completed';
          _message =
              'M-Pesa payment confirmed by the server. Wallet balance refreshed.';
          _amountController.clear();
          _pinController.clear();
        });
      } else if (status == 'failed' ||
          status == 'cancelled' ||
          status == 'reversed') {
        _pollTimer?.cancel();
        setState(() {
          _status = 'failed';
          _message = 'Payment status: $status. No successful top-up is shown.';
        });
      } else if (!silent) {
        setState(() => _message =
            'Payment is still pending. Complete the prompt on your phone and check again.');
      }
    } catch (_) {
      if (!silent && mounted) {
        setState(() => _message = 'Could not check payment status. The payment remains unconfirmed.');
      }
    } finally {
      _checkingStatus = false;
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
                child: Text('M-Pesa top-up',
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w800))),
            IconButton(
                onPressed: _loading ? null : _loadWallet,
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
                title: const Text('Wallet balance'),
                subtitle: Text(
                    formatWalletAmount(_wallet!.balance, _wallet!.currency)),
              ),
            ),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Add funds from M-Pesa',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  const Text(
                      'Enter the number that should receive the STK prompt. M-Pesa charges in Kenyan shillings; the backend applies the configured wallet exchange rate.'),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _phoneController,
                    enabled: !_submitting && _status != 'pending',
                    keyboardType: TextInputType.phone,
                    autofillHints: const [AutofillHints.telephoneNumber],
                    decoration: const InputDecoration(
                        labelText: 'M-Pesa phone number',
                        hintText: '07xx xxx xxx or 2547xx xxx xxx',
                        border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _pinController,
                    enabled: !_submitting && _status != 'pending',
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    maxLength: 6,
                    decoration: const InputDecoration(
                        labelText: 'Wallet PIN',
                        helperText:
                            'Verified by Testagram before the payment request.',
                        border: OutlineInputBorder()),
                  ),
                  TextField(
                    controller: _amountController,
                    enabled: !_submitting && _status != 'pending',
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: 'Amount in KES',
                        hintText: 'e.g. 100',
                        border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 14),
                  if (!_pinSet)
                    OutlinedButton.icon(
                      onPressed: () => context.go('/wallet/security'),
                      icon: const Icon(Icons.shield_outlined),
                      label: const Text('Set wallet PIN'),
                    ),
                  FilledButton.icon(
                    onPressed: _submitting || _status == 'pending'
                        ? null
                        : _startTopUp,
                    icon: _submitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.phone_android),
                    label: Text(_submitting
                        ? 'Sending request…'
                        : 'Request M-Pesa prompt'),
                  ),
                  if (_status == 'pending') ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => _checkStatus(),
                      icon: const Icon(Icons.sync),
                      label: const Text('Check payment status'),
                    ),
                    TextButton(
                      onPressed: () {
                        _pollTimer?.cancel();
                        setState(() {
                          _status = 'idle';
                          _checkoutId = null;
                          _message =
                              'Previous request remains in history. Check wallet history if you completed payment.';
                        });
                      },
                      child: const Text('Stop waiting'),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_message != null)
            Card(
              color: _status == 'failed'
                  ? theme.colorScheme.errorContainer
                  : theme.colorScheme.surfaceContainerHighest,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(_status == 'completed'
                        ? Icons.check_circle
                        : _status == 'failed'
                            ? Icons.error_outline
                            : Icons.info_outline),
                    const SizedBox(width: 10),
                    Expanded(child: Text(_message!)),
                  ],
                ),
              ),
            ),
          if (_checkoutId != null)
            SelectableText('Checkout request: $_checkoutId',
                style: theme.textTheme.bodySmall),
          const SizedBox(height: 12),
          const Text(
            'A prompt being sent is not proof of payment. The wallet is credited only after Testagram’s M-Pesa callback and server-side settlement confirm the transaction. Do not retry while a previous request may still complete.',
            style: TextStyle(fontSize: 12),
          ),
        ],
      ],
    );
  }
}
