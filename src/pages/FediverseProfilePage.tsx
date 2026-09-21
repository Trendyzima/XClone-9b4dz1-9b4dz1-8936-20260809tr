import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, UserPlus, UserMinus, Loader2, Users, Rss } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import { supabase } from '@/lib/supabase';

export default function FediverseProfilePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const actorUrl = params.get('actor') ?? '';
  const suppliedHandle = params.get('handle') ?? '';
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followState, setFollowState] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const handle = useMemo(() => {
    if (suppliedHandle) return suppliedHandle.replace(/^@/, '');
    try {
      const u = new URL(actorUrl);
      const name = u.pathname.split('/').filter(Boolean).pop() ?? '';
      return name ? name + '@' + u.hostname : '';
    } catch { return ''; }
  }, [actorUrl, suppliedHandle]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!actorUrl && !handle) { setLoading(false); return; }
      setLoading(true);
      try {
        const result = handle ? await federation.getUser(handle) : null;
        if (cancelled) return;
        setProfile(result);

        const resolvedActorUri = actorUrl || result?.url || '';
        if (user && resolvedActorUri) {
          // federation-transport persists remote follows in the canonical
          // federated_follow_relationships table. Read that same source on every
          // profile visit so Following survives navigation/reload.
          const { data: relationship, error: relationshipError } = await supabase
            .from('federated_follow_relationships')
            .select('state, remote_actor_uri')
            .eq('local_user_id', user.id)
            .eq('remote_actor_uri', resolvedActorUri)
            .maybeSingle();
          if (!cancelled) {
            if (!relationshipError && relationship) {
              const state = relationship.state ?? null;
              setFollowState(state);
              setFollowing(state === 'pending' || state === 'accepted' || state === 'active');
            } else {
              // Backward compatibility for relationships created by older builds.
              const { data: legacy } = await supabase
                .from('federated_relationships')
                .select('state')
                .eq('local_user_id', user.id)
                .eq('remote_actor_uri', resolvedActorUri)
                .eq('relationship', 'following')
                .maybeSingle();
              const state = legacy?.state ?? null;
              setFollowState(state);
              setFollowing(state === 'pending' || state === 'accepted' || state === 'active');
            }
          }
        }

        if (resolvedActorUri) {
          const { data } = await supabase
            .from('federated_objects')
            .select('*')
            .eq('actor_uri', resolvedActorUri)
            .is('deleted_at', null)
            .order('published_at', { ascending: false })
            .limit(20);
          if (!cancelled) setPosts(data ?? []);
        }
      } catch {
        if (!cancelled) toast.error('Could not load this Fediverse profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [actorUrl, handle, user]);

  const doFollow = async () => {
    if (!user) { navigate('/auth'); return; }
    const target = actorUrl || profile?.url;
    if (!target || working) return;

    // Local-first: the UI and personalized feed react immediately. The
    // ActivityPub delivery continues in the background and failures roll back.
    const previousFollowing = following;
    const previousState = followState;
    setFollowing(true);
    setFollowState('active');
    setWorking(true);
    toast.success('Following — this account will appear first in your Fediverse feed');

    try {
      const result = await federation.follow(target);
      const remoteState = result?.state;
      setFollowState(remoteState === 'pending' ? 'active' : (remoteState ?? 'active'));
    } catch (error: any) {
      setFollowing(previousFollowing);
      setFollowState(previousState);
      toast.error(error?.message ?? 'Could not complete the follow. Your follow was not saved.');
    } finally {
      setWorking(false);
    }
  };

  const doUnfollow = async () => {
    const target = actorUrl || profile?.url;
    if (!target || working) return;

    // Local-first: remove it from the personalized feed immediately. If the
    // remote Undo fails, restore the previous local state.
    const previousFollowing = following;
    const previousState = followState;
    setFollowing(false);
    setFollowState(null);
    setWorking(true);
    toast.success('Unfollowed — this account was removed from your personalized Fediverse feed');

    try {
      await federation.unfollow(target);
    } catch (error: any) {
      setFollowing(previousFollowing);
      setFollowState(previousState);
      toast.error(error?.message ?? 'Could not complete the unfollow. Your follow was restored.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto h-full px-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold">Fediverse profile</h1>
            <p className="text-[11px] text-muted-foreground">Viewed inside Testagram</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto pb-12">
        {loading ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : !profile ? (
          <div className="py-20 px-5 text-center">
            <Globe className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="font-bold">Profile not found</h2>
            <p className="text-sm text-muted-foreground mt-1">Testagram could not resolve this remote actor.</p>
          </div>
        ) : (
          <>
            <section className="border-b border-border">
              <div className="h-32 bg-gradient-to-br from-purple-500/20 via-primary/10 to-background" />
              <div className="px-4 pb-5">
                <div className="flex items-end justify-between -mt-10">
                  <img
                    src={profile.icon?.url || profile.avatar || profile.avatar_url}
                    alt={profile.name || profile.preferredUsername || profile.username || 'Fediverse profile'}
                    className="w-20 h-20 rounded-full object-cover bg-muted border-4 border-background"
                  />
                  <button
                    onClick={following ? doUnfollow : doFollow}
                    disabled={working}
                    className="px-4 py-2 rounded-full bg-foreground text-background font-bold text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {working ? <Loader2 className="w-4 h-4 animate-spin" /> : following ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                    {following ? 'Following' : 'Follow'}
                  </button>
                </div>
                <h2 className="mt-3 text-xl font-black">{profile.name || profile.display_name || profile.preferredUsername || profile.username}</h2>
                <p className="text-sm text-muted-foreground">@{profile.preferredUsername || profile.username}{profile.url ? (() => { try { return '@' + new URL(profile.url).hostname; } catch { return ''; } })() : ''}</p>
                {profile.summary && <div className="mt-3 text-sm leading-6" dangerouslySetInnerHTML={{ __html: profile.summary }} />}
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="w-4 h-4" />{profile.followers ?? 0} followers</span>
                  <span className="flex items-center gap-1"><Globe className="w-4 h-4" />Remote account</span>
                </div>
                {following && (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    This account is followed in Testagram. Its posts are prioritized in your personalized Fediverse feed.
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="px-4 py-4 border-b border-border flex items-center gap-2 font-bold"><Rss className="w-4 h-4" />Posts on Testagram</div>
              {posts.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No cached posts from this account yet.</div>
              ) : (
                <div className="divide-y divide-border">
                  {posts.map((post: any) => (
                    <article key={post.id ?? post.uri} className="p-4">
                      <div className="text-sm leading-6" dangerouslySetInnerHTML={{ __html: post.content ?? '' }} />
                      <p className="mt-2 text-xs text-muted-foreground">{post.published_at ? new Date(post.published_at).toLocaleString() : ''}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
