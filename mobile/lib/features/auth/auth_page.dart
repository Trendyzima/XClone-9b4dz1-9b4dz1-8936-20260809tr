import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/auth/auth_redirect_policy.dart';
import '../../core/widgets/testagram_background.dart';

class AuthPage extends StatefulWidget {
  const AuthPage({this.recovery = false, this.returnTo = '/', super.key});
  final bool recovery;
  final String returnTo;

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _dob = TextEditingController();
  final _newPassword = TextEditingController();
  final _confirmPassword = TextEditingController();
  bool _busy = false;
  bool _obscurePassword = true;
  bool _acceptTerms = false;
  bool _acceptPrivacy = false;
  bool _acceptContentPolicy = false;
  String? _error;
  User? _pendingLegalUser;

  SupabaseClient get _client => Supabase.instance.client;

  @override
  void initState() {
    super.initState();
    final existing = _client.auth.currentUser;
    if (existing != null && !widget.recovery) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _checkLegalAndContinue(existing));
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _dob.dispose();
    _newPassword.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  String _normalizeKenyaPhone(String input) {
    final raw = input.trim().replaceAll(RegExp(r'\s+'), '');
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (RegExp(r'^\+254[17]\d{8}$').hasMatch(raw)) return raw;
    if (RegExp(r'^0[17]\d{8}$').hasMatch(raw)) return '+254${raw.substring(1)}';
    if (RegExp(r'^254[17]\d{8}$').hasMatch(digits)) return '+$digits';
    if (RegExp(r'^[17]\d{8}$').hasMatch(digits)) return '+254$digits';
    throw const AuthException(
        'Enter a valid email address or Kenyan phone number.');
  }

