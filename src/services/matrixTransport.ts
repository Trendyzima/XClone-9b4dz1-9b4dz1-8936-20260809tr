import { supabase } from '@/lib/supabase';

export type MatrixTransportStatus = {
  enabled: boolean;
  provider: 'matrix';
  identity: string | null;
};

export type MatrixTransport = {
  status(): Promise<MatrixTransportStatus>;
  syncConversation(conversationId: string): Promise<{ synced: boolean }>;
};

const bridgeUrl = () => (import.meta.env.VITE_MATRIX_BRIDGE_URL ?? '').replace(/\/$/, '');

async function callBridge<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const url = bridgeUrl();
  if (!url) throw new Error('Matrix transport is not configured');
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('Authentication required');
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message ?? 'Matrix bridge request failed');
  return payload.data as T;
}

export const matrixTransport: MatrixTransport = {
  async status() {
    if (!bridgeUrl()) return { enabled: false, provider: 'matrix', identity: null };
    return callBridge<MatrixTransportStatus>('/status');
  },
  syncConversation: conversationId => callBridge<{ synced: boolean }>('/sync-conversation', { conversation_id: conversationId }),
};
