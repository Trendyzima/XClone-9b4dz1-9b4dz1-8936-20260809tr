/// Guardrails shared by the native owner-only staff recruitment workflow.
class StaffRecruitmentPolicy {
  const StaffRecruitmentPolicy._();

  static const reviewStatuses = <String>{'reviewing', 'shortlisted', 'accepted', 'rejected'};

  static bool canInvite(String status) => status == 'accepted';

  static String displayName(Map<String, dynamic> application) {
    final display = '${application['display_name'] ?? ''}'.trim();
    if (display.isNotEmpty) return display;
    final username = '${application['username'] ?? ''}'.trim();
    return username.isNotEmpty ? '@$username' : 'Applicant';
  }
}
