import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Native governance console. Privileged operations are enforced by Supabase RPCs.
class GovernancePage extends StatefulWidget {
  const GovernancePage({super.key});

  @override
  State<GovernancePage> createState() => _GovernancePageState();
}

class _GovernancePageState extends State<GovernancePage> {
  static const roles = <String, String>{
    'moderator': 'Moderator',
    'support_admin': 'Support Admin',
    'finance_admin': 'Finance Admin',
    'content_admin': 'Content Admin',
    'trust_safety': 'Trust & Safety',
    'operations_admin': 'Operations Admin',
    'super_admin': 'Super Admin',
    'community_admin': 'Community Admin',
    'security_admin': 'Security Admin',
    'audit_admin': 'Audit Admin',
    'release_ops': 'Release Ops',
  };

  final db = Supabase.instance.client;
  final pin = TextEditingController();
  final query = TextEditingController();
  bool loading = true;
  bool working = false;
  bool owner = false;
  bool admin = false;
  bool unlocked = false;
  bool pinExists = true;
  String selectedRole = 'moderator';
  String? role;
  String? status;
  String? error;
  String? notice;
  List<String> permissions = const [];
  List<Map<String, dynamic>> admins = const [];
  List<Map<String, dynamic>> audit = const [];
  List<Map<String, dynamic>> matches = const [];

  @override
  void initState() {
    super.initState();
    loadGovernance();
  }

  @override
  void dispose() {
    pin.dispose();
    query.dispose();
    super.dispose();
  }

