import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, TrendingUp, Users, CheckCircle2, RefreshCw, Search, Globe2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';
import * as federation from '@/api/federation';
import { TopBar } from '@/components/layout/TopBar';

interface SuggestedUser {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  follower_count: number;
  verified: boolean;
  score?: number;
  reason?: string;
  origin?: 'local' | 'fediverse';
  actor_uri?: string | null;
  acct?: string | null;
  domain?: string | null;
}

type Tab = 'suggested' | 'popular' | 'fediverse';

const REASON_LABELS: Record<string, string> = {
  mutual_follows: 'Mutual connection',
  similar_interests: 'Similar interests',
  popular: 'Popular creator',
  location: 'Near you',
  trending: 'Trending',
  active: 'Very active',
};

function DiscoverAdBanner() { return <PageAdBanner />; }

export default function DiscoverPage({ section, standalone = false }: { section?: Tab; standalone?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(section ?? 'suggested');
  const [users, setUsers] = useState<SuggestedUser[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => { if (section) setTab(section); }, [section]);

  const discoverJsonLd = useMemo(() => {
    const top5 = users.slice(0, 5);
    if (top5.length === 0) return undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Suggested Creators on Testagram',
      description: 'Discover top creators to follow on Testagram',
      numberOfItems: top5.length,
      itemListElement: top5.map((u, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Person',
          name: u.username,
          url: `https://testagram.site/profile/${u.username}`,
          image: u.avatar_url || undefined,
          interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/FollowAction',
            userInteractionCount: u.follower_count ?? 0,
          },
        },
      })),
    };
  }, [users]);

  useSEO({
    title: 'Discover Creators — Testagram',
    description: 'Find and follow top creators, trending accounts, and communities on Testagram. Explore verified users, rising stars, and content you love.',
    url: '/discover',
    type: 'website',
    keywords: 'discover creators, follow users, trending accounts, testagram, find people',
    structuredData: discoverJsonLd,
  });

  const loadFollowing = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
    if (data) setFollowing(new Set(data.map((f) => f.following_id)));
  }, [user]);

  const loadPopular = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, bio, follower_count, verified')
      .order('follower_count', { ascending: false })
      .neq('id', user?.id ?? '')
      .limit(25);
    if (data) setUsers(data);
    setLoading(false);
  }, [user]);

  const loadFediverse = useCallback(async () => {
    setLoading(true);
    try {
      // Discovery must read the actual federated_actors contract. This table
      // stores actor_uri/username/domain/display_name/bio/avatar_url; it does
      // not use the old Mastodon serializer fields (uri/preferred_username).
      const { data, error } = await supabase
        .from('federated_actors')
        .select('id, actor_uri, username, domain, display_name, bio, avatar_url, raw_actor, created_at')
        .order('created_at', { ascending: false })
        .limit(40);

      if (error) throw error;

      const merged: SuggestedUser[] = (data ?? []).map((row: any) => ({
        id: 'fed:' + row.actor_uri,
        username: String(row.username ?? row.display_name ?? 'Fediverse user'),
        avatar_url: row.avatar_url ?? row.raw_actor?.icon?.url ?? row.raw_actor?.icon?.href ?? null,
        bio: row.bio ?? row.raw_actor?.summary ?? null,
        follower_count: Number(row.raw_actor?.followersCount ?? row.raw_actor?.followers_count ?? 0),
        verified: Boolean(row.raw_actor?.verified),
        origin: 'fediverse' as const,
        actor_uri: row.actor_uri,
        acct: row.domain ? `${row.username}@${row.domain}` : row.username,
        domain: row.domain,
      }));

      setUsers(merged);
    } catch (error) {
      console.error('[discover] fediverse discovery failed', error);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);
  const loadSuggested = useCallback(async () => {
    if (!user) { await loadPopular(); return; }
    const { data } = await supabase
      .from('user_suggestions')
      .select(`
        score,
        reason,
        suggested_user:user_profiles!user_suggestions_suggested_user_id_fkey(
          id, username, avatar_url, bio, follower_count, verified
        )
      `)
      .eq('user_id', user.id)
      .order('score', { ascending: false })
      .limit(25);

    if (data && data.length > 0) {
      const mapped: SuggestedUser[] = data
        .filter((d) => d.suggested_user)
        .map((d) => ({ ...(d.suggested_user as any), score: d.score, reason: d.reason }));
      setUsers(mapped);
      setLoading(false);
    } else {
      await loadPopular();
    }
  }, [user, loadPopular]);

  useEffect(() => {
    setLoading(true);
    loadFollowing();
    if (tab === 'suggested') loadSuggested();
    else if (tab === 'fediverse') loadFediverse();
    else loadPopular();
  }, [tab, user, loadFollowing, loadSuggested, loadPopular, loadFediverse]);

  const handleFollow = async (targetId: string) => {
    if (!user) { toast.error('Please log in to follow users'); return; }
    setFollowLoading((prev) => new Set(prev).add(targetId));
    const target = users.find((u) => u.id === targetId);
    if (target?.origin === 'fediverse' && target.actor_uri) {
      try {
        if (following.has(targetId)) {
          await federation.unfollow(target.actor_uri);
          setFollowing((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
          toast.success('Unfollowed Fediverse account');
        } else {
          await federation.follow(target.actor_uri);
          setFollowing((prev) => new Set(prev).add(targetId));
          toast.success('Following Fediverse account');
        }
      } catch (error: any) { toast.error(error?.message ?? 'Fediverse follow failed'); }
    } else {
      const isFollowing = following.has(targetId);
      if (isFollowing) {
        const { error } = await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId);
        if (!error) { setFollowing((prev) => { const n = new Set(prev); n.delete(targetId); return n; }); toast.success('Unfollowed'); }
      } else {
        const { error } = await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId });
        if (!error) { setFollowing((prev) => new Set(prev).add(targetId)); toast.success('Following!'); }
      }
    }
    setFollowLoading((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
  };

  const filtered = users.filter((u) =>
    !search || u.username?.toLowerCase().includes(search.toLowerCase()) || u.bio?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen">
      <TopBar title="Discover" />
      <div className="sticky top-[104px] z-10 bg-background/90 backdrop-blur border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">Discover People</h1>
            <p className="text-xs text-muted-foreground">Find new voices to follow</p>
          </div>
          <button onClick={() => { setLoading(true); tab === 'suggested' ? loadSuggested() : tab === 'fediverse' ? loadFediverse() : loadPopular(); loadFollowing(); }} className="p-2 rounded-full hover:bg-muted transition-colors" title="Refresh" aria-label="Refresh suggestions">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input type="text" placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm flex-1 outline-none placeholder:text-muted-foreground" />
        </div>
      </div>

      <div className="flex border-b border-border">
        {([
          { key: 'suggested', icon: Sparkles, label: 'Suggested' },
          { key: 'popular', icon: TrendingUp, label: 'Popular' },
          { key: 'fediverse', icon: Globe2, label: 'Fediverse' },
        ] as const).map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => { setTab(key); navigate(`/discover/${key}`); }} className={cn('flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold border-b-2 transition-colors', tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <DiscoverAdBanner />

      <div className="divide-y divide-border">
        {loading ? (
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-muted flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-3 bg-muted rounded w-2/3" />
                <div className="h-3 bg-muted rounded w-1/4" />
              </div>
              <div className="w-20 h-8 bg-muted rounded-full" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Users className="w-12 h-12 mb-3 opacity-30" />
            <p className="font-medium">{search ? 'No users match your search' : 'No suggestions yet'}</p>
            <p className="text-sm mt-1">{search ? 'Try a different name' : 'Follow more people to get personalized suggestions'}</p>
          </div>
        ) : (
          filtered.map((u) => {
            const isFollowing = following.has(u.id);
            const isProcessing = followLoading.has(u.id);
            const reasonLabel = u.reason ? REASON_LABELS[u.reason] : null;
            const isSelf = u.id === user?.id;
            return (
              <div key={u.id} className="flex items-start gap-3 px-4 py-4 hover:bg-muted/30 transition-colors">
                <Link to={u.origin === 'fediverse' && u.actor_uri ? `/fediverse/profile?actor=${encodeURIComponent(u.actor_uri)}&handle=${encodeURIComponent(u.acct || u.username)}` : `/profile/${u.username}`} className="flex-shrink-0">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center overflow-hidden ring-2 ring-transparent hover:ring-primary/30 transition-all">
                    {u.avatar_url ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" loading="lazy" /> : <span className="text-lg font-bold text-primary">{(u.username ?? 'U')[0].toUpperCase()}</span>}
                  </div>
                </Link>
                <div className="flex-1 min-w-0">
                  <Link to={u.origin === 'fediverse' && u.actor_uri ? `/fediverse/profile?actor=${encodeURIComponent(u.actor_uri)}&handle=${encodeURIComponent(u.acct || u.username)}` : `/profile/${u.username}`} className="block">
                    <div className="flex items-center gap-1">
                      <span className="font-bold hover:underline truncate">{u.username}</span>
                      {u.verified && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
                    </div>
                    {u.bio && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2 leading-snug">{u.bio}</p>}
                  </Link>
                  <div className="flex items-center flex-wrap gap-2 mt-1.5">
                    <span className="text-xs text-muted-foreground">{(u.follower_count ?? 0).toLocaleString()} followers</span>
                    {u.origin === 'fediverse' && <span className="text-xs bg-sky-500/10 text-sky-600 dark:text-sky-400 px-2 py-0.5 rounded-full font-medium">Fediverse</span>}
                    {reasonLabel && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">{reasonLabel}</span>}
                    {typeof u.score === 'number' && u.score > 8 && <span className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">High match</span>}
                  </div>
                </div>
                {!isSelf && (
                  <Button size="sm" variant={isFollowing ? 'outline' : 'default'} onClick={() => handleFollow(u.id)} disabled={isProcessing} className="flex-shrink-0 rounded-full min-w-[80px]">
                    {isProcessing ? '…' : isFollowing ? 'Following' : 'Follow'}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
