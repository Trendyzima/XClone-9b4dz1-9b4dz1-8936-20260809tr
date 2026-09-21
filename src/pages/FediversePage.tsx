import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';
import { FediverseBadge } from '@/components/features/FediverseBadge';
import {
  Globe, Search, Users, Rss, UserPlus, UserMinus,
  Loader2, AlertCircle, Copy, CheckCircle, Heart, Repeat2,
  MessageCircle, Send, X, Inbox, Radio, BarChart3, Plus, Trash2,
  RefreshCw, CheckCheck, Activity, Server, Sparkles
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  AreaChart, Area, Legend
} from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';
import { useSEO, buildOgImageUrl } from '@/hooks/useSEO';

import { PageAdBanner } from '@/components/features/AdSenseAd';
import { PostCard } from '@/components/features/PostCard';
function FediverseAdBanner() { return <PageAdBanner />; }

type Tab = 'feed' | 'inbox' | 'relay' | 'analytics' | 'discover' | 'identity' | 'mastodon';

const CHART_COLORS = ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6'];

export default function FediversePage() {
  useSEO({
    title: 'Fediverse — Connect Across the Open Web | Testagram',
    description: 'Follow and interact with accounts from Mastodon, Pixelfed, and other ActivityPub platforms directly from Testagram. Join the open federated social web.',
    url: '/fediverse',
    type: 'website',
    image: buildOgImageUrl({ username: 'fediverse' }),
    keywords: 'fediverse, activitypub, mastodon, federated social media, open web, testagram fediverse',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Testagram Fediverse',
      description: 'Connect with accounts across Mastodon, Pixelfed, and other ActivityPub-compatible platforms through Testagram.',
      url: 'https://testagram.site/fediverse',
      isPartOf: { '@type': 'WebSite', name: 'Testagram', url: 'https://testagram.site' },
      about: {
        '@type': 'Thing',
        name: 'ActivityPub Federation',
        description: 'ActivityPub is a decentralized social networking protocol enabling interoperability across federated platforms.',
        sameAs: 'https://www.w3.org/TR/activitypub/',
      },
    },
  });
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('feed');
  const [searchHandle, setSearchHandle] = useState('');
  const [searchResult, setSearchResult] = useState<any | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeRemoteProfile, setActiveRemoteProfile] = useState<any | null>(null);
  const [following, setFollowing] = useState(false);
  const [remotePosts, setRemotePosts] = useState<any[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [federatedFollowing, setFederatedFollowing] = useState<any[]>([]);
  const [federatedFollowers, setFederatedFollowers] = useState<any[]>([]);
  const [gatewayOk, setGatewayOk] = useState<boolean | null>(null);
  const [postStates, setPostStates] = useState<Record<string, any>>({});
  const [myActor, setMyActor] = useState<any>(null);
  const [keysReady, setKeysReady] = useState(false);
  const [keywordQuery, setKeywordQuery] = useState('');
  const [keywordResults, setKeywordResults] = useState<any[]>([]);
  const [searchingKeyword, setSearchingKeyword] = useState(false);
  const [keywordSearched, setKeywordSearched] = useState(false);
  const [fedTrendingTags, setFedTrendingTags] = useState<any[]>([]);
  const [loadingFedTags, setLoadingFedTags] = useState(false);
  const [testagramSuggestions, setTestagramSuggestions] = useState<any[]>([]);
  const [loadingTestagramSuggestions, setLoadingTestagramSuggestions] = useState(false);
  const [followingActorUrls, setFollowingActorUrls] = useState<string[]>([]);

  // ── Mastodon tab state ───────────────────────────────────────────────────
  const [mastodonInstance, setMastodonInstance] = useState('mastodon.social');
  const [mastodonPosts, setMastodonPosts] = useState<any[]>([]);
  const [loadingMastodon, setLoadingMastodon] = useState(false);
  const [mastodonSearch, setMastodonSearch] = useState('');
  const [mastodonSearchResults, setMastodonSearchResults] = useState<any[]>([]);
  const [searchingMastodon, setSearchingMastodon] = useState(false);
  const MASTODON_INSTANCES = [
    'mastodon.social', 'fosstodon.org', 'hachyderm.io', 'infosec.exchange',
    'techhub.social', 'mastodon.online', 'mastodon.world', 'aus.social',
    'social.coop', 'chaos.social', 'merveilles.town', 'sigmoid.social',
    'mas.to', 'mastodon.uno', 'mastodon.lol', 'mstdn.social',
  ];
  const [discoveredInstances, setDiscoveredInstances] = useState<any[]>([]);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [customInstance, setCustomInstance] = useState('');
  const [showInstanceGrid, setShowInstanceGrid] = useState(false);

  // ── Inbox state ──────────────────────────────────────────────────────────
  const [inboxItems, setInboxItems] = useState<any[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const inboxPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Relay state ──────────────────────────────────────────────────────────
  const [relayUrls, setRelayUrls] = useState<string[]>([]);
  const [newRelayUrl, setNewRelayUrl] = useState('');
  const [savingRelay, setSavingRelay] = useState(false);
  const [outboxLog, setOutboxLog] = useState<any[]>([]);
  const [loadingOutbox, setLoadingOutbox] = useState(false);

  // ── Analytics state ──────────────────────────────────────────────────────
  const [deliveryChart, setDeliveryChart] = useState<any[]>([]);
  const [activityTypePie, setActivityTypePie] = useState<any[]>([]);
  const [topInstances, setTopInstances] = useState<any[]>([]);
  const [queueArea, setQueueArea] = useState<any[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // ── Multi-table search state ─────────────────────────────────────────────
  const [multiQuery, setMultiQuery] = useState('');
  const [multiResults, setMultiResults] = useState<{ posts: any[]; actors: any[] }>({ posts: [], actors: [] });
  const [searchingMulti, setSearchingMulti] = useState(false);
  const multiDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // (AdSense push handled internally by PageAdBanner / FediverseAdBanner component)

  // Init on mount
  useEffect(() => {
    checkGateway();
    fetchFederatedFeed();
    fetchFedTrendingTags();
    if (user) {
      fetchFederationStats();
      fetchMyActor();
    }
    fetchTestagramSuggestions();
  }, [user]);

  // Load Mastodon timeline when switching to mastodon tab
  useEffect(() => {
    if (tab === 'mastodon' && mastodonPosts.length === 0) fetchMastodonTimeline(mastodonInstance);
  }, [tab]);

  const fetchMastodonTimeline = async (instance: string) => {
    setLoadingMastodon(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'public_timeline', instance, limit: 20 }),
      });
      if (res.ok) {
        const d = await res.json();
        const posts = Array.isArray(d) ? d : d?.statuses ?? d?.data ?? [];
        if (posts.length > 0) { setMastodonPosts(posts); setLoadingMastodon(false); return; }
      }
      const directRes = await fetch(`https://${instance}/api/v1/timelines/public?limit=20&local=true`);
      if (!directRes.ok) throw new Error('Direct fetch failed');
      const data = await directRes.json();
      setMastodonPosts(Array.isArray(data) ? data : []);
    } catch {
      setMastodonPosts([]);
    } finally { setLoadingMastodon(false); }
  };

  const fetchInstanceDirectory = async () => {
    setLoadingDiscovery(true);
    setShowInstanceGrid(true);
    try {
      const res = await fetch('https://api.joinmastodon.org/servers?language=&category=&region=&ownership=&registrations=');
      if (!res.ok) throw new Error('API unavailable');
      const data = await res.json();
      const sorted = (Array.isArray(data) ? data : [])
        .filter((s: any) => s.total_users > 200 && s.last_week_users > 50)
        .sort((a: any, b: any) => b.last_week_users - a.last_week_users)
        .slice(0, 32);
      if (sorted.length > 0) {
        setDiscoveredInstances(sorted);
        toast.success(`Found ${sorted.length} active Mastodon instances`);
        setLoadingDiscovery(false);
        return;
      }
      throw new Error('empty');
    } catch {
      setDiscoveredInstances([
        { domain: 'mastodon.social',   total_users: 900000, last_week_users: 15000, description: 'The original Mastodon server' },
        { domain: 'fosstodon.org',     total_users: 120000, last_week_users: 3000,  description: 'Open source & tech community' },
        { domain: 'hachyderm.io',      total_users: 75000,  last_week_users: 2000,  description: 'Tech professionals' },
        { domain: 'infosec.exchange',  total_users: 35000,  last_week_users: 1000,  description: 'InfoSec community' },
        { domain: 'mastodon.online',   total_users: 85000,  last_week_users: 2500,  description: 'Open community' },
        { domain: 'mastodon.world',    total_users: 65000,  last_week_users: 1800,  description: 'Global English instance' },
        { domain: 'aus.social',        total_users: 35000,  last_week_users: 800,   description: 'Australian community' },
        { domain: 'social.coop',       total_users: 6000,   last_week_users: 250,   description: 'Cooperatively run instance' },
        { domain: 'techhub.social',    total_users: 10000,  last_week_users: 400,   description: 'Tech hub community' },
        { domain: 'chaos.social',      total_users: 18000,  last_week_users: 600,   description: 'Chaos Computer Club' },
        { domain: 'sigmoid.social',    total_users: 5000,   last_week_users: 200,   description: 'AI/ML community' },
        { domain: 'mas.to',            total_users: 100000, last_week_users: 3500,  description: 'General instance' },
        { domain: 'mastodon.uno',      total_users: 45000,  last_week_users: 1200,  description: 'Italian community' },
        { domain: 'mstdn.social',      total_users: 42000,  last_week_users: 900,   description: 'Social networking' },
        { domain: 'mastodon.lol',      total_users: 25000,  last_week_users: 700,   description: 'Fun community' },
        { domain: 'merveilles.town',   total_users: 700,    last_week_users: 80,    description: 'Creative & experimental' },
      ]);
    }
    setLoadingDiscovery(false);
  };

  const searchMastodon = async (q: string) => {
    if (!q.trim()) { setMastodonSearchResults([]); return; }
    setSearchingMastodon(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'search', instance: mastodonInstance, q, type: 'statuses', limit: 20 }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMastodonSearchResults(data.statuses ?? []);
    } catch { setMastodonSearchResults([]); }
    setSearchingMastodon(false);
  };

  useEffect(() => {
    if (tab === 'inbox') {
      fetchInbox();
      inboxPollRef.current = setInterval(fetchInbox, 3000);
    } else {
      if (inboxPollRef.current) { clearInterval(inboxPollRef.current); inboxPollRef.current = null; }
    }
    if (tab === 'relay') { fetchRelayConfig(); fetchOutboxLog(); }
    if (tab === 'analytics') fetchAnalytics();
    return () => { if (inboxPollRef.current) clearInterval(inboxPollRef.current); };
  }, [tab, user]);

  const checkGateway = async () => {
    try {
      const res = await federation.getHealth();
      setGatewayOk(!!res);
    } catch {
      try { await federation.getInstance(); setGatewayOk(true); } catch { setGatewayOk(false); }
    }
  };

  const fetchMyActor = async () => {
    if (!user) return;
    const { data: actor } = await supabase.from('activitypub_actors').select('*').eq('user_id', user.id).maybeSingle();
    setMyActor(actor);
    const { data: keys } = await supabase.from('activitypub_keys').select('id').eq('user_id', user.id).maybeSingle();
    setKeysReady(!!keys);
    if (!keys) void generateKeys();
  };

  const cacheFederatedPosts = async (posts: any[]) => {
    const rows = posts.filter((p: any) => p.uri ?? p.url ?? p.id).map((p: any) => ({
      uri: p.uri ?? p.url ?? p.id ?? '',
      object_type: p.object_type ?? 'Note',
      actor_uri: p.actor_uri ?? p.actor?.id ?? p.actor?.url ?? p.account?.url ?? p.actor_url ?? '',
      url: p.url ?? p.uri ?? p.id ?? '',
      content: p.content ?? p.text ?? '',
      summary: p.spoiler_text ?? p.summary ?? null,
      attachments: p.media_attachments ?? p.attachments ?? [],
      tags: p.tags ?? [],
      like_count: p.favourites_count ?? p.likes_count ?? 0,
      reply_count: p.replies_count ?? 0,
      announce_count: p.reblogs_count ?? p.boosts_count ?? 0,
      published_at: p.created_at ?? p.published ?? new Date().toISOString(),
      raw_object: p,
    })).filter((r: any) => r.uri);
    if (!rows.length) return;
    await supabase.from('federated_objects').upsert(rows, { onConflict: 'uri', ignoreDuplicates: false })
      .then(() => setCachedAt(new Date())).catch(() => {});
  };
  const fetchFederatedFeed = async () => {
    setLoadingFeed(true);
    try {
      const page = await federation.getFederatedTimelinePage({ limit: 30 });
      const fresh = Array.isArray(page?.items) ? page.items : [];
      if (fresh.length > 0) {
        setRemotePosts(fresh);
        cacheFederatedPosts(fresh).catch(() => {});
        setCachedAt(new Date());
      } else {
        const { data: cached } = await supabase
          .from('federated_objects')
          .select('*')
          .order('published_at', { ascending: false })
          .limit(30);
        setRemotePosts(cached ?? []);
        if ((cached ?? []).length > 0) setCachedAt(new Date());
      }
    } catch {
      const { data: cached } = await supabase
        .from('federated_objects')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(30);
      setRemotePosts(cached ?? []);
      if ((cached ?? []).length > 0) setCachedAt(new Date());
      console.log('[FediversePage] Personalized feed unavailable, serving from cache');
    } finally {
      setLoadingFeed(false);
      setIsStale(false);
    }
  };

  const fetchFederationStats = async () => {
    if (!user) return;
    const [followingRes, followerRes] = await Promise.all([
      supabase.from('federated_follow_relationships').select('*').eq('local_user_id', user.id),
      supabase.from('federated_relationships').select('*').eq('local_user_id', user.id).eq('relationship','follower'),
    ]);
    // federation-transport writes follows to federated_follow_relationships.
    // Normalize it to the UI shape used by this page and keep a legacy fallback
    // for older relationships created before the canonical table was introduced.
    let followingRows: any[] = [];
    if (!followingRes.error) {
      followingRows = (followingRes.data ?? [])
        .filter((r: any) => ['pending', 'accepted', 'active'].includes(r.state))
        .map((r: any) => ({
          ...r,
          relationship: 'following',
          remote_actor_url: r.remote_actor_uri,
          remote_actor_uri: r.remote_actor_uri,
        }));
    } else {
      const legacy = await supabase.from('federated_relationships').select('*').eq('local_user_id', user.id).eq('relationship','following');
      followingRows = legacy.data ?? [];
    }
    setFederatedFollowing(followingRows);
    setFollowingActorUrls(followingRows.map((r: any) => r.remote_actor_url ?? r.remote_actor_uri).filter(Boolean));
    setFederatedFollowers(followerRes.data ?? []);
  };

  // ── Inbox ────────────────────────────────────────────────────────────────
  const fetchInbox = useCallback(async () => {
    if (!user) return;
    setLoadingInbox(prev => inboxItems.length === 0 ? true : prev);
    const { data } = await supabase
      .from('activitypub_inbox')
      .select('*')
      .eq('local_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setInboxItems(data ?? []);
    setLoadingInbox(false);
  }, [user, inboxItems.length]);

  const markAllProcessed = async () => {
    if (!user) return;
    setMarkingAll(true);
    await supabase.from('activitypub_inbox').update({ processed: true }).eq('local_user_id', user.id).eq('processed', false);
    await fetchInbox();
    setMarkingAll(false);
    toast.success('All activities marked as processed');
  };

  const inboxByDomain: Record<string, any[]> = {};
  for (const item of inboxItems) {
    let domain = '(unknown)';
    try { domain = new URL(item.actor_url).hostname; } catch {}
    if (!inboxByDomain[domain]) inboxByDomain[domain] = [];
    inboxByDomain[domain].push(item);
  }
  const unprocessedCount = inboxItems.filter(i => !i.processed).length;

  // ── Relay ────────────────────────────────────────────────────────────────
  const fetchRelayConfig = async () => {
    const { data } = await supabase.from('platform_settings').select('setting_value').eq('setting_key', 'relay_urls').maybeSingle();
    setRelayUrls(Array.isArray(data?.setting_value) ? data.setting_value : []);
  };

  const fetchOutboxLog = async () => {
    setLoadingOutbox(true);
    const { data } = await supabase.from('activitypub_outbox').select('*').order('created_at', { ascending: false }).limit(30);
    setOutboxLog(data ?? []);
    setLoadingOutbox(false);
  };

  const saveRelayUrls = async (urls: string[]) => {
    setSavingRelay(true);
    await supabase.from('platform_settings').upsert(
      { setting_key: 'relay_urls', setting_value: urls },
      { onConflict: 'setting_key' }
    );
    setRelayUrls(urls);
    setSavingRelay(false);
  };

  const addRelayUrl = async () => {
    const url = newRelayUrl.trim();
    if (!url || relayUrls.includes(url)) { toast.error('Invalid or duplicate URL'); return; }
    setNewRelayUrl('');
    await saveRelayUrls([...relayUrls, url]);
    toast.success('Relay added');
  };

  const removeRelayUrl = async (url: string) => {
    await saveRelayUrls(relayUrls.filter(u => u !== url));
    toast.success('Relay removed');
  };

  // ── Analytics ────────────────────────────────────────────────────────────
  const fetchAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: outboxData } = await supabase.from('activitypub_outbox').select('created_at, delivered').gte('created_at', since24h);

      const hourBuckets: Record<string, { hour: string; success: number; total: number }> = {};
      for (let h = 23; h >= 0; h--) {
        const d = new Date(Date.now() - h * 3600 * 1000);
        const key = d.toISOString().slice(0, 13);
        hourBuckets[key] = { hour: d.toLocaleTimeString([], { hour: '2-digit', hour12: false }), success: 0, total: 0 };
      }
      (outboxData ?? []).forEach((r: any) => {
        const key = r.created_at.slice(0, 13);
        if (hourBuckets[key]) {
          hourBuckets[key].total++;
          if (r.delivered) hourBuckets[key].success++;
        }
      });
      setDeliveryChart(Object.values(hourBuckets).map(b => ({
        hour: b.hour,
        rate: b.total > 0 ? Math.round((b.success / b.total) * 100) : null,
        total: b.total,
      })));

      setQueueArea(Object.values(hourBuckets).map(b => ({
        hour: b.hour,
        delivered: b.success,
        pending: b.total - b.success,
      })));

      const { data: inboxTypes } = await supabase.from('activitypub_inbox').select('activity_type');
      const typeCounts: Record<string, number> = {};
      (inboxTypes ?? []).forEach((r: any) => {
        typeCounts[r.activity_type] = (typeCounts[r.activity_type] ?? 0) + 1;
      });
      setActivityTypePie(Object.entries(typeCounts).map(([name, value]) => ({ name, value })));

      const { data: accounts } = await supabase.from('federated_actors').select('domain');
      const domainCounts: Record<string, number> = {};
      (accounts ?? []).forEach((r: any) => {
        domainCounts[r.domain] = (domainCounts[r.domain] ?? 0) + 1;
      });
      setTopInstances(
        Object.entries(domainCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name, accounts]) => ({ name, accounts }))
      );
    } catch (err) { console.error('Analytics error', err); }
    setLoadingAnalytics(false);
  };

  // ── Multi-table search ────────────────────────────────────────────────────
  const handleMultiSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setMultiResults({ posts: [], actors: [] }); return; }
    setSearchingMulti(true);
    const [postsRes, actorsRes] = await Promise.all([
      supabase.from('federated_objects').select('*').ilike('content', `%${q}%`).order('published_at', { ascending: false }).limit(10),
      supabase.from('federated_actors').select('*').or(`username.ilike.%${q}%,display_name.ilike.%${q}%,domain.ilike.%${q}%`).limit(8),
    ]);
    setMultiResults({ posts: postsRes.data ?? [], actors: actorsRes.data ?? [] });
    setSearchingMulti(false);
  }, []);

  useEffect(() => {
    if (multiDebounce.current) clearTimeout(multiDebounce.current);
    multiDebounce.current = setTimeout(() => handleMultiSearch(multiQuery), 400);
    return () => { if (multiDebounce.current) clearTimeout(multiDebounce.current); };
  }, [multiQuery, handleMultiSearch]);

  // ── Common interaction handlers ───────────────────────────────────────────
  const handleSearch = async () => {
    const handle = searchHandle.trim().replace(/^@/, '');
    if (!handle.includes('@')) { toast.error('Use full format: user@mastodon.social'); return; }
    setSearching(true); setSearchResult(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const lookupRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'lookup_actor', handle }),
      });
      const lookup = await lookupRes.json();
      const actor = lookup?.actor;
      if (lookupRes.ok && actor) {
        setSearchResult({
          actor_url: actor.actor_uri, username: actor.username ?? handle.split('@')[0],
          domain: actor.domain ?? handle.split('@')[1] ?? '', display_name: actor.display_name ?? actor.username,
          bio: actor.bio, avatar_url: actor.avatar_url, followers_url: actor.followers_url, inbox_url: actor.inbox_url,
        });
      } else { throw new Error(lookup?.error ?? 'Actor not found'); }
    } catch (err: any) { toast.error(`Lookup failed: ${err.message ?? 'unknown error'}`); }
    setSearching(false);
  };

  const handleUnfollowFederated = async (remoteActorUrl: string) => {
    if (!user) { navigate('/auth'); return; }
    const previous = federatedFollowing;
    const previousUrls = followingActorUrls;
    setFollowingActorUrls(prev => prev.filter(url => url !== remoteActorUrl));
    setFederatedFollowing(prev => prev.filter((row: any) => row.remote_actor_url !== remoteActorUrl));
    setFollowing(false);
    setSearchResult((prev: any) => prev ? { ...prev, following: false } : prev);
    setActiveRemoteProfile((prev: any) => prev ? { ...prev, following: false } : prev);
    toast.success('Unfollowed');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'unfollow', target: remoteActorUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Unfollow failed');
    } catch (err: any) {
      setFederatedFollowing(previous);
      setFollowingActorUrls(previousUrls);
      setFollowing(true);
      toast.error(`Unfollow failed: ${err.message ?? ''}`);
    }
  };

  const handleFedLike = async (post: any) => {
    if (!user) { navigate('/auth'); return; }
    const key = post.object_url ?? post.id;
    if (!key) return;
    setPostStates(prev => ({ ...prev, [key]: { ...prev[key], liked: !prev[key]?.liked } }));
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'like', object_url: key, user_id: user.id }),
      });
    } catch {}
  };

  const handleFedBoost = async (post: any) => {
    if (!user) { navigate('/auth'); return; }
    const key = post.object_url ?? post.id;
    if (!key) return;
    setPostStates(prev => ({ ...prev, [key]: { ...prev[key], boosted: !prev[key]?.boosted } }));
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'boost', object_url: key, user_id: user.id }),
      });
    } catch {}
  };

  const handleFedReply = async (post: any) => {
    if (!user) { navigate('/auth'); return; }
    const key = post.object_url ?? post.id;
    if (!key) return;
    const text = postStates[key]?.replyText?.trim();
    if (!text) return;
    setPostStates(prev => ({ ...prev, [key]: { ...prev[key], sending: true } }));
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reply', object_url: key, content: text, user_id: user.id }),
      });
      toast.success('Reply sent to the Fediverse!');
      setPostStates(prev => ({ ...prev, [key]: { ...prev[key], replyText: '', replyOpen: false, sending: false } }));
    } catch (err: any) {
      toast.error(`Reply failed: ${err.message ?? ''}`);
      setPostStates(prev => ({ ...prev, [key]: { ...prev[key], sending: false } }));
    }
  };

  const handleFollow = async (account: any) => {
    if (!user) { navigate('/auth'); return; }
    const target = account.actor_url ?? account.actor_uri ?? `https://${account.domain}/users/${account.username}`;
    const alreadyFollowing = followingActorUrls.includes(target) || !!account.following;
    if (alreadyFollowing) { await handleUnfollowFederated(target); return; }
    const previous = federatedFollowing;
    const previousUrls = followingActorUrls;
    const optimisticRow = { id: `optimistic-${target}`, local_user_id: user.id, relationship: 'following', remote_actor_url: target, remote_actor_uri: target, remote_username: account.username, remote_domain: account.domain, state: 'active' };
    setFollowingActorUrls(prev => prev.includes(target) ? prev : [...prev, target]);
    setFederatedFollowing(prev => [optimisticRow, ...prev.filter((row: any) => row.remote_actor_url !== target)]);
    setFollowing(true);
    setSearchResult((prev: any) => prev ? { ...prev, following: true, actor_url: target } : prev);
    setActiveRemoteProfile((prev: any) => prev ? { ...prev, following: true, actor_url: target } : prev);
    toast.success('Following');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-federation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'follow', target }),
      }).then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error ?? 'Follow delivery failed');
      }).catch((err: any) => {
        setFederatedFollowing(prev => prev.filter((row: any) => row.remote_actor_url !== target));
        setFollowingActorUrls(prev => prev.filter(url => url !== target));
        setFollowing(false);
        setSearchResult((prev: any) => prev ? { ...prev, following: false } : prev);
        setActiveRemoteProfile((prev: any) => prev ? { ...prev, following: false } : prev);
        toast.error(`Follow failed: ${err.message ?? 'remote delivery failed'}`);
      });
    } catch (err: any) {
      setFederatedFollowing(previous); setFollowingActorUrls(previousUrls); setFollowing(false);
      toast.error(`Follow failed: ${err.message ?? ''}`);
    }
  };

  const fetchTestagramSuggestions = async () => {
    setLoadingTestagramSuggestions(true);
    try {
      // Generate recommendations first, then read them. The previous fire-and-forget
      // call could race the SELECT and leave this rail empty on a fresh account.
      if (user) {
        await supabase.rpc('generate_content_recommendations', { p_user_id: user.id }).catch(() => null);
        const { data: recs } = await supabase
          .from('content_recommendations')
          .select('recommended_post_id, score, reason')
          .eq('user_id', user.id)
          .order('score', { ascending: false })
          .limit(8);

        if (recs?.length) {
          const ids = recs.map((r: any) => r.recommended_post_id);
          const { data: posts } = await supabase
            .from('posts')
            .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
            .in('id', ids)
            .is('community_id', null);

          if (posts?.length) {
            const byId = new Map(posts.map((p: any) => [p.id, p]));
            const ranked = recs
              .map((r: any) => {
                const post = byId.get(r.recommended_post_id);
                return post && typeof post === 'object' ? { ...post, _reason: r.reason } : null;
              })
              .filter((p: any) => p?.id);
            if (ranked.length) {
              setTestagramSuggestions(ranked);
              return;
            }
          }
        }
      }

      // Always provide a native Testagram fallback so the Fediverse page is useful
      // even before a user has enough interaction history for personalized ranking.
      const { data: popular, error: popularError } = await supabase
        .from('posts')
        .select('*, user_profiles:profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,verified_tier,follower_count,following_count,protected_account,cover_url,website,location,social_links,created_at)')
        .is('community_id', null)
        .order('likes_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(8);

      if (popularError) throw popularError;
      setTestagramSuggestions(popular ?? []);
    } catch (err) {
      console.warn('[fediverse] Testagram suggestions unavailable', err);
      setTestagramSuggestions([]);
    } finally {
      setLoadingTestagramSuggestions(false);
    }
  };

  const fetchFedTrendingTags = async () => {
    setLoadingFedTags(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'trending_tags', limit: 15 }),
      });
      if (!res.ok) throw new Error('Gateway unavailable');
      const data = await res.json();
      const tags = Array.isArray(data) ? data.map((t: any) => ({ tag: t.name ?? t.tag ?? t, count: t.history?.[0]?.uses ?? 0 })) : [];
      if (tags.length > 0) { setFedTrendingTags(tags); setLoadingFedTags(false); return; }
      throw new Error('empty');
    } catch {
      const { data } = await supabase.from('trending_hashtags').select('trend_score, daily_posts, hashtags(tag, usage_count)').order('trend_score', { ascending: false }).limit(15);
      if (data) setFedTrendingTags(data.filter((r: any) => r.hashtags).map((r: any) => ({ tag: r.hashtags.tag, count: r.daily_posts ?? r.hashtags.usage_count ?? 0 })));
    } finally { setLoadingFedTags(false); }
  };

  const handleKeywordSearch = async () => {
    const q = keywordQuery.trim();
    if (!q) return;
    setSearchingKeyword(true); setKeywordResults([]); setKeywordSearched(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'search', query: q, type: 'statuses', limit: 20 }),
      });
      const data = await res.json();
      const posts = Array.isArray(data) ? data : data?.statuses ?? data?.posts ?? data?.data ?? [];
      if (posts.length === 0 && !res.ok) throw new Error(data?.error ?? 'No results');
      setKeywordResults(posts);
    } catch {
      const { data: cached } = await supabase.from('federated_objects').select('*').ilike('content', `%${q}%`).order('published_at', { ascending: false }).limit(20);
      setKeywordResults(cached ?? []);
      if ((cached ?? []).length === 0) toast.error(`No results for "${q}"`);
    } finally { setSearchingKeyword(false); }
  };

  const generateKeys = async () => {
    if (!user) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-keygen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: user.id }),
      });
      const data = await res.json();
      if (data.status === 'created' || data.status === 'exists') { setKeysReady(true); toast.success('RSA keys ready!'); fetchMyActor(); }
      else toast.error(data.error ?? 'Keygen failed');
    } catch (err: any) { toast.error('Keygen error: ' + err.message); }
  };

  const appMetadata = (user as any)?.app_metadata ?? {};
  const canBackfillKeys = appMetadata.role === 'admin' || appMetadata.role === 'super_admin' || appMetadata.role === 'owner';

  const backfillAllKeys = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/activitypub-keygen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ generate_all_missing: true }),
      });
      const data = await res.json();
      if (data.status === 'backfill_complete') toast.success(`Backfill done: ${data.generated} generated, ${data.failed} failed`);
      else toast.error(data.error ?? 'Backfill failed');
    } catch (err: any) { toast.error('Backfill error: ' + err.message); }
  };

  // ─── Render helpers ────────────────────────────────────────────────────────
  function RemotePostRow({ p, compact = false }: { p: any; compact?: boolean }) {
    const rawActor = p.raw_object?.attributedTo;
    const rawActorUri = typeof rawActor === 'string' ? rawActor : rawActor?.id ?? '';
    const actor = p.remote_account ?? p.remote_accounts ?? p.actor ?? p.account ?? {};
    const actorUri = actor.url ?? actor.actor_uri ?? p.actor_uri ?? p.actor_url ?? rawActorUri ?? '';
    const identitySource = actorUri || p.uri || p.url || '';
    const fallbackIdentity = (() => {
      try {
        const parsed = new URL(identitySource);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const markerIndex = parts.findIndex((part) => ['statuses', 'objects', 'notes'].includes(part));
        const handle = markerIndex > 0 ? parts[markerIndex - 1] : (parts.at(-1) || '');
        return { username: ['ap', 'users', 'actors', 'person'].includes(handle) ? '' : handle, domain: parsed.hostname };
      } catch { return { username: '', domain: '' }; }
    })();
    const username = actor.preferredUsername ?? actor.username ?? actor.acct?.split('@')[0] ?? fallbackIdentity.username ?? 'unknown';
    const domain = actor.domain ?? fallbackIdentity.domain;
    const avatarUrl = actor.avatar_url ?? actor.icon?.url ?? actor.avatar;
    const content = p.content ?? p.text ?? '';
    const created = p.published_at ?? p.created_at ?? p.published ?? '';
    const key = p.object_url ?? p.uri ?? p.url ?? p.id ?? Math.random().toString();
    const ps = postStates[key] ?? {};

    return (
      <div className={`${compact ? 'p-3' : 'p-4'} hover:bg-muted/5 transition-colors`}>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate(`/fediverse/profile?actor=${encodeURIComponent(actor.url ?? actor.actor_uri ?? p.actor_uri ?? p.actor_url ?? rawActorUri ?? '')}&handle=${encodeURIComponent('@' + username + (domain ? '@' + domain : ''))}`)}
            className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30"
            aria-label={`Open @${username}`}
          >
            <div className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-muted overflow-hidden`}>
              {avatarUrl ? <img src={avatarUrl} alt={username} className="w-full h-full object-cover" /> :
                <div className="w-full h-full flex items-center justify-center font-bold text-xs">{username[0]?.toUpperCase()}</div>}
            </div>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <button
                type="button"
                onClick={() => navigate(`/fediverse/profile?actor=${encodeURIComponent(actor.url ?? actor.actor_uri ?? p.actor_url ?? '')}&handle=${encodeURIComponent('@' + username + (domain ? '@' + domain : ''))}`)}
                className={`font-semibold text-left hover:underline ${compact ? 'text-xs' : 'text-sm'}`}
              >{actor.display_name ?? username}</button>
              <button
                type="button"
                onClick={() => navigate(`/fediverse/profile?actor=${encodeURIComponent(actor.url ?? actor.actor_uri ?? p.actor_url ?? '')}&handle=${encodeURIComponent('@' + username + (domain ? '@' + domain : ''))}`)}
                className="text-xs text-purple-500 flex items-center gap-0.5 hover:underline"
              ><Globe className="w-3 h-3" />{domain}</button>
              {created && <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(created), { addSuffix: true })}</span>}
            </div>
            <div className={`${compact ? 'text-xs' : 'text-sm'} leading-relaxed line-clamp-3`} dangerouslySetInnerHTML={{ __html: content }} />
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              <button onClick={() => handleFedLike({ ...p, object_url: key })}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${ps.liked ? 'bg-pink-500/15 text-pink-600' : 'hover:bg-muted text-muted-foreground hover:text-pink-600'}`}>
                <Heart className={`w-3 h-3 ${ps.liked ? 'fill-current' : ''}`} />
                {(p.likes_count ?? p.favourites_count ?? 0) + (ps.liked ? 1 : 0)}
              </button>
              <button onClick={() => handleFedBoost({ ...p, object_url: key })}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${ps.boosted ? 'bg-green-500/15 text-green-600' : 'hover:bg-muted text-muted-foreground hover:text-green-600'}`}>
                <Repeat2 className="w-3 h-3" />
                {(p.boosts_count ?? p.reblogs_count ?? 0) + (ps.boosted ? 1 : 0)}
              </button>
              {user && (
                <button onClick={() => setPostStates(prev => ({ ...prev, [key]: { ...prev[key], replyOpen: !ps.replyOpen } }))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs hover:bg-muted text-muted-foreground hover:text-primary transition-colors">
                  <MessageCircle className="w-3 h-3" />{p.replies_count ?? 0}
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate(`/fediverse/profile?actor=${encodeURIComponent(actor.url ?? actor.actor_uri ?? p.actor_url ?? '')}&handle=${encodeURIComponent('@' + username + (domain ? '@' + domain : ''))}`)}
                className="ml-auto text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-full hover:bg-muted transition-colors"
              >View on Testagram</button>
            </div>
            {user && ps.replyOpen && (
              <div className="mt-1.5 flex items-start gap-1.5">
                <textarea className="flex-1 bg-muted rounded-lg px-2.5 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary border border-border" rows={2}
                  placeholder={`Reply to @${username}@${domain}…`}
                  value={ps.replyText ?? ''}
                  onChange={e => setPostStates(prev => ({ ...prev, [key]: { ...prev[key], replyText: e.target.value } }))} />
                <button onClick={() => handleFedReply({ ...p, object_url: key })} disabled={ps.sending || !ps.replyText?.trim()}
                  className="p-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-50">
                  {ps.sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
                <button onClick={() => setPostStates(prev => ({ ...prev, [key]: { ...prev[key], replyOpen: false } }))}
                  className="p-1.5 bg-muted rounded-lg text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'feed',      label: 'Feed',       icon: Rss },
    { id: 'mastodon',  label: 'Mastodon',   icon: Globe },
    { id: 'inbox',     label: 'Inbox',      icon: Inbox,    badge: unprocessedCount > 0 ? unprocessedCount : undefined },
    { id: 'relay',     label: 'Relay',      icon: Radio },
    { id: 'analytics', label: 'Analytics',  icon: BarChart3 },
    { id: 'discover',  label: 'Discover',   icon: Search },
    { id: 'identity',  label: 'Identity',   icon: Globe },
  ];

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Fediverse · testagram.site" showBack />
      <FediverseAdBanner />

      {gatewayOk === false && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Gateway temporarily unreachable — serving from local cache.
        </div>
      )}
      {gatewayOk === true && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border-b border-green-500/20 text-green-600 dark:text-green-400 text-xs">
          <Globe className="w-3.5 h-3.5 shrink-0" />
          Gateway connected · testagram.site
        </div>
      )}

      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border overflow-x-auto flex scrollbar-hide">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative shrink-0 flex-1 min-w-[80px] py-3 text-xs font-semibold border-b-2 flex items-center justify-center gap-1 transition-colors ${
                active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.label.slice(0, 4)}</span>
              {t.badge !== undefined && (
                <span className="absolute top-1.5 right-1 min-w-[14px] h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════════ FEED TAB ══════════════════ */}
      {tab === 'feed' && (
        <div>
          {cachedAt && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 border-b border-border text-xs text-muted-foreground">
              {isStale
                ? <><Loader2 className="w-3 h-3 animate-spin text-primary" />Refreshing feed…</>
                : <><CheckCircle className="w-3 h-3 text-green-500" />Synced {formatDistanceToNow(cachedAt, { addSuffix: true })}</>}
            </div>
          )}

          {/* AdSense banner — fediverse feed */}
          <FediverseAdBanner />

          {(fedTrendingTags.length > 0 || loadingFedTags) && (
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                Trending on Fediverse
              </p>
              {loadingFedTags ? (
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {[0,1,2,3,4].map(i => <div key={i} className="h-7 w-20 rounded-full bg-muted animate-pulse shrink-0" />)}
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {fedTrendingTags.map((t: any, i: number) => (
                    <button key={i} onClick={() => navigate(`/hashtag/${t.tag.replace(/^#/, '')}`)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-semibold transition-colors">
                      #{t.tag.replace(/^#/, '')}
                      {t.count > 0 && <span className="text-purple-400/70">{t.count > 999 ? `${(t.count/1000).toFixed(1)}k` : t.count}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {(loadingTestagramSuggestions || testagramSuggestions.length > 0) && (
            <section className="border-y border-border bg-muted/10">
              <div className="px-4 py-3 flex items-center justify-between">
                <div><p className="text-sm font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Suggested from Testagram</p><p className="text-[11px] text-muted-foreground">Native Testagram posts recommended alongside your federated timeline.</p></div>
                <button onClick={fetchTestagramSuggestions} className="p-1.5 rounded-full hover:bg-muted" aria-label="Refresh Testagram suggestions"><RefreshCw className="w-3.5 h-3.5" /></button>
              </div>
              {loadingTestagramSuggestions ? <div className="px-4 pb-4 space-y-2">{[0,1,2].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div> : <div className="divide-y divide-border">{testagramSuggestions.slice(0, 6).map((post: any) => <PostCard key={post.id} post={post} />)}</div>}
            </section>
          )}
          {loadingFeed ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : remotePosts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground px-6">
              <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold mb-1">No federated posts yet</p>
              <p className="text-sm">Follow people on Mastodon or Misskey to see their posts here</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {remotePosts.map((p: any, i: number) => <RemotePostRow key={p.id ?? p.object_url ?? i} p={p} />)}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ MASTODON TAB ══════════════════ */}
      {tab === 'mastodon' && (
        <div className="space-y-0">
          <div className="px-4 py-3 bg-muted/20 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-[#6364FF] flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] font-black">M</span>
                </div>
                <p className="text-xs font-bold text-[#6364FF]">Mastodon · {mastodonInstance}</p>
              </div>
              <button
                onClick={fetchInstanceDirectory}
                disabled={loadingDiscovery}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 bg-[#6364FF]/10 text-[#6364FF] rounded-full font-semibold hover:bg-[#6364FF]/20 disabled:opacity-50 transition-colors"
              >
                {loadingDiscovery ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Auto-find instances
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {MASTODON_INSTANCES.map(inst => (
                <button key={inst}
                  onClick={() => { setMastodonInstance(inst); setMastodonPosts([]); setMastodonSearchResults([]); fetchMastodonTimeline(inst); }}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${
                    mastodonInstance === inst
                      ? 'bg-[#6364FF] text-white border-[#6364FF]'
                      : 'border-border text-muted-foreground hover:border-[#6364FF]/40 hover:text-[#6364FF]'
                  }`}>
                  {inst}
                </button>
              ))}
            </div>

            {showInstanceGrid && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Instance Directory ({discoveredInstances.length})</p>
                  <button onClick={() => setShowInstanceGrid(false)} className="text-[10px] text-muted-foreground hover:text-foreground">Hide</button>
                </div>
                {loadingDiscovery ? (
                  <div className="grid grid-cols-2 gap-2">
                    {[0,1,2,3,4,5].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {discoveredInstances.map((inst: any) => (
                      <button key={inst.domain}
                        onClick={() => { setMastodonInstance(inst.domain); setMastodonPosts([]); setMastodonSearchResults([]); fetchMastodonTimeline(inst.domain); }}
                        className={`text-left p-2.5 rounded-xl border-2 transition-all hover:scale-[1.02] active:scale-[0.98] ${
                          mastodonInstance === inst.domain
                            ? 'border-[#6364FF] bg-[#6364FF]/10'
                            : 'border-border hover:border-[#6364FF]/40 hover:bg-[#6364FF]/5'
                        }`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="w-4 h-4 rounded-full bg-[#6364FF] flex items-center justify-center shrink-0">
                            <span className="text-white text-[6px] font-black">M</span>
                          </div>
                          <p className="text-xs font-bold truncate">{inst.domain}</p>
                        </div>
                        <p className="text-[10px] text-[#6364FF] font-semibold">{formatNumber(inst.total_users ?? 0)} users</p>
                        {inst.description && <p className="text-[9px] text-muted-foreground line-clamp-1 mt-0.5">{inst.description}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Server className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  placeholder="custom.instance.social"
                  value={customInstance}
                  onChange={e => setCustomInstance(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customInstance.trim()) {
                      const inst = customInstance.trim().replace(/^https?:\/\//, '');
                      setMastodonInstance(inst); setMastodonPosts([]); setMastodonSearchResults([]);
                      fetchMastodonTimeline(inst); setCustomInstance('');
                    }
                  }}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-xl bg-background focus:outline-none focus:ring-1 focus:ring-[#6364FF]/30 font-mono"
                />
              </div>
              <button
                onClick={() => {
                  if (!customInstance.trim()) return;
                  const inst = customInstance.trim().replace(/^https?:\/\//, '');
                  setMastodonInstance(inst); setMastodonPosts([]); setMastodonSearchResults([]);
                  fetchMastodonTimeline(inst); setCustomInstance('');
                }}
                disabled={!customInstance.trim()}
                className="px-3 py-1.5 bg-[#6364FF] text-white text-xs rounded-xl font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                Go
              </button>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input value={mastodonSearch} onChange={e => setMastodonSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchMastodon(mastodonSearch)}
                  placeholder="Search toots on Mastodon…"
                  className="w-full pl-9 pr-4 py-2 bg-muted rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[#6364FF]/30" />
              </div>
              <button onClick={() => searchMastodon(mastodonSearch)} disabled={searchingMastodon || !mastodonSearch.trim()}
                className="px-4 py-2 bg-[#6364FF] text-white rounded-full text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 hover:opacity-90">
                {searchingMastodon ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search
              </button>
            </div>
          </div>

          {loadingMastodon ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[#6364FF]" /></div>
          ) : (
            <div className="divide-y divide-border">
              {(mastodonSearchResults.length > 0 ? mastodonSearchResults : mastodonPosts).map((toot: any, i: number) => {
                const account = toot.account ?? {};
                const username = account.acct ?? account.username ?? 'unknown';
                const displayName = account.display_name || username;
                const avatarUrl = account.avatar_static ?? account.avatar;
                const content = toot.content ?? toot.text ?? '';
                const created = toot.created_at ?? '';
                const url = toot.url ?? toot.uri ?? '';
                const likes = toot.favourites_count ?? 0;
                const boosts = toot.reblogs_count ?? 0;
                const replies = toot.replies_count ?? 0;
                const mediaAtts = toot.media_attachments ?? [];
                return (
                  <div key={toot.id ?? i} className="p-4 hover:bg-muted/5 transition-colors">
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setActiveRemoteProfile({
                          actor_url: `https://${mastodonInstance}/users/${(account.username ?? username).split('@')[0]}`,
                          username: (account.username ?? username).split('@')[0],
                          domain: mastodonInstance,
                          display_name: displayName,
                          bio: account.note ?? '',
                          avatar_url: avatarUrl,
                          followers_count: account.followers_count,
                          following_count: account.following_count,
                        })} className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0 hover:ring-2 hover:ring-[#6364FF] transition-all">
                        {avatarUrl ? <img src={avatarUrl} alt={username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{displayName[0]?.toUpperCase()}</div>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <button type="button" onClick={() => setActiveRemoteProfile({
                            actor_url: `https://${mastodonInstance}/users/${(account.username ?? username).split('@')[0]}`,
                            username: (account.username ?? username).split('@')[0],
                            domain: mastodonInstance,
                            display_name: displayName,
                            bio: account.note ?? '',
                            avatar_url: avatarUrl,
                            followers_count: account.followers_count,
                            following_count: account.following_count,
                          })} className="font-semibold text-sm hover:text-[#6364FF] hover:underline text-left">{displayName}</button>
                          <span className="text-xs text-[#6364FF] flex items-center gap-0.5">
                            <span className="w-3 h-3 rounded-full bg-[#6364FF] inline-flex items-center justify-center"><span className="text-white text-[7px] font-black">M</span></span>
                            @{username.includes('@') ? username : `${username}@${mastodonInstance}`}
                          </span>
                          {created && <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(created), { addSuffix: true })}</span>}
                        </div>
                        <div className="text-sm leading-relaxed line-clamp-4 mb-2" dangerouslySetInnerHTML={{ __html: content }} />
                        {mediaAtts.length > 0 && (
                          <div className={`mt-2 grid gap-1 rounded-xl overflow-hidden ${mediaAtts.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                            {mediaAtts.slice(0, 4).map((att: any) => (
                              att.type === 'image' ? <img key={att.id} src={att.preview_url ?? att.url} alt={att.description ?? ''} className="w-full object-cover max-h-48" />
                              : att.type === 'video' || att.type === 'gifv' ? <video key={att.id} src={att.url} controls className="w-full max-h-48" />
                              : null
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <button onClick={() => handleFedLike({ ...toot, object_url: toot.uri ?? url })} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-pink-500/10 hover:text-pink-600 transition-colors"><Heart className="w-3 h-3" />{likes + (postStates[toot.uri ?? url]?.liked ? 1 : 0)}</button>
                          <button onClick={() => handleFedBoost({ ...toot, object_url: toot.uri ?? url })} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-green-500/10 hover:text-green-600 transition-colors"><Repeat2 className="w-3 h-3" />{boosts + (postStates[toot.uri ?? url]?.boosted ? 1 : 0)}</button>
                          <button onClick={() => setPostStates(prev => ({...prev,[toot.uri ?? url]:{...prev[toot.uri ?? url],replyOpen:!prev[toot.uri ?? url]?.replyOpen}}))} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-primary/10 hover:text-primary transition-colors"><MessageCircle className="w-3 h-3" />{replies}</button>
                          <button type="button" onClick={() => setPostStates(prev => ({...prev,[toot.uri ?? url]:{...prev[toot.uri ?? url],open:true}}))}
                            className="ml-auto text-xs text-[#6364FF] hover:underline">Open in Testagram</button>
                        </div>
                        {user && postStates[toot.uri ?? url]?.replyOpen && (
                          <div className="mt-2 flex gap-2">
                            <input value={postStates[toot.uri ?? url]?.replyText ?? ''} onChange={e => setPostStates(prev=>({...prev,[toot.uri ?? url]:{...prev[toot.uri ?? url],replyText:e.target.value}}))} placeholder="Reply to this toot…" className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-xs" />
                            <button onClick={() => handleFedReply({...toot,object_url:toot.uri ?? url})} disabled={!postStates[toot.uri ?? url]?.replyText?.trim()} className="px-3 py-2 bg-[#6364FF] text-white rounded-xl text-xs font-semibold disabled:opacity-50"><Send className="w-3 h-3" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!loadingMastodon && mastodonPosts.length === 0 && mastodonSearchResults.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="font-semibold">No toots found</p>
                  <p className="text-sm mt-1">Try a different instance or search query</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ INBOX TAB ══════════════════ */}
      {tab === 'inbox' && (
        <div>
          <div className="sticky top-[calc(3.5rem+3rem)] z-20 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-muted-foreground font-medium">Live · polling every 3s</span>
              <span className="text-xs bg-muted px-2 py-0.5 rounded-full font-semibold">{inboxItems.length} activities</span>
              {unprocessedCount > 0 && (
                <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">{unprocessedCount} new</span>
              )}
            </div>
            {unprocessedCount > 0 && (
              <button onClick={markAllProcessed} disabled={markingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity">
                {markingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                Mark all read
              </button>
            )}
          </div>

          {loadingInbox && inboxItems.length === 0 ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : inboxItems.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Inbox className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-semibold">No activities yet</p>
              <p className="text-sm mt-1">Follow remote actors to see their activities here</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {Object.entries(inboxByDomain).map(([domain, items]) => (
                <div key={domain}>
                  <div className="px-4 py-2 bg-muted/20 flex items-center gap-2 border-b border-border">
                    <Server className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-xs font-bold text-purple-600 dark:text-purple-400 font-mono">{domain}</span>
                    <span className="text-xs text-muted-foreground">{items.length} activities</span>
                    <span className="ml-auto text-xs text-muted-foreground">{items.filter(i => !i.processed).length} unread</span>
                  </div>
                  {items.map((item: any) => (
                    <div key={item.id} className={`px-4 py-3 flex items-start gap-3 hover:bg-muted/5 transition-colors ${!item.processed ? 'border-l-2 border-l-cyan-500' : ''}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        item.activity_type === 'Like' ? 'bg-pink-500/15 text-pink-600' :
                        item.activity_type === 'Announce' ? 'bg-green-500/15 text-green-600' :
                        item.activity_type === 'Follow' ? 'bg-blue-500/15 text-blue-600' :
                        item.activity_type === 'Create' ? 'bg-purple-500/15 text-purple-600' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {item.activity_type?.[0] ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
                            item.activity_type === 'Like' ? 'bg-pink-500/10 text-pink-600 border-pink-500/20' :
                            item.activity_type === 'Announce' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                            item.activity_type === 'Follow' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
                            'bg-muted text-muted-foreground border-border'
                          }`}>{item.activity_type}</span>
                          <span className="text-xs text-muted-foreground truncate">{item.actor_url?.split('/').pop()}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                        </div>
                        {item.object_url && <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{item.object_url}</p>}
                        {!item.processed && (
                          <button onClick={async () => {
                            await supabase.from('activitypub_inbox').update({ processed: true }).eq('id', item.id);
                            setInboxItems(prev => prev.map(i => i.id === item.id ? { ...i, processed: true } : i));
                          }} className="mt-1 text-xs text-cyan-600 hover:underline">Mark read</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ RELAY TAB ══════════════════ */}
      {tab === 'relay' && (
        <div className="p-4 space-y-5">
          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-500" />
              <h2 className="font-bold text-sm">Relay URLs</h2>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{relayUrls.length} relays</span>
            </div>
            <div className="p-4 space-y-3">
              {relayUrls.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">No relay URLs configured. Add a Mastodon/ActivityPub relay below.</p>
              ) : (
                <div className="space-y-2">
                  {relayUrls.map((url, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-xl border border-border">
                      <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                      <span className="flex-1 text-xs font-mono truncate text-cyan-600 dark:text-cyan-400">{url}</span>
                      <button onClick={() => removeRelayUrl(url)} className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <input type="url" placeholder="https://relay.mastodon.host/inbox" value={newRelayUrl}
                  onChange={e => setNewRelayUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRelayUrl()}
                  className="flex-1 px-3 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-cyan-500/30 font-mono" />
                <button onClick={addRelayUrl} disabled={savingRelay || !newRelayUrl.trim()}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5 hover:bg-cyan-700 transition-colors">
                  {savingRelay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-violet-500" />
                <h2 className="font-bold text-sm">Outbox Activity Log</h2>
              </div>
              <button onClick={fetchOutboxLog} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {loadingOutbox ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : outboxLog.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">No outbox activities yet</p>
              ) : (
                outboxLog.map((item: any) => (
                  <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${item.delivered ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'}`}>
                      {item.delivered ? '✓' : '⏳'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{item.activity_type}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${item.delivered ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}>{item.delivered ? 'Delivered' : 'Pending'}</span>
                      </div>
                      {item.object_id && <p className="text-[10px] text-muted-foreground font-mono truncate">{item.object_id}</p>}
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Sent', value: outboxLog.length, color: 'text-cyan-600' },
              { label: 'Delivered', value: outboxLog.filter(o => o.delivered).length, color: 'text-green-600' },
              { label: 'Pending', value: outboxLog.filter(o => !o.delivered).length, color: 'text-amber-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="border border-border rounded-xl p-3 text-center bg-muted/20">
                <p className={`text-xl font-black ${color}`}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════ ANALYTICS TAB ══════════════════ */}
      {tab === 'analytics' && (
        <div className="p-4 space-y-5">
          {loadingAnalytics ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="border border-border rounded-2xl p-4 bg-card">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-3"><div className="w-2 h-2 rounded-full bg-green-500" />24h Delivery Success Rate</h3>
                {deliveryChart.some(d => d.total > 0) ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={deliveryChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval={3} />
                      <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`${v}%`, 'Success Rate']} />
                      <Line type="monotone" dataKey="rate" stroke="#06b6d4" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="h-[160px] flex items-center justify-center text-muted-foreground text-sm">No outbox data in last 24h</div>}
              </div>

              <div className="border border-border rounded-2xl p-4 bg-card">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-3"><div className="w-2 h-2 rounded-full bg-violet-500" />Activity Types Distribution</h3>
                {activityTypePie.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="50%" height={140}>
                      <PieChart>
                        <Pie data={activityTypePie} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
                          {activityTypePie.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5">
                      {activityTypePie.map((entry, i) => (
                        <div key={entry.name} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="truncate text-muted-foreground">{entry.name}</span>
                          <span className="ml-auto font-bold">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <p className="text-center py-8 text-sm text-muted-foreground">No inbox activity data yet</p>}
              </div>

              <div className="border border-border rounded-2xl p-4 bg-card">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-3"><div className="w-2 h-2 rounded-full bg-cyan-500" />Top 10 Connected Instances</h3>
                {topInstances.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={topInstances} layout="vertical" margin={{ top: 0, right: 10, left: 60, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={55} />
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [v, 'Accounts']} />
                      <Bar dataKey="accounts" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-center py-8 text-sm text-muted-foreground">No remote account data yet</p>}
              </div>

              <div className="border border-border rounded-2xl p-4 bg-card">
                <h3 className="font-bold text-sm flex items-center gap-2 mb-3"><div className="w-2 h-2 rounded-full bg-amber-500" />Queue Status (24h)</h3>
                {queueArea.some(d => d.delivered + d.pending > 0) ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={queueArea} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gradPending" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={3} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
                      <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#10b981" fill="url(#gradDelivered)" strokeWidth={2} />
                      <Area type="monotone" dataKey="pending" name="Pending" stroke="#f59e0b" fill="url(#gradPending)" strokeWidth={2} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="text-center py-8 text-sm text-muted-foreground">No queue data in last 24h</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════ DISCOVER TAB ══════════════════ */}
      {tab === 'discover' && (
        <div className="p-4 space-y-4">
          <div className="border border-cyan-500/20 rounded-2xl bg-cyan-500/3 p-4 space-y-3">
            <p className="text-sm font-bold text-cyan-600 dark:text-cyan-400 flex items-center gap-2">
              <Search className="w-4 h-4" /> Multi-table Fediverse Search
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                placeholder="Search posts, actors, domains…" value={multiQuery} onChange={e => setMultiQuery(e.target.value)} />
              {searchingMulti && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />}
            </div>
            {multiQuery.trim() && (multiResults.actors.length > 0 || multiResults.posts.length > 0) && (
              <div className="space-y-3">
                {multiResults.actors.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1"><Users className="w-3 h-3" />Actors ({multiResults.actors.length})</p>
                    <div className="space-y-2">
                      {multiResults.actors.map((a: any) => (
                        <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 bg-background rounded-xl border border-border">
                          <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                            {a.avatar_url ? <img src={a.avatar_url} alt={a.username} className="w-full h-full object-cover" /> :
                              <div className="w-full h-full flex items-center justify-center font-bold text-xs">{a.username?.[0]?.toUpperCase()}</div>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold">{a.display_name ?? a.username}</p>
                            <p className="text-[10px] text-muted-foreground">@{a.username}@{a.domain}</p>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => handleFollow(a)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-primary text-primary-foreground rounded-full text-xs font-semibold hover:opacity-90">
                              {followingActorUrls.includes(a.actor_url ?? `https://${a.domain}/users/${a.username}`) ? <CheckCircle className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}{followingActorUrls.includes(a.actor_url ?? `https://${a.domain}/users/${a.username}`) ? 'Following' : 'Follow'}
                            </button>
                            <button onClick={() => setActiveRemoteProfile({ ...a, actor_url: a.actor_url ?? `https://${a.domain}/users/${a.username}` })}
                              className="px-2.5 py-1.5 border border-border rounded-full text-xs font-semibold hover:bg-muted transition-colors">
                              Profile
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {multiResults.posts.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1"><Rss className="w-3 h-3" />Posts ({multiResults.posts.length})</p>
                    <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                      {multiResults.posts.map((p: any, i: number) => <RemotePostRow key={p.id ?? i} p={p} compact />)}
                    </div>
                  </div>
                )}
              </div>
            )}
            {multiQuery.trim() && !searchingMulti && multiResults.actors.length === 0 && multiResults.posts.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3">No results found for "{multiQuery}"</p>
            )}
          </div>

          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">Actor Lookup by Handle</p>
            <div className="flex gap-2">
              <input className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="@alice@mastodon.social" value={searchHandle}
                onChange={e => setSearchHandle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              <button onClick={handleSearch} disabled={searching || !searchHandle.trim()}
                className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {searching ? '…' : 'Lookup'}
              </button>
            </div>
            {searchResult && (
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted overflow-hidden shrink-0">
                    {searchResult.avatar_url ? <img src={searchResult.avatar_url} alt={searchResult.username} className="w-full h-full object-cover" /> :
                      <div className="w-full h-full flex items-center justify-center font-bold text-lg">{searchResult.username[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{searchResult.display_name ?? searchResult.username}</p>
                    <p className="text-sm text-muted-foreground">@{searchResult.username}@{searchResult.domain}</p>
                    {searchResult.bio && <div className="mt-1 text-xs text-muted-foreground line-clamp-3" dangerouslySetInnerHTML={{ __html: searchResult.bio }} />}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleFollow(searchResult)}
                    className="flex-1 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold flex items-center justify-center gap-2">
                    {followingActorUrls.includes(searchResult.actor_url) ? <CheckCircle className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                    {followingActorUrls.includes(searchResult.actor_url) ? 'Following' : 'Follow'}
                  </button>
                  <button onClick={() => setActiveRemoteProfile(searchResult)}
                    className="px-4 py-2 border border-border rounded-full text-sm font-semibold hover:bg-muted transition-colors">
                    Open in Testagram
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold">Keyword Post Search via Gateway</p>
            <div className="flex gap-2">
              <input className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Search by keyword, hashtag…" value={keywordQuery}
                onChange={e => setKeywordQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleKeywordSearch()} />
              <button onClick={handleKeywordSearch} disabled={searchingKeyword || !keywordQuery.trim()}
                className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2">
                {searchingKeyword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search
              </button>
            </div>
            {keywordResults.length > 0 && (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {keywordResults.map((p: any, i: number) => <RemotePostRow key={p.id ?? i} p={p} compact />)}
              </div>
            )}
            {keywordSearched && !searchingKeyword && keywordResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No results for "{keywordQuery}"</p>
            )}
          </div>

          {user && (
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold">{federatedFollowing.length}</p>
                <p className="text-xs text-muted-foreground">Following</p>
              </div>
              <div className="border border-border rounded-xl p-3 text-center">
                <p className="text-2xl font-bold">{federatedFollowers.length}</p>
                <p className="text-xs text-muted-foreground">Remote followers</p>
              </div>
            </div>
          )}

          {federatedFollowing.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <p className="px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">Currently Following</p>
              <div className="divide-y divide-border">
                {federatedFollowing.map((f: any) => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                      <Globe className="w-4 h-4 text-purple-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{f.remote_username ?? f.remote_actor_url.split('/').pop()}</p>
                      <p className="text-xs text-muted-foreground truncate">{f.remote_domain ?? f.remote_actor_url}</p>
                    </div>
                    <button onClick={() => handleUnfollowFederated(f.remote_actor_url)}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full border border-border text-xs font-medium hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors">
                      <UserMinus className="w-3 h-3" />Unfollow
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ IDENTITY TAB ══════════════════ */}
      {tab === 'identity' && (
        <div className="p-4 space-y-4">
          {!user ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-3">Sign in to view your Fediverse identity</p>
              <button onClick={() => navigate('/auth')} className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm">Sign in</button>
            </div>
          ) : (
            <>
              <FediverseBadge username={user.username} remoteFollowers={federatedFollowers.length} />
              <div className="border border-border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Actor Status</h3>
                <div className="space-y-2 text-sm">
                  <Row label="Actor ID" value={myActor?.actor_id ?? '—'} mono />
                  <Row label="Inbox" value={myActor?.inbox_url ?? '—'} mono />
                  <Row label="Domain" value={myActor?.domain ?? 'testagram.site'} />
                  <Row label="RSA Keys" value={keysReady ? '✅ Ready' : '⚠️ Not generated'} />
                </div>
                {!keysReady && (
                  <button onClick={generateKeys} className="w-full py-2 bg-purple-600 text-white rounded-full text-sm font-medium mt-2">Generate RSA Keys</button>
                )}
              </div>
              <div className="border border-border rounded-xl p-4 space-y-2">
                <h3 className="font-semibold text-sm mb-2">Share your handle</h3>
                <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
                  <span className="flex-1 font-mono text-sm">@{user.username}@testagram.site</span>
                  <button onClick={() => { navigator.clipboard.writeText(`@${user.username}@testagram.site`); toast.success('Copied!'); }} className="p-1.5 hover:bg-background rounded-lg transition-colors">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {canBackfillKeys && (
                <div className="border border-amber-500/20 rounded-xl p-4 bg-amber-500/5">
                  <h3 className="font-semibold text-sm mb-1 text-amber-700 dark:text-amber-400">Backfill RSA Keys</h3>
                  <p className="text-xs text-muted-foreground mb-3">Generate ActivityPub RSA-2048 key pairs for all existing users.</p>
                  <button onClick={backfillAllKeys} className="w-full py-2 bg-amber-600 text-white rounded-full text-sm font-medium hover:bg-amber-700 transition-colors">
                    Backfill All Missing Keys
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeRemoteProfile && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActiveRemoteProfile(null)}>
          <div className="w-full sm:max-w-md bg-background border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="h-20 bg-gradient-to-r from-[#6364FF]/20 via-purple-500/15 to-cyan-500/20" />
            <div className="px-5 pb-5 -mt-10">
              <div className="flex items-end justify-between">
                <div className="w-20 h-20 rounded-full bg-muted border-4 border-background overflow-hidden">
                  {activeRemoteProfile.avatar_url
                    ? <img src={activeRemoteProfile.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-2xl font-bold">{activeRemoteProfile.username?.[0]?.toUpperCase()}</div>}
                </div>
                <button onClick={() => setActiveRemoteProfile(null)} className="p-2 rounded-full bg-muted hover:bg-muted/80"><X className="w-5 h-5" /></button>
              </div>
              <div className="mt-3">
                <h2 className="text-lg font-bold">{activeRemoteProfile.display_name ?? activeRemoteProfile.username}</h2>
                <p className="text-sm text-[#6364FF]">@{activeRemoteProfile.username}@{activeRemoteProfile.domain}</p>
                {activeRemoteProfile.bio && <div className="mt-3 text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{__html: activeRemoteProfile.bio}} />}
                <div className="flex gap-4 mt-4 text-xs text-muted-foreground">
                  {activeRemoteProfile.followers_count != null && <span><b className="text-foreground">{formatNumber(activeRemoteProfile.followers_count)}</b> followers</span>}
                  {activeRemoteProfile.following_count != null && <span><b className="text-foreground">{formatNumber(activeRemoteProfile.following_count)}</b> following</span>}
                  <span className="ml-auto">Federated via Testagram</span>
                </div>
                <button onClick={() => handleFollow(activeRemoteProfile)}
                  className="w-full mt-5 py-2.5 rounded-full bg-[#6364FF] text-white font-semibold">
                  {followingActorUrls.includes(activeRemoteProfile.actor_url) ? 'Following' : 'Follow'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}