  Future<void> _signIn() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final identifier = _email.text.trim();
      final response = await (identifier.contains('@')
              ? _client.auth.signInWithPassword(
                  email: identifier.toLowerCase(), password: _password.text)
              : _client.auth.signInWithPassword(
                  phone: _normalizeKenyaPhone(identifier),
                  password: _password.text))
          .timeout(const Duration(seconds: 15));
      final user = response.user;
      if (user == null) {
        throw const AuthException(
            'Sign-in returned no account. Please try again.');
      }
      await _checkLegalAndContinue(user);
    } on AuthException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (error) {
      if (mounted) setState(() => _error = _friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _ensureFederationIdentity(User user) {
    final role = user.appMetadata['role'];
    final roles = user.appMetadata['roles'];
    final shouldBackfillAll = role == 'admin' ||
        role == 'super_admin' ||
        role == 'owner' ||
        (roles is List &&
            roles.any((value) => value == 'admin' || value == 'super_admin' || value == 'owner'));
    // The Edge Function independently verifies the JWT and admin role. This
    // only requests the full one-time backfill when the signed-in user is an
    // admin; ordinary users provision their own actor and signing key.
    unawaited(
      _client.functions
          .invoke('activitypub-keygen', body: {if (shouldBackfillAll) 'generate_all_missing': true})
          .timeout(const Duration(seconds: 20))
          .then<void>((_) {}, onError: (Object _) {}),
    );
  }

  Future<void> _checkLegalAndContinue(User user) async {
    try {
      final result = await _client
          .from('profiles')
          .select(
              'birth_date,legal_terms_accepted_at,legal_privacy_accepted_at,legal_content_policy_accepted_at,legal_age_confirmed_at,legal_policy_version')
          .eq('id', user.id)
          .maybeSingle()
          .timeout(const Duration(seconds: 12));
      final birthDate = DateTime.tryParse('${result?['birth_date'] ?? ''}');
      final now = DateTime.now();
      final ageCutoff = DateTime(now.year - 18, now.month, now.day);
      if (birthDate != null && birthDate.isAfter(ageCutoff)) {
        await _client.auth.signOut();
        throw const AuthException(
            'Testagram is available only to users aged 18 or older.');
      }
      final accepted = result != null &&
          result['legal_terms_accepted_at'] != null &&
          result['legal_privacy_accepted_at'] != null &&
          result['legal_content_policy_accepted_at'] != null &&
          result['legal_age_confirmed_at'] != null &&
          result['legal_policy_version'] == '2026-09' &&
          birthDate != null;
      if (!accepted) {
        if (!mounted) return;
        setState(() {
          _pendingLegalUser = user;
          _error = null;
        });
        return;
      }
      _ensureFederationIdentity(user);
      if (mounted) {
        context.go(AuthRedirectPolicy.safeReturnPath(widget.returnTo));
      }
    } catch (error) {
      if (mounted) setState(() => _error = _friendlyError(error));
    }
  }

  Future<void> _acceptLegal() async {
    final user = _pendingLegalUser;
    final dob = DateTime.tryParse(_dob.text);
    if (user == null) return;
    if (dob == null) {
      setState(() => _error = 'Enter your date of birth to continue.');
      return;
    }
    final now = DateTime.now();
    final cutoff = DateTime(now.year - 18, now.month, now.day);
    if (dob.isAfter(cutoff)) {
      setState(() =>
          _error = 'Testagram is available only to users aged 18 or older.');
      return;
    }
    if (!_acceptTerms || !_acceptPrivacy || !_acceptContentPolicy) {
      setState(() => _error = 'Please accept all three policies to continue.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await _client.rpc('accept_testagram_legal', params: {
        'p_birth_date': _dob.text
      }).timeout(const Duration(seconds: 12));
      if (response == null || response == false) {
        // Some Postgres functions return void (null) on success.
      }
      _ensureFederationIdentity(user);
      if (mounted) {
        context.go(AuthRedirectPolicy.safeReturnPath(widget.returnTo));
      }
    } catch (error) {
      if (mounted) setState(() => _error = _friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _updatePassword() async {
    if (_newPassword.text.length < 8) {
      setState(
          () => _error = 'Use at least 8 characters for your new password.');
      return;
    }
    if (_newPassword.text != _confirmPassword.text) {
      setState(() => _error = 'The passwords do not match.');
      return;
    }
    if (_client.auth.currentSession == null) {
      setState(() => _error =
          'This recovery link is no longer active. Request a new password recovery email.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.auth
          .updateUser(UserAttributes(password: _newPassword.text))
          .timeout(const Duration(seconds: 12));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Password updated successfully.')));
        await _checkLegalAndContinue(_client.auth.currentUser!);
      }
    } catch (error) {
      if (mounted) setState(() => _error = _friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openExistingSignup() async {
    final opened = await launchUrl(
      Uri.parse('${AppConfig.siteUrl}/auth'),
      mode: LaunchMode.externalApplication,
    );
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Could not open the existing signup flow.')),
      );
    }
  }

  Future<void> _resetPassword() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = 'Enter your email address first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _client.auth
          .resetPasswordForEmail(email,
              redirectTo: '${AppConfig.siteUrl}/auth?reset=1')
          .timeout(const Duration(seconds: 12));
      if (mounted) {
        setState(() => _error =
            'If the account exists, a password recovery email has been sent.');
      }
    } catch (error) {
      if (mounted) setState(() => _error = _friendlyError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _friendlyError(Object error) {
    final text = error.toString().replaceFirst('Exception: ', '');
    if (text.contains('SocketException') ||
        text.contains('Failed host lookup')) {
      return 'Network unavailable. Check your connection and retry.';
    }
    if (text.contains('TimeoutException')) {
      return 'The request timed out. Check your connection and retry.';
    }
    return text;
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 18, 1, 1),
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'Select your date of birth',
    );
    if (picked != null) {
      _dob.text =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final legalStep = _pendingLegalUser != null;
    final recoveryStep = widget.recovery && !legalStep;
    return Scaffold(
      body: TestagramBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(22),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Center(
                              child: Image.asset(
                                  'assets/branding/testagram-icon.webp',
                                  width: 68,
                                  height: 68)),
                          const SizedBox(height: 14),
                          Text(
                              legalStep
                                  ? 'Finish account setup'
                                  : 'Welcome back',
                              textAlign: TextAlign.center,
                              style: Theme.of(context)
                                  .textTheme
                                  .headlineSmall
                                  ?.copyWith(
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: -0.5)),
                          const SizedBox(height: 8),
                          Text(
                              legalStep
                                  ? 'Confirm your age and accept the current Testagram policies.'
                                  : 'Sign in to your Testagram account.',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.bodyMedium),
                          const SizedBox(height: 24),
                          if (recoveryStep) ...[
                            TextFormField(
                              controller: _newPassword,
                              obscureText: _obscurePassword,
                              decoration: const InputDecoration(
                                  labelText: 'New password',
                                  prefixIcon: Icon(Icons.lock_reset_rounded)),
                              validator: (value) =>
                                  value == null || value.length < 8
                                      ? 'Use at least 8 characters.'
                                      : null,
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: _confirmPassword,
                              obscureText: _obscurePassword,
                              decoration: const InputDecoration(
                                  labelText: 'Confirm new password',
                                  prefixIcon: Icon(Icons.lock_outline_rounded)),
                              validator: (value) => value != _newPassword.text
                                  ? 'The passwords do not match.'
                                  : null,
                            ),
                            const SizedBox(height: 14),
                            FilledButton(
                                onPressed: _busy ? null : _updatePassword,
                                child: Text(
                                    _busy ? 'Updating…' : 'Update password')),
                            TextButton(
                                onPressed: _busy ? null : _resetPassword,
                                child:
                                    const Text('Send another recovery email')),
                          ] else if (!legalStep) ...[
                            TextFormField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              autofillHints: const [
                                AutofillHints.username,
                                AutofillHints.email
                              ],
                              decoration: const InputDecoration(
                                  labelText: 'Email or phone number',
                                  prefixIcon: Icon(Icons.mail_outline_rounded)),
                              validator: (value) {
                                final identifier = value?.trim() ?? '';
                                if (identifier.isEmpty) {
                                  return 'Enter your email or phone number.';
                                }
                                if (identifier.contains('@')) {
                                  return RegExp(r'^\S+@\S+\.\S+$')
                                          .hasMatch(identifier)
                                      ? null
                                      : 'Enter a valid email address.';
                                }
                                try {
                                  _normalizeKenyaPhone(identifier);
                                  return null;
                                } catch (_) {
                                  return 'Enter a valid Kenyan phone number.';
                                }
                              },
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              controller: _password,
                              obscureText: _obscurePassword,
                              autofillHints: const [AutofillHints.password],
                              decoration: InputDecoration(
                                  labelText: 'Password',
                                  prefixIcon:
                                      const Icon(Icons.lock_outline_rounded),
                                  suffixIcon: IconButton(
                                      onPressed: () => setState(() =>
                                          _obscurePassword = !_obscurePassword),
                                      icon: Icon(_obscurePassword
                                          ? Icons.visibility_outlined
                                          : Icons.visibility_off_outlined))),
                              validator: (value) =>
                                  value == null || value.isEmpty
                                      ? 'Enter your password.'
                                      : null,
                              onFieldSubmitted: (_) => _signIn(),
                            ),
                            Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                    onPressed: _busy ? null : _resetPassword,
                                    child: const Text('Forgot password?'))),
                            const SizedBox(height: 8),
                            FilledButton.icon(
                                onPressed: _busy ? null : _signIn,
                                icon: _busy
                                    ? const SizedBox(
                                        width: 18,
                                        height: 18,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2))
                                    : const Icon(Icons.login_rounded),
                                label: Text(_busy ? 'Signing in…' : 'Sign in'),
                                style: FilledButton.styleFrom(
                                    minimumSize: const Size.fromHeight(50))),
                            const SizedBox(height: 12),
                            Text(
                                'New account creation follows Testagram’s verified identity flow. Use the existing website signup process until native signup parity is validated.',
                                textAlign: TextAlign.center,
                                style: Theme.of(context).textTheme.bodySmall),
                            TextButton.icon(
                              onPressed: _busy ? null : _openExistingSignup,
                              icon: const Icon(Icons.open_in_new_rounded),
                              label: const Text('Open existing signup flow'),
                            ),
                          ] else ...[
                            TextFormField(
                                controller: _dob,
                                readOnly: true,
                                onTap: _pickDate,
                                decoration: const InputDecoration(
                                    labelText: 'Date of birth (YYYY-MM-DD)',
                                    prefixIcon:
                                        Icon(Icons.calendar_month_outlined),
                                    suffixIcon:
                                        Icon(Icons.arrow_drop_down_rounded))),
                            const SizedBox(height: 10),
                            CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                value: _acceptTerms,
                                onChanged: (value) => setState(
                                    () => _acceptTerms = value ?? false),
                                title: const Text(
                                    'I accept the Terms of Service.'),
                                controlAffinity:
                                    ListTileControlAffinity.leading),
                            CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                value: _acceptPrivacy,
                                onChanged: (value) => setState(
                                    () => _acceptPrivacy = value ?? false),
                                title:
                                    const Text('I accept the Privacy Policy.'),
                                controlAffinity:
                                    ListTileControlAffinity.leading),
                            CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                value: _acceptContentPolicy,
                                onChanged: (value) => setState(() =>
                                    _acceptContentPolicy = value ?? false),
                                title:
                                    const Text('I accept the Content Policy.'),
                                controlAffinity:
                                    ListTileControlAffinity.leading),
                            FilledButton(
                                onPressed: _busy ? null : _acceptLegal,
                                child: Text(
                                    _busy ? 'Saving…' : 'Accept and continue')),
                            TextButton(
                                onPressed: _busy
                                    ? null
                                    : () async {
                                        await _client.auth.signOut();
                                        if (mounted) {
                                          setState(
                                              () => _pendingLegalUser = null);
                                        }
                                      },
                                child: const Text('Sign out instead')),
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: 14),
                            Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .errorContainer,
                                    borderRadius: BorderRadius.circular(12)),
                                child: Text(_error!,
                                    style: TextStyle(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onErrorContainer))),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
