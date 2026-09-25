import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Globe, UserPlus, Sparkles } from 'lucide-react';
import * as federation from '@/api/federation';
import { toast } from 'sonner';

function stripHtml(value: unknown) { return String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function actorFrom(item:any) {
  const raw=item.raw_object?.attributedTo; const uri=String(item.actor_uri || (typeof raw==='string'?raw:raw?.id) || '');
  const fallback=uri.split('/').filter(Boolean).pop() || 'remote-user';
  return item.remote_account ?? { actor_uri:uri, username:fallback, display_name:fallback, domain: (()=>{try{return new URL(uri).hostname}catch{return ''}})() };
}
export function FederatedOrganicCard({ item, onFollow }: { item:any; onFollow?: (actor:string)=>void }) {
  const navigate=useNavigate(); const [following,setFollowing]=useState(false); const actor=actorFrom(item);
  const follow=async(e:MouseEvent)=>{e.stopPropagation(); if(following)return; try{await federation.follow(actor.actor_uri);setFollowing(true);onFollow?.(actor.actor_uri);toast.success('Follow request sent')}catch(err:any){toast.error(err?.message??'Follow failed')}};
  return <article className="border-b border-border bg-card">
    <div className="px-4 pt-3 flex items-center gap-3">
      <button onClick={()=>navigate(`/fediverse/profile/posts?actor=${encodeURIComponent(actor.actor_uri)}`)} className="flex items-center gap-2 min-w-0 text-left">
        <div className="w-9 h-9 rounded-full bg-primary/10 overflow-hidden shrink-0">{actor.avatar_url?<img src={actor.avatar_url} alt="" className="w-full h-full object-cover" loading="lazy"/>:<Globe className="w-5 h-5 m-2 text-primary"/>}</div>
        <div className="min-w-0"><p className="font-semibold text-sm truncate">{actor.display_name||actor.username}</p><p className="text-[11px] text-muted-foreground truncate">@{actor.username}{actor.domain?`@${actor.domain}`:''}</p></div>
      </button>
      <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1 shrink-0"><Globe className="w-3 h-3"/>Fediverse</span>
      <button onClick={follow} disabled={following} className="px-2.5 py-1 rounded-full border border-primary/30 text-primary text-xs font-semibold disabled:opacity-60"><UserPlus className="inline w-3 h-3 mr-1"/>{following?'Following':'Follow'}</button>
    </div>
    <button onClick={()=>item.url&&window.open(item.url,'_blank','noopener,noreferrer')} className="w-full text-left px-4 py-3">
      {item.content_warning&&<p className="text-xs text-muted-foreground mb-2">Content warning: {item.content_warning}</p>}
      <p className="text-sm whitespace-pre-wrap leading-relaxed">{stripHtml(item.content||item.summary)||'Remote post'}</p>
      {Array.isArray(item.attachments)&&item.attachments.length>0&&<p className="text-[11px] text-muted-foreground mt-2">{item.attachments.length} media attachment{item.attachments.length===1?'':'s'}</p>}
      <p className="text-[10px] text-muted-foreground mt-2">{item.published_at?new Date(item.published_at).toLocaleString():''} · {actor.domain||'remote instance'}</p>
    </button>
  </article>;
}

export function FederatedOrganicInjection({ surface = 'home' }: { surface?: string }) {
  const [item, setItem] = useState<any | null>(null);
  useEffect(() => { let active=true; federation.getFederatedDiscoveryFeed({limit:1,surface}).then(r=>{if(active)setItem(r.items?.[0]??null)}).catch(()=>{}); return ()=>{active=false}; }, [surface]);
  if (!item) return null;
  return <div className="border-y border-border bg-card"><div className="px-4 py-2 flex items-center gap-2 text-[11px] text-muted-foreground"><Sparkles className="w-3.5 h-3.5 text-primary"/>Suggested from the Fediverse</div><FederatedOrganicCard item={item}/></div>;
}



/**
 * Compact cross-surface Fediverse hashtag discovery.
 * Hashtags are derived from the same federated object cache used by the feed,
 * so every ingested remote tag can become a first-class Testagram discovery
 * route without another remote request on every page.
 */
export function FederatedHashtagDiscovery({ limit = 8, surface = 'discovery' }: { limit?: number; surface?: string }) {
  const navigate = useNavigate();
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { data } = await supabase
          .from('federated_objects')
          .select('tags,published_at')
          .order('published_at', { ascending: false })
          .limit(150);
        if (!active) return;

        const counts = new Map<string, number>();
        for (const row of data ?? []) {
          for (const raw of Array.isArray(row?.tags) ? row.tags : []) {
            const value = typeof raw === 'string' ? raw : raw?.name ?? raw?.tag;
            const normalized = String(value ?? '').replace(/^#/, '').trim().toLowerCase();
            if (!normalized || !/^[\p{L}\p{N}_-]+$/u.test(normalized)) continue;
            counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
          }
        }

        const next = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, Math.max(1, limit))
          .map(([tag, count]) => ({ tag, count }));
        setTags(next);
      } catch {
        if (active) setTags([]);
      }
    };
    void load();
    const timer = window.setInterval(load, 120000);
    return () => { active = false; window.clearInterval(timer); };
  }, [limit, surface]);

  if (!tags.length) return null;

  return (
    <section className="border-y border-border bg-muted/10 px-4 py-3" aria-label="Fediverse hashtags">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-xs font-bold">Fediverse hashtags</p>
          <p className="text-[10px] text-muted-foreground">Topics discovered from ingested federated posts</p>
        </div>
        <span className="text-[10px] text-muted-foreground">Live cache</span>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {tags.map(({ tag, count }) => (
          <button
            key={tag}
            onClick={() => navigate(`/hashtag/${encodeURIComponent(tag)}`)}
            className="shrink-0 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
          >
            #{tag}
            <span className="ml-1 text-[10px] opacity-60">{count}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
