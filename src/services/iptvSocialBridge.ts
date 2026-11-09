import { appwriteAuth, APPWRITE_AUTH_CHANGED_EVENT } from '@/services/appwriteAuth';

const REQUEST_TYPE = 'testagram:iptv-social:request';
const RESPONSE_TYPE = 'testagram:iptv-social:response';
const API_ORIGIN = (import.meta.env.VITE_TESTAGRAM_API_URL ?? '').trim().replace(/\/+$/, '');
const ALLOWED_ACTIONS = new Set([
  'session_info', 'sign_out',
  'reactions_state', 'reaction_toggle',
  'comments_list', 'comments_count', 'comment_add', 'comment_delete',
  'bookmark_list', 'bookmark_toggle',
  'history_list', 'history_upsert', 'history_delete', 'history_clear', 'notifications',
  'trending', 'report',
]);
const PUBLIC_ACTIONS = new Set(['reactions_state', 'comments_list', 'comments_count', 'trending']);
let installed = false;
let activeRequests = 0;

function respond(target, origin, requestId, ok, data, error) {
  try {
    target.postMessage({ type: RESPONSE_TYPE, requestId, ok, data, error }, origin);
  } catch (postError) {
    console.warn('[IPTV bridge] Could not return response to vendor frame', postError);
  }
}

export function installIptvSocialBridge() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin || event.source === window) return;
    const message = event.data;
    if (!message || message.type !== REQUEST_TYPE || typeof message.requestId !== 'string') return;
    const target = event.source;
    if (!target || typeof target.postMessage !== 'function') return;
    if (activeRequests >= 8) {
      respond(target, event.origin, message.requestId, false, null, 'Too many IPTV requests are in progress.');
      return;
    }
    const action = typeof message.action === 'string' ? message.action : '';
    if (!ALLOWED_ACTIONS.has(action)) {
      respond(target, event.origin, message.requestId, false, null, 'Unsupported IPTV action.');
      return;
    }
    const payload = message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)
      ? message.payload
      : {};
    if (action === 'session_info') {
      try {
        const user = await appwriteAuth.getCurrentUser();
        respond(target, event.origin, message.requestId, true, {
          user: user ? {
            id: user.$id,
            email: user.email,
            username: user.prefs?.username || user.name || user.email.split('@')[0],
            avatar: user.prefs?.avatar_url || undefined,
          } : null,
        }, null);
      } catch (error) {
        respond(target, event.origin, message.requestId, false, null,
          error instanceof Error ? error.message : 'Could not read the Appwrite session.');
      }
      return;
    }
    if (action === 'sign_out') {
      try {
        await appwriteAuth.signOut();
        respond(target, event.origin, message.requestId, true, { signed_out: true }, null);
      } catch (error) {
        respond(target, event.origin, message.requestId, false, null,
          error instanceof Error ? error.message : 'Could not sign out.');
      }
      return;
    }
    if (!API_ORIGIN) {
      respond(target, event.origin, message.requestId, false, null, 'The canonical Backend API URL is not configured.');
      return;
    }
    activeRequests += 1;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      let token = '';
      try {
        token = await appwriteAuth.createBackendJWT();
      } catch {
        if (!PUBLIC_ACTIONS.has(action)) throw new Error('Sign in to use IPTV social features.');
      }
      const response = await fetch(API_ORIGIN + '/api/iptv/social', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Testagram-API-Version': '1',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ action, payload }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok === false) {
        const detail = body?.error?.message || body?.message || 'The Backend could not complete this IPTV action.';
        throw new Error(detail);
      }
      respond(target, event.origin, message.requestId, true, body.data ?? body, null);
    } catch (error) {
      respond(target, event.origin, message.requestId, false, null,
        error instanceof Error ? error.message : 'IPTV social request failed.');
    } finally {
      window.clearTimeout(timeout);
      activeRequests = Math.max(0, activeRequests - 1);
    }
  });
  window.addEventListener(APPWRITE_AUTH_CHANGED_EVENT, () => {
    document.querySelectorAll('iframe').forEach((frame) => {
      try { frame.contentWindow?.postMessage({ type: 'testagram:auth-changed' }, window.location.origin); } catch {}
    });
  });
}
