import { backendCapabilities } from '@/services/backendClient';
import { supabase } from '@/lib/supabase';

export type ReplyItem = {
  id: string;
  user_id: string;
  post_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  profile: any;
};

const boundedLimit = (limit = 50) => Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));

export async function listReplies(postId: string, limit = 50): Promise<{ items: ReplyItem[]; next_cursor: string | null }> {
  // Reads are intentionally direct and RLS-backed so public interaction pages do not
  // depend on the authenticated-only capability. Creation remains capability-gated.
  const { data, error } = await supabase
    .from('replies')
    .select('id,user_id,post_id,content,created_at,updated_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(boundedLimit(limit));

  if (error) throw error;

  const rows = data ?? [];
  const ids = [...new Set(rows.map((row: any) => row.user_id).filter(Boolean))];
  if (!ids.length) return { items: [], next_cursor: null };

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,username,display_name,full_name,avatar_url,verified')
    .in('id', ids);

  if (profileError) throw profileError;

  const byId = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  return {
    items: rows.map((row: any) => ({ ...row, profile: byId.get(row.user_id) ?? null })),
    next_cursor: null,
  };
}

export async function createReply(postId: string, content: string) {
  return backendCapabilities.createReply(postId, content);
}

export async function listProfileReplies(userId: string, limit = 50): Promise<ReplyItem[]> {
  const { data, error } = await supabase
    .from('replies')
    .select('id,user_id,post_id,content,created_at,updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(boundedLimit(limit));

  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  // Keep this read independent of PostgREST relationship metadata. The profile
  // replies page should not fail merely because a generated/aliased FK relation
  // is unavailable or has been renamed in the database schema.
  const postIds = [...new Set(rows.map((row: any) => row.post_id).filter(Boolean))];
  const { data: posts, error: postsError } = postIds.length
    ? await supabase
        .from('posts')
        .select('id,content,author_id,created_at')
        .in('id', postIds)
    : { data: [], error: null };

  if (postsError) throw postsError;

  const authorIds = [...new Set((posts ?? []).map((post: any) => post.author_id).filter(Boolean))];
  const { data: profiles, error: profilesError } = authorIds.length
    ? await supabase
        .from('profiles')
        .select('id,username,full_name,avatar_url,verified')
        .in('id', authorIds)
    : { data: [], error: null };

  if (profilesError) throw profilesError;

  const profileById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  const postById = new Map((posts ?? []).map((post: any) => [
    post.id,
    { ...post, profiles: profileById.get(post.author_id) ?? null },
  ]));

  return rows.map((row: any) => ({
    ...row,
    posts: postById.get(row.post_id) ?? null,
    profile: profileById.get(row.user_id) ?? null,
  })) as ReplyItem[];
}
