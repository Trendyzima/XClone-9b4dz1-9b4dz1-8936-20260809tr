import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/messages/team_chat_policy.dart';

void main() {
  group('TeamChatPolicy.canAccess', () {
    test('grants explicit system owner access', () {
      expect(
        TeamChatPolicy.canAccess(
          isOwner: true,
          isRegulator: false,
          hasActiveAssignment: false,
        ),
        isTrue,
      );
    });

    test('grants explicit regulator access', () {
      expect(
        TeamChatPolicy.canAccess(
          isOwner: false,
          isRegulator: true,
          hasActiveAssignment: false,
        ),
        isTrue,
      );
    });

    test('grants staff access only with an active assignment', () {
      expect(
        TeamChatPolicy.canAccess(
          isOwner: false,
          isRegulator: false,
          hasActiveAssignment: true,
        ),
        isTrue,
      );
      expect(
        TeamChatPolicy.canAccess(
          isOwner: false,
          isRegulator: false,
          hasActiveAssignment: false,
        ),
        isFalse,
      );
    });
  });

  test('only owner or regulator can moderate team messages', () {
    expect(
      TeamChatPolicy.canModerate(isOwner: false, isRegulator: false),
      isFalse,
    );
    expect(
      TeamChatPolicy.canModerate(isOwner: true, isRegulator: false),
      isTrue,
    );
    expect(
      TeamChatPolicy.canModerate(isOwner: false, isRegulator: true),
      isTrue,
    );
  });

  test('message composition trims whitespace and preserves content', () {
    expect(TeamChatPolicy.composeMessage('  ship it  '), 'ship it');
    expect(TeamChatPolicy.composeMessage('  \n '), isEmpty);
    expect(TeamChatPolicy.composeMessage('line 1\nline 2'), 'line 1\nline 2');
  });
}
