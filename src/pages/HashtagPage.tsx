import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { PostCard } from '@/components/features/PostCard';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { Post } from '@/types/app-types';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2, TrendingUp, Check, Users, Radio, Headphones,
  BadgeCheck, ChevronRight, Hash, Flame,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';
import { useSEO, buildHashtagLD, buildOgImageUrl } from '@/hooks/useSEO';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function HashtagAdBanner() { return <PageAdBanner />; }

export default function HashtagPage() {
  const { tag } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [federatedPosts, setFederatedPosts] = useState<any[]>([]);
  const [hashtag, setHashtag] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<'recent' | 'top'>('recent');
  const [topPosts, setTopPosts] = useState<Post[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);

  // ── Related suggestions ────────────────────────────────────────────────────
  const [relatedSpaces, setRelatedSpaces] = useState<any[]>([]);
  const [relatedCommunities, setRelatedCommunities] = useState<any[]>([]);

  useSEO({
    title: hashtag
      ? `#${tag} — ${formatNumber(hashtag.usage_count ?? posts.length)} posts on Testagram`
      : tag ? `#${tag} on Testagram` : 'Hashtag',
    description: hashtag
      ? `Browse ${(Number(hashtag.usage_count ?? 0) + Number(hashtag.federated_post_count ?? 0)).toLocaleString()} posts tagged with #${tag} on Testagram. Join the conversation and follow this hashtag to see it in your feed.`
      : `Posts tagged with #${tag} on Testagram.`,
    image: tag ? buildOgImageUrl({ tag }) : undefined,
    url: `/hashtag/${tag}`,
    type: 'website',
    keywords: `${tag}, #${tag}, testagram, trending, social media, hashtag, posts`,
    structuredData: hashtag ? buildHashtagLD(tag ?? '', hashtag.usage_count ?? 0) : undefined,
  });

  useEffect(() => {
    if (tag) {
      fetchHashtagAndPosts();
      if (user) checkFollowStatus();
      fetchRelatedSuggestions(tag);
    }
  }, [tag, user]);

  const fetchRelatedSuggestions = useCallback(async (tagName: string) => {
    // Related live spaces: search title for the hashtag keyword
    const { data: spaces } = await supabase
      .from('spaces')
      .select('id, title, listener_count, category, host:user_profiles!spaces_host_id_fkey(username, avatar_url, verified)')
      .eq('is_live', true)
      .ilike('title', `%${tagName}%`)
      .limit(3);

    if (spaces && spaces.length > 0) {
      setRelatedSpaces(spaces);
    } else {
      // Fallback: popular live spaces
      const { data: popular } = await supabase
        .from('spaces')
        .select('id, title, listener_count, category, host:user_profiles!spaces_host_id_fkey(username, avatar_url, verified)')
        .eq('is_live', true)
        .order('listener_count', { ascending: false })
        .limit(3);
      setRelatedSpaces(popular ?? []);
    }

    // Related communities: search name for the hashtag keyword
    const { data: comms } = await supabase
      .from('communities')
      .select('id, name, display_name, description, icon_url, member_count')
      .or(`name.ilike.%${tagName}%,display_name.ilike.%${tagName}%,description.ilike.%${tagName}%`)
      .order('member_count', { ascending: false })
      .limit(3);

    if (comms && comms.length > 0) {
      setRelatedCommunities(comms);
    } else {
      // Fallback: top communities
      const { data: popular } = await supabase
        .from('communities')
        .select('id, name, display_name, description, icon_url, member_count')
        .order('member_count', { ascending: false })
        .limit(3);
      setRelatedCommunities(popular ?? []);
    }
  }, []);

  const fetchTopPosts = async (hashtagId: string) => {
    const { data } = await supabase
      .from('post_hashtags')
      .select('post_id, posts(*, user_profiles:profiles!posts_user_id_fkey(*))')
      .eq('hashtag_id', hashtagId);
    if (!data) return;
    const allPosts = data.map((item: any) => item.posts).filter(Boolean);
    const sorted = [...allPosts].sort((a, b) => {
      const scoreA = (a.likes_count || 0) + (a.reposts_count || 0) + (a.replies_count || 0);
      const scoreB = (b.likes_count || 0) + (b.reposts_count || 0) + (b.replies_count || 0);
      return scoreB - scoreA;
    });
    setTopPosts(sorted);
  };

  const fetchHashtagAndPosts = async () => {
    try {
      const hashtagResult = await backendCapabilities.searchHashtags(tag ?? '', 1);
      const hashtagData = hashtagResult.items?.find((item: any) =>
        String(item?.tag ?? '').toLowerCase() === String(tag ?? '').toLowerCase()
      );
      if (!hashtagData) throw new Error('HASHTAG_NOT_FOUND');
      setHashtag(hashtagData);

      const { count: fCount } = await supabase.from('hashtag_follows').select('*', { count: 'exact', head: true }).eq('hashtag_id', hashtagData.id);
      setFollowerCount(fCount ?? 0);

      const { data: postsData, error: postsError } = await supabase
        .from('post_hashtags')
        .select('post_id, posts(*, user_profiles:profiles!posts_user_id_fkey(*))')
        .eq('hashtag_id', hashtagData.id)
        .order('created_at', { ascending: false });
      if (postsError) throw postsError;
      const formattedPosts = (postsData || []).map((item: any) => item.posts).filter(Boolean);
      setPosts(formattedPosts);
      // Mix cached ActivityPub objects that advertise the same hashtag. The
      // cache is populated by inbound federation and followed-actor hydration,
      // so the hashtag page can surface remote and local conversations together.
      const normalizedTag = String(tag ?? '').replace(/^#/, '').trim().toLowerCase();
      const { data: remoteMentions } = await supabase
        .from('federated_hashtag_mentions')
        .select('created_at, hashtags!inner(id,tag), federated_objects!inner(id,uri,actor_uri,content,summary,published_at,updated_at,attachments,tags,like_count,announce_count,reply_count,object_type,url,deleted_at,tombstone)')
        .eq('hashtags.tag', normalizedTag)
        .is('federated_objects.deleted_at', null)
        .eq('federated_objects.tombstone', false)
        .order('created_at', { ascending: false })
        .limit(50);
      const remoteRows = (remoteMentions ?? []).map((m: any) => m.federated_objects).filter(Boolean);
      setFederatedPosts((remoteRows ?? []).map((p: any) => ({
        ...p,
        id: p.id ?? p.uri,
        uri: p.uri,
        user_id: p.actor_uri,
        author_id: p.actor_uri,
        created_at: p.published_at ?? p.updated_at,
        content: p.content ?? p.summary ?? '',
        remote_status_uri: p.uri,
        user_profiles: { actor_uri: p.actor_uri, username: p.actor_uri?.split('/').pop() ?? 'unknown', display_name: 'Fediverse account', avatar_url: null },
        is_federated: true,
      })));
      fetchTopPosts(hashtagData.id);
    } catch (error) {
      console.error('Error fetching hashtag data:', error);
      toast.error('Failed to load hashtag');
    } finally {
      setLoading(false);
    }
  };

  const checkFollowStatus = async () => {
    if (!user || !hashtag) return;
    const { data } = await supabase
      .from('hashtag_follows').select('id')
      .eq('user_id', user.id).eq('hashtag_id', hashtag.id).maybeSingle();
    setIsFollowing(!!data);
  };

  const handleFollow = async () => {
    if (!user) { navigate('/auth'); return; }
    if (!hashtag) return;
    setFollowLoading(true);
    if (isFollowing) {
      await supabase.from('hashtag_follows').delete().eq('user_id', user.id).eq('hashtag_id', hashtag.id);
      setIsFollowing(false);
      setFollowerCount(c => Math.max(0, c - 1));
      toast.success(`Unfollowed #${tag}`);
    } else {
      await supabase.from('hashtag_follows').insert({ user_id: user.id, hashtag_id: hashtag.id });
      setIsFollowing(true);
      setFollowerCount(c => c + 1);
      toast.success(`Following #${tag} — posts will appear in your feed`);
    }
    setFollowLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hashtag) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title={`#${tag}`} showBack />
        <HashtagAdBanner />
        <div className="text-center py-12 text-muted-foreground"><p>Hashtag not found</p></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title={`#${tag}`} showBack />
      <HashtagAdBanner />

      {/* Hashtag Header */}
      <div className="border-b border-border p-6 bg-gradient-to-br from-primary/10 to-primary/5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              <TrendingUp className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold">#{tag}</h1>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span><strong className="text-foreground">{formatNumber(Number(hashtag.usage_count ?? 0) + Number(hashtag.federated_post_count ?? 0))}</strong> posts</span>
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                <strong className="text-foreground">{formatNumber(followerCount)}</strong> followers
              </span>
            </div>
          </div>
          {user && (
            <Button onClick={handleFollow} variant={isFollowing ? 'outline' : 'default'} className="rounded-full px-6" disabled={followLoading}>
              {followLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : isFollowing
                  ? <><Check className="w-4 h-4 mr-2" />Following</>
                  : 'Follow'}
            </Button>
          )}
        </div>

        {isFollowing && (
          <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-lg">
            <p className="text-sm text-foreground">✓ You're following this hashtag. Posts with #{tag} will appear in your feed.</p>
          </div>
        )}

        {/* ── Live Spaces related to this hashtag ── */}
        {relatedSpaces.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center gap-2 mb-2.5">
              <Radio className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-bold text-red-500">Live Spaces</span>
              <span className="text-[10px] text-muted-foreground">discussing #{tag}</span>
              <button onClick={() => navigate('/spaces')} className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              {relatedSpaces.map(space => (
                <button key={space.id} onClick={() => navigate('/spaces')}
                  className="flex items-center gap-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition-colors shrink-0 min-w-0 max-w-[200px]">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0">
                    {space.host?.avatar_url
                      ? <img src={space.host.avatar_url} className="w-full h-full object-cover" alt="" />
                      : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{space.host?.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-bold line-clamp-1 leading-tight">{space.title}</p>
                    <div className="flex items-center gap-1 text-[10px] text-red-500 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                      {formatNumber(space.listener_count ?? 0)} live
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Related Communities ── */}
        {relatedCommunities.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex items-center gap-2 mb-2.5">
              <Hash className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-bold text-primary">Communities</span>
              <span className="text-[10px] text-muted-foreground">about #{tag}</span>
              <button onClick={() => navigate('/communities')} className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              {relatedCommunities.map(comm => (
                <button key={comm.id} onClick={() => navigate(`/c/${comm.name}`)}
                  className="flex items-center gap-2.5 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl hover:bg-primary/10 transition-colors shrink-0 min-w-0 max-w-[200px]">
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-primary/10 shrink-0 flex items-center justify-center">
                    {comm.icon_url
                      ? <img src={comm.icon_url} className="w-full h-full object-cover" alt="" />
                      : <span className="text-sm font-bold text-primary">{comm.display_name?.[0]}</span>}
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-bold line-clamp-1 leading-tight">{comm.display_name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatNumber(comm.member_count ?? 0)} members</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sort tabs */}
      <div className="border-b border-border flex">
        <button onClick={() => setSortMode('recent')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${sortMode === 'recent' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'}`}>
          Recent
        </button>
        <button onClick={() => setSortMode('top')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 ${sortMode === 'top' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'}`}>
          <TrendingUp className="w-4 h-4" /> Top Posts
        </button>
      </div>

      {/* Posts */}
      <div>
        {(sortMode === 'recent' ? [...posts, ...federatedPosts] : [...topPosts, ...federatedPosts]).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Flame className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No posts found with this hashtag</p>
          </div>
        ) : (
          (sortMode === 'recent' ? [...posts, ...federatedPosts] : [...topPosts, ...federatedPosts]).sort((a:any,b:any) => new Date(b.created_at ?? b.published_at ?? 0).getTime() - new Date(a.created_at ?? a.published_at ?? 0).getTime()).map((post:any) => (
            <div key={post.id ?? post.uri}>
              <div className="px-4 pt-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${post.is_federated ? 'border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400' : 'border-primary/20 bg-primary/5 text-primary'}`}>{post.is_federated ? 'Fediverse' : 'Testagram'}</span></div>
              <PostCard post={post} onUpdate={fetchHashtagAndPosts} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
