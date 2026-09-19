import { useEffect, useMemo, useRef, useState } from 'react';
import { VerifiedTick } from '@/components/ui/VerifiedTick';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, Clock3, Hash, AtSign, Sparkles, Users, Image as ImageIcon, ListFilter, Loader2, TrendingUp, Globe2, ChevronDown } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/features/PostCard';
import { formatNumber } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import * as federation from '@/api/federation';

const TABS = ['Top', 'Latest', 'People', 'Media', 'Hashtags', 'Communities', 'Fediverse'];
const DATE_FILTERS = ['Any time', '24 hours', '7 days', '30 days'];
const KEYWORD_SEEDS = [
  'technology', 'artificial intelligence', 'football', 'music', 'Kenya', 'Nairobi',
  'business', 'gaming', 'science', 'creator economy', 'travel', 'news',
];

function normalizeToken(value: string) {
  return value.trim().replace(/^[@#]/, '').replace(/\s+/g, ' ');
}

function SearchPageV2() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState(params.get('tab') ?? 'Top');
  const [posts, setPosts] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [hashtags, setHashtags] = useState<any[]>([]);
  const [communities, setCommunities] = useState<any[]>([]);
  const [fediverse, setFediverse] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [peopleSuggestions, setPeopleSuggestions] = useState<any[]>([]);
  const [hashtagSuggestions, setHashtagSuggestions] = useState<any[]>([]);
  const [keywordSuggestions, setKeywordSuggestions] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [dateFilter, setDateFilter] = useState('Any time');
  const [mediaOnly, setMediaOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState('Relevance');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem('tsocial_recent_searches') || '[]').slice(0, 8)); } catch {}
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (typeaheadRef.current && !typeaheadRef.current.contains(event.target as Node)) setShowTypeahead(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const saveRecent = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    const next = [clean, ...recent.filter(x => x !== clean)].slice(0, 8);
    setRecent(next);
    try { localStorage.setItem('tsocial_recent_searches', JSON.stringify(next)); } catch {}
  };

  const parseQuery = (raw: string) => {
    const trimmed = raw.trim();
    const mention = trimmed.match(/(?:^|\s)@([\w.]{2,})$/)?.[1] ?? null;
    const hashtag = trimmed.match(/(?:^|\s)#([\w-]{2,})$/)?.[1] ?? null;
    return { mention, hashtag, clean: normalizeToken(trimmed) };
  };

  const fetchTypeahead = async (raw: string) => {
    const clean = normalizeToken(raw);
    if (clean.length < 1) {
      setPeopleSuggestions([]); setHashtagSuggestions([]); setKeywordSuggestions(KEYWORD_SEEDS.slice(0, 6)); return;
    }
    setAutocompleteLoading(true);
    const { mention, hashtag } = parseQuery(raw);
    const prefix = clean.toLowerCase();
    try {
      const [peopleRes, hashRes] = await Promise.all([
        hashtag ? Promise.resolve({ data: [] as any[] }) : supabase.from('profiles')
          .select('id,username,display_name,avatar_url,verified,follower_count,bio')
          .ilike('username', `${(mention ?? clean).replace(/^@/, '')}%`)
          .order('follower_count', { ascending: false }).limit(6),
        mention ? Promise.resolve({ data: [] as any[] }) : supabase.from('hashtags')
          .select('id,tag,usage_count')
          .ilike('tag', `${(hashtag ?? clean).replace(/^#/, '')}%`)
          .order('usage_count', { ascending: false }).limit(6),
      ]);
      setPeopleSuggestions(peopleRes.data ?? []);
      setHashtagSuggestions(hashRes.data ?? []);
      setKeywordSuggestions(KEYWORD_SEEDS.filter(k => k.toLowerCase().includes(prefix)).slice(0, 6));
    } finally {
      setAutocompleteLoading(false);
    }
  };

  const runSearch = async (raw: string, tab = activeTab) => {
    const q = raw.trim();
    if (!q) return;
    saveRecent(q);
    setShowTypeahead(false);
    setParams({ q, tab });
    setLoading(true);
    const clean = normalizeToken(q).replace(/^[@#]/, '');
    try {
      const since = dateFilter === '24 hours' ? new Date(Date.now() - 86400000).toISOString()
        : dateFilter === '7 days' ? new Date(Date.now() - 7 * 86400000).toISOString()
        : dateFilter === '30 days' ? new Date(Date.now() - 30 * 86400000).toISOString() : null;
      const postQuery = supabase.from('posts').select('*, user_profiles:profiles!posts_user_id_fkey(*)')
        .or(`content.ilike.%${clean}%,content.ilike.%${q}%`)
        .is('community_id', null).limit(80);
      if (since) postQuery.gte('created_at', since);
      if (mediaOnly) postQuery.or('image_url.neq.null,video_url.neq.null,is_video.eq.true');
      if (verifiedOnly) postQuery.eq('user_profiles.verified', true);
      if (tab === 'Latest') postQuery.order('created_at', { ascending: false });
      else if (sort === 'Most liked') postQuery.order('likes_count', { ascending: false });
      else if (sort === 'Most viewed') postQuery.order('views_count', { ascending: false });
      else postQuery.order('created_at', { ascending: false });

      const [postsRes, peopleRes, hashRes, communityRes] = await Promise.all([
        postQuery,
        supabase.from('profiles').select('id,username,display_name,avatar_url,verified,follower_count,bio,creator_tier')
          .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%,bio.ilike.%${clean}%`).limit(30),
        supabase.from('hashtags').select('id,tag,usage_count').ilike('tag', `%${clean}%`).order('usage_count', { ascending: false }).limit(30),
        supabase.from('communities').select('*').or(`name.ilike.%${clean}%,display_name.ilike.%${clean}%,description.ilike.%${clean}%`).order('member_count', { ascending: false }).limit(20),
      ]);
      setPosts(postsRes.data ?? []);
      setPeople(peopleRes.data ?? []);
      setHashtags(hashRes.data ?? []);
      setCommunities(communityRes.data ?? []);

      if (tab === 'Fediverse' || q.startsWith('@')) {
        const localRemote = await supabase.from('remote_accounts').select('*')
          .or(`username.ilike.%${clean}%,display_name.ilike.%${clean}%,domain.ilike.%${clean}%`).limit(20);
        let accounts = localRemote.data ?? [];
        try {
          const result: any = await federation.search(clean, 'users');
          const remote = Array.isArray(result) ? result : result?.accounts ?? result?.users ?? result?.data ?? [];
          accounts = [...accounts, ...remote.map((a: any) => ({
            actor_url: a.url ?? a.id, username: a.username ?? a.preferredUsername,
            domain: a.acct?.split('@')[1] ?? a.domain, display_name: a.display_name ?? a.name,
            bio: a.note ?? a.summary, avatar_url: a.avatar ?? a.avatar_url,
          }))];
        } catch {}
        const seen = new Set<string>();
        setFediverse(accounts.filter((a: any) => a.username && !seen.has(a.actor_url) && seen.add(a.actor_url)));
      } else setFediverse([]);
    } catch (error) {
      console.error('[search-v2]', error);
      toast.error('Search could not be completed');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery, activeTab);
  }, [initialQuery]);

  const handleInput = (value: string) => {
    setQuery(value);
    setShowTypeahead(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchTypeahead(value), 180);
  };

  const chooseSuggestion = (value: string, kind: 'keyword' | 'hashtag' | 'user') => {
    const next = kind === 'hashtag' ? `#${value.replace(/^#/, '')}` : kind === 'user' ? `@${value.replace(/^@/, '')}` : value;
    setQuery(next);
    runSearch(next, kind === 'user' ? 'People' : kind === 'hashtag' ? 'Hashtags' : 'Top');
  };

  const visiblePosts = useMemo(() => {
    let result = [...posts];
    if (activeTab === 'Media') result = result.filter(p => p.image_url || p.video_url || p.is_video || (p.media_urls?.length ?? 0) > 0);
    if (activeTab === 'Latest') result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sort === 'Most liked') result.sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0));
    if (sort === 'Most viewed') result.sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0));
    return result;
  }, [posts, activeTab, sort]);

  const empty = !loading && query.trim() && (
    activeTab === 'People' ? people.length === 0 : activeTab === 'Hashtags' ? hashtags.length === 0 :
    activeTab === 'Communities' ? communities.length === 0 : activeTab === 'Fediverse' ? fediverse.length === 0 : visiblePosts.length === 0
  );

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Search" showBack />
      <div className="sticky top-14 z-40 bg-background/95 backdrop-blur border-b border-border" ref={typeaheadRef}>
        <form onSubmit={e => { e.preventDefault(); runSearch(query); }} className="px-3 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input value={query} onChange={e => handleInput(e.target.value)} onFocus={() => { setShowTypeahead(true); if (!query) fetchTypeahead(''); }}
              placeholder="Search Testagram" className="h-12 pl-12 pr-20 rounded-full bg-muted/80 border border-transparent focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary text-[15px]" />
            {query && <button type="button" onClick={() => { setQuery(''); setShowTypeahead(true); setPosts([]); setPeople([]); setHashtags([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full hover:bg-background/70"><X className="w-4 h-4" /></button>}
          </div>
        </form>

        {showTypeahead && (
          <div className="absolute left-3 right-3 top-[68px] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto">
            {autocompleteLoading && <div className="px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Finding suggestions…</div>}
            {!query.trim() && recent.length > 0 && <section className="py-2"><div className="px-4 py-2 flex justify-between"><span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Recent searches</span><button onClick={() => { setRecent([]); localStorage.removeItem('tsocial_recent_searches'); }} className="text-xs text-primary">Clear</button></div>{recent.map(item => <button key={item} onClick={() => chooseSuggestion(item, 'keyword')} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted text-left"><Clock3 className="w-4 h-4 text-muted-foreground" /><span className="text-sm flex-1 truncate">{item}</span><X className="w-3 h-3 text-muted-foreground" /></button>)}</section>}
            {hashtagSuggestions.length > 0 && <section className="py-2 border-t border-border"><div className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Topics</div>{hashtagSuggestions.map(h => <button key={h.id} onClick={() => chooseSuggestion(h.tag, 'hashtag')} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted text-left"><span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><Hash className="w-4 h-4 text-primary" /></span><span className="flex-1"><span className="block text-sm font-bold">#{h.tag}</span><span className="block text-[11px] text-muted-foreground">{formatNumber(h.usage_count ?? 0)} posts</span></span><TrendingUp className="w-4 h-4 text-muted-foreground" /></button>)}</section>}
            {peopleSuggestions.length > 0 && <section className="py-2 border-t border-border"><div className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">People</div>{peopleSuggestions.map(p => <button key={p.id} onClick={() => chooseSuggestion(p.username, 'user')} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted text-left"><div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">{p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{p.username?.[0]?.toUpperCase()}</div>}</div><span className="flex-1 min-w-0"><span className="flex items-center gap-1 text-sm font-bold truncate">@{p.username}{p.verified && <VerifiedTick className="w-3.5 h-3.5 text-primary" />}</span><span className="block text-[11px] text-muted-foreground truncate">{p.display_name || `${formatNumber(p.follower_count ?? 0)} followers`}</span></span></button>)}</section>}
            {keywordSuggestions.length > 0 && <section className="py-2 border-t border-border"><div className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Search suggestions</div>{keywordSuggestions.map(k => <button key={k} onClick={() => chooseSuggestion(k, 'keyword')} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted text-left"><span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><Sparkles className="w-4 h-4 text-primary" /></span><span className="text-sm">Search for <b>{k}</b></span></button>)}</section>}
            {query.trim() && peopleSuggestions.length === 0 && hashtagSuggestions.length === 0 && keywordSuggestions.length === 0 && !autocompleteLoading && <button onClick={() => runSearch(query)} className="w-full p-4 text-left hover:bg-muted text-sm"><Search className="w-4 h-4 inline mr-2" />Search for <b>{query}</b></button>}
          </div>
        )}

        <div className="flex overflow-x-auto scrollbar-hide px-2">
          {TABS.map(tab => <button key={tab} onClick={() => { setActiveTab(tab); if (query.trim()) runSearch(query, tab); }} className={`relative shrink-0 px-4 py-3 text-sm font-semibold ${activeTab === tab ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {tab}{activeTab === tab && <span className="absolute left-1/2 bottom-0 -translate-x-1/2 w-10 h-1 rounded-full bg-primary" />}
          </button>)}
          <button onClick={() => setShowFilters(v => !v)} className={`ml-auto shrink-0 p-3 ${showFilters ? 'text-primary' : 'text-muted-foreground'}`}><ListFilter className="w-4 h-4" /></button>
        </div>
      </div>

      {showFilters && <div className="px-4 py-3 border-b border-border bg-muted/20 flex flex-wrap gap-2 items-center">
        {DATE_FILTERS.map(item => <button key={item} onClick={() => setDateFilter(item)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${dateFilter === item ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>{item}</button>)}
        <button onClick={() => setMediaOnly(v => !v)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1 ${mediaOnly ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}><ImageIcon className="w-3 h-3" /> Media</button>
        <button onClick={() => setVerifiedOnly(v => !v)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1 ${verifiedOnly ? 'bg-primary text-primary-foreground border-primary' : 'border-border'}`}><VerifiedTick className="w-3 h-3" /> Verified</button>
        <div className="ml-auto flex items-center gap-1 text-xs"><span className="text-muted-foreground">Sort</span><select value={sort} onChange={e => setSort(e.target.value)} className="bg-background border border-border rounded-lg px-2 py-1"><option>Relevance</option><option>Most liked</option><option>Most viewed</option></select></div>
      </div>}

      {!query.trim() ? (
        <div className="px-4 py-6 space-y-6">
          <div><h2 className="text-xl font-black mb-1">Explore Testagram</h2><p className="text-sm text-muted-foreground">Find people, conversations, hashtags and communities.</p></div>
          <section><div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-primary" /><h3 className="font-bold">Try searching for</h3></div><div className="flex flex-wrap gap-2">{KEYWORD_SEEDS.map(k => <button key={k} onClick={() => chooseSuggestion(k, 'keyword')} className="px-3 py-2 rounded-full border border-border bg-card hover:border-primary/40 hover:bg-primary/5 text-sm font-medium">{k}</button>)}</div></section>
          <section className="rounded-2xl border border-border overflow-hidden"><div className="px-4 py-3 bg-muted/30 font-bold flex items-center gap-2"><Hash className="w-4 h-4 text-primary" /> Discover topics</div>{hashtags.slice(0, 8).map(h => <button key={h.id} onClick={() => chooseSuggestion(h.tag, 'hashtag')} className="w-full flex items-center gap-3 px-4 py-3 border-t border-border hover:bg-muted text-left"><span className="text-sm font-bold flex-1">#{h.tag}</span><span className="text-xs text-muted-foreground">{formatNumber(h.usage_count ?? 0)} posts</span></button>)}</section>
        </div>
      ) : loading ? <div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div> : (
        <div>
          {activeTab === 'People' && <div>{people.map(p => <button key={p.id} onClick={() => navigate(`/profile/${p.username}`)} className="w-full flex items-center gap-3 px-4 py-3 border-b border-border hover:bg-muted text-left"><div className="w-11 h-11 rounded-full bg-muted overflow-hidden">{p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{p.username?.[0]?.toUpperCase()}</div>}</div><div className="flex-1 min-w-0"><span className="flex items-center gap-1 font-bold">@{p.username}{p.verified && <VerifiedTick className="w-3.5 h-3.5 text-primary" />}</span><p className="text-xs text-muted-foreground truncate">{p.bio || `${formatNumber(p.follower_count ?? 0)} followers`}</p></div><Users className="w-4 h-4 text-muted-foreground" /></button>)}</div>}
          {activeTab === 'Hashtags' && <div>{hashtags.map(h => <button key={h.id} onClick={() => navigate(`/hashtag/${h.tag}`)} className="w-full flex items-center gap-3 px-4 py-3 border-b border-border hover:bg-muted text-left"><span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center"><Hash className="w-4 h-4 text-primary" /></span><div><p className="font-bold">#{h.tag}</p><p className="text-xs text-muted-foreground">{formatNumber(h.usage_count ?? 0)} posts</p></div></button>)}</div>}
          {activeTab === 'Communities' && <div>{communities.map(c => <button key={c.id} onClick={() => navigate(`/c/${c.name}`)} className="w-full px-4 py-3 border-b border-border hover:bg-muted text-left"><p className="font-bold">{c.display_name || c.name}</p><p className="text-xs text-muted-foreground line-clamp-1">{c.description}</p><p className="text-[11px] text-muted-foreground mt-1">{formatNumber(c.member_count ?? 0)} members</p></button>)}</div>}
          {activeTab === 'Fediverse' && <div>{fediverse.map((a: any, i) => <div key={`${a.actor_url}-${i}`} className="flex items-center gap-3 px-4 py-3 border-b border-border"><div className="w-10 h-10 rounded-full bg-muted overflow-hidden">{a.avatar_url && <img src={a.avatar_url} alt="" className="w-full h-full object-cover" />}</div><div className="flex-1 min-w-0"><p className="font-bold truncate">{a.display_name || a.username}</p><p className="text-xs text-muted-foreground truncate">@{a.username}{a.domain ? `@${a.domain}` : ''}</p></div>{user && <button onClick={() => federation.follow(a.actor_url).then(() => toast.success('Follow request sent')).catch(() => toast.error('Follow failed'))} className="px-3 py-1.5 rounded-full border border-primary text-primary text-xs font-bold">Follow</button>}</div>)}</div>}
          {(activeTab === 'Top' || activeTab === 'Latest' || activeTab === 'Media') && <div>{visiblePosts.map(post => <PostCard key={post.id} post={post} />)}</div>}
          {empty && <div className="py-20 text-center text-muted-foreground"><Search className="w-10 h-10 mx-auto mb-3 opacity-20" /><p className="font-semibold">No results for “{query}”</p><p className="text-xs mt-1">Try a hashtag, @username, or a broader keyword.</p></div>}
        </div>
      )}
    </div>
  );
}

export default SearchPageV2;
