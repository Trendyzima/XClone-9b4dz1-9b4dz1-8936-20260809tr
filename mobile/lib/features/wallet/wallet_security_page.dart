import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'wallet_read_model.dart';

class WalletSecurityPage extends StatefulWidget {
  const WalletSecurityPage({super.key});

  @override
  State<WalletSecurityPage> createState() => _WalletSecurityPageState();
}

class _WalletSecurityPageState extends State<WalletSecurityPage> {
  final _client = Supabase.instance.client;
  final _pinController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  bool _pinSet = false;
  bool _biometricEnabled = false;
  String? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _loadSecurity();
  }

  @override
  void dispose() {
    _pinController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _loadSecurity() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _client.rpc('get_my_wallet_security');
      final security = Map<String, dynamic>.from(data as Map);
      if (!mounted) return;
      setState(() {
        _pinSet = security['pin_set'] == true;
        _biometricEnabled = security['biometric_enabled'] == true;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Wallet security could not be loaded. Check your connection and retry.';
      });
    }
  }

  Future<void> _savePin() async {
    final pin = _pinController.text;
    if (!isValidWalletPin(pin)) {
      setState(() => _error = 'Your PIN must contain 4 to 6 digits.');
      return;
    }
    if (pin != _confirmController.text) {
      setState(() => _error = 'The PIN entries do not match.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _notice = null;
    });
    try {
      final result = await _client.rpc(
        'set_wallet_pin',
        params: {'p_pin': pin},
      );
      final response = Map<String, dynamic>.from(result as Map);
      if (response['success'] != true) {
        throw StateError('The server did not confirm the PIN update.');
      }
      if (!mounted) return;
      setState(() {
        _pinSet = true;
        _saving = false;
        _notice = 'Wallet PIN saved securely on the server.';
        _pinController.clear();
        _confirmController.clear();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'PIN could not be saved. No change has been confirmed.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Wallet security',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Secure your wallet before initiating transfers. PIN verification is enforced by the server-side transfer RPC.',
        ),
        const SizedBox(height: 16),
        if (_loading)
          const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            ),
          )
        else ...[
          Card(
            child: ListTile(
              leading: Icon(
                _pinSet ? Icons.lock : Icons.lock_open,
                color: _pinSet ? Colors.green : theme.colorScheme.error,
              ),
              title: const Text('Wallet PIN'),
              subtitle: Text(
                _pinSet
                    ? 'A server-side PIN is configured.'
                    : 'Set a PIN before sending money.',
              ),
              trailing: Icon(
                _pinSet ? Icons.check_circle : Icons.warning_amber,
                color: _pinSet ? Colors.green : Colors.orange,
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.fingerprint),
              title: const Text('Biometrics'),
              subtitle: Text(
                _biometricEnabled
                    ? 'A biometric credential is enabled.'
                    : 'No biometric credential is enabled for this wallet.',
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            _pinSet ? 'Set a new PIN' : 'Create wallet PIN',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _pinController,
            keyboardType: TextInputType.number,
            obscureText: true,
            maxLength: 6,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(
              labelText: 'New 4–6 digit PIN',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _confirmController,
            keyboardType: TextInputType.number,
            obscureText: true,
            maxLength: 6,
            decoration: const InputDecoration(
              labelText: 'Confirm PIN',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          if (_error != null)
            _message(
              _error!,
              theme.colorScheme.errorContainer,
              theme.colorScheme.onErrorContainer,
            ),
          if (_notice != null)
            _message(
              _notice!,
              theme.colorScheme.primaryContainer,
              theme.colorScheme.onPrimaryContainer,
            ),
          FilledButton.icon(
            onPressed: _saving ? null : _savePin,
            icon: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.shield_outlined),
            label: Text(
              _saving
                  ? 'Saving securely…'
                  : _pinSet
                  ? 'Update PIN'
                  : 'Set wallet PIN',
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading ? null : _loadSecurity,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh security status'),
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
