import { supabase } from './supabase';

export const TESTAGRAM_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const STORAGE_KEY = 'testagram-session-start-v2';

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
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, startedAt })); } catch {}
}

function clearStart() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
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
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) {
    clearStart();
    return false;
  }

  const userId = data.session.user.id;
  const existing = readStart();

  if (!existing || existing.userId !== userId) {
    writeStart(userId, Date.now());
    return true;
  }

  if (Date.now() - existing.startedAt >= TESTAGRAM_SESSION_MAX_AGE_MS) {
    clearStart();
    await supabase.auth.signOut();
    return false;
  }

  return true;
}

export function clearTestagramSessionLifetime() {
  clearStart();
}
