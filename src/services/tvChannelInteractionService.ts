import { backendCapabilities } from '@/services/testagramCapabilityClient';

export const TV_REACTIONS = ['❤️', '🔥', '👏', '😂', '😮', '😢'];
export type TvReactionCounts = { emoji: string; count: number }[];

export async function getTvReactionCounts(channelId: string): Promise<TvReactionCounts> {
  if (!channelId) return [];
  const result = await backendCapabilities.call<{ items: TvReactionCounts }>('testagram.tv.reactions.list', { channel_id: channelId });
  return result.items ?? [];
}

export async function getMyTvReaction(channelId: string, _userId?: string): Promise<string | null> {
  if (!channelId) return null;
  const result = await backendCapabilities.call<{ emoji: string | null }>('testagram.tv.reactions.state', { channel_id: channelId });
  return result.emoji ?? null;
}

export async function setTvReaction(channelId: string, _userId: string, emoji: string, current: string | null): Promise<string | null> {
  if (!channelId) return null;
  const result = await backendCapabilities.call<{ emoji: string | null }>('testagram.tv.reactions.set', {
    channel_id: channelId,
    emoji: current === emoji ? null : emoji,
  });
  return result.emoji ?? null;
}
