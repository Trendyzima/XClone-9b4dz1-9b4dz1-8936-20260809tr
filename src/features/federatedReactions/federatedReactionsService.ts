import { supabase } from '@/lib/supabase';

const isRemoteObject = (objectUri: string) => /^https:\/\//i.test(objectUri);

async function call(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>, params?: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke('testagram-api', {
    body: { path, method, body, params },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function toggleFederatedEmojiReaction(objectUri: string, emoji: string, active: boolean) {
  if (!isRemoteObject(objectUri)) throw new Error('Federated reaction requires a remote ActivityPub object URI');
  return call('/federated/reactions', 'POST', { object_uri: objectUri, emoji, enabled: active });
}

export async function getFederatedEmojiReactionState(objectUri: string): Promise<string[]> {
  if (!isRemoteObject(objectUri)) return [];
  const data = await call('/federated/reactions', 'GET', undefined, { object_uri: objectUri });
  return Array.isArray(data?.emojis) ? data.emojis.filter((x: unknown): x is string => typeof x === 'string') : [];
}

export async function getFederatedEmojiReactionCounts(objectUri: string): Promise<Record<string, number>> {
  if (!isRemoteObject(objectUri)) return {};
  const data = await call('/federated-reaction-counts', 'GET', undefined, { object_uri: objectUri });
  return data?.counts && typeof data.counts === 'object' ? data.counts as Record<string, number> : {};
}
