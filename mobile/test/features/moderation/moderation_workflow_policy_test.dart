import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/moderation/moderation_workflow_policy.dart';

void main() {
  group('ModerationWorkflowPolicy', () {
    test('validates trimmed appeal reasons with server-aligned bounds', () {
      expect(ModerationWorkflowPolicy.validAppealReason(' too short '), isFalse);
      expect(ModerationWorkflowPolicy.validAppealReason(List.filled(20, 'x').join()), isTrue);
      expect(ModerationWorkflowPolicy.validAppealReason(List.filled(800, 'x').join()), isTrue);
      expect(ModerationWorkflowPolicy.validAppealReason(List.filled(801, 'x').join()), isFalse);
    });

    test('prevents duplicate, unauthenticated, and in-flight submissions', () {
      const reason = 'I believe the restriction was applied in error.';
      expect(
        ModerationWorkflowPolicy.canSubmitAppeal(
          authenticated: true,
          submitting: false,
          hasPendingAppeal: false,
          reason: reason,
        ),
        isTrue,
      );
      expect(
        ModerationWorkflowPolicy.canSubmitAppeal(
          authenticated: false,
          submitting: false,
          hasPendingAppeal: false,
          reason: reason,
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canSubmitAppeal(
          authenticated: true,
          submitting: true,
          hasPendingAppeal: false,
          reason: reason,
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canSubmitAppeal(
          authenticated: true,
          submitting: false,
          hasPendingAppeal: true,
          reason: reason,
        ),
        isFalse,
      );
    });

    test('review decisions require owner and pending status', () {
      expect(
        ModerationWorkflowPolicy.canReviewAppeal(
          isOwner: true,
          status: 'pending',
          decision: 'approved',
        ),
        isTrue,
      );
      expect(
        ModerationWorkflowPolicy.canReviewAppeal(
          isOwner: false,
          status: 'pending',
          decision: 'approved',
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canReviewAppeal(
          isOwner: true,
          status: 'approved',
          decision: 'denied',
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canReviewAppeal(
          isOwner: true,
          status: 'pending',
          decision: 'lift_ban',
        ),
        isFalse,
      );
    });

    test('report decisions require owner, open status, and idle row', () {
      expect(
        ModerationWorkflowPolicy.canDecideReport(
          isOwner: true,
          status: 'open',
          decision: 'resolved',
          busy: false,
        ),
        isTrue,
      );
      expect(
        ModerationWorkflowPolicy.canDecideReport(
          isOwner: false,
          status: 'open',
          decision: 'resolved',
          busy: false,
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canDecideReport(
          isOwner: true,
          status: 'resolved',
          decision: 'dismissed',
          busy: false,
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canDecideReport(
          isOwner: true,
          status: 'open',
          decision: 'delete_post',
          busy: false,
        ),
        isFalse,
      );
      expect(
        ModerationWorkflowPolicy.canDecideReport(
          isOwner: true,
          status: 'open',
          decision: 'resolved',
          busy: true,
        ),
        isFalse,
      );
    });

    test('limits audit note length', () {
      expect(ModerationWorkflowPolicy.validAuditNote(List.filled(1000, 'x').join()), isTrue);
      expect(ModerationWorkflowPolicy.validAuditNote(List.filled(1001, 'x').join()), isFalse);
    });
  });
}
