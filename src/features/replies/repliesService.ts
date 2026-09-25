import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';
import * as federation from '@/api/federation';
import { federatedReplyToItem, resolveFederatedReplies } from '@/features/federation/federatedPostAdapter';

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
  if (/^https:\/\//i.test(postId)) {
    const [remoteResult, ledgerResult] = await Promise.allSettled([
      federation.getFederatedObject(postId),
      federation.getFederatedReplies(postId),
    ]);
    const remote = remoteResult.status === 'fulfilled' ? remoteResult.value : null;
    const object = remote?.object ?? remote;
    const rawReplies = object?.replies
      ? await resolveFederatedReplies(object.replies, federation.getFederatedObject)
      : [];
    const remoteItems = rawReplies
      .filter((reply: any) => reply?.id)
      .slice(0, boundedLimit(limit))
      .map((reply: any) => federatedReplyToItem(reply, postId)) as ReplyItem[];
    const ledgerRows = ledgerResult.status === 'fulfilled' ? ledgerResult.value : [];
    const ledgerItems = ledgerRows.map((row: any) => ({
      id: String(row.activity_uri || row.id),
      user_id: String(row.user_id || ''),
      post_id: postId,
      content: String(row.content || ''),
      created_at: String(row.created_at || new Date().toISOString()),
      updated_at: String(row.updated_at || row.created_at || new Date().toISOString()),
      parent_reply_id: null,
      profile: row.profile ?? null,
      remote: true,
      delivery_state: row.delivery_state,
    })) as ReplyItem[];
    const merged = new Map<string, ReplyItem>();
    for (const item of [...remoteItems, ...ledgerItems]) {
      if (item.id) merged.set(item.id, item);
    }
    const items = [...merged.values()]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, boundedLimit(limit));
    return { items, next_cursor: null };
  }
  // Keep the reply read path compatible with both authenticated capability reads
  // and public/RLS reads. The capability response is the canonical source for
  // identity (display name + avatar); the direct query preserves parent_reply_id
  // and remains the fallback for guests or transient gateway failures.
  let capabilityItems: any[] = [];
  try {
    const capabilityPage = await backendCapabilities.listReplies(postId, boundedLimit(limit));
    capabilityItems = capabilityPage?.items ?? [];
  } catch (error) {
    console.warn('[replies] capability identity enrichment unavailable', error);
  }

  const { data, error } = await supabase
    .from('replies')
    .select('id,user_id,post_id,parent_reply_id,content,created_at,updated_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(boundedLimit(limit));

  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return { items: [], next_cursor: null };

  const capabilityById = new Map(
    capabilityItems.map((item: any) => [String(item.id), item.profile ?? null]),
  );

  const ids = [...new Set(rows.map((row: any) => row.user_id).filter(Boolean))];
  let profiles: any[] = [];
  if (ids.length) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id,username,display_name,avatar_url,cover_url,bio,website_url,location,verified_tier,follower_count,following_count,posts_count,account_type,visibility,creator_tier,is_creator,created_at')
      .in('id', ids);
    if (profileError) console.warn('[replies] profile enrichment failed', profileError);
    profiles = profileRows ?? [];
  }

  const byId = new Map(profiles.map((profile: any) => [profile.id, profile]));
  return {
    items: rows.map((row: any) => {
      const capabilityProfile = capabilityById.get(String(row.id));
      const profile = capabilityProfile ?? byId.get(row.user_id) ?? null;
      return {
        ...row,
        profile: profile ? {
          ...profile,
          username: String(profile.username ?? profile.preferredUsername ?? profile.acct ?? '').replace(/^@/, ''),
          display_name: profile.display_name ?? profile.full_name ?? profile.name ?? profile.username ?? null,
        } : null,
      };
    }),
    next_cursor: null,
  };
}
export async function createReply(postId: string, content: string, parentReplyId?: string) {
  if (/^https:\/\//i.test(postId)) {
    return federation.reply({ postId, content, parentReplyId });
  }
  return backendCapabilities.createReply(postId, content, parentReplyId);
}

export async function getReplyChain(replyId: string, limit = 100): Promise<ReplyItem[]> {
  if (!replyId) return [];
  const { data, error } = await supabase.rpc('testagram_reply_chain', {
    p_reply_id: replyId,
    p_limit: Math.min(500, Math.max(1, Math.floor(limit))),
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return [];

  const userIds = [...new Set(rows.map((row: any) => row.user_id).filter(Boolean))];
  let profiles: any[] = [];
  if (userIds.length) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id,username,display_name,avatar_url,cover_url,bio,website_url,location,verified_tier,follower_count,following_count,posts_count,account_type,visibility,creator_tier,is_creator,created_at')
      .in('id', userIds);
    if (profileError) console.warn('[replies] chain profile enrichment failed', profileError);
    profiles = profileRows ?? [];
  }
  const byId = new Map(profiles.map((profile: any) => [profile.id, profile]));
  return rows.map((row: any) => {
    const profile = byId.get(row.user_id) ?? null;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      post_id: String(row.post_id),
      parent_reply_id: row.parent_reply_id ?? null,
      content: String(row.content ?? ''),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at ?? row.created_at),
      profile: profile ? {
        ...profile,
        username: String(profile.username ?? '').replace(/^@/, ''),
        display_name: profile.display_name ?? profile.full_name ?? profile.username ?? null,
      } : null,
    };
  });
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
      .select('id,username,display_name,avatar_url,verified')
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
    const { data: profileData, error: profileError } = await supabase.from('profiles').select('id,username,display_name,avatar_url,bio,location,created_at').in('id', profileIds);
    if (profileError) console.warn('[replies] profile enrichment failed', profileError); else profiles = profileData ?? [];
  }
  const profileById = new Map(profiles.map((profile: any) => [profile.id, profile]));
  const postById = new Map(posts.map((post: any) => { const authorId = post.author_id ?? post.user_id; return [post.id, {...post, author_id: authorId, profiles: profileById.get(authorId) ?? null}]; }));
  return { items: pageRows.map((row: any) => ({...row, profile: profileById.get(row.user_id) ?? null, posts: postById.get(row.post_id) ?? null})), next_cursor: hasMore ? pageRows[pageRows.length - 1].created_at : null } as ProfileRepliesPage;
}
