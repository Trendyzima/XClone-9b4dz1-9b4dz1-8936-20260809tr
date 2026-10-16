import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Feature-specific wallet routes backed by the existing wallet schema/RPCs.
enum WalletAuxiliaryMode {
  analytics,
  pocket,
  receive,
  referrals,
  reminders,
  scheduled,
}

class WalletAuxiliaryPage extends StatefulWidget {
  const WalletAuxiliaryPage({required this.mode, super.key});
  final WalletAuxiliaryMode mode;

  @override
  State<WalletAuxiliaryPage> createState() => _WalletAuxiliaryPageState();
}

class _WalletAuxiliaryPageState extends State<WalletAuxiliaryPage> {
  final _db = Supabase.instance.client;
  final _amount = TextEditingController();
  final _title = TextEditingController();
  final _username = TextEditingController();
  final _note = TextEditingController();
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _notice;
  Map<String, dynamic>? _wallet;
  Map<String, dynamic>? _pocketData;
  Map<String, dynamic>? _profile;
  List<Map<String, dynamic>> _rows = const [];
  DateTime _scheduledFor = DateTime.now().add(const Duration(days: 1));

  String get _titleText => switch (widget.mode) {
    WalletAuxiliaryMode.analytics => 'Wallet analytics',
    WalletAuxiliaryMode.pocket => 'Savings pocket',
    WalletAuxiliaryMode.receive => 'Receive money',
    WalletAuxiliaryMode.referrals => 'Wallet referrals',
    WalletAuxiliaryMode.reminders => 'Payment reminders',
    WalletAuxiliaryMode.scheduled => 'Scheduled transfers',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _amount.dispose();
    _title.dispose();
    _username.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _notice = null;
    });
    final user = _db.auth.currentUser;
    if (user == null) {
      setState(() {
        _loading = false;
        _error = 'Sign in to access your wallet.';
      });
      return;
    }
    try {
      switch (widget.mode) {
        case WalletAuxiliaryMode.analytics:
          final results = await Future.wait<dynamic>([
            _db.rpc('get_my_wallet').maybeSingle(),
            _db
                .from('wallet_transactions')
                .select('id,amount,type,status,direction,created_at')
                .eq('user_id', user.id)
                .order('created_at', ascending: false)
                .limit(100),
          ]);
          _wallet = results[0] == null
              ? null
              : Map<String, dynamic>.from(results[0] as Map);
          _rows = (results[1] as List)
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
          break;
        case WalletAuxiliaryMode.pocket:
          _wallet = await _db.rpc('get_my_wallet').maybeSingle();
          final pocketResponse = await _db
              .from('wallet_savings_pockets')
              .select('wallet_id,user_id,balance,currency,updated_at')
              .eq('user_id', user.id)
              .maybeSingle();
          _pocketData = pocketResponse == null
              ? null
              : Map<String, dynamic>.from(pocketResponse);
          break;
        case WalletAuxiliaryMode.receive:
          _wallet = await _db.rpc('get_my_wallet').maybeSingle();
          _profile = await _db
              .from('profiles')
              .select('username,display_name,avatar_url')
              .eq('id', user.id)
              .maybeSingle();
          break;
        case WalletAuxiliaryMode.referrals:
          final referralResponse = await _db
              .from('wallet_referral_credits')
              .select('id,amount,reason,created_at,referral_id')
              .eq('user_id', user.id)
              .order('created_at', ascending: false)
              .limit(100);
          _rows = (referralResponse as List)
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
          break;
        case WalletAuxiliaryMode.reminders:
          final reminderResponse = await _db
              .from('wallet_transaction_reminders')
              .select(
                'id,title,amount,currency,remind_at,frequency,to_username,is_active,last_sent_at',
              )
              .eq('user_id', user.id)
              .order('remind_at', ascending: true)
              .limit(100);
          _rows = (reminderResponse as List)
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
          break;
        case WalletAuxiliaryMode.scheduled:
          final scheduledResponse = await _db
              .from('wallet_scheduled_transfers')
              .select(
                'id,to_user_id,to_username,amount,currency,note,scheduled_for,status,created_at',
              )
              .eq('from_user_id', user.id)
              .order('scheduled_for', ascending: true)
              .limit(100);
          _rows = (scheduledResponse as List)
              .whereType<Map>()
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
          break;
      }
      if (!mounted) return;
      setState(() => _loading = false);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error =
            '$_titleText could not be loaded. Check your connection and retry.';
      });
    }
  }

  double? get _validAmount {
    final value = double.tryParse(_amount.text.trim());
    if (value == null ||
        !value.isFinite ||
        value <= 0 ||
        value * 100 != (value * 100).roundToDouble()) {
      return null;
    }
    return value;
  }

  Future<void> _movePocket(String direction) async {
    final amount = _validAmount;
    if (amount == null) {
      setState(
        () => _error = 'Enter an amount greater than zero with at most two decimal places.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await _db.rpc(
        'wallet_move_savings',
        params: {'p_amount': amount, 'p_direction': direction},
      );
      _amount.clear();
      if (mounted) {
        setState(
          () => _notice = direction == 'in'
              ? 'Funds moved into your savings pocket.'
              : 'Funds returned to your wallet.',
        );
      }
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'The savings operation was not confirmed. Refresh your balances before retrying.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _createReminder() async {
    final user = _db.auth.currentUser;
    final title = _title.text.trim();
    if (user == null || title.isEmpty) {
      setState(() => _error = 'Enter a reminder title.');
      return;
    }
    final amount = _amount.text.trim().isEmpty ? null : _validAmount;
    if (_amount.text.trim().isNotEmpty && amount == null) {
      setState(() => _error = 'Enter a valid reminder amount.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final wallet = await _db.rpc('get_my_wallet').maybeSingle();
      if (wallet == null || wallet['id'] == null) {
        throw StateError('Wallet missing');
      }
      await _db.from('wallet_transaction_reminders').insert({
        'user_id': user.id,
        'wallet_id': wallet['id'],
        'title': title,
        'amount': amount,
        'currency': wallet['currency'] ?? 'KES',
        'remind_at': _scheduledFor.toUtc().toIso8601String(),
        'frequency': 'once',
        'is_active': true,
      });
      _title.clear();
      _amount.clear();
      if (mounted) setState(() => _notice = 'Reminder saved.');
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Reminder could not be saved. No reminder was confirmed.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disableReminder(String id) async {
    try {
      await _db
          .from('wallet_transaction_reminders')
          .update({'is_active': false})
          .eq('id', id)
          .eq('user_id', _db.auth.currentUser!.id);
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'Reminder could not be updated.');
    }
  }

  Future<void> _createScheduledTransfer() async {
    final user = _db.auth.currentUser;
    final username = _username.text.trim().replaceFirst(RegExp(r'^@'), '');
    final amount = _validAmount;
    if (user == null || username.isEmpty || amount == null) {
      setState(() => _error = 'Enter a recipient username and a valid amount.');
      return;
    }
    if (!_scheduledFor.isAfter(DateTime.now())) {
      setState(() => _error = 'Choose a future date and time.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final recipient = await _db
          .from('profiles')
          .select('id,username')
          .eq('username', username)
          .maybeSingle();
      if (recipient == null) throw StateError('Recipient not found');
      await _db.rpc(
        'wallet_create_scheduled_transfer',
        params: {
          'p_to_user_id': recipient['id'],
          'p_amount': amount,
          'p_scheduled_for': _scheduledFor.toUtc().toIso8601String(),
          'p_note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        },
      );
      _username.clear();
      _amount.clear();
      _note.clear();
      if (mounted) {
        setState(
          () => _notice = 'Transfer scheduled. It will be processed by the server at the selected time.',
        );
      }
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Transfer was not scheduled. Verify the recipient, balance and future date.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancelScheduled(String id) async {
    try {
      final result = await _db.rpc(
        'wallet_cancel_scheduled_transfer',
        params: {'p_id': id},
      );
      if (result != true) throw StateError('Cancellation not confirmed');
      if (mounted) setState(() => _notice = 'Scheduled transfer cancelled.');
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Transfer cancellation was not confirmed. Refresh the list.',
        );
      }
    }
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _scheduledFor.isAfter(DateTime.now())
          ? _scheduledFor
          : DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_scheduledFor),
    );
    if (time == null || !mounted) return;
    setState(
      () => _scheduledFor = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      ),
    );
  }

  Future<void> _shareReceiveDetails() async {
    final username = _profile?['username']?.toString();
    final userId = _db.auth.currentUser?.id;
    final details =
        'Receive money on Testagram${username == null ? '' : ' as @$username'}. Account reference: ${userId ?? ''}';
    await Clipboard.setData(ClipboardData(text: details));
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Receiving details copied')));
    }
    await Share.share(details);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            _titleText,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text(_error!),
                trailing: IconButton(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
            ),
          if (_notice != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.check_circle_outline),
                title: Text(_notice!),
              ),
            ),
          if (!_loading && widget.mode == WalletAuxiliaryMode.analytics)
            _analytics(theme),
          if (!_loading && widget.mode == WalletAuxiliaryMode.pocket)
            _pocketContent(theme),
          if (!_loading && widget.mode == WalletAuxiliaryMode.receive)
            _receive(theme),
          if (!_loading && widget.mode == WalletAuxiliaryMode.referrals)
            _referrals(theme),
          if (!_loading && widget.mode == WalletAuxiliaryMode.reminders)
            _reminders(theme),
          if (!_loading && widget.mode == WalletAuxiliaryMode.scheduled)
            _scheduled(theme),
        ],
      ),
    );
  }

  Widget _analytics(ThemeData theme) {
    final incoming = _rows
        .where(
          (r) =>
              r['direction'] == 'in' ||
              r['type'] == 'deposit' ||
              r['type'] == 'credit',
        )
        .fold<double>(
          0,
          (s, r) => s + (double.tryParse('${r['amount'] ?? 0}') ?? 0),
        );
    final outgoing = _rows
        .where(
          (r) =>
              r['direction'] == 'out' ||
              r['type'] == 'withdrawal' ||
              r['type'] == 'debit',
        )
        .fold<double>(
          0,
          (s, r) => s + (double.tryParse('${r['amount'] ?? 0}') ?? 0),
        );
    final currency = '${_wallet?['currency'] ?? 'KES'}';
    return Column(
      children: [
        Card(
          child: ListTile(
            title: const Text('Current balance'),
            subtitle: const Text('Canonical server wallet balance'),
            trailing: Text('$currency ${_wallet?['balance'] ?? '—'}'),
          ),
        ),
        Row(
          children: [
            Expanded(
              child: _metric('Incoming', incoming, currency, Icons.south_west),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _metric('Outgoing', outgoing, currency, Icons.north_east),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Card(
          child: Column(
            children: [
              const ListTile(title: Text('Recent transactions')),
              for (final row in _rows.take(30))
                ListTile(
                  dense: true,
                  leading: Icon(
                    row['direction'] == 'in'
                        ? Icons.arrow_downward
                        : Icons.arrow_upward,
                  ),
                  title: Text('${row['type'] ?? 'Transaction'}'),
                  subtitle: Text(
                    '${row['created_at'] ?? ''} • ${row['status'] ?? ''}',
                  ),
                  trailing: Text('$currency ${row['amount'] ?? 0}'),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _metric(String title, double value, String currency, IconData icon) =>
      Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon),
              const SizedBox(height: 8),
              Text(title),
              Text(
                '$currency ${value.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
      );

  Widget _pocketContent(ThemeData theme) => Column(
    children: [
      Card(
        child: ListTile(
          leading: const Icon(Icons.savings_outlined),
          title: const Text('Pocket balance'),
          subtitle: Text(
            'Currency: ${_pocketData?['currency'] ?? _wallet?['currency'] ?? 'KES'}',
          ),
          trailing: Text('${_pocketData?['balance'] ?? '0.00'}'),
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _amount,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(
          labelText: 'Amount',
          prefixIcon: Icon(Icons.payments_outlined),
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 10),
      Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _busy ? null : () => _movePocket('in'),
              child: const Text('Move to pocket'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: FilledButton(
              onPressed: _busy ? null : () => _movePocket('out'),
              child: const Text('Withdraw'),
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
      const Text(
        'All balance changes are validated and recorded by the server-side wallet RPC.',
      ),
    ],
  );

  Widget _receive(ThemeData theme) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        children: [
          const CircleAvatar(
            radius: 32,
            child: Icon(Icons.call_received, size: 32),
          ),
          const SizedBox(height: 12),
          Text(
            '@${_profile?['username'] ?? 'account'}',
            style: theme.textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          const Text(
            'Share your Testagram account reference with the sender. Never share your wallet PIN or sign-in codes.',
          ),
          const SizedBox(height: 12),
          SelectableText(_db.auth.currentUser?.id ?? ''),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _shareReceiveDetails,
            icon: const Icon(Icons.share),
            label: const Text('Copy & share receiving details'),
          ),
        ],
      ),
    ),
  );

  Widget _referrals(ThemeData theme) => Column(
    children: [
      Card(
        child: ListTile(
          leading: const Icon(Icons.card_giftcard),
          title: const Text('Wallet referral credits'),
          subtitle: const Text(
            'Credits are read from the authenticated wallet referral ledger.',
          ),
          trailing: Text(
            '${_rows.fold<int>(0, (s, r) => s + (int.tryParse('${r['amount'] ?? 0}') ?? 0))}',
          ),
        ),
      ),
      if (_rows.isEmpty)
        const Card(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text('No wallet referral credits recorded yet.'),
          ),
        ),
      for (final row in _rows)
        Card(
          child: ListTile(
            leading: const Icon(Icons.stars_outlined),
            title: Text('${row['reason'] ?? 'Referral credit'}'),
            subtitle: Text('${row['created_at'] ?? ''}'),
            trailing: Text('+${row['amount'] ?? 0}'),
          ),
        ),
    ],
  );

  Widget _reminders(ThemeData theme) => Column(
    children: [
      TextField(
        controller: _title,
        decoration: const InputDecoration(
          labelText: 'Reminder title',
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _amount,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(
          labelText: 'Amount (optional)',
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 8),
      ListTile(
        leading: const Icon(Icons.calendar_month),
        title: const Text('Remind me at'),
        subtitle: Text(_scheduledFor.toLocal().toString()),
        trailing: TextButton(onPressed: _pickDate, child: const Text('Change')),
      ),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _busy ? null : _createReminder,
          child: const Text('Save reminder'),
        ),
      ),
      const SizedBox(height: 12),
      Text('Your reminders', style: theme.textTheme.titleLarge),
      if (_rows.isEmpty)
        const Card(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text('No reminders saved.'),
          ),
        ),
      for (final row in _rows)
        Card(
          child: ListTile(
            leading: Icon(
              row['is_active'] == true
                  ? Icons.notifications_active_outlined
                  : Icons.notifications_off_outlined,
            ),
            title: Text('${row['title']}'),
            subtitle: Text('${row['remind_at']} • ${row['frequency']}'),
            trailing: row['is_active'] == true
                ? IconButton(
                    tooltip: 'Disable reminder',
                    onPressed: () => _disableReminder('${row['id']}'),
                    icon: const Icon(Icons.pause_circle_outline),
                  )
                : const Text('Paused'),
          ),
        ),
    ],
  );

  Widget _scheduled(ThemeData theme) => Column(
    children: [
      TextField(
        controller: _username,
        decoration: const InputDecoration(
          labelText: 'Recipient username',
          prefixText: '@',
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _amount,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: const InputDecoration(
          labelText: 'Amount',
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 8),
      TextField(
        controller: _note,
        decoration: const InputDecoration(
          labelText: 'Note (optional)',
          border: OutlineInputBorder(),
        ),
      ),
      ListTile(
        leading: const Icon(Icons.schedule),
        title: const Text('Transfer date and time'),
        subtitle: Text(_scheduledFor.toLocal().toString()),
        trailing: TextButton(onPressed: _pickDate, child: const Text('Change')),
      ),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _busy ? null : _createScheduledTransfer,
          child: const Text('Schedule transfer'),
        ),
      ),
      const SizedBox(height: 12),
      Text(
        'Upcoming and previous transfers',
        style: theme.textTheme.titleLarge,
      ),
      if (_rows.isEmpty)
        const Card(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text('No scheduled transfers.'),
          ),
        ),
      for (final row in _rows)
        Card(
          child: ListTile(
            leading: const Icon(Icons.event_repeat),
            title: Text(
              '${row['currency'] ?? 'KES'} ${row['amount']} → @${row['to_username'] ?? 'recipient'}',
            ),
            subtitle: Text('${row['scheduled_for']} • ${row['status']}'),
            trailing: row['status'] == 'pending'
                ? IconButton(
                    tooltip: 'Cancel transfer',
                    onPressed: _busy
                        ? null
                        : () => _cancelScheduled('${row['id']}'),
                    icon: const Icon(Icons.cancel_outlined),
                  )
                : null,
          ),
        ),
    ],
  );
}
