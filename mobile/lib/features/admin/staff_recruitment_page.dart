import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'staff_recruitment_policy.dart';

/// Owner-only recruitment console. Every privileged action is enforced again
/// by the corresponding security-definer RPC, including privileged-session checks.
class StaffRecruitmentPage extends StatefulWidget {
  const StaffRecruitmentPage({super.key});

  @override
  State<StaffRecruitmentPage> createState() => _StaffRecruitmentPageState();
}

class _StaffRecruitmentPageState extends State<StaffRecruitmentPage> {
  final _db = Supabase.instance.client;
  List<Map<String, dynamic>> _applications = const [];
  bool _loading = true;
  bool _owner = false;
  String? _error;
  String? _busyId;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    final user = _db.auth.currentUser;
    if (user == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _owner = false;
          _applications = const [];
          _error = 'Sign in to access staff recruitment.';
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _owner = false;
      _applications = const [];
      _error = null;
    });
    try {
      final ownerResult = await _db.rpc('testagram_is_owner').timeout(const Duration(seconds: 12));
      if (ownerResult != true) {
        if (mounted && generation == _generation) {
          setState(() {
            _owner = false;
            _applications = const [];
            _loading = false;
          });
        }
        return;
      }
      final result = await _db.rpc('testagram_list_job_applications',
          params: {'p_status': null}).timeout(const Duration(seconds: 15));
      final rows = result is List
          ? result.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList()
          : <Map<String, dynamic>>[];
      if (mounted && generation == _generation) {
        setState(() {
          _owner = true;
          _applications = rows;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _error = 'Recruitment records are unavailable. Retry to reconnect.';
        });
      }
    }
  }

  Future<void> _review(Map<String, dynamic> application, String status) async {
    if (!_owner || !StaffRecruitmentPolicy.reviewStatuses.contains(status)) {
      return;
    }
    final id = '${application['id'] ?? ''}';
    if (id.isEmpty || _busyId != null) return;
    setState(() {
      _busyId = id;
      _error = null;
    });
    try {
      await _db.rpc(
        'testagram_review_job_application',
        params: {'p_application_id': id, 'p_status': status, 'p_note': null},
      ).timeout(const Duration(seconds: 15));
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Application moved to $status.')));
      }
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'The application update was rejected. Verify owner access and retry.',
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _invite(Map<String, dynamic> application) async {
    if (!_owner || !StaffRecruitmentPolicy.canInvite('${application['status'] ?? ''}')) {
      return;
    }
    final id = '${application['id'] ?? ''}';
    final userId = '${application['user_id'] ?? ''}';
    final roleName = '${application['role_name'] ?? ''}';
    if (id.isEmpty || userId.isEmpty || roleName.isEmpty || _busyId != null) {
      return;
    }
    setState(() {
      _busyId = id;
      _error = null;
    });
    try {
      await _db.rpc(
        'testagram_invite_admin',
        params: {
          'p_user_id': userId,
          'p_role_name': roleName,
          'p_note': 'Owner-approved invitation following recruitment application $id',
        },
      ).timeout(const Duration(seconds: 15));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${StaffRecruitmentPolicy.displayName(application)} invited.')),
        );
      }
      await _load();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Invitation was rejected. The server may require a fresh privileged owner session.',
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Staff recruitment'),
        actions: [
          IconButton(
            tooltip: 'Refresh applications',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const Icon(Icons.admin_panel_settings_outlined, size: 36),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Owner-controlled recruitment',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Review applications and invite only accepted candidates. Privileges are assigned by the server-side governance RPC.',
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_error != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Text(_error!),
                      TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              ),
            if (!_loading && _error == null && !_owner)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(
                    children: [
                      Icon(Icons.lock_outline, size: 40),
                      SizedBox(height: 10),
                      Text('System owner access required.'),
                      SizedBox(height: 6),
                      Text(
                        'Recruitment data and privileged actions are unavailable to other accounts.',
                      ),
                    ],
                  ),
                ),
              ),
            if (!_loading && _owner && _applications.isEmpty)
              const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: Text('No recruitment applications yet.')),
              ),
            for (final application in _applications)
              Card(
                margin: const EdgeInsets.only(top: 10),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          CircleAvatar(
                            child: Text(
                              StaffRecruitmentPolicy.displayName(application)
                                  .substring(0, 1)
                                  .toUpperCase(),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  StaffRecruitmentPolicy.displayName(application),
                                  style: Theme.of(context).textTheme.titleSmall,
                                ),
                                Text(
                                  '${application['role_name'] ?? 'Role'} · ${application['status'] ?? 'submitted'}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text('${application['statement'] ?? ''}'),
                      const SizedBox(height: 6),
                      Text(
                        'Submitted: ${application['created_at'] ?? 'Date unavailable'}',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final status in StaffRecruitmentPolicy.reviewStatuses)
                            OutlinedButton(
                              onPressed:
                                  _busyId == null ? () => _review(application, status) : null,
                              child: Text(status),
                            ),
                          if (StaffRecruitmentPolicy.canInvite('${application['status'] ?? ''}'))
                            FilledButton.icon(
                              onPressed: _busyId == null ? () => _invite(application) : null,
                              icon: const Icon(Icons.person_add_alt_1),
                              label: const Text('Invite & activate'),
                            ),
                          if (_busyId == '${application['id']}')
                            const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
