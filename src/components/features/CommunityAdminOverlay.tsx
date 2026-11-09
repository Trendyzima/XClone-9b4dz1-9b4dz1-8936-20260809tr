/**
 * Community administration is intentionally unavailable until its
 * authorization, membership and media-management endpoints are implemented
 * in Testagram Backend. The browser must not fall back to direct database
 * access for privileged community operations.
 */
export function CommunityAdminOverlay() {
  return null;
}
