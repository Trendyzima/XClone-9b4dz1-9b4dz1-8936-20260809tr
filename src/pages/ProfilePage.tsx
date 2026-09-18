import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, UserPlus, Clock, UserCheck } from 'lucide-react';
import { backendCapabilities } from '@/services/backendClient';
import { useAuth } from '@/hooks/useAuth';

type Profile = {
  id: string; username: string; display_name: string | null; avatar_url: string | null;
  bio: string | null; verified_tier: string | null; follower_count: number | null;
  following_count: number | null; protected_account: boolean; created_at: string;
  post_count?: number; is_following?: boolean;
};
type FollowState = 'self' | 'following' | 'requested' | 'none';

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [followState, setFollowState] = useState<FollowState>('none');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!username) return;
      setLoading(true); setError(null);
      try {
        const result = await backendCapabilities.searchUsers(username, 10);
        const match = result.items.find((item: any) => String(item.username ?? '').toLowerCase() === username.toLowerCase());
        if (!match) throw new Error('Profile not found');
        const next = { ...match, follower_count: match.follower_count ?? match.followers_count ?? 0, following_count: match.following_count ?? 0 } as Profile;
        if (cancelled) return;
        setProfile(next);
        if (next?.id === user?.id) setFollowState('self');
        else {
          const follow = await backendCapabilities.getFollowState(String(next.id));
          setFollowState(follow.state?.following ? 'following' : follow.state?.requested ? 'requested' : 'none');
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : 'Profile lookup failed'); setProfile(null); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [username, user?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !profile?.id || user.id === profile.id) return;
      const { state } = await backendCapabilities.getFollowState(profile.id);
      if (cancelled) return;
      if (state?.following) setFollowState('following');
      else if (state?.requested) setFollowState('requested');
    })();
    return () => { cancelled = true; };
  }, [user?.id, profile?.id]);

  async function handleFollow() {
    if (!user || !profile || user.id === profile.id || acting) return;
    setActing(true); setError(null);
    try {
      const result = await backendCapabilities.followUser(profile.id, true);
      setFollowState(result.state?.following ? 'following' : result.state?.requested ? 'requested' : 'none');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow failed');
    }
    setActing(false);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin" /></div>;
  if (!profile) return <div className="p-6 text-sm text-muted-foreground">{error ?? 'Profile not found.'}</div>;

  const requested = followState === 'requested';
  const following = followState === 'following';
  return <section className="min-h-screen">
    <header className="border-b border-border p-5">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 overflow-hidden rounded-full bg-muted shrink-0">
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold truncate">{profile.display_name || profile.username}</h1>
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
          {profile.protected_account && <p className="text-xs text-muted-foreground mt-1">Protected account</p>}
        </div>
        {followState !== 'self' && <button type="button" onClick={() => void handleFollow()}
          disabled={acting || requested || following}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-60">
          {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : following ? <UserCheck className="h-4 w-4" /> : requested ? <Clock className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {following ? 'Following' : requested ? 'Requested' : 'Follow'}
        </button>}
      </div>
      {profile.bio && <p className="mt-4 text-sm whitespace-pre-wrap">{profile.bio}</p>}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex gap-5 text-sm">
        <span><b>{profile.post_count ?? 0}</b> posts</span>
        <span><b>{profile.follower_count ?? 0}</b> followers</span>
        <span><b>{profile.following_count ?? 0}</b> following</span>
      </div>
    </header>
    <div className="p-5 text-sm text-muted-foreground">
      {profile.protected_account && !following && followState !== 'self'
        ? 'Posts from this protected account are visible after your follow request is accepted.'
        : 'Timeline content is served through the canonical post visibility boundary.'}
    </div>
  </section>;
}
