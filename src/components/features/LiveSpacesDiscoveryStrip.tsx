import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Headphones, Radio, Users, Video, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';

type LiveSpace = {
  id: string;
  title: string;
  host_id: string;
  listener_count: number | null;
  started_at: string | null;
  category: string | null;
  artwork_url: string | null;
  has_video: boolean | null;
  host?: { username?: string | null; display_name?: string | null; avatar_url?: string | null } | null;
};

const HIDDEN_KEY = 'testagram_live_spaces_hidden_until';
const POLL_MS = 15_000;

export function LiveSpacesDiscoveryStrip() {
  const location = useLocation();
  const [spaces, setSpaces] = useState<LiveSpace[]>([]);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('spaces')
      .select('id,title,host_id,listener_count,started_at,category,artwork_url,has_video,host:profiles!spaces_host_id_fkey(username,display_name,avatar_url)')
      .eq('is_live', true)
      .eq('is_archived', false)
      .order('listener_count', { ascending: false })
      .limit(8);
    if (data) setSpaces(data as unknown as LiveSpace[]);
  }, []);

  useEffect(() => {
    try {
      const until = Number(sessionStorage.getItem(HIDDEN_KEY) || '0');
      setHidden(until > Date.now());
    } catch {}
    void load();
    const timer = window.setInterval(load, POLL_MS);
    const channel = supabase
      .channel('live-spaces-discovery')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, () => void load())
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  if (
    hidden ||
    spaces.length === 0 ||
    location.pathname === '/spaces' ||
    location.pathname.startsWith('/spaces/') ||
    location.pathname.startsWith('/start-stream') ||
    location.pathname.startsWith('/tv-studio') ||
    location.pathname.startsWith('/live/')
  ) return null;

  const hide = () => {
    setHidden(true);
    try { sessionStorage.setItem(HIDDEN_KEY, String(Date.now() + 60 * 60 * 1000)); } catch {}
  };

  return (
    <section className="border-b border-border bg-background/95 backdrop-blur-sm px-3 py-2" aria-label="Live now">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <span className="text-sm font-bold">Live now</span>
          <span className="text-xs text-muted-foreground">{spaces.length} {spaces.length === 1 ? 'space' : 'spaces'}</span>
          <Link to="/spaces" className="ml-auto text-xs font-semibold text-primary hover:underline">See all</Link>
          <button onClick={hide} className="p-1 rounded-full hover:bg-muted" aria-label="Hide live spaces">
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {spaces.map(space => {
            const host = space.host || {};
            return (
              <Link
                key={space.id}
                to={`/spaces?space=${encodeURIComponent(space.id)}`}
                className="shrink-0 w-[220px] rounded-xl border border-border bg-card hover:bg-muted/60 transition-colors p-2.5 flex items-center gap-2.5"
              >
                <div className="relative shrink-0 w-11 h-11 rounded-full overflow-hidden bg-primary/10 ring-2 ring-red-500/50">
                  {space.artwork_url || host.avatar_url
                    ? <img src={space.artwork_url || host.avatar_url || ''} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><Headphones className="w-5 h-5 text-primary" /></div>}
                  <span className="absolute bottom-0 right-0 rounded-full bg-red-500 text-white p-0.5">
                    {space.has_video ? <Video className="w-2.5 h-2.5" /> : <Radio className="w-2.5 h-2.5" />}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{space.title}</p>
                  <p className="text-xs text-muted-foreground truncate">@{host.username || 'host'}</p>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <Users className="w-3 h-3" /> {formatNumber(space.listener_count ?? 0)}
                    <span>•</span><span>{space.has_video ? 'TV live' : 'Audio live'}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