  Future<void> loadGovernance() async {
    if (!mounted) return;
    setState(() {
      loading = true;
      error = null;
    });
    if (db.auth.currentUser == null) {
      setState(() {
        loading = false;
        error = 'Sign in to access governance.';
      });
      return;
    }
    try {
      final response = await Future.wait<dynamic>(
          [db.rpc('testagram_get_governance'), db.rpc('testagram_is_owner')]);
      final data = response[0] is Map
          ? Map<String, dynamic>.from(response[0] as Map)
          : <String, dynamic>{};
      final isOwner = response[1] == true || data['is_owner'] == true;
      if (!mounted) return;
      setState(() {
        owner = isOwner;
        admin = isOwner || data['is_admin'] == true;
        role = isOwner ? 'owner' : data['role']?.toString();
        status = data['status']?.toString();
        permissions = data['permissions'] is List
            ? (data['permissions'] as List).map((v) => '$v').toList()
            : const [];
        loading = false;
      });
      if (!admin) return;
      if (owner) {
        setState(() => unlocked = true);
        await loadData();
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          loading = false;
          error =
              'Could not verify governance authorization. Privileged data remains locked.';
        });
      }
    }
  }

  Future<void> submitPin() async {
    if (!RegExp(r'^\d{4,6}$').hasMatch(pin.text.trim())) {
      setState(() => error = 'PIN must contain 4 to 6 digits.');
      return;
    }
    setState(() {
      working = true;
      error = null;
      notice = null;
    });
    try {
      final result = await db.rpc(
          pinExists
              ? 'testagram_verify_admin_dashboard_pin'
              : 'testagram_set_admin_dashboard_pin',
          params: {'p_pin': pin.text.trim()});
      final data = result is Map
          ? Map<String, dynamic>.from(result)
          : <String, dynamic>{};
      if (data['success'] != true) {
        if (data['code'] == 'PIN_NOT_SET') {
          setState(() => pinExists = false);
        }
        throw StateError('PIN not accepted');
      }
      pin.clear();
      if (mounted) {
        setState(() {
          unlocked = true;
          pinExists = true;
          notice = 'Privileged workspace unlocked.';
        });
      }
      await loadData();
    } catch (_) {
      if (mounted) {
        setState(() => error = pinExists
            ? 'PIN was not accepted. Repeated failures may trigger server-enforced lockout.'
            : 'PIN could not be set. Confirm your administrator appointment.');
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> loadData() async {
    if (!admin || !unlocked) return;
    setState(() {
      working = true;
      error = null;
    });
    try {
      final canAudit = owner || permissions.contains('governance.audit.read');
      final requests = <Future<dynamic>>[db.rpc('testagram_list_admins')];
      if (canAudit) {
        requests.add(
            db.rpc('testagram_governance_audit', params: {'p_limit': 100}));
      }
      final result = await Future.wait<dynamic>(requests);
      if (!mounted) return;
      setState(() {
        admins = (result[0] as List)
            .whereType<Map>()
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        audit = canAudit && result.length > 1
            ? (result[1] as List)
                .whereType<Map>()
                .map((r) => Map<String, dynamic>.from(r))
                .toList()
            : const [];
      });
    } catch (_) {
      if (mounted) {
        setState(() => error =
            'Governance records could not be loaded. Server-side permissions remain authoritative.');
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> searchUsers() async {
    if (!owner || query.text.trim().length < 2) {
      setState(() => matches = const []);
      return;
    }
    setState(() {
      working = true;
      error = null;
    });
    try {
      final result = await db.rpc('testagram_search_governance_users',
          params: {'p_query': query.text.trim(), 'p_limit': 20});
      if (mounted) {
        setState(() => matches = (result as List)
            .whereType<Map>()
            .map((r) => Map<String, dynamic>.from(r))
            .toList());
      }
    } catch (_) {
      if (mounted) {
        setState(() =>
            error = 'Only the system owner can search governance candidates.');
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> appoint(Map<String, dynamic> user) async {
    if (!owner) return;
    setState(() {
      working = true;
      error = null;
      notice = null;
    });
    try {
      await db.rpc('testagram_invite_admin', params: {
        'p_user_id': user['user_id'],
        'p_role_name': selectedRole,
        'p_note': 'Appointed through Flutter governance console'
      });
      if (mounted) {
        setState(() {
          notice =
              'Governance invitation issued to @${user['username'] ?? 'member'}.';
          matches = const [];
          query.clear();
        });
      }
      await loadData();
    } catch (_) {
      if (mounted) {
        setState(() => error =
            'Appointment was not confirmed. The server allows only the system owner to appoint staff.');
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  Future<void> updateAdmin(Map<String, dynamic> item, String nextStatus) async {
    if (!owner) return;
    setState(() {
      working = true;
      error = null;
    });
    try {
      await db.rpc('testagram_update_admin', params: {
        'p_user_id': item['user_id'],
        'p_role_name': item['role_name'],
        'p_status': nextStatus,
        'p_reason': 'Updated in Flutter governance console'
      });
      if (mounted) {
        setState(() => notice = 'Administrator status changed to $nextStatus.');
      }
      await loadData();
    } catch (_) {
      if (mounted) {
        setState(
            () => error = 'Administrator status change was not confirmed.');
      }
    } finally {
      if (mounted) setState(() => working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RefreshIndicator(
        onRefresh: loadGovernance,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Text('Admin & governance',
              style: theme.textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text(
              'Role assignment, privileged access and audit records are verified by server-side governance controls.'),
          const SizedBox(height: 12),
          if (loading) const LinearProgressIndicator(),
          if (error != null)
            Card(
                child: ListTile(
                    leading: const Icon(Icons.error_outline),
                    title: Text(error!),
                    trailing: IconButton(
                        onPressed: loadGovernance,
                        icon: const Icon(Icons.refresh)))),
          if (notice != null)
            Card(
                child: ListTile(
                    leading: const Icon(Icons.check_circle_outline),
                    title: Text(notice!))),
          if (!loading && !admin)
            const Card(
                child: Padding(
                    padding: EdgeInsets.all(20),
                    child: Column(children: [
                      Icon(Icons.lock_outline, size: 40),
                      SizedBox(height: 10),
                      Text('Governance is locked',
                          style: TextStyle(fontWeight: FontWeight.w800)),
                      SizedBox(height: 6),
                      Text(
                          'The system owner must appoint this account before administrative access is activated.')
                    ]))),
          if (!loading && admin && !unlocked) _pinCard(theme),
          if (!loading && admin && unlocked) ...[
            Card(
                child: ListTile(
                    leading: Icon(owner
                        ? Icons.workspace_premium
                        : Icons.admin_panel_settings_outlined),
                    title: Text(owner
                        ? 'Testagram System Owner'
                        : (role ?? 'Administrator')),
                    subtitle: Text(owner
                        ? 'Full governance authority'
                        : 'Assigned role • ${status ?? 'active'}'),
                    trailing: const Icon(Icons.verified_user_outlined))),
            if (owner) _appointmentCard(),
            Row(children: [
              Expanded(
                  child: Text('Administrators',
                      style: theme.textTheme.titleLarge)),
              IconButton(
                  onPressed: working ? null : loadData,
                  icon: const Icon(Icons.refresh))
            ]),
            if (admins.isEmpty)
              const Card(
                  child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('No administrator assignments found.'))),
            for (final item in admins) _adminTile(item),
            if (owner || permissions.contains('governance.audit.read')) ...[
              const SizedBox(height: 12),
              Text('Governance audit trail', style: theme.textTheme.titleLarge),
              if (audit.isEmpty)
                const Card(
                    child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No audit records available.'))),
              for (final item in audit.take(50))
                Card(
                    child: ListTile(
                        leading: const Icon(Icons.history),
                        title: Text('${item['action'] ?? 'Governance action'}'),
                        subtitle: Text(
                            '${item['created_at'] ?? ''} • ${item['actor_username'] ?? 'system'} → ${item['target_username'] ?? '—'}'))),
            ],
          ],
        ]));
  }

  Widget _pinCard(ThemeData theme) => Card(
      child: Padding(
          padding: const EdgeInsets.all(18),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.key_outlined, size: 36),
            const SizedBox(height: 8),
            Text(
                pinExists
                    ? 'Administrator PIN required'
                    : 'Set your administrator PIN',
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            Text(pinExists
                ? 'Enter your 4–6 digit PIN. Repeated failures can trigger a server-enforced lockout.'
                : 'Set a 4–6 digit PIN before opening the privileged workspace.'),
            const SizedBox(height: 12),
            TextField(
                controller: pin,
                obscureText: true,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                    labelText: 'Administrator PIN',
                    border: OutlineInputBorder())),
            SizedBox(
                width: double.infinity,
                child: FilledButton(
                    onPressed: working ? null : submitPin,
                    child: Text(working
                        ? 'Verifying…'
                        : (pinExists ? 'Unlock workspace' : 'Set PIN')))),
          ])));

  Widget _appointmentCard() => Card(
      child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Appoint an administrator',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            const SizedBox(height: 6),
            const Text(
                'Only the system owner can appoint staff. The server enforces roles and audit logging.'),
            const SizedBox(height: 12),
            TextField(
                controller: query,
                decoration: const InputDecoration(
                    labelText: 'Search username or display name',
                    border: OutlineInputBorder()),
                onSubmitted: (_) => searchUsers()),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
                value: selectedRole,
                decoration: const InputDecoration(
                    labelText: 'Governance role', border: OutlineInputBorder()),
                items: roles.entries
                    .map((r) =>
                        DropdownMenuItem(value: r.key, child: Text(r.value)))
                    .toList(),
                onChanged: working
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() => selectedRole = value);
                        }
                      }),
            SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                    onPressed: working ? null : searchUsers,
                    icon: const Icon(Icons.search),
                    label: const Text('Search users'))),
            for (final user in matches)
              ListTile(
                  leading: const Icon(Icons.person_add_alt_1),
                  title: Text('@${user['username'] ?? 'unknown'}'),
                  subtitle: Text('${user['display_name'] ?? ''}'),
                  trailing: IconButton(
                      tooltip: 'Appoint administrator',
                      onPressed: working ? null : () => appoint(user),
                      icon: const Icon(Icons.add_circle_outline))),
          ])));

  Widget _adminTile(Map<String, dynamic> item) {
    final username = '${item['username'] ?? '?'}';
    return Card(
        child: ListTile(
      leading: CircleAvatar(
          child: Text(username.isEmpty ? '?' : username[0].toUpperCase())),
      title: Text('@$username'),
      subtitle: Text(
          '${roles['${item['role_name']}'] ?? item['role_name']} • ${item['status'] ?? 'unknown'}\nAppointed ${item['appointed_at'] ?? '—'}'),
      isThreeLine: true,
      trailing: owner && '${item['status']}' != 'revoked'
          ? PopupMenuButton<String>(
              enabled: !working,
              onSelected: (value) => updateAdmin(item, value),
              itemBuilder: (_) => const [
                    PopupMenuItem(value: 'active', child: Text('Activate')),
                    PopupMenuItem(value: 'suspended', child: Text('Suspend')),
                    PopupMenuItem(value: 'revoked', child: Text('Revoke'))
                  ],
              icon: const Icon(Icons.more_vert))
          : null,
    ));
  }
}
