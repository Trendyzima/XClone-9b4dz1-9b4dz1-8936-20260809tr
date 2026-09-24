import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import * as federation from '@/api/federation';
import { Search, Users, Hash, AtSign, Image, MessageSquareText, ListFilter, BookmarkPlus, Trash2, Loader2, Globe, Rss, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type Mode = 'all' | 'people' | 'posts' | 'hashtags' | 'mentions' | 'media' | 'conversations' | 'instances' | 'feeds';
const MODES: { id: Mode; label: string; icon: any }[] = [
  { id: 'all', label: 'All', icon: Search }, { id: 'people', label: 'People', icon: Users },
  { id: 'posts', label: 'Posts', icon: Rss }, { id: 'hashtags', label: 'Hashtags', icon: Hash },
  { id: 'mentions', label: 'Mentions', icon: AtSign }, { id: 'media', label: 'Media', icon: Image },
  { id: 'conversations', label: 'Conversations', icon: MessageSquareText }, { id: 'instances', label: 'Instances', icon: Globe },
  { id: 'feeds', label: 'Feeds', icon: ListFilter },
];
function textFromHtml(value: unknown) { return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function ResultCard({ item, mode }: { item: any; mode: Mode }) {
  const navigate = useNavigate();
  const actorLabel = item.display_name ?? item.username ?? item.acct ?? (item.actor_uri ? String(item.actor_uri).split('/').pop() : 'Remote account');
  if (mode === 'people') return <div className="p-3 border border-border rounded-xl"><p className="font-semibold text-sm">{item.display_name ?? item.username}</p><p className="text-xs text-muted-foreground">@{item.username}{item.domain ? `@${item.domain}` : ''}</p><button onClick={() => navigate('/fediverse')} className="mt-2 text-xs text-primary font-semibold">Open federation profile</button></div>;
  if (mode === 'hashtags') return <button onClick={() => navigate(`/hashtag/${String(item.tag ?? item.name ?? '').replace(/^#/, '')}`)} className="w-full text-left p-3 border border-border rounded-xl hover:bg-muted/40"><p className="font-semibold text-sm">#{String(item.tag ?? item.name ?? '').replace(/^#/, '')}</p><p className="text-xs text-muted-foreground">{Number(item.total_posts ?? item.usage_count ?? item.post_count ?? 0).toLocaleString()} posts</p></button>;
  if (mode === 'instances') return <div className="p-3 border border-border rounded-xl"><p className="font-semibold text-sm">{item.domain}</p><p className="text-xs text-muted-foreground">{Number(item.accounts ?? 0).toLocaleString()} known remote accounts</p></div>;
  return <div className="p-3 border border-border rounded-xl"><div className="flex items-center gap-2 mb-1"><span className="font-semibold text-xs">{actorLabel}</span>{item.domain && <span className="text-[10px] text-muted-foreground">@{item.domain}</span>}{mode === 'mentions' && <span className="text-[10px] text-primary">mentioned</span>}{mode === 'conversations' && <span className="text-[10px] text-primary">reply</span>}</div><p className="text-sm whitespace-pre-wrap line-clamp-5">{textFromHtml(item.content ?? item.summary) || item.uri || 'Remote object'}</p>{item.published_at && <p className="text-[10px] text-muted-foreground mt-2">{new Date(item.published_at).toLocaleString()}</p>}{Array.isArray(item.attachments) && item.attachments.length > 0 && <p className="text-[10px] text-muted-foreground mt-1">{item.attachments.length} media attachment{item.attachments.length === 1 ? '' : 's'}</p>}</div>;
}
export default function FediverseDiscoverPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>('all'); const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false);
  const [customFeeds, setCustomFeeds] = useState<any[]>([]); const [feedName, setFeedName] = useState(''); const [savingFeed, setSavingFeed] = useState(false);
  const loadCustomFeeds = useCallback(async () => { if (!user) { setCustomFeeds([]); return; } const { data } = await supabase.from('federated_custom_discovery_feeds').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }); setCustomFeeds(data ?? []); }, [user]);
  useEffect(() => { void loadCustomFeeds(); }, [loadCustomFeeds]);
  const search = useCallback(async (selectedMode = mode, selectedQuery = query) => {
    const q = selectedQuery.trim();
    if (!q && !['media','conversations','instances'].includes(selectedMode)) { setResults([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    try {
      if (['all','people','posts','hashtags'].includes(selectedMode)) {
        const data = await federation.searchFederatedDiscovery(q, 30);
        setResults(selectedMode === 'people' ? data.users : selectedMode === 'posts' ? data.posts : selectedMode === 'hashtags' ? data.hashtags : [...data.users, ...data.hashtags, ...data.posts]);
      } else if (selectedMode === 'mentions') {
        const token = q.replace(/^@/, '').toLowerCase();
        const { data, error } = await supabase.from('federated_objects').select('*').is('deleted_at', null).not('tags', 'is', null).order('published_at', { ascending: false }).limit(100);
        if (error) throw error;
        setResults((data ?? []).filter((row:any) => (Array.isArray(row.tags) ? row.tags : []).some((tag:any) => String(tag?.type ?? '').toLowerCase() === 'mention' && String(tag?.name ?? '').toLowerCase().includes(token))).slice(0,30));
      } else if (selectedMode === 'media') {
        const { data, error } = await supabase.from('federated_objects').select('*').is('deleted_at', null).not('attachments', 'is', null).order('published_at', { ascending: false }).limit(100);
        if (error) throw error;
        setResults((data ?? []).filter((row:any) => Array.isArray(row.attachments) && row.attachments.length > 0 && (!q || textFromHtml(row.content).toLowerCase().includes(q.toLowerCase()))).slice(0,30));
      } else if (selectedMode === 'conversations') {
        let request = supabase.from('federated_objects').select('*').is('deleted_at', null).not('in_reply_to_uri', 'is', null).order('published_at', { ascending: false }).limit(60);
        if (q) request = request.ilike('content', `%${q.replace(/[%_]/g, '')}%`);
        const { data, error } = await request; if (error) throw error; setResults(data ?? []);
      } else if (selectedMode === 'instances') {
        const { data, error } = await supabase.from('federated_actors').select('domain').not('domain', 'is', null).limit(2000);
        if (error) throw error; const counts = new Map<string,number>(); for (const row of data ?? []) if (!q || String(row.domain).toLowerCase().includes(q.toLowerCase())) counts.set(row.domain,(counts.get(row.domain) ?? 0)+1);
        setResults([...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,50).map(([domain,accounts])=>({domain,accounts})));
      }
    } catch (error:any) { setResults([]); toast.error(error?.message ?? 'Federated discovery failed'); } finally { setLoading(false); }
  }, [mode, query]);
  const saveCustomFeed = async () => {
    if (!user) { toast.error('Sign in to save a federated feed'); return; } if (!feedName.trim()) return;
    setSavingFeed(true); const { error } = await supabase.from('federated_custom_discovery_feeds').upsert({ user_id:user.id,name:feedName.trim(),query:query.trim(),mode:mode === 'feeds' ? 'all' : mode });
    if (error) toast.error(error.message); else { toast.success('Federated feed saved'); setFeedName(''); await loadCustomFeeds(); } setSavingFeed(false);
  };
  const deleteCustomFeed = async (id:string) => { const { error } = await supabase.from('federated_custom_discovery_feeds').delete().eq('id',id); if (error) toast.error(error.message); else await loadCustomFeeds(); };
  const runFeed = async (feed:any) => { setMode(feed.mode as Mode); setQuery(feed.query ?? ''); await search(feed.mode as Mode, feed.query ?? ''); };
  return <div className="min-h-screen bg-background pb-16 md:pb-0">
    <TopBar title="Fediverse · Discover" showBack />
    <div className="sticky top-14 z-20 bg-background/95 backdrop-blur border-b border-border overflow-x-auto"><div className="flex min-w-max p-2 gap-1">{MODES.map(({id,label,icon:Icon}) => <button key={id} onClick={()=>{setMode(id);setResults([]);setSearched(false)}} className={`px-3 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 ${mode===id?'bg-primary text-primary-foreground':'hover:bg-muted'}`}><Icon className="w-3.5 h-3.5"/>{label}</button>)}</div></div>
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <section className="border border-cyan-500/20 rounded-2xl p-4 bg-cyan-500/5 space-y-3"><div><h1 className="font-bold text-base">Federated discovery hub</h1><p className="text-xs text-muted-foreground mt-1">Search known federated content across people, posts, hashtags, mentions, media, conversations and instances.</p></div><div className="flex gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void search()} placeholder={mode==='mentions'?'@account@instance':mode==='instances'?'mastodon.social':'Search federated content…'} className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-sm"/><button onClick={()=>void search()} disabled={loading} className="px-4 rounded-xl bg-primary text-primary-foreground disabled:opacity-50">{loading?<Loader2 className="w-4 h-4 animate-spin"/>:<Search className="w-4 h-4"/>}</button></div><div className="flex items-center gap-2 text-[11px] text-muted-foreground">Mode: <strong>{MODES.find(x=>x.id===mode)?.label}</strong><button onClick={()=>void search()} className="ml-auto inline-flex items-center gap-1 hover:text-foreground"><RefreshCw className="w-3 h-3"/>Refresh</button></div></section>
      {mode==='feeds' && <section className="border border-border rounded-2xl p-4 space-y-4"><div><h2 className="font-semibold text-sm">Custom federated feeds</h2><p className="text-xs text-muted-foreground mt-1">Save reusable discovery queries and filters. Results remain limited to content Testagram knows or resolves.</p></div><div className="flex gap-2"><input value={feedName} onChange={e=>setFeedName(e.target.value)} placeholder="Feed name" className="flex-1 px-3 py-2 rounded-xl border border-border bg-background text-sm"/><button onClick={()=>void saveCustomFeed()} disabled={savingFeed||!feedName.trim()} className="px-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1"><BookmarkPlus className="w-3.5 h-3.5"/>Save current</button></div>{customFeeds.length===0?<p className="text-xs text-muted-foreground text-center py-4">No saved federated feeds yet.</p>:<div className="space-y-2">{customFeeds.map(feed=><div key={feed.id} className="flex items-center gap-3 p-3 border border-border rounded-xl"><ListFilter className="w-4 h-4 text-primary"/><div className="flex-1 min-w-0"><p className="font-semibold text-sm">{feed.name}</p><p className="text-xs text-muted-foreground truncate">{feed.mode} · {feed.query||'all indexed content'}</p></div><button onClick={()=>void runFeed(feed)} className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">Open</button><button onClick={()=>void deleteCustomFeed(feed.id)} className="p-2 hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${feed.name}`}><Trash2 className="w-3.5 h-3.5"/></button></div>)}</div>}</section>}
      {mode!=='feeds' && <section className="space-y-2">{results.map((item,index)=><ResultCard key={item.id??item.uri??item.domain??index} item={item} mode={mode}/>)}{searched&&!loading&&results.length===0&&<div className="border border-dashed border-border rounded-2xl py-12 text-center text-sm text-muted-foreground">No {MODES.find(x=>x.id===mode)?.label.toLowerCase()} found.</div>}</section>}
      <section className="border border-border rounded-2xl p-4"><p className="text-xs font-semibold">Federation discovery scope</p><p className="text-[11px] text-muted-foreground mt-1">Results are limited to actors and objects known to Testagram or resolved through supported federation gateways. ActivityPub is decentralized, so no server can assume a complete global index.</p></section>
    </main>
  </div>;
}
