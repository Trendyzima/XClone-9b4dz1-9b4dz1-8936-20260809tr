import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, Heart, Flame, Laugh, Newspaper, ThumbsUp } from 'lucide-react';
import { backendCapabilities } from '@/services/backendClient';

export type FeedItem = {
  id: string;
  title: string;
  excerpt?: string | null;
  canonical_url: string;
  image_url?: string | null;
  favicon_url?: string | null;
  category?: string | null;
  country_code?: string | null;
  published_at: string;
  testagram_rss_source_profiles?: {
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

type ReactionKey = '❤️' | '🔥' | '😂' | '👍';
const REACTIONS: { key: ReactionKey; label: string; Icon: typeof Heart }[] = [
  { key: '❤️', label: 'Love', Icon: Heart },
  { key: '🔥', label: 'Fire', Icon: Flame },
  { key: '😂', label: 'Funny', Icon: Laugh },
  { key: '👍', label: 'Like', Icon: ThumbsUp },
];

const CACHE_TTL = 60_000;
const RSS_FRESHNESS_MS = 12 * 60 * 60 * 1000;
function freshRssItems(items: FeedItem[]) { const cutoff = Date.now() - RSS_FRESHNESS_MS; return items.filter(item => { const published = new Date(item.published_at).getTime(); return Number.isFinite(published) && published >= cutoff && published <= Date.now() + 5 * 60 * 1000; }); }
const SESSION_KEY = 'testagram_rss_temporary_reactions_v1';
let cache: { at: number; items: FeedItem[] } = { at: 0, items: [] };
let pending: Promise<FeedItem[]> | null = null;

function readReactions(): Record<string, ReactionKey> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeReactions(value: Record<string, ReactionKey>) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch { /* private mode */ }
}

export async function loadPublisherFeed(): Promise<FeedItem[]> {
  if (cache.items.length && Date.now() - cache.at < CACHE_TTL) return freshRssItems(cache.items);
  if (pending) return pending;
  pending = backendCapabilities.call<any>('testagram.news.trending', { limit: 12 })
    .then(payload => {
      const sourceItems = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
      const items = sourceItems.slice(0, 12).map((row: any): FeedItem | null => {
        const canonical = String(row?.detail_url ?? row?.source_url ?? '').trim();
        const published = String(row?.published_at ?? row?.updated_at ?? '').trim();
        if (!canonical || !/^https:\/\//i.test(canonical) || !published) return null;
        return {
          id: String(row.id ?? row.newsify_item_id ?? canonical),
          title: String(row.title ?? row.trend_title ?? 'News update'),
          excerpt: row.excerpt ?? null,
          canonical_url: canonical,
          image_url: row.metadata?.image_url ?? row.metadata?.image ?? null,
          favicon_url: null,
          category: row.category ?? row.geo ?? 'news',
          country_code: row.country_code ?? null,
          published_at: published,
          testagram_rss_source_profiles: { display_name: row.source_name ?? 'News partner' },
        };
      }).filter((item: FeedItem | null): item is FeedItem => Boolean(item));
      cache = { at: Date.now(), items };
      return freshRssItems(items);
    })
    .catch(() => freshRssItems(cache.items))
    .finally(() => { pending = null; });
  return pending;
}

function relativeDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

export function PublisherFeedCard({ item }: { item: FeedItem }) {
  const navigate = useNavigate();
  const [reactions, setReactions] = useState<Record<string, ReactionKey>>(readReactions);
  const selected = reactions[item.id];
  const react = (emoji: ReactionKey) => setReactions(previous => {
    const next = { ...previous };
    if (next[item.id] === emoji) delete next[item.id]; else next[item.id] = emoji;
    writeReactions(next); return next;
  });
  const publisher = item.testagram_rss_source_profiles?.display_name || 'Publisher';
  return <article className='overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
    <button type='button' onClick={() => navigate('/news/' + encodeURIComponent(item.id))} className='block w-full text-left'>
      {item.image_url ? <img src={item.image_url} alt='' loading='lazy' className='h-40 w-full object-cover' /> : <div className='flex h-20 items-center gap-2 bg-muted px-4 text-xs text-muted-foreground'><Newspaper className='h-5 w-5' />Publisher story</div>}
      <div className='p-3'><div className='flex items-center gap-2'>
        {item.favicon_url ? <img src={item.favicon_url} alt='' loading='lazy' onError={e => { e.currentTarget.style.display='none'; }} className='h-5 w-5 rounded object-contain' /> : null}
        <span className='truncate text-[11px] font-bold'>Feed from {publisher}</span><span className='text-[10px] text-muted-foreground'>· {item.category || 'news'}</span><span className='ml-auto shrink-0 text-[10px] text-muted-foreground'>{relativeDate(item.published_at)}</span>
      </div><h3 className='mt-2 text-base font-bold leading-snug'>{item.title}</h3>{item.excerpt ? <p className='mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground'>{item.excerpt}</p> : null}<div className='mt-2 flex items-center gap-1 text-[10px] font-semibold text-primary'>Read in Testagram <ExternalLink className='h-3 w-3 rotate-180' /></div></div>
    </button>
    <div className='flex items-center gap-1 border-t border-border px-3 py-2'>{REACTIONS.map(({key,label,Icon}) => <button key={key} type='button' aria-label={label+' reaction'} aria-pressed={selected===key} title={label} onClick={() => react(key)} className={'flex h-8 min-w-9 items-center justify-center rounded-full px-2 text-sm '+(selected===key?'bg-primary/10 text-primary ring-1 ring-primary/30':'hover:bg-muted')}><Icon className='h-4 w-4' /></button>)}<span className='ml-1 text-[10px] text-muted-foreground'>{selected?'Your temporary reaction':'React temporarily'}</span></div>
  </article>;
}

export function PublisherFeedStream({ surface = 'global' }: { surface?: 'home' | 'global' }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hostRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionKey>>(readReactions);

  const hidden = /^(\/auth|\/admin|\/settings|\/wallet|\/messages|\/notifications|\/help|\/premium|\/create-ad|\/my-ads|\/ad-|\/rewards|\/verify|\/privacy|\/terms|\/policy|\/regulator|\/sessions|\/blocked|\/appeals|\/payouts|\/revenue|\/analytics|\/news\/)/.test(pathname);
  const isHome = pathname === '/';

  useEffect(() => {
    if (hidden || (surface === 'global' && isHome)) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '900px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden, surface, isHome]);

  useEffect(() => {
    if (hidden || (surface === 'global' && isHome) || !nearViewport) return;
    let alive = true;
    void loadPublisherFeed().then(next => { if (alive) setItems(next); });
    return () => { alive = false; };
  }, [hidden, surface, isHome, nearViewport]);

  if (hidden || (surface === 'global' && isHome)) return null;

  const react = (id: string, emoji: ReactionKey) => {
    setReactions(previous => {
      const next = { ...previous };
      if (next[id] === emoji) delete next[id];
      else next[id] = emoji;
      writeReactions(next);
      return next;
    });
  };

  return (
    <section ref={hostRef} aria-label='Publisher feeds' className='border-y border-border bg-background px-3 py-4'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div>
          <div className='flex items-center gap-2'>
            <Newspaper className='h-4 w-4 text-primary' />
            <h2 className='text-sm font-bold'>Publisher feeds</h2>
          </div>
          <p className='mt-0.5 text-[11px] text-muted-foreground'>Live headlines from publishers · reactions are temporary</p>
        </div>
        <button type='button' onClick={() => navigate('/search?q=news')} className='text-[11px] font-semibold text-primary'>
          Explore feeds
        </button>
      </div>

      {!items.length ? (
        <div className='rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground'>Loading live publisher feeds…</div>
      ) : (
        <div className='space-y-3'>
          {items.map(item => {
            const publisher = item.testagram_rss_source_profiles?.display_name || 'Publisher';
            const selected = reactions[item.id];
            return (
              <article key={item.id} className='overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
                <button type='button' onClick={() => navigate('/news/' + encodeURIComponent(item.id))} className='block w-full text-left'>
                  {item.image_url ? (
                    <img src={item.image_url} alt='' loading='lazy' className='h-40 w-full object-cover' />
                  ) : (
                    <div className='flex h-20 items-center gap-2 bg-muted px-4 text-xs text-muted-foreground'><Newspaper className='h-5 w-5' />Publisher story</div>
                  )}
                  <div className='p-3'>
                    <div className='flex items-center gap-2'>
                      {item.favicon_url ? <img src={item.favicon_url} alt='' loading='lazy' onError={e => { e.currentTarget.style.display = 'none'; }} className='h-5 w-5 rounded object-contain' /> : null}
                      <span className='truncate text-[11px] font-bold'>Feed from {publisher}</span>
                      <span className='text-[10px] text-muted-foreground'>· {item.category || 'news'}</span>
                      <span className='ml-auto shrink-0 text-[10px] text-muted-foreground'>{relativeDate(item.published_at)}</span>
                    </div>
                    <h3 className='mt-2 text-base font-bold leading-snug'>{item.title}</h3>
                    {item.excerpt ? <p className='mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground'>{item.excerpt}</p> : null}
                    <div className='mt-2 flex items-center gap-1 text-[10px] font-semibold text-primary'>Read in Testagram <ExternalLink className='h-3 w-3 rotate-180' /></div>
                  </div>
                </button>

                <div className='flex items-center gap-1 border-t border-border px-3 py-2'>
                  {REACTIONS.map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      type='button'
                      aria-label={label + ' reaction'}
                      aria-pressed={selected === key}
                      title={label}
                      onClick={() => react(item.id, key)}
                      className={'flex h-8 min-w-9 items-center justify-center gap-1 rounded-full px-2 text-sm transition-colors ' + (selected === key ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'hover:bg-muted')}
                    >
                      <Icon className='h-4 w-4' />
                    </button>
                  ))}
                  <span className='ml-1 text-[10px] text-muted-foreground'>
                    {selected ? 'Your temporary reaction' : 'React temporarily'}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
