import 'package:flutter/material.dart';

import '../../core/auth/appwrite_admin_session.dart';

class AdReviewPage extends StatefulWidget {
  const AdReviewPage({super.key});

  @override
  State<AdReviewPage> createState() => _AdReviewPageState();
}

class _AdReviewPageState extends State<AdReviewPage> {
  final _session = AppwriteAdminSession();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _otp = TextEditingController();
  final _notes = <String, String>{};

  bool _busy = false;
  bool _loading = true;
  bool _signedIn = false;
  bool _mfaRequired = false;
  String? _challengeId;
  String? _error;
  String _factor = 'totp';
  String _status = 'pending';
  List<String> _factors = const [];
  List<Map<String, dynamic>> _campaigns = const [];

  static const _filters = <String, String>{
    'pending': 'Pending',
    'approved': 'Approved',
    'rejected': 'Rejected',
    'all': 'All',
  };

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _otp.dispose();
    _session.dispose();
    super.dispose();
  }

  Future<void> _restoreSession() async {
    try {
      await _session.restore();
      if (_session.isAuthenticated) {
        _signedIn = true;
        await _loadQueue();
      }
    } on AppwriteAdminException catch (error) {
      if (error.code == 'user_more_factors_required') {
        _signedIn = true;
        await _prepareMfa();
      } else {
        _error = error.message;
      }
    } catch (error) {
      _error = error.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _session.signIn(email: _email.text, password: _password.text);
      _signedIn = true;
      await _loadQueue();
    } on AppwriteAdminException catch (error) {
      if (error.code == 'user_more_factors_required') {
        _signedIn = true;
        await _prepareMfa();
        if (_factors.isEmpty) {
          _error = 'Enable a second factor on this Appwrite account before reviewing ads.';
        }
      } else {
        _error = error.message;
      }
    } catch (error) {
      _error = error.toString();
    } finally {
      if (mounted) {
        _password.clear();
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _prepareMfa() async {
    try {
      final factors = await _session.listMfaFactors();
      final available = ['totp', 'email', 'phone']
          .where((factor) => factors[factor] == true)
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _factors = available;
        _factor = available.isNotEmpty ? available.first : 'totp';
        _mfaRequired = true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _startMfa() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final challenge = await _session.createMfaChallenge(_factor);
      if (mounted) {
        setState(() => _challengeId = challenge);
        _message(_factor == 'totp' ? 'Enter your authenticator code.' : 'A verification code was sent.');
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _completeMfa() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _session.completeMfaChallenge(challengeId: _challengeId ?? '', otp: _otp.text);
      _otp.clear();
      _challengeId = null;
      _mfaRequired = false;
      _signedIn = true;
      await _loadQueue();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _loadQueue() async {
    if (mounted) setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _session.getAdReviewQueue(status: _status, limit: 200);
      if (!mounted) return;
      setState(() {
        _campaigns = items;
        _signedIn = true;
        _mfaRequired = false;
      });
    } on AppwriteAdminException catch (error) {
      if (error.code == 'ADMIN_MFA_REQUIRED') {
        await _prepareMfa();
      } else if (error.code == 'ADMIN_PERMISSION_REQUIRED') {
        _error = 'This account does not have the platform.ads permission.';
      } else if (error.code == 'AUTH_REQUIRED' || error.status == 401) {
        _signedIn = false;
        _error = 'Sign in with your Appwrite account to continue.';
      } else {
        _error = error.message;
      }
    } catch (error) {
      _error = error.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _review(Map<String, dynamic> campaign, String decision) async {
    final id = (campaign['campaign_id'] ?? '').toString();
    final note = (_notes[id] ?? '').trim();
    if (decision == 'rejected' && note.isEmpty) {
      _message('A rejection reason is required.', isError: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await _session.reviewCampaign(campaignId: id, decision: decision, note: note);
      _message(decision == 'approved'
          ? 'Campaign approved. It activates only after funding.'
          : 'Campaign rejected.');
      await _loadQueue();
    } on AppwriteAdminException catch (error) {
      if (error.code == 'ADMIN_MFA_REQUIRED') {
        await _prepareMfa();
      } else {
        _message(error.message, isError: true);
      }
    } catch (error) {
      _message(error.toString(), isError: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setStatus(Map<String, dynamic> campaign, String status) async {
    final id = (campaign['campaign_id'] ?? '').toString();
    setState(() => _busy = true);
    try {
      await _session.updateCampaignStatus(campaignId: id, status: status);
      _message(status == 'paused' ? 'Campaign paused.' : 'Campaign resumed.');
      await _loadQueue();
    } on AppwriteAdminException catch (error) {
      if (error.code == 'ADMIN_MFA_REQUIRED') {
        await _prepareMfa();
      } else {
        _message(error.message, isError: true);
      }
    } catch (error) {
      _message(error.toString(), isError: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signOut() async {
    setState(() => _busy = true);
    try {
      await _session.signOut();
    } catch (_) {
      // The local privileged token is cleared even when Appwrite is unreachable.
    } finally {
      if (mounted) {
        setState(() {
          _signedIn = false;
          _mfaRequired = false;
          _challengeId = null;
          _campaigns = const [];
          _busy = false;
        });
      }
    }
  }

  void _message(String value, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(value),
      backgroundColor: isError ? Theme.of(context).colorScheme.error : null,
    ));
  }

  String _kes(dynamic micros) {
    final amount = (num.tryParse(micros.toString()) ?? 0) / 1000000;
    return 'KES ${amount.toStringAsFixed(0)}';
  }

  String _date(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    return date == null
        ? 'Not set'
        : MaterialLocalizations.of(context).formatMediumDate(date.toLocal());
  }

  Color _statusColor(String value) {
    switch (value) {
      case 'approved':
      case 'active':
        return Colors.green;
      case 'rejected':
        return Theme.of(context).colorScheme.error;
      case 'paused':
        return Colors.blueGrey;
      default:
        return Colors.orange;
    }
  }

  Widget _panel({
    required IconData icon,
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) {
    return Card(
      margin: const EdgeInsets.all(16),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(icon, size: 36, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 12),
            Text(title, textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text(subtitle, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 20),
            ...children,
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _loginPanel() => _panel(
        icon: Icons.admin_panel_settings_outlined,
        title: 'Appwrite admin sign-in',
        subtitle: 'Ad review uses a separate, short-lived Appwrite session. Your normal app sign-in is not reused for privileged actions.',
        children: [
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            decoration: const InputDecoration(labelText: 'Appwrite email', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _password,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Appwrite password', border: OutlineInputBorder()),
            onSubmitted: (_) => _signIn(),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy ? null : _signIn,
            child: _busy
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Sign in securely'),
          ),
        ],
      );

  Widget _mfaPanel() => _panel(
        icon: Icons.verified_user_outlined,
        title: 'Verify your identity',
        subtitle: 'The Backend requires a current Appwrite second-factor verification before ad moderation.',
        children: [
          if (_factors.isEmpty)
            const Text('No second factor is enabled. Enable TOTP, email or phone MFA on this Appwrite account, then return here.')
          else ...[
            DropdownButtonFormField<String>(
              value: _factor,
              decoration: const InputDecoration(labelText: 'Verification method', border: OutlineInputBorder()),
              items: _factors.map((factor) => DropdownMenuItem(value: factor, child: Text(factor.toUpperCase()))).toList(),
              onChanged: _busy ? null : (value) => setState(() {
                _factor = value ?? 'totp';
                _challengeId = null;
                _otp.clear();
              }),
            ),
            const SizedBox(height: 12),
            if (_challengeId == null)
              FilledButton(
                onPressed: _busy ? null : _startMfa,
                child: _busy ? const CircularProgressIndicator() : Text(_factor == 'totp' ? 'Start authenticator verification' : 'Send verification code'),
              )
            else ...[
              TextField(
                controller: _otp,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                decoration: const InputDecoration(labelText: 'Verification code', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : _completeMfa,
                child: _busy ? const CircularProgressIndicator() : const Text('Verify and continue'),
              ),
            ],
          ],
        ],
      );

  Widget _campaignCard(Map<String, dynamic> campaign) {
    final id = (campaign['campaign_id'] ?? '').toString();
    final moderation = (campaign['moderation_status'] ?? 'pending').toString();
    final status = (campaign['campaign_status'] ?? 'pending_review').toString();
    final creative = campaign['creative'] is Map
        ? Map<String, dynamic>.from(campaign['creative'] as Map)
        : <String, dynamic>{};
    final title = (campaign['campaign_name'] ?? 'Untitled campaign').toString();
    final advertiser = (campaign['advertiser_name'] ?? 'Advertiser').toString();
    final assetUrl = (creative['asset_url'] ?? '').toString();
    final clickUrl = (creative['click_through_url'] ?? '').toString();

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
              Chip(
                label: Text(moderation.toUpperCase(), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                backgroundColor: _statusColor(moderation).withValues(alpha: 0.12),
                side: BorderSide(color: _statusColor(moderation).withValues(alpha: 0.3)),
              ),
            ]),
            Text(advertiser, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 10),
            if (assetUrl.startsWith('https://'))
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.network(assetUrl, height: 150, fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink()),
              ),
            if ((creative['headline'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(creative['headline'].toString(), style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            if ((creative['body'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(creative['body'].toString()),
              ),
            if (clickUrl.startsWith('https://'))
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: SelectableText(clickUrl, style: TextStyle(color: Theme.of(context).colorScheme.primary, fontSize: 12)),
              ),
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 4, children: [
              Chip(label: Text('Budget ${_kes(campaign['lifetime_budget_micros'])}')),
              Chip(label: Text('Funded ${_kes(campaign['funded_micros'])}')),
              Chip(label: Text('Payment ${campaign['payment_status'] ?? 'unpaid'}')),
            ]),
            Text('Created ${_date(campaign['created_at'])} · Ends ${_date(campaign['ends_at'])}',
                style: Theme.of(context).textTheme.bodySmall),
            if ((campaign['moderation_note'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Previous note: ${campaign['moderation_note']}', style: Theme.of(context).textTheme.bodySmall),
              ),
            if (moderation == 'pending') ...[
              const SizedBox(height: 12),
              TextField(
                minLines: 1,
                maxLines: 3,
                maxLength: 500,
                decoration: const InputDecoration(labelText: 'Review note (required for rejection)', border: OutlineInputBorder()),
                onChanged: (value) => _notes[id] = value,
              ),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: FilledButton.icon(
                  onPressed: _busy ? null : () => _review(campaign, 'approved'),
                  icon: const Icon(Icons.check_circle_outline),
                  label: const Text('Approve'),
                )),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _review(campaign, 'rejected'),
                  icon: const Icon(Icons.cancel_outlined),
                  label: const Text('Reject'),
                )),
              ]),
            ] else if (status == 'active') ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _setStatus(campaign, 'paused'),
                icon: const Icon(Icons.pause_circle_outline),
                label: const Text('Pause campaign'),
              ),
            ] else if (status == 'paused' && moderation == 'approved') ...[
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _busy ? null : () => _setStatus(campaign, 'active'),
                icon: const Icon(Icons.play_circle_outline),
                label: const Text('Resume campaign'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ad Review'),
        actions: [
          if (_signedIn)
            IconButton(onPressed: _busy ? null : _signOut, icon: const Icon(Icons.logout), tooltip: 'Sign out'),
          if (_signedIn && !_mfaRequired)
            IconButton(onPressed: _loading ? null : _loadQueue, icon: const Icon(Icons.refresh), tooltip: 'Refresh'),
        ],
      ),
      body: _loading && !_signedIn && !_mfaRequired
          ? const Center(child: CircularProgressIndicator())
          : !_signedIn
              ? ListView(children: [_loginPanel()])
              : _mfaRequired
                  ? ListView(children: [_mfaPanel()])
                  : Column(children: [
                      if (_error != null)
                        MaterialBanner(
                          content: Text(_error!),
                          actions: [TextButton(onPressed: _loadQueue, child: const Text('Retry'))],
                        ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                        child: DropdownButtonFormField<String>(
                          value: _status,
                          decoration: const InputDecoration(labelText: 'Review status', border: OutlineInputBorder()),
                          items: _filters.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                          onChanged: _busy ? null : (value) {
                            if (value == null) return;
                            setState(() => _status = value);
                            _loadQueue();
                          },
                        ),
                      ),
                      Expanded(
                        child: _loading
                            ? const Center(child: CircularProgressIndicator())
                            : _campaigns.isEmpty
                                ? const Center(child: Text('No campaigns in this review filter.'))
                                : RefreshIndicator(
                                    onRefresh: _loadQueue,
                                    child: ListView.builder(
                                      itemCount: _campaigns.length,
                                      itemBuilder: (context, index) => _campaignCard(_campaigns[index]),
                                    ),
                                  ),
                      ),
                    ]),
    );
  }
}
