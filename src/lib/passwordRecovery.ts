const STORAGE_KEY = 'testagram-password-recovery';
const RECOVERY_MARKER_MAX_AGE_MS = 30 * 60 * 1000;

type RecoveryMarker = { userId: string; issuedAt: number };

/**
 * A persisted Supabase session alone is not proof that the current visit came
 * from a password-reset link. Only call this after Supabase emits
 * PASSWORD_RECOVERY or verifyOtp({ type: 'recovery' }) succeeds.
 */
export function markPasswordRecoverySession(userId: string) {
  if (!userId || typeof window === 'undefined') return;
  try {
    const marker: RecoveryMarker = { userId, issuedAt: Date.now() };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // The caller still has the in-memory recovery state for this page visit.
  }
}

export function getPasswordRecoveryUserId(now = Date.now()): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Deliberately reject legacy user-ID-only markers. They had no trustworthy
    // age and could let an old normal session unlock a later reset URL.
    const marker = JSON.parse(raw) as Partial<RecoveryMarker>;
    if (
      typeof marker.userId !== 'string' ||
      !marker.userId ||
      typeof marker.issuedAt !== 'number' ||
      !Number.isFinite(marker.issuedAt) ||
      marker.issuedAt > now ||
      now - marker.issuedAt >= RECOVERY_MARKER_MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return marker.userId;
  } catch {
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch {}
    return null;
  }
}

export function clearPasswordRecoverySession() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch {}
}
