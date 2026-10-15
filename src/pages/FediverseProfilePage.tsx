import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Globe, UserPlus, UserMinus, Loader2, Users, Rss, LockKeyhole, Bot, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import * as federation from '@/api/federation';
import { FediverseRichText } from '@/components/features/FediverseRichText';
import { supabase } from '@/lib/supabase';
import { federatedMediaUrl } from '@/features/federation/federatedMedia';

type FediverseProfilePageProps = { initialTab?: string; standalone?: boolean };

function numericCount(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function displayCount(value: any): string { return typeof value === 'number' ? new Intl.NumberFormat().format(value) : '—'; }
function linkUrl(value: any): string | null { if (typeof value === 'string') return value; if (Array.isArray(value)) { for (const item of value) { const resolved = linkUrl(item); if (resolved) return resolved; } } if (value && typeof value === 'object') return linkUrl(value.href ?? value.url ?? value.id); return null; }

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
  const [relationshipRows, setRelationshipRows] = useState<any[]>([]);
  const [relationshipCursor, setRelationshipCursor] = useState<string | null>(null);
  const [relationshipTotal, setRelationshipTotal] = useState<number | null>(null);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [relationshipUnavailable, setRelationshipUnavailable] = useState(false);
  const [timelineCursor, setTimelineCursor] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  const profileTabs = ['Posts', 'Featured', 'Threads', 'Replies', 'Media', 'Videos', 'Podcasts', 'Series', 'Likes', 'Tips', 'Gifts', 'Followers', 'Following', 'Analytics'];
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

  // Canonical actor URI used by render-time media proxying. The loader has its own
  // scoped value, so keep a component-level value for the JSX below as well.
  const resolvedActorUri = profile?.actor_uri ?? profile?.actor_url ?? actorUrl;

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
                followers: numericCount(account.followers_count),
                following: numericCount(account.following_count),
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
          avatar_url: linkUrl(actorDoc.icon?.url ?? actorDoc.icon ?? result?.avatar_url ?? result?.avatar),
          icon: actorDoc.icon ?? result?.icon ?? null,
          header_url: linkUrl(actorDoc.image?.url ?? actorDoc.image ?? result?.header_url ?? result?.header),
          url: linkUrl(actorDoc.url) ?? linkUrl(result?.url) ?? actorDoc.id ?? actorUrl,
          followers: numericCount(result?.followers_count ?? result?.followersCount ?? (typeof result?.followers === 'number' ? result.followers : null) ?? actorDoc.followers?.totalItems),
          following: numericCount(result?.following_count ?? result?.followingCount ?? (typeof result?.following === 'number' ? result.following : null) ?? actorDoc.following?.totalItems),
          followers_url: linkUrl(actorDoc.followers) ?? result?.followers_url ?? null,
          following_url: linkUrl(actorDoc.following) ?? result?.following_url ?? null,
          fields: result?.fields ?? actorDoc.attachment ?? [],
          tags: actorDoc.tag ?? result?.tags ?? [],
          emojis: actorDoc.emoji ?? result?.emojis ?? [],
          created_at: actorDoc.published ?? result?.created_at ?? result?.createdAt ?? null,
          posts_count: numericCount(result?.posts_count ?? result?.statuses_count ?? result?.statusesCount ?? actorDoc.outbox?.totalItems),
          actor_type: actorDoc.type ?? result?.actor_type ?? result?.type ?? 'Person',
          locked: actorDoc.manuallyApprovesFollowers === true || result?.locked === true,
          bot: actorDoc.type === 'Service' || result?.bot === true,
          discoverable: actorDoc.discoverable !== false,
          indexable: actorDoc.indexable !== false && result?.indexable !== false,
          limited: actorDoc.limited === true || result?.limited === true,
          suspended: actorDoc.suspended === true || result?.suspended === true,
          last_status_at: result?.last_status_at ?? actorDoc.lastStatusAt ?? null,
          moved_to: linkUrl(actorDoc.moved) ?? result?.moved_to ?? null,
          also_known_as: actorDoc.alsoKnownAs ?? result?.also_known_as ?? [],
          raw_actor: actorDoc,
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
              const confirmed = state === 'active' || state === 'accepted';
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
            if (!cancelled) setTimelineCursor(typeof remote?.next_cursor === 'string' ? remote.next_cursor : null);
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
                attachments: Array.isArray(post.attachment) ? post.attachment : post.attachment ? [post.attachment] : [],
                content_warning: post.summary ?? '',
                language_code: post.language ?? null,
                like_count: numericCount(post.likes?.totalItems),
                announce_count: numericCount(post.shares?.totalItems),
                reply_count: numericCount(post.replies?.totalItems),
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
                followers: numericCount(remoteActor.followers?.totalItems) ?? current.followers ?? null,
                following: numericCount(remoteActor.following?.totalItems) ?? current.following ?? null,
                tags: remoteActor.tag ?? current.tags ?? [],
                posts_count: numericCount(remoteActor.outbox?.totalItems) ?? current.posts_count ?? null,
                actor_type: remoteActor.type ?? current.actor_type ?? 'Person',
                indexable: remoteActor.indexable !== false && current.indexable !== false,
                limited: remoteActor.limited === true || current.limited === true,
                suspended: remoteActor.suspended === true || current.suspended === true,
                last_status_at: remoteActor.lastStatusAt ?? current.last_status_at ?? null,
                raw_actor: remoteActor,
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

  useEffect(() => {
    if (!resolvedActorUri || !['Followers', 'Following', 'Featured', 'Likes'].includes(activeTab)) return;
    let cancelled = false;
    setRelationshipLoading(true);
    setRelationshipError(null);
    setRelationshipRows([]);
    setRelationshipCursor(null);
    setRelationshipTotal(null);
    setRelationshipUnavailable(false);
    federation.getRemoteCollection(resolvedActorUri, activeTab.toLowerCase() as 'followers' | 'following', 30)
      .then(result => {
        if (cancelled) return;
        setRelationshipRows(result.items);
        setRelationshipCursor(result.next_cursor);
        setRelationshipTotal(result.totalItems);
        setRelationshipUnavailable(result.unavailable === true);
        if (result.totalItems !== null) setProfile((current: any) => current ? { ...current, [activeTab === 'Followers' ? 'followers' : 'following']: result.totalItems } : current);
      })
      .catch((error: any) => { if (!cancelled) setRelationshipError(error?.message || `Could not load ${activeTab.toLowerCase()}.`); })
      .finally(() => { if (!cancelled) setRelationshipLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, resolvedActorUri]);

  const loadMoreRelationships = async () => {
    if (!resolvedActorUri || !relationshipCursor || relationshipLoading || !['Followers', 'Following', 'Featured', 'Likes'].includes(activeTab)) return;
    setRelationshipLoading(true);
    setRelationshipError(null);
    try {
      const result = await federation.getRemoteCollection(resolvedActorUri, activeTab.toLowerCase() as 'followers' | 'following', 30, relationshipCursor);
      setRelationshipRows(current => {
        const seen = new Set(current.map((row: any) => String(row.actor_uri || row.id || row.url).toLowerCase()));
        return [...current, ...result.items.filter((row: any) => { const key = String(row.actor_uri || row.id || row.url).toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; })];
      });
      setRelationshipCursor(result.next_cursor);
      setRelationshipTotal(result.totalItems ?? relationshipTotal);
      setRelationshipUnavailable(result.unavailable === true);
      if (result.totalItems !== null) setProfile((current: any) => current ? { ...current, [activeTab === 'Followers' ? 'followers' : 'following']: result.totalItems } : current);
    } catch (error: any) { setRelationshipError(error?.message || `Could not load more ${activeTab.toLowerCase()}.`); }
    finally { setRelationshipLoading(false); }
  };

  const loadMoreTimeline = async () => {
    if (!resolvedActorUri || !timelineCursor || timelineLoading) return;
    setTimelineLoading(true);
    try {
      const remote = await federation.getRemoteProfile(resolvedActorUri, 60, timelineCursor);
      const rows = (Array.isArray(remote?.items) ? remote.items : []).filter((post: any) => post && typeof post === 'object' && !['Delete', 'Tombstone'].includes(String(post.type))).map((post: any) => ({
        ...post, id: post.id ?? post.url, uri: post.id ?? post.url, url: post.url ?? post.id,
        actor_uri: resolvedActorUri, type: post.type ?? 'Note', content: post.content ?? post.name ?? '',
        published_at: post.published ?? post.updated ?? null, in_reply_to_uri: post.inReplyTo ?? null,
        attachments: Array.isArray(post.attachment) ? post.attachment : post.attachment ? [post.attachment] : [], content_warning: post.summary ?? '', language_code: post.language ?? null, like_count: numericCount(post.likes?.totalItems), announce_count: numericCount(post.shares?.totalItems), reply_count: numericCount(post.replies?.totalItems), raw_object: post,
      }));
      setPosts(current => {
        const seen = new Set(current.map((post: any) => String(post.uri ?? post.id ?? post.url)));
        return [...current, ...rows.filter((post: any) => { const key = String(post.uri ?? post.id ?? post.url); if (!key || seen.has(key)) return false; seen.add(key); return true; })];
      });
      setTimelineCursor(typeof remote?.next_cursor === 'string' ? remote.next_cursor : null);
    } catch (error: any) { toast.error(error?.message || 'Could not load more public posts.'); }
    finally { setTimelineLoading(false); }
  };

  const doFollow = async () => {
    if (!user) { navigate('/auth'); return; }
    const target = profile?.actor_uri ?? profile?.actor_url ?? profile?.uri ?? actorUrl;
    if (!target || working) return;

    setWorking(true);
    try {
      const result = await federation.follow(target);
      const confirmed = result?.state === 'active' || result?.state === 'accepted';
      if (!confirmed) throw new Error('Follow was not persisted by federation');
      setFollowing(true);
      setFollowState(result?.state ?? 'active');
      toast.success(result?.deliveryState === 'delivered' ? 'Following — remote delivery confirmed' : 'Following — remote delivery queued');
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
                {(profile.header_url || profile.header) && <img src={federatedMediaUrl(profile.header_url || profile.header, profile.actor_uri || profile.actor_url) || profile.header_url || profile.header} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="px-4 pb-5">
                <div className="flex items-end justify-between -mt-10">
                  <img
                    src={federatedMediaUrl(profile.icon?.url || profile.avatar || profile.avatar_url, profile.actor_uri || profile.actor_url) || profile.icon?.url || profile.avatar || profile.avatar_url}
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
                {profile.summary && <FediverseRichText html={profile.summary} tags={profile.raw_actor?.tag ?? profile.tags ?? []} className="mt-3 text-sm leading-6" />}
                {Array.isArray(profile.fields) && profile.fields.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {profile.fields.map((field: any, i: number) => (
                      <div key={i} className="grid grid-cols-[auto_1fr] gap-3 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                        <span className="font-semibold">{field.name}</span>
                        <FediverseRichText html={field.value} className="text-muted-foreground break-words" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <button onClick={() => setActiveTab('Followers')} className="flex items-center gap-1 hover:text-foreground"><Users className="w-4 h-4" /><strong className="text-foreground">{displayCount(profile.followers)}</strong> followers</button>
                  <button onClick={() => setActiveTab('Following')} className="flex items-center gap-1 hover:text-foreground"><Users className="w-4 h-4" /><strong className="text-foreground">{displayCount(profile.following)}</strong> following</button>
                  <span className="flex items-center gap-1"><Globe className="w-4 h-4" />{(() => { try { return new URL(profile.actor_uri || profile.actor_url).hostname; } catch { return 'Remote account'; } })()}</span>
                  <span>{profile.actor_type || 'Person'}</span>
                  <span><strong className="text-foreground">{displayCount(profile.posts_count)}</strong> posts reported</span>
                  {profile.created_at && <span>Joined {new Date(profile.created_at).toLocaleDateString()}</span>}
                  {profile.last_status_at && <span>Last public status {new Date(profile.last_status_at).toLocaleDateString()}</span>}
                  {profile.indexable === false && <span>Not indexable</span>}
                  {profile.limited && <span>Limited</span>}
                  {profile.suspended && <span>Suspended</span>}
                  {profile.locked && <span className="inline-flex items-center gap-1"><LockKeyhole className="w-3.5 h-3.5"/>Approval required</span>}
                  {profile.bot && <span className="inline-flex items-center gap-1"><Bot className="w-3.5 h-3.5"/>Bot / service</span>}
                  {profile.discoverable === false && <span>Not listed in discovery</span>}
                  {profile.moved_to && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={profile.moved_to} target="_blank" rel="noreferrer">Moved account <ExternalLink className="w-3 h-3"/></a>}
                </div>
                {Array.isArray(profile.also_known_as) && profile.also_known_as.length > 0 && <div className="mt-3 text-xs text-muted-foreground">Also known as: {profile.also_known_as.map((uri: any) => String(uri?.id ?? uri)).join(' · ')}</div>}
                {profile.url && <p className="mt-3 text-xs text-muted-foreground">Remote profile address: <span className="break-all">{profile.url}</span></p>}
                {Array.isArray(profile.emojis) && profile.emojis.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{profile.emojis.map((emoji: any, i: number) => <span key={`${emoji.shortcode ?? emoji.name ?? i}`} className="text-xs rounded-full border border-border px-2 py-1">:{emoji.shortcode ?? emoji.name ?? 'emoji'}:</span>)}</div>}
                {Array.isArray(profile.tags) && profile.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{profile.tags.filter((tag: any) => tag && typeof tag === 'object').map((tag: any, i: number) => <span key={`${tag.name ?? tag.href ?? i}`} className="text-xs rounded-full bg-muted px-2 py-1">{tag.name ?? tag.href ?? 'Tag'}</span>)}</div>}
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

              {(() => {
                const roots = posts.filter((post: any) => !post.in_reply_to_uri);
                const replies = posts.filter((post: any) => Boolean(post.in_reply_to_uri));
                const media = posts.filter((post: any) => Array.isArray(post.attachments) && post.attachments.length > 0);
                const videos = posts.filter((post: any) =>
                  String(post.type || '').toLowerCase() === 'video' ||
                  post.attachments?.some((a: any) => String(a?.mediaType || a?.media_type || a?.type || '').toLowerCase().startsWith('video/'))
                );
                const audio = posts.filter((post: any) =>
                  post.attachments?.some((a: any) => String(a?.mediaType || a?.media_type || a?.type || '').toLowerCase().startsWith('audio/'))
                );
                const visible = activeTab === 'Threads' ? roots :
                  activeTab === 'Replies' ? replies :
                  activeTab === 'Media' ? media :
                  activeTab === 'Videos' ? videos :
                  activeTab === 'Podcasts' ? audio :
                  activeTab === 'Series' ? posts.filter((post: any) => ['Article', 'Page'].includes(String(post.type))) :
                  activeTab === 'Posts' ? posts : [];
                if (['Posts', 'Threads', 'Replies', 'Videos', 'Podcasts', 'Series'].includes(activeTab)) {
                  return (
                    <div className="divide-y divide-border">
                      {visible.length > 0 ? visible.map((post: any) => (
                        <article key={post.id ?? post.uri} className="p-4">
                          {post.content_warning && <div className="mb-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs font-semibold">Content warning: {String(post.content_warning).replace(/<[^>]*>/g, ' ').slice(0, 240)}</div>}
                          <FediverseRichText html={post.content ?? ''} tags={post.raw_object?.tag ?? post.tags ?? []} className="text-sm leading-6" />
                          {post.attachments?.length > 0 && (
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              {post.attachments.slice(0, 4).map((attachment: any, index: number) => {
                                const mediaType = String(attachment?.mediaType || attachment?.media_type || attachment?.type || '').toLowerCase();
                                const remoteUrl = attachment?.url || attachment?.href;
                                const url = federatedMediaUrl(remoteUrl, resolvedActorUri) || remoteUrl;
                                if (!url) return null;
                                if (mediaType.startsWith('video/')) return <video key={index} src={url} controls playsInline preload="metadata" className="w-full rounded-xl bg-muted" />;
                                if (mediaType.startsWith('audio/')) return <audio key={index} src={url} controls preload="metadata" className="w-full" />;
                                return <img key={index} src={url} alt={attachment?.name || ''} loading="lazy" className="w-full aspect-square object-cover rounded-xl bg-muted" />;
                              })}
                            </div>
                          )}
                          <p className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>{post.published_at ? new Date(post.published_at).toLocaleString() : ''}</span>
                            {typeof post.like_count === 'number' && <span>{displayCount(post.like_count)} likes</span>}
                            {typeof post.announce_count === 'number' && <span>{displayCount(post.announce_count)} boosts</span>}
                            {typeof post.reply_count === 'number' && <span>{displayCount(post.reply_count)} replies</span>}
                            <span className="inline-flex items-center gap-1 text-muted-foreground"><Globe className="w-3 h-3"/>Federated content · shown on Testagram</span>
                          </p>
                        </article>
                      )) : (
                        <div className="py-14 px-5 text-center text-sm text-muted-foreground">
                          No {activeTab.toLowerCase()} found in this remote account's public ActivityPub timeline.
                        </div>
                      )}
                      {timelineCursor && <div className="p-4 text-center"><button disabled={timelineLoading} onClick={loadMoreTimeline} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">{timelineLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}Load more posts</button></div>}
                    </div>
                  );
                }
                if (activeTab === 'Media') {
                  return (
                    <>
                      {media.length === 0 ? (
                        <div className="py-14 text-center text-sm text-muted-foreground">No media found in the public remote timeline.</div>
                      ) : (
                        <div className="grid grid-cols-3 gap-1 p-1">
                          {media.map((post: any) => post.attachments.map((attachment: any, index: number) => {
                            const remoteUrl = attachment?.url || attachment?.href;
                            const url = federatedMediaUrl(remoteUrl, post.actor_uri || resolvedActorUri) || remoteUrl;
                            const type = String(attachment?.mediaType || attachment?.media_type || attachment?.type || '').toLowerCase();
                            return url && type.startsWith('video/') ? (
                              <video key={`${post.id}-${index}`} src={url} controls playsInline preload="metadata" className="aspect-square w-full object-cover bg-muted" />
                            ) : url ? (
                              <img key={`${post.id}-${index}`} src={url} alt={attachment?.name || ''} loading="lazy" className="aspect-square w-full object-cover bg-muted" />
                            ) : null;
                          }))}
                        </div>
                      )}
                      {timelineCursor && <div className="p-4 text-center"><button disabled={timelineLoading} onClick={loadMoreTimeline} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">{timelineLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}Load more media</button></div>}
                    </>
                  );
                }
                if (['Tips', 'Gifts'].includes(activeTab)) {
                  return <div className="py-14 px-5 text-center text-sm text-muted-foreground">Tips and gifts are Testagram-native features and are not exposed as public Mastodon ActivityPub profile data.</div>;
                }
                if (['Followers', 'Following', 'Featured', 'Likes'].includes(activeTab)) {
                  return (
                    <div className="divide-y divide-border">
                      <div className="px-4 py-3 flex items-center justify-between text-sm text-muted-foreground">
                        <span>{relationshipTotal === null ? 'Public relationship collection' : `${displayCount(relationshipTotal)} ${activeTab.toLowerCase()}`}</span>
                        {['Followers', 'Following'].includes(activeTab) && <button onClick={() => setActiveTab(activeTab === 'Followers' ? 'Following' : 'Followers')} className="font-semibold text-primary">View {activeTab === 'Followers' ? 'following' : 'followers'}</button>}
                      </div>
                      {relationshipLoading && relationshipRows.length === 0 && <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin"/></div>}
                      {relationshipError && <div className="p-4 text-sm text-destructive"><p>{relationshipError}</p><button onClick={() => { const tab=activeTab; setActiveTab('Posts'); setTimeout(() => setActiveTab(tab), 0); }} className="mt-2 underline">Retry</button></div>}
                      {relationshipUnavailable && <div className="p-5 text-sm text-muted-foreground">This server does not publish a public {activeTab === 'Likes' ? 'liked-items' : activeTab === 'Featured' ? 'featured-items' : activeTab.toLowerCase()} collection.</div>}
                      {!relationshipLoading && !relationshipError && !relationshipUnavailable && relationshipRows.length === 0 && <div className="p-6 text-sm text-muted-foreground">No public {activeTab.toLowerCase()} were returned. The server may hide or not implement this collection.</div>}
                      {relationshipRows.map((person: any, index: number) => {
                        if (['Featured', 'Likes'].includes(activeTab)) return <article key={person.uri ?? person.id ?? index} className="p-4">
                          <FediverseRichText html={person.content ?? person.summary ?? ''} tags={person.raw_object?.tag ?? person.tags ?? []} className="text-sm leading-6"/>
                          {Array.isArray(person.attachments) && person.attachments.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2">{person.attachments.map((attachment: any, mediaIndex: number) => { const raw=attachment?.url || attachment?.href; const url=federatedMediaUrl(raw, person.actor_uri || resolvedActorUri) || raw; const type=String(attachment?.type || attachment?.mediaType || attachment?.media_type || '').toLowerCase(); if (!url) return null; return type.startsWith('video/') ? <video key={mediaIndex} src={url} controls playsInline preload="metadata" className="w-full rounded-xl bg-muted"/> : type.startsWith('audio/') ? <audio key={mediaIndex} src={url} controls preload="metadata" className="w-full"/> : <img key={mediaIndex} src={url} alt={attachment?.name || ''} loading="lazy" className="w-full rounded-xl object-cover bg-muted"/>; })}</div>}
                          <p className="mt-2 text-xs text-muted-foreground">{person.published_at ? new Date(person.published_at).toLocaleString() : ''}{person.actor_uri ? ` · ${new URL(person.actor_uri).hostname}` : ''}</p>
                        </article>;
                        const actor = String(person.actor_uri ?? person.actor_url ?? person.id ?? person.url ?? '');
                        const domain = String(person.domain ?? (() => { try { return new URL(actor).hostname; } catch { return ''; } })());
                        const username = String(person.username ?? person.preferredUsername ?? 'remote');
                        return <button key={actor || index} onClick={() => actor && navigate(`/fediverse/profile?actor=${encodeURIComponent(actor)}&handle=${encodeURIComponent(`${username}@${domain}`)}`)} className="w-full text-left p-4 flex items-center gap-3 hover:bg-muted/40">
                          <img src={federatedMediaUrl(person.avatar_url, actor) || person.avatar_url || undefined} alt="" className="w-11 h-11 rounded-full object-cover bg-muted"/>
                          <span className="min-w-0 flex-1"><span className="block font-bold truncate">{person.display_name ?? person.name ?? username}</span><span className="block text-sm text-muted-foreground truncate">@{username}@{domain}</span>{person.bio && <span className="block text-xs text-muted-foreground line-clamp-2 mt-1">{String(person.bio).replace(/<[^>]*>/g, ' ').slice(0, 180)}</span>}</span>
                          {person.bot && <Bot className="w-4 h-4 text-muted-foreground"/>}{person.locked && <LockKeyhole className="w-4 h-4 text-muted-foreground"/>}
                        </button>;
                      })}
                      {relationshipCursor && <div className="p-4 text-center"><button disabled={relationshipLoading} onClick={loadMoreRelationships} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">{relationshipLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}Load more {activeTab.toLowerCase()}</button></div>}
                    </div>
                  );
                }
                if (activeTab === 'Analytics') {
                  return (
                    <div className="grid grid-cols-2 gap-3 p-4">
                      <div className="rounded-xl border border-border p-4"><div className="text-2xl font-black">{posts.length}</div><div className="text-xs text-muted-foreground">Public posts loaded</div></div>
                      <div className="rounded-xl border border-border p-4"><div className="text-2xl font-black">{media.length}</div><div className="text-xs text-muted-foreground">Media posts</div></div>
                      <div className="rounded-xl border border-border p-4"><div className="text-2xl font-black">{displayCount(profile.followers)}</div><div className="text-xs text-muted-foreground">Followers reported</div></div>
                      <div className="rounded-xl border border-border p-4"><div className="text-2xl font-black">{displayCount(profile.following)}</div><div className="text-xs text-muted-foreground">Following reported</div></div>
                    </div>
                  );
                }
                return null;
              })()}

            </section>
          </>
        )}
      </main>
    </div>
  );
}
