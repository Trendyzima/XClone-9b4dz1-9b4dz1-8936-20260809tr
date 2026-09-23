import { backendCapabilities } from '@/services/backendClient';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';

export type Post = {
  id: string;
  content: string;
  created_at: string;
  author: any;
  origin: 'local' | 'federated';
  federation_id?: string;
  visibility?: string;
  [k: string]: any;
};

function normalizeLocal(row: any): Post {
  return {
    id: `local:${row.id}`,
    content: row.content,
    created_at: row.created_at,
    author: row.author,
    origin: 'local',
    ...row,
  };
}

function normalizeFederated(item: any): Post {
  return {
    id: `fed:${item.id ?? item.federation_id}`,
    content: item.content ?? item.html ?? '',
    created_at: item.created_at ?? item.published ?? new Date().toISOString(),
    author: item.author,
    origin: 'federated',
    federation_id: item.id ?? item.federation_id,
    ...item,
  };
}

export async function getMergedHomeTimeline({ limit = 20, before }: { limit?: number; before?: string } = {}) {
  // Canonical local timeline now comes through the authenticated capability gateway.
  let localRes: any = { items: [] };
  try {
    localRes = await backendCapabilities.listPosts(limit, before);
  } catch (err) {
    console.warn('[feed] failed to fetch native timeline', err);
  }

  let fedRes: any = { posts: [] };
  try {
    fedRes = await federation.getHomeTimeline({ limit, before });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[feed] failed to fetch federated timeline', err);
    fedRes = { posts: [] };
  }

  let localItems = Array.isArray(localRes?.items) ? localRes.items : [];

  // The personalized ranking intentionally excludes self-authored and recently
  // seen posts. That is useful for ranking, but it must never make Home appear
  // empty in a small/new account or when the ranked candidate set is exhausted.
  // Fall back to the canonical public posts read path before rendering an empty
  // Home timeline.
  if (localItems.length === 0) {
    try {
      const { data, error } = await supabase.from('posts')
        .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .is('community_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error) localItems = data ?? [];
    } catch (err) {
      console.warn('[feed] chronological fallback failed', err);
    }
  }

  const localPosts = localItems.map(normalizeLocal);
  const fedPosts = (fedRes?.posts ?? []).map(normalizeFederated);

  // Merge and dedupe by federation_id or fallback to id
  const map = new Map<string, Post>();
  [...localPosts, ...fedPosts].forEach((p) => {
    const key = p.federation_id ?? p.id;
    if (!map.has(key) || new Date(p.created_at) > new Date(map.get(key)!.created_at)) {
      map.set(key, p);
    }
  });

  const merged = Array.from(map.values()).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  return { posts: merged, next_cursor: undefined };
}
