import { backendCapabilities } from '@/services/backendClient';
import * as federation from '@/api/federation';
import { federatedReplyToItem, normalizeFederatedText, resolveFederatedReplies } from '@/features/federation/federatedPostAdapter';

export type ReplyItem = {
  id: string;
  user_id: string;
  post_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  parent_reply_id?: string | null;
  profile: any;
  posts?: any;
};

export type ProfileRepliesPage = { items: ReplyItem[]; next_cursor: string | null };
const boundedLimit = (limit = 50) => Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));

/** All local reply reads go through the authenticated Backend API. */
export async function listReplies(postId: string, limit = 50): Promise<{ items: ReplyItem[]; next_cursor: string | null }> {
  if (/^https:\/\//i.test(postId)) {
    const remote = await resolveFederatedReplies(postId, boundedLimit(limit));
    return { items: remote.map((item: any) => federatedReplyToItem(item, postId)), next_cursor: null };
  }
  const page = await backendCapabilities.call<{ items: ReplyItem[]; next_cursor?: string | null }>(
    'testagram.replies.list',
    { post_id: postId, limit: boundedLimit(limit) },
  );
  return { items: Array.isArray(page.items) ? page.items : [], next_cursor: page.next_cursor ?? null };
}

export async function createReply(postId: string, content: string, parentReplyId?: string) {
  if (/^https:\/\//i.test(postId)) return federation.reply({ postId, content, parentReplyId });
  return backendCapabilities.createReply(postId, normalizeFederatedText(content), parentReplyId);
}

export async function getReplyChain(replyId: string, limit = 100): Promise<ReplyItem[]> {
  if (!replyId) return [];
  const result = await backendCapabilities.call<{ items: ReplyItem[] }>('testagram.replies.chain', {
    reply_id: replyId,
    limit: Math.min(500, Math.max(1, Math.floor(limit))),
  });
  return Array.isArray(result.items) ? result.items : [];
}

export async function listProfileReplies(userId: string, limit = 50): Promise<ReplyItem[]> {
  const result = await backendCapabilities.call<{ items: ReplyItem[] }>('testagram.profile.replies.list', {
    user_id: userId,
    limit: boundedLimit(limit),
  });
  return Array.isArray(result.items) ? result.items : [];
}

export async function listProfileRepliesPage(userId: string, limit = 20, cursor?: string | null): Promise<ProfileRepliesPage> {
  const result = await backendCapabilities.call<ProfileRepliesPage>('testagram.profile.replies.list', {
    user_id: userId,
    limit: boundedLimit(limit),
    ...(cursor ? { cursor } : {}),
  });
  return { items: Array.isArray(result.items) ? result.items : [], next_cursor: result.next_cursor ?? null };
}
