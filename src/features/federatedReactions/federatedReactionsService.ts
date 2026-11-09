import * as federation from '@/api/federation';
const isRemoteObject = (uri: string) => /^https:\/\//i.test(uri);
export async function toggleFederatedEmojiReaction(objectUri: string, emoji: string, active: boolean) {
  if (!isRemoteObject(objectUri)) throw new Error('Federated reaction requires a remote ActivityPub object URI');
  return federation.setReaction(objectUri, emoji, active);
}
export async function getFederatedEmojiReactionState(objectUri: string): Promise<string[]> {
  if (!isRemoteObject(objectUri)) return [];
  const result = await federation.getReactionState(objectUri);
  return Array.isArray(result?.emojis) ? result.emojis.filter((value): value is string => typeof value === 'string') : [];
}
export async function getFederatedEmojiReactionCounts(objectUri: string): Promise<Record<string, number>> {
  if (!isRemoteObject(objectUri)) return {};
  return federation.getReactionCounts(objectUri);
}
