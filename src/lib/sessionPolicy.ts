import { supabase } from './supabase';

export const TESTAGRAM_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const STORAGE_KEY = 'testagram-session-started-at-v2';

function readStartedAt(): number | null {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

function writeStartedAt(value: number) {
  try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch {}
}

function clearStartedAt() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function sessionHasExpired(now = Date.now()) {
  const startedAt = readStartedAt();
  return !!startedAt && now - startedAt >= TESTAGRAM_SESSION_MAX_AGE_MS;
}

export function markAuthenticatedSessionStarted(userId?: string) {
  const existing = readStartedAt();
  if (!existing || Date.now() - existing >= TESTAGRAM_SESSION_MAX_AGE_MS) writeStartedAt(Date.now());
}

export async function enforceTestagramSessionLifetime() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) {
    clearStartedAt();
    return false;
  }

  const startedAt = readStartedAt();
  if (!startedAt) {
    // Existing sessions created before this policy get a fresh two-hour
    // application lifetime when first observed.
    writeStartedAt(Date.now());
    return true;
  }

  if (Date.now() - startedAt >= TESTAGRAM_SESSION_MAX_AGE_MS) {
    clearStartedAt();
    await supabase.auth.signOut();
    return false;
  }

  return true;
}

export function clearTestagramSessionLifetime() {
  clearStartedAt();
}
