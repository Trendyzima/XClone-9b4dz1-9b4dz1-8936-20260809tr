import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Headphones, Radio, Users, Video, X, Tv } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';

type Host = { username?: string | null; display_name?: string | null; avatar_url?: string | null };
type LiveSpace = { id: string; title: string; host_id: string; listener_count: number | null; started_at: string | null; category: string | null; artwork_url: string | null; has_video: boolean | null; host?: Host | null };
type LiveTv = { id: string; title: string; user_id: string; viewer_count: number | null; started_at: string | null; category: string | null; thumbnail_url: string | null; user?: Host | null };
type LiveChannel = ({ kind: 'audio' | 'video-space' } & LiveSpace) | ({ kind: 'tv' } & LiveTv);

const HIDDEN_KEY = 'testagram_live_channels_hidden_until';
const POLL_MS = 10_000;

export function LiveSpacesDiscoveryStrip() {
  const location = useLocation();
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    const [spacesResult, tvResult] = await Promise.all([
      supabase.from('spaces').select('id,title,host_id,listener_count,started_at,category,artwork_url,has_video,host:profiles!spaces_host_id_fkey(username,display_name,avatar_url)').eq('is_live', true).eq('is_archived', false).order('listener_count', { ascending: false }).limit(8),
      supabase.from('live_streams').select('id,title,user_id,viewer_count,started_at,category,thumbnail_url,user:profiles!live_streams_user_id_fkey(username,display_name,avatar_url)').eq('is_live', true).order('viewer_count', { ascending: false }).limit(8),
    ]);
    const audio: LiveChannel[] = (spacesResult.data ?? []).map((s: any) => ({ ...s, kind: s.has_video ? 'video-space' : 'audio' }));
    const tv: LiveChannel[] = (tvResult.data ?? []).map((s: any) => ({ ...s, kind: 'tv' }));
    const all = [...audio, ...tv];
    const audience = (item: LiveChannel) => item.kind === 'tv' ? Number(item.viewer_count ?? 0) : Number(item.listener_count ?? 0);
    setChannels(all.sort((a, b) => audience(b) - audience(a)).slice(0, 10));
  }, []);

  useEffect(() => {
    try { setHidden(Number(sessionStorage.getItem(HIDDEN_KEY) || '0') > Date.now()); } catch {}
    void load();
    const timer = window.setInterval(load, POLL_MS);
    const channel = supabase.channel('live-channels-discovery')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_streams' }, () => void load())
      .subscribe();
    return () => { window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const excluded = location.pathname === '/spaces' || location.pathname.startsWith('/spaces/') || location.pathname.startsWith('/start-stream') || location.pathname.startsWith('/tv-studio') || location.pathname.startsWith('/stream/') || location.pathname.startsWith('/live/');
  if (hidden || channels.length === 0 || excluded) return null;

  const hide = () => {
    setHidden(true);
    try { sessionStorage.setItem(HIDDEN_KEY, String(Date.now() + 30 * 60 * 1000)); } catch {}
  };

  return (
    <section className="border-b border-border bg-background/95 backdrop-blur-sm px-3 py-2" aria-label="Live now">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-2 mb-2">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" /></span>
          <span className="text-sm font-bold">Live now</span>
          <span className="text-xs text-muted-foreground">{channels.length} live {channels.length === 1 ? 'channel' : 'channels'}</span>
          <Link to="/spaces" className="ml-auto text-xs font-semibold text-primary hover:underline">See all</Link>
          <button onClick={hide} className="p-1 rounded-full hover:bg-muted" aria-label="Hide live channels"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {channels.map(channel => {
            const isTv = channel.kind === 'tv';
            const host = isTv ? (channel.user || {}) : (channel.host || {});
            const count = isTv ? channel.viewer_count : channel.listener_count;
            const image = isTv ? channel.thumbnail_url : (channel.artwork_url || host.avatar_url);
            const to = isTv ? '/stream/' + channel.id : '/spaces?space=' + encodeURIComponent(channel.id);
            return (
              <Link key={channel.kind + '-' + channel.id} to={to} className="shrink-0 w-[235px] rounded-xl border border-border bg-card hover:bg-muted/60 transition-colors p-2.5 flex items-center gap-2.5">
                <div className="relative shrink-0 w-11 h-11 rounded-full overflow-hidden bg-primary/10 ring-2 ring-red-500/50">
                  {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center">{isTv ? <Tv className="w-5 h-5 text-primary" /> : channel.kind === 'video-space' ? <Video className="w-5 h-5 text-primary" /> : <Headphones className="w-5 h-5 text-primary" />}</div>}
                  <span className="absolute bottom-0 right-0 rounded-full bg-red-500 text-white p-0.5">{isTv || channel.kind === 'video-space' ? <Video className="w-2.5 h-2.5" /> : <Radio className="w-2.5 h-2.5" />}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{channel.title}</p>
                  <p className="text-xs text-muted-foreground truncate">@{host.username || 'host'}</p>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5"><Users className="w-3 h-3" /> {formatNumber(count ?? 0)}<span>•</span><span>{isTv ? 'TV live' : channel.kind === 'video-space' ? 'Video Space' : 'Audio live'}</span></div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
