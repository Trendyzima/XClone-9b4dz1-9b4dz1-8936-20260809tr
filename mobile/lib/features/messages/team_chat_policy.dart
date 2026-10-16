/// Pure access policy shared by Team Chat UI and its unit tests.
class TeamChatPolicy {
  const TeamChatPolicy._();

  /// Owner and regulator access is explicit; everyone else needs an active
  /// employee assignment. Missing or unknown signals never grant access.
  static bool canAccess({
    required bool isOwner,
    required bool isRegulator,
    required bool hasActiveAssignment,
  }) => isOwner || isRegulator || hasActiveAssignment;

  static bool canModerate({required bool isOwner, required bool isRegulator}) =>
      isOwner || isRegulator;

  static String composeMessage(String input) => input.trim();
}
