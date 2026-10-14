import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/admin/staff_recruitment_policy.dart';

void main() {
  test('only accepted candidates can be invited', () {
    expect(StaffRecruitmentPolicy.canInvite('accepted'), isTrue);
    for (final status in [
      'submitted',
      'reviewing',
      'shortlisted',
      'rejected',
      'withdrawn'
    ]) {
      expect(StaffRecruitmentPolicy.canInvite(status), isFalse, reason: status);
    }
  });

  test('display name prefers profile name and safely falls back to username',
      () {
    expect(
        StaffRecruitmentPolicy.displayName(
            {'display_name': 'Amina', 'username': 'amina'}),
        'Amina');
    expect(
        StaffRecruitmentPolicy.displayName(
            {'display_name': '', 'username': 'amina'}),
        '@amina');
    expect(StaffRecruitmentPolicy.displayName({}), 'Applicant');
  });
}
