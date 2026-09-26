import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, UserPlus, UserMinus, Loader2, Users, Rss } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import { supabase } from '@/lib/supabase';

type FediverseProfilePageProps = { initialTab?: string; standalone?: boolean };

export default function FediverseProfilePage({ initialTab = 'Posts', standalone = false }: FediverseProfilePageProps) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const actorUrl = params.get('actor') ?? '';
  const suppliedHandle = params.get('handle') ?? '';
  const suppliedUsername = params.get('username') ?? '';
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followState, setFollowState] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);

  const profileTabs = ['Posts', 'Threads', 'Replies', 'Media', 'Videos', 'Podcasts', 'Series', 'Likes', 'Tips', 'Gifts', 'Followers', 'Following', 'Analytics'];
  const mediaPosts = posts.filter((post: any) => Array.isArray(post.attachments) && post.attachments.length > 0);
  const videoPosts = posts.filter((post: any) => post.type === 'Video' || (Array.isArray(post.attachments) && post.attachments.some((a: any) => String(a?.mediaType || a?.media_type || '').startsWith('video/'))));

  const handle = useMemo(() => {
    if (suppliedHandle) return suppliedHandle.replace(/^@/, '');
    if (suppliedUsername) {
      const domain = (() => { try { return new URL(actorUrl).hostname; } catch { return ''; } })();
      return domain ? suppliedUsername.replace(/^@/, '') + '@' + domain : suppliedUsername.replace(/^@/, '');
    }
    try {
      const u = new URL(actorUrl);
      const name = u.pathname.split('/').filter(Boolean).pop() ?? '';
      return name ? name + '@' + u.hostname : '';
    } catch { return ''; }
  }, [actorUrl, suppliedHandle, suppliedUsername]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!actorUrl && !handle && !suppliedUsername) { setLoading(false); return; }
      setLoading(true);
      try {
        let result: any = null;
        if (actorUrl) {
          try {
            result = await federation.resolveRemoteActor(actorUrl);
          } catch {
            // Older ingested posts may still contain the remote web-profile URL.
            // Recover the canonical ActivityPub actor from the cached raw account
            // before giving up, then resolve that canonical actor.
            const { data: cached } = await supabase
              .from('federated_objects')
              .select('actor_uri, raw_object')
              .eq('actor_uri', actorUrl)
              .is('deleted_at', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            const account = cached?.raw_object?.account;
            const canonicalActor = account?.uri || account?.id || cached?.actor_uri || '';
            if (canonicalActor && canonicalActor !== actorUrl) {
              try { result = await federation.resolveRemoteActor(canonicalActor); } catch {}
            }
            if (!result && account) {
              result = {
                ...account,
                actor_uri: canonicalActor || actorUrl,
                actor_url: canonicalActor || actorUrl,
                preferredUsername: account.username,
                username: account.username,
                name: account.display_name || account.username,
                display_name: account.display_name || account.username,
                summary: account.note || '',
                bio: account.note || '',
                avatar_url: account.avatar || null,
                icon: account.avatar ? { url: account.avatar } : null,
                header_url: account.header || null,
                url: account.url || actorUrl,
                followers: account.followers_count || 0,
                following: account.following_count || 0,
                fields: Array.isArray(account.fields) ? account.fields : [],
                cached: true,
              };
            }
          }
        } else {
          result = handle
            ? await federation.getUser(handle)
            : (suppliedUsername ? await federation.getUser(suppliedUsername) : null);
        }
        if (cancelled) return;
        const actorDoc = result?.actor ?? result;
        const normalizedProfile = actorDoc ? {
          ...result,
          actor_uri: actorDoc.id ?? result?.actor_uri ?? result?.actor_url ?? actorUrl,
          actor_url: actorDoc.id ?? result?.actor_url ?? result?.actor_uri ?? actorUrl,
          preferredUsername: actorDoc.preferredUsername ?? result?.preferredUsername ?? result?.username,
          username: actorDoc.preferredUsername ?? result?.username ?? result?.preferredUsername,
          name: actorDoc.name ?? result?.name ?? result?.display_name,
          display_name: actorDoc.name ?? result?.display_name ?? result?.name,
          summary: actorDoc.summary ?? result?.summary ?? result?.bio ?? '',
          bio: actorDoc.summary ?? result?.bio ?? result?.summary ?? '',
          avatar_url: actorDoc.icon?.url ?? result?.avatar_url ?? result?.avatar ?? null,
          icon: actorDoc.icon ?? result?.icon ?? null,
          header_url: actorDoc.image?.url ?? result?.header_url ?? result?.header ?? null,
          url: actorDoc.url ?? result?.url ?? actorDoc.id ?? actorUrl,
          followers: result?.followers ?? actorDoc.followers ?? 0,
          following: result?.following ?? actorDoc.following ?? 0,
          fields: result?.fields ?? [],
        } : null;
        setProfile(normalizedProfile);

        const resolvedActorUri = (result?.actor_uri ?? result?.actor_url ?? result?.actor?.id ?? result?.id ?? actorUrl) || '';
        if (user && resolvedActorUri) {
          // federation-transport persists remote follows in the canonical
          // federated_follow_relationships table. Read that same source on every
          // profile visit so Following survives navigation/reload.
          const { data: relationship, error: relationshipError } = await supabase
            .from('federated_follow_relationships')
            .select('state, delivery_state, remote_actor_uri')
            .eq('local_user_id', user.id)
            .eq('remote_actor_uri', resolvedActorUri)
            .eq('direction', 'following')
            .maybeSingle();
          if (!cancelled) {
            if (!relationshipError && relationship) {
              const state = relationship.state ?? null;
              const confirmed = state === 'active' || (state === 'accepted' && relationship.delivery_state === 'delivered');
              setFollowState(confirmed ? state : null);
              setFollowing(confirmed);
            } else {
              setFollowState(null);
              setFollowing(false);
            }
          }
        }

        if (resolvedActorUri) {
          // Remote ActivityPub outboxes are fetched server-side because browser
          // CORS and HTTP-signature requirements vary across Fediverse servers.
          let remotePosts: any[] = [];
          try {
            const remote = await federation.getRemoteProfile(resolvedActorUri, 80);
            const remoteActor = remote?.actor ?? {};
            const items = Array.isArray(remote?.items) ? remote.items : [];
            remotePosts = items
              .filter((post: any) => post && typeof post === 'object' && post.type !== 'Delete')
              .map((post: any) => ({
                ...post,
                id: post.id ?? post.url,
                uri: post.id ?? post.url,
                url: post.url ?? post.id,
                actor_uri: resolvedActorUri,
                type: post.type ?? 'Note',
                content: post.content ?? post.name ?? '',
                published_at: post.published ?? post.updated ?? null,
                in_reply_to_uri: post.inReplyTo ?? null,
                attachments: Array.isArray(post.attachment) ? post.attachment : [],
                raw_object: post,
              }));
            if (remoteActor && !cancelled) {
              setProfile((current: any) => current ? {
                ...current,
                preferredUsername: remoteActor.preferredUsername ?? current.preferredUsername,
                username: remoteActor.preferredUsername ?? current.username,
                name: remoteActor.name ?? current.name,
                display_name: remoteActor.name ?? current.display_name,
                summary: remoteActor.summary ?? current.summary,
                bio: remoteActor.summary ?? current.bio,
                avatar_url: remoteActor.icon?.url ?? current.avatar_url,
                icon: remoteActor.icon ?? current.icon,
                header_url: remoteActor.image?.url ?? current.header_url,
                url: remoteActor.url ?? current.url,
                followers: remoteActor.followers?.totalItems ?? current.followers ?? 0,
                following: remoteActor.following?.totalItems ?? current.following ?? 0,
              } : current);
            }
          } catch {
            // Fall back to the bounded ingestion cache when the remote server
            // temporarily rejects a signed outbox request.
          }

          if (!remotePosts.length) {
            const { data } = await supabase
              .from('federated_objects')
              .select('*')
              .eq('actor_uri', resolvedActorUri)
              .is('deleted_at', null)
              .order('published_at', { ascending: false })
              .limit(80);
            remotePosts = (data ?? []).map((post: any) => ({
              ...post,
              id: post.uri ?? post.id,
              uri: post.uri ?? post.id,
              url: post.url ?? post.uri,
              type: post.object_type ?? post.raw_object?.type ?? 'Note',
              in_reply_to_uri: post.in_reply_to_uri ?? post.raw_object?.inReplyTo ?? null,
              attachments: Array.isArray(post.attachments) ? post.attachments : [],
              published_at: post.published_at,
            }));
          }
          if (!cancelled) setPosts(remotePosts);
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
    const target = profile?.actor_uri ?? profile?.actor_url ?? profile?.uri ?? actorUrl;
    if (!target || working) return;

    setWorking(true);
    try {
      const result = await federation.follow(target);
      const confirmed = result?.state === 'active' ||
        (result?.state === 'accepted' && result?.deliveryState === 'delivered') ||
        result?.deliveryState === 'delivered';
      if (!confirmed) throw new Error('Follow was not confirmed by federation delivery');
      setFollowing(true);
      setFollowState(result?.state ?? 'active');
      toast.success('Following — remote delivery confirmed');
    } catch (error: any) {
      setFollowing(false);
      setFollowState(null);
      toast.error(error?.message ?? 'Could not complete the follow. Your follow was not saved.');
    } finally {
      setWorking(false);
    }
  };

  const doUnfollow = async () => {
    const target = profile?.actor_uri ?? profile?.actor_url ?? profile?.uri ?? actorUrl;
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
              <div className="h-32 bg-gradient-to-br from-purple-500/20 via-primary/10 to-background overflow-hidden">
                {(profile.header_url || profile.header) && <img src={profile.header_url || profile.header} alt="" className="w-full h-full object-cover" />}
              </div>
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
                {Array.isArray(profile.fields) && profile.fields.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {profile.fields.slice(0, 8).map((field: any, i: number) => (
                      <div key={i} className="grid grid-cols-[auto_1fr] gap-3 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                        <span className="font-semibold">{field.name}</span>
                        <span className="text-muted-foreground break-words" dangerouslySetInnerHTML={{ __html: field.value }} />
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="w-4 h-4" />{profile.followers ?? 0} followers</span>
                  <span className="flex items-center gap-1"><Globe className="w-4 h-4" />Remote account</span>
                  {profile.created_at && <span>Joined {new Date(profile.created_at).toLocaleDateString()}</span>}
                </div>
                {following && (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                    This account is followed in Testagram. Its posts are prioritized in your personalized Fediverse feed.
                  </div>
                )}
              </div>
            </section>

            <section>
              {!standalone && (
              <nav aria-label="Profile sections" className="sticky top-14 z-10 border-b border-border bg-background/95 backdrop-blur-xl overflow-x-auto scrollbar-hide">
                <div className="flex min-w-max">
                  {profileTabs.map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`relative px-4 py-4 text-sm font-semibold transition-colors whitespace-nowrap ${activeTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                      {tab}
                      {activeTab === tab && <span className="absolute inset-x-3 bottom-0 h-1 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
              </nav>
              )}

              {['Posts', 'Threads', 'Replies'].includes(activeTab) && (
                <div className="divide-y divide-border">
                  {activeTab === 'Posts' && posts.length > 0 ? posts.map((post: any) => (
                    <article key={post.id ?? post.uri} className="p-4">
                      <div className="text-sm leading-6" dangerouslySetInnerHTML={{ __html: post.content ?? '' }} />
                      <p className="mt-2 text-xs text-muted-foreground">{post.published_at ? new Date(post.published_at).toLocaleString() : ''}</p>
                    </article>
                  )) : <div className="py-14 px-5 text-center text-sm text-muted-foreground">No {activeTab.toLowerCase()} yet.</div>}
                </div>
              )}

              {activeTab === 'Media' && (mediaPosts.length === 0 ? <div className="py-14 text-center text-sm text-muted-foreground">No media yet</div> : <div className="grid grid-cols-3 gap-1 p-1">{mediaPosts.map((post: any) => <article key={post.id ?? post.uri} className="aspect-square bg-muted overflow-hidden">{post.attachments?.[0]?.url && <img src={post.attachments[0].url} alt="" className="w-full h-full object-cover" />}</article>)}</div>)}

              {activeTab === 'Videos' && (videoPosts.length === 0 ? <div className="py-14 text-center text-sm text-muted-foreground">No videos yet</div> : <div className="divide-y divide-border">{videoPosts.map((post: any) => <article key={post.id ?? post.uri} className="p-4"><div className="text-sm leading-6" dangerouslySetInnerHTML={{ __html: post.content ?? '' }} /></article>)}</div>)}

              {['Podcasts', 'Series', 'Likes', 'Tips', 'Gifts', 'Followers', 'Following', 'Analytics'].includes(activeTab) && <div className="py-14 px-5 text-center text-sm text-muted-foreground">No {activeTab.toLowerCase()} yet.</div>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
