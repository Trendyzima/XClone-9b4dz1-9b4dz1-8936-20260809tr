import { backendCapabilities } from '@/services/testagramCapabilityClient';

export type TvReply = {
  id: string; channel_id: string; user_id: string; content: string; created_at: string;
  profile?: { username?: string; display_name?: string; avatar_url?: string } | null;
};

export async function getTvReplies(channelId: string, limit = 40): Promise<TvReply[]> {
  if (!channelId) return [];
  const result = await backendCapabilities.call<{ items: TvReply[] }>('testagram.tv.replies.list', {
    channel_id: channelId, limit: Math.min(100, Math.max(1, Math.floor(limit))),
  });
  return result.items ?? [];
}

export async function createTvReply(channelId: string, _userId: string, content: string): Promise<TvReply> {
  const clean = content.trim();
  if (!channelId || !clean) throw new Error('Reply is required');
  if (clean.length > 1000) throw new Error('Reply is too long');
  return backendCapabilities.call<TvReply>('testagram.tv.replies.create', { channel_id: channelId, content: clean });
}
