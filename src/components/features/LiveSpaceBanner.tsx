import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Radio, Users, X, ChevronRight } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

const POLL_MS = 30_000;
const DISMISS_KEY = 'live_space_banner_dismissed_ids';

function getDismissedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveDismissedId(id: string) {
  try {
    const ids = getDismissedIds();
    ids.add(id);
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {}
}

export function LiveSpaceBanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const [liveSpace, setLiveSpace] = useState<any | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Don't show on the spaces page itself or the videos page (full-screen)
  const isSpacesPage = location.pathname === '/spaces';
  const isVideosPage = location.pathname === '/videos';

  const fetchLiveSpace = async () => {
    try {
      const { data } = await supabase
        .from('spaces')
        .select('id, title, host_id, listener_count, started_at, profiles(id, username, avatar_url)')
        .eq('is_live', true)
        .eq('is_archived', false)
        .order('listener_count', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        const dismissedIds = getDismissedIds();
        if (dismissedIds.has(data.id)) {
          setLiveSpace(null);
        } else {
          setLiveSpace(data);
          setDismissed(false);
        }
      } else {
        setLiveSpace(null);
      }
    } catch {
      // silently fail — banner is non-critical
    }
  };

  useEffect(() => {
    fetchLiveSpace();
    pollRef.current = setInterval(fetchLiveSpace, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (liveSpace) saveDismissedId(liveSpace.id);
    setDismissed(true);
    setLiveSpace(null);
  };

  if (!liveSpace || dismissed || isSpacesPage || isVideosPage) return null;

  const host = liveSpace.user_profiles ?? {};

  return (
    <div
      className="fixed left-0 right-0 z-[200] animate-slide-in"
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {/* Centered pill — max width matches content column */}
      <div className="max-w-2xl mx-auto px-4">
        <button
          onClick={() => navigate('/spaces')}
          className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-purple-700/95 via-violet-700/95 to-indigo-700/95 backdrop-blur-md border border-purple-500/40 rounded-2xl shadow-2xl shadow-purple-900/50 hover:from-purple-600/95 hover:to-indigo-600/95 active:scale-[0.99] transition-all text-left group"
        >
          {/* LIVE pill */}
          <div className="shrink-0 flex items-center gap-1.5 bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </div>

          {/* Host avatar */}
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-full bg-white/20 overflow-hidden border-2 border-purple-400/60">
              {host.avatar_url ? (
                <img src={host.avatar_url} alt={host.username} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-purple-500">
                  <span className="text-white text-sm font-black">
                    {host.username?.[0]?.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-purple-700" />
          </div>

          {/* Title + host */}
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate leading-tight">
              {liveSpace.title}
            </p>
            <p className="text-purple-200/80 text-[11px] truncate">
              @{host.username}
            </p>
          </div>

          {/* Listeners */}
          <div className="shrink-0 flex items-center gap-1 text-purple-200/70 text-xs mr-1">
            <Users className="w-3 h-3" />
            <span className="font-semibold">{formatNumber(liveSpace.listener_count ?? 0)}</span>
          </div>

          {/* Join CTA */}
          <div className="shrink-0 flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1.5 rounded-full transition-colors">
            <Radio className="w-3 h-3" />
            <span>Join</span>
            <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </div>

          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white/70 hover:text-white transition-colors ml-1"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </button>
      </div>
    </div>
  );
}
