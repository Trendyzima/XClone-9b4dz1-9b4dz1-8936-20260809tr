import { backendCapabilities } from '@/services/backendClient';
import { supabase } from '@/lib/supabase';

export type ReplyItem = {
  id: string;
  user_id: string;
  post_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  parent_reply_id?: string | null;
  profile: any;
};

const boundedLimit = (limit = 50) => Math.min(100, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 50));

export async function listReplies(postId: string, limit = 50): Promise<{ items: ReplyItem[]; next_cursor: string | null }> {
  // Reads are intentionally direct and RLS-backed so public interaction pages do not
  // depend on the authenticated-only capability. Creation remains capability-gated.
  const { data, error } = await supabase
    .from('replies')
    .select('id,user_id,post_id,parent_reply_id,content,created_at,updated_at')
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

  if (profileError) console.warn('[replies] profile enrichment failed', profileError);

  const byId = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  return {
    items: rows.map((row: any) => {
      const profile = byId.get(row.user_id) as {
        id?: string;
        username?: string | null;
        display_name?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
        verified?: boolean | null;
      } | null;
      return { ...row, profile: profile ? {
        ...profile,
        username: String(profile.username ?? '').replace(/^@/, ''),
        display_name: profile.display_name ?? profile.full_name ?? profile.username ?? null,
      } : null };
    }),
    next_cursor: null,
  };
}

export async function createReply(postId: string, content: string, parentReplyId?: string) {
  return backendCapabilities.createReply(postId, content, parentReplyId);
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
  // The reply rows are the canonical collection. Enrichment is deliberately
  // best-effort: a missing/blocked parent post or profile must not turn a real
  // reply into the generic "Unable to load this section" error.
  let posts: any[] = [];
  if (postIds.length) {
    const { data, error: postsError } = await supabase
      .from('posts')
      .select('id,content,author_id,user_id,created_at')
      .in('id', postIds);
    if (postsError) console.warn('[replies] parent-post enrichment failed', postsError);
    posts = data ?? [];
  }

  const authorIds = [...new Set(posts.map((post: any) => post.author_id ?? post.user_id).filter(Boolean))];
  let profiles: any[] = [];
  if (authorIds.length) {
    const { data, error: profilesError } = await supabase
      .from('profiles')
      .select('id,username,full_name,display_name,avatar_url,verified')
      .in('id', authorIds);
    if (profilesError) console.warn('[replies] parent-author enrichment failed', profilesError);
    profiles = data ?? [];
  }

  const profileById = new Map(profiles.map((profile: any) => [profile.id, profile]));
  const postById = new Map(posts.map((post: any) => {
    const authorId = post.author_id ?? post.user_id;
    return [post.id, { ...post, author_id: authorId, profiles: profileById.get(authorId) ?? null }];
  }));

  return rows.map((row: any) => ({
    ...row,
    posts: postById.get(row.post_id) ?? null,
    profile: profileById.get(row.user_id) ?? null,
  })) as ReplyItem[];
}

export type ProfileRepliesPage = { items: ReplyItem[]; next_cursor: string | null };

export async function listProfileRepliesPage(userId: string, limit = 20, cursor?: string | null): Promise<ProfileRepliesPage> {
  const pageSize = boundedLimit(limit);
  let query = supabase.from('replies').select('id,user_id,post_id,parent_reply_id,content,created_at,updated_at').eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1);
  if (cursor) query = query.lt('created_at', cursor);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const pageRows = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  if (!pageRows.length) return { items: [], next_cursor: null };
  const postIds = [...new Set(pageRows.map((row: any) => row.post_id).filter(Boolean))];
  const authorIds = [...new Set(pageRows.map((row: any) => row.user_id).filter(Boolean))];
  let posts: any[] = [];
  if (postIds.length) {
    const { data: postData, error: postError } = await supabase.from('posts').select('id,content,author_id,user_id,created_at').in('id', postIds);
    if (postError) console.warn('[replies] parent-post enrichment failed', postError); else posts = postData ?? [];
  }
  const parentAuthorIds = posts.map((post: any) => post.author_id ?? post.user_id).filter(Boolean);
  const profileIds = [...new Set([...authorIds, ...parentAuthorIds])];
  let profiles: any[] = [];
  if (profileIds.length) {
    const { data: profileData, error: profileError } = await supabase.from('profiles').select('id,username,display_name,full_name,avatar_url,verified,bio,website,location,created_at').in('id', profileIds);
    if (profileError) console.warn('[replies] profile enrichment failed', profileError); else profiles = profileData ?? [];
  }
  const profileById = new Map(profiles.map((profile: any) => [profile.id, profile]));
  const postById = new Map(posts.map((post: any) => { const authorId = post.author_id ?? post.user_id; return [post.id, {...post, author_id: authorId, profiles: profileById.get(authorId) ?? null}]; }));
  return { items: pageRows.map((row: any) => ({...row, profile: profileById.get(row.user_id) ?? null, posts: postById.get(row.post_id) ?? null})), next_cursor: hasMore ? pageRows[pageRows.length - 1].created_at : null } as ProfileRepliesPage;
}
