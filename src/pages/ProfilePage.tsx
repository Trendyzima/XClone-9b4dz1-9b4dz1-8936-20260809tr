import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BadgeCheck, CalendarDays, Clock, Image as ImageIcon, Loader2, Lock,
  MoreHorizontal, UserCheck, UserPlus, ArrowLeft, BarChart3, Gift, Globe2,
  BookOpen, Mic2, Star, Wallet, Settings2,
} from 'lucide-react';
import { format } from 'date-fns';
import { backendCapabilities } from '@/services/backendClient';
import { useAuth } from '@/hooks/useAuth';
import { PostCard } from '@/components/features/PostCard';
import type { Post } from '@/types/app-types';

type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  verified_tier: string | null;
  verified?: boolean;
  follower_count: number | null;
  following_count: number | null;
  protected_account: boolean;
  created_at: string;
  post_count?: number;
  profile_features?: Record<string, boolean>;
};

type FollowState = 'self' | 'following' | 'requested' | 'none';
type Tab = 'posts' | 'media' | 'replies' | 'likes';

const FEATURE_META: Record<string, { label: string; icon: typeof Star }> = {
  analytics: { label: 'Analytics', icon: BarChart3 },
  monetization: { label: 'Monetization', icon: Wallet },
  podcasts: { label: 'Podcasts', icon: Mic2 },
  series: { label: 'Series', icon: BookOpen },
  achievements: { label: 'Achievements', icon: Star },
  highlights: { label: 'Highlights', icon: ImageIcon },
  'social-links': { label: 'Social links', icon: Globe2 },
  tips: { label: 'Tips', icon: Gift },
};

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followState, setFollowState] = useState<FollowState>('none');
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<Tab>('posts');
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = followState === 'self';
  const following = followState === 'following';
  const requested = followState === 'requested';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!username) return;
      setLoading(true);
      setError(null);
      try {
        const result = await backendCapabilities.searchUsers(username, 10);
        const match = result.items.find((item: any) =>
          String(item.username ?? '').toLowerCase() === username.toLowerCase()
        );
        if (!match) throw new Error('Profile not found');
        const next = {
          ...match,
          follower_count: match.follower_count ?? match.followers_count ?? 0,
          following_count: match.following_count ?? 0,
          profile_features: match.profile_features ?? {},
        } as Profile;
        if (cancelled) return;
        setProfile(next);
        if (next.id === user?.id) setFollowState('self');
        else {
          const state = await backendCapabilities.getFollowState(next.id);
          if (!cancelled) {
            setFollowState(state.state?.following ? 'following' : state.state?.requested ? 'requested' : 'none');
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Profile lookup failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [username, user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.id) return;
      if (profile.protected_account && !isSelf && !following) {
        setPosts([]);
        return;
      }
      setTimelineLoading(true);
      try {
        const result = await backendCapabilities.getProfileTimeline(profile.id, 20);
        if (!cancelled) setPosts((result.items ?? []) as Post[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load profile timeline');
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.protected_account, isSelf, following]);

  async function handleFollow() {
    if (!user || !profile || isSelf || acting) return;
    setActing(true);
    setError(null);
    try {
      const result = await backendCapabilities.followUser(profile.id, true);
      setFollowState(result.state?.following ? 'following' : result.state?.requested ? 'requested' : 'none');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow failed');
    } finally {
      setActing(false);
    }
  }

  const visiblePosts = useMemo(() => {
    if (tab === 'media') return posts.filter(p => Boolean(p.image_url || p.video_url || p.media_count || p.media_urls?.length));
    if (tab === 'replies') return posts.filter((p: any) => Boolean(p.reply_to_post_id || p.reply_to_id));
    if (tab === 'likes') return [];
    return posts;
  }, [posts, tab]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  }
  if (!profile) {
    return <div className="min-h-screen p-6"><button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted"><ArrowLeft className="w-5 h-5" /></button><p className="mt-8 text-sm text-muted-foreground">{error ?? 'Profile not found.'}</p></div>;
  }

  const features = Object.entries(profile.profile_features ?? {}).filter(([key, enabled]) => enabled && FEATURE_META[key]);

  return (
    <section className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="h-14 px-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold truncate">{profile.display_name || profile.username}</h1>
            <p className="text-xs text-muted-foreground">{profile.post_count ?? posts.length} posts</p>
          </div>
        </div>
      </header>

      <div className="relative">
        <div className="h-36 sm:h-44 bg-gradient-to-br from-primary/25 via-muted to-primary/10 border-b border-border" />
        <div className="px-4">
          <div className="flex items-end justify-between -mt-12 sm:-mt-14">
            <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-full border-4 border-background bg-muted overflow-hidden shadow-sm">
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                : <div className="h-full w-full flex items-center justify-center text-2xl font-black">{profile.username.slice(0, 1).toUpperCase()}</div>}
            </div>
            <div className="flex items-center gap-2 pb-2">
              <button aria-label="More profile actions" className="h-9 w-9 rounded-full border border-border bg-background flex items-center justify-center"><MoreHorizontal className="w-4 h-4" /></button>
              {isSelf ? (
                <button onClick={() => navigate('/profile-features')} className="rounded-full border border-border px-4 py-2 text-sm font-bold bg-background inline-flex items-center gap-2"><Settings2 className="w-4 h-4" /> Edit profile</button>
              ) : (
                <button onClick={() => void handleFollow()} disabled={acting || requested || following}
                  className="rounded-full bg-foreground text-background px-5 py-2 text-sm font-bold disabled:opacity-60 inline-flex items-center gap-2">
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : following ? <UserCheck className="h-4 w-4" /> : requested ? <Clock className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  {following ? 'Following' : requested ? 'Requested' : 'Follow'}
                </button>
              )}
            </div>
          </div>

          <div className="pt-3 pb-4">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xl font-black">{profile.display_name || profile.username}</h2>
              {(profile.verified || profile.verified_tier) && <BadgeCheck className="w-5 h-5 text-primary" fill="currentColor" />}
            </div>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
            {profile.protected_account && <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Lock className="w-3 h-3" /> Protected account</div>}
            {profile.bio && <p className="mt-3 text-sm whitespace-pre-wrap leading-5">{profile.bio}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> Joined {format(new Date(profile.created_at), 'MMMM yyyy')}</span>
            </div>
            <div className="mt-4 flex gap-5 text-sm">
              <span><b>{profile.following_count ?? 0}</b> Following</span>
              <span><b>{profile.follower_count ?? 0}</b> Followers</span>
              <span><b>{profile.post_count ?? posts.length}</b> Posts</span>
            </div>
          </div>
        </div>

        {features.length > 0 && (
          <div className="px-4 pb-4 flex gap-2 overflow-x-auto scrollbar-hide">
            {features.map(([key]) => {
              const meta = FEATURE_META[key];
              const Icon = meta.icon;
              return <button key={key} onClick={() => key === 'analytics' ? navigate('/analytics') : key === 'monetization' ? navigate('/monetization') : key === 'podcasts' ? navigate('/podcasts/search') : key === 'series' ? navigate('/series') : undefined}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-muted">
                <Icon className="w-3.5 h-3.5" /> {meta.label}
              </button>;
            })}
          </div>
        )}

        <nav className="grid grid-cols-4 border-y border-border sticky top-14 bg-background/95 backdrop-blur-xl z-10">
          {([
            ['posts', 'Posts'],
            ['replies', 'Replies'],
            ['media', 'Media'],
            ['likes', 'Likes'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`py-4 text-sm font-bold border-b-2 transition-colors ${tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'}`}>{label}</button>
          ))}
        </nav>

        {error && <div className="mx-4 mt-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

        {profile.protected_account && !isSelf && !following ? (
          <div className="p-10 text-center border-b border-border">
            <Lock className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <h3 className="font-bold">This account is protected</h3>
            <p className="text-sm text-muted-foreground mt-1">Follow this account to see its posts.</p>
          </div>
        ) : tab === 'likes' ? (
          <div className="p-10 text-center text-sm text-muted-foreground border-b border-border">Liked posts are private to the account owner.</div>
        ) : timelineLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : visiblePosts.length === 0 ? (
          <div className="p-12 text-center border-b border-border">
            {tab === 'media' ? <ImageIcon className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /> : <div className="text-3xl mb-3">✍️</div>}
            <h3 className="font-bold">{tab === 'media' ? 'No media yet' : 'No posts yet'}</h3>
            <p className="text-sm text-muted-foreground mt-1">When {profile.username} posts, they will appear here.</p>
          </div>
        ) : (
          <div>{visiblePosts.map(post => <PostCard key={post.id} post={post} onUpdate={() => void 0} />)}</div>
        )}
      </div>
    </section>
  );
}
