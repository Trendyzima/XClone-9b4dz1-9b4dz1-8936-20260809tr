import { appwriteAuth } from '@/services/appwriteAuth';

// Enforce the platform's maximum interactive session age independently of the
// Appwrite session persistence mechanism.
export const TESTAGRAM_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'testagram-session-start-v3';

type StoredStart = { userId: string; startedAt: number };

function readStart(): StoredStart | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredStart;
    return value && typeof value.userId === 'string' && Number.isFinite(value.startedAt) ? value : null;
  } catch { return null; }
}

function writeStart(userId: string, startedAt: number) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, startedAt })); } catch { /* storage may be unavailable */ }
}

function clearStart() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
}

export function sessionHasExpired(now = Date.now()) {
  const start = readStart();
  return !!start && now - start.startedAt >= TESTAGRAM_SESSION_MAX_AGE_MS;
}

export function markAuthenticatedSessionStarted(userId: string) {
  const existing = readStart();
  if (!existing || existing.userId !== userId || Date.now() - existing.startedAt >= TESTAGRAM_SESSION_MAX_AGE_MS) {
    writeStart(userId, Date.now());
  }
}

export async function enforceTestagramSessionLifetime() {
  const user = await appwriteAuth.getCurrentUser();
  if (!user) {
    clearStart();
    return false;
  }
  const existing = readStart();
  if (!existing || existing.userId !== user.$id) {
    writeStart(user.$id, Date.now());
    return true;
  }
  if (Date.now() - existing.startedAt >= TESTAGRAM_SESSION_MAX_AGE_MS) {
    clearStart();
    await appwriteAuth.signOut();
    return false;
  }
  return true;
}

export function clearTestagramSessionLifetime() {
  clearStart();
}
