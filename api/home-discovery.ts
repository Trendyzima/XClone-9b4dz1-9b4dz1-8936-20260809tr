import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ffrhglgkukgsuhxenena.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': 'https://testagram.site',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Vary': 'Authorization',
};

const json = (body: unknown, status = 200, cache = 'private, max-age=5, stale-while-revalidate=30') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });

async function authenticate(request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+/i.test(authorization) || !SUPABASE_ANON_KEY) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

const profileSelect = 'id,username,display_name,avatar_url,follower_count,verified,verified_tier';

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

export default async function handler(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'GET required' }, 405);

  const started = Date.now();
  try {
    const userId = await authenticate(request);
    if (!userId || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Authentication required' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [followingRes, interestsRes, memberRows] = await Promise.all([
      admin.from('follows').select('following_id').eq('follower_id', userId).limit(300),
      admin.from('user_interests').select('interest_score,hashtags(id,tag)').eq('user_id', userId)
        .order('interest_score', { ascending: false }).limit(50),
      admin.from('community_members').select('community_id').eq('user_id', userId).eq('status', 'active').limit(100),
    ]);

    const followingIds = unique((followingRes.data || []).map((x: any) => x.following_id).filter(Boolean));
    const followedSet = new Set(followingIds);
    const interestTags = unique((interestsRes.data || []).map((x: any) => x.hashtags?.tag).filter(Boolean).map((x: string) => x.toLowerCase()));

    const [
      recGeneration, recRows, userSuggestions, hashtags, communities, polls,
      ads, products, series, trends, federated,
    ] = await Promise.all([
      admin.rpc('generate_content_recommendations', { p_user_id: userId }),
      admin.from('content_recommendations').select('recommended_post_id,score,reason,source')
        .eq('user_id', userId).eq('shown', false).order('score', { ascending: false }).limit(12),
      admin.from('user_suggestions').select('suggested_user_id,score,reason')
        .eq('user_id', userId).order('score', { ascending: false }).limit(8),
      admin.from('hashtags').select('id,tag,usage_count,post_count,follower_count,federated_post_count,last_used_at')
        .order('follower_count', { ascending: false }).limit(20),
      admin.from('communities').select('id,name,display_name,slug,description,avatar_url,icon_url,member_count,post_count,visibility')
        .eq('visibility', 'public').eq('is_private', false).order('member_count', { ascending: false }).limit(20),
      admin.rpc('suggest_polls_for_user', { p_limit: 4 }),
      admin.rpc('get_personalized_ads', { p_user_id: userId, p_limit: 5 }),
      followingIds.length
        ? admin.from('products').select('*, user_profiles:profiles!products_user_id_fkey(id,username,avatar_url,verified_tier)')
            .in('user_id', followingIds.slice(0, 50)).eq('is_active', true).order('created_at', { ascending: false }).limit(8)
        : Promise.resolve({ data: [], error: null }),
      admin.from('post_series').select('*, user_profiles!post_series_user_id_fkey(username,avatar_url,verified)')
        .eq('is_public', true).gt('item_count', 0).order('item_count', { ascending: false }).limit(8),
      admin.from('trending_topics').select('id,topic,category,posts_count,updated_at')
        .order('posts_count', { ascending: false }).limit(8),
      admin.from('federated_objects').select('id,uri,actor_uri,content,summary,published_at,attachments,tags,like_count,announce_count,reply_count,view_count,object_type')
        .is('deleted_at', null).eq('tombstone', false).in('object_type', ['Note','Article','Question','Video','Image'])
        .order('published_at', { ascending: false }).limit(18),
    ]);

    const recIds = unique((recRows.data || []).map((x: any) => x.recommended_post_id).filter(Boolean));
    const recommendationPosts = recIds.length
      ? await admin.from('posts').select('*, user_profiles:profiles!posts_user_id_fkey(' + profileSelect + ')')
          .in('id', recIds).is('community_id', null)
      : { data: [], error: null };
    const recById = new Map((recRows.data || []).map((r: any) => [r.recommended_post_id, r]));
    const recommendedPosts = (recommendationPosts.data || []).map((post: any) => {
      const rec = recById.get(post.id);
      return { ...post, _reason: rec?.reason || 'Recommended for you', _score: rec?.score || 0 };
    }).sort((a: any, b: any) => Number(b._score) - Number(a._score)).slice(0, 10);

    const suggestedIds = unique((userSuggestions.data || []).map((x: any) => x.suggested_user_id)
      .filter((id: string) => id !== userId && !followedSet.has(id)));
    const suggestedProfiles = suggestedIds.length
      ? await admin.from('profiles').select(profileSelect).in('id', suggestedIds)
      : { data: [], error: null };
    const suggestionScore = new Map((userSuggestions.data || []).map((x: any) => [x.suggested_user_id, x]));
    const rankedUsers: any[] = (suggestedProfiles.data || []).map((p: any) => ({
      ...p, _score: Number(suggestionScore.get(p.id)?.score || 0),
      _reason: suggestionScore.get(p.id)?.reason || 'Suggested for you',
    })).sort((a: any, b: any) => b._score - a._score);

    if (rankedUsers.length < 3 && followingIds.length) {
      const secondDegree = await admin.from('follows').select('following_id')
        .in('follower_id', followingIds.slice(0, 50)).limit(100);
      const candidateIds = unique((secondDegree.data || []).map((x: any) => x.following_id)
        .filter((id: string) => id !== userId && !followedSet.has(id)));
      if (candidateIds.length) {
        const fallback = await admin.from('profiles').select(profileSelect).in('id', candidateIds.slice(0, 30))
          .order('follower_count', { ascending: false }).limit(6);
        for (const p of fallback.data || []) {
          if (!rankedUsers.some((x: any) => x.id === p.id))
            rankedUsers.push({ ...p, _score: 0, _reason: 'People followed by your network' });
        }
      }
    }

    const interestWeight = new Map((interestsRes.data || []).map((x: any) => [String(x.hashtags?.id || ''), Number(x.interest_score || 0)]));
    const rankedHashtags = (hashtags.data || []).map((h: any) => {
      const interest = interestWeight.get(h.id) || 0;
      const activity = Math.log1p(Number(h.post_count || 0) + Number(h.federated_post_count || 0));
      const freshness = Math.exp(-Math.max(0, Date.now() - new Date(h.last_used_at || Date.now()).getTime()) / 86400000);
      return { ...h, _score: interest * 8 + activity * 3 + freshness * 4, _reason: interest ? 'Matches your interests' : 'Trending now' };
    }).sort((a: any, b: any) => b._score - a._score).slice(0, 10);

    const joinedCommunities = new Set((memberRows.data || []).map((x: any) => x.community_id));
    const rankedCommunities = (communities.data || []).filter((c: any) => !joinedCommunities.has(c.id))
      .map((c: any) => ({
        ...c,
        _score: Math.log1p(Number(c.member_count || 0)) * 3 + Math.log1p(Number(c.post_count || 0)) * 4,
        _reason: Number(c.post_count || 0) > 0 ? 'Active community' : 'Growing community',
      })).sort((a: any, b: any) => b._score - a._score).slice(0, 8);

    let adRows = ads.data || [];
    if (adRows.length === 0) {
      const fallbackAds = await admin.from('user_ads')
        .select('*, user_profiles!user_ads_user_id_fkey(id,username,avatar_url,verified)')
        .eq('status', 'active').eq('payment_status', 'paid')
        .order('created_at', { ascending: false }).limit(5);
      adRows = fallbackAds.data || [];
    }
    const rankedAds = adRows.map((a: any) => ({ ...a, id: a.ad_id || a.id }));
    const rankedProducts = (products.data || []).filter((p: any) => p.user_id && followedSet.has(p.user_id));
    const rankedFederated = (federated.data || []).map((p: any) => {
      const ageHours = Math.max(0, (Date.now() - new Date(p.published_at || Date.now()).getTime()) / 3600000);
      const engagement = Math.log1p(Number(p.like_count || 0)) * 2 + Math.log1p(Number(p.announce_count || 0)) * 2.5 + Math.log1p(Number(p.reply_count || 0)) * 1.5;
      const text = String(p.content || '').toLowerCase();
      const interest = interestTags.some((tag) => text.includes('#' + tag)) ? 6 : 0;
      return { ...p, _score: Math.exp(-ageHours / 36) * 10 + engagement + interest, _reason: interest ? 'Matches your interests' : 'From the Fediverse' };
    }).sort((a: any, b: any) => Number(b._score) - Number(a._score)).slice(0, 12);

    if (recIds.length) {
      admin.from('content_recommendations').update({ shown: true }).eq('user_id', userId)
        .in('recommended_post_id', recIds).then(() => {});
    }

    return json({
      ok: true, generatedAt: new Date().toISOString(), latencyMs: Date.now() - started,
      recommendations: recommendedPosts, users: rankedUsers.slice(0, 5), hashtags: rankedHashtags,
      communities: rankedCommunities, polls: polls.data || [], ads: rankedAds,
      products: rankedProducts.slice(0, 8), series: series.data || [], trends: trends.data || [],
      fediverse: rankedFederated,
      signals: { followingCount: followingIds.length, interestCount: interestTags.length, interestTags: interestTags.slice(0, 20) },
      errors: { recommendationGeneration: recGeneration.error?.message || null },
    });
  } catch (error) {
    console.error('[home-discovery]', error);
    return json({ error: error instanceof Error ? error.message : 'Discovery failed' }, 500, 'no-store');
  }
}
