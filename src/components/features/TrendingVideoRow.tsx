import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Play, Eye, Flame, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '@/lib/utils';

export function TrendingVideoRow() {
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('posts')
        .select('id, video_url, image_url, views_count, likes_count, content, user_profiles:profiles!posts_user_id_fkey(username, avatar_url)')
        .eq('is_video', true)
        .gte('created_at', since)
        .order('views_count', { ascending: false })
        .limit(8);

      if (recent && recent.length >= 3) {
        setVideos(recent);
      } else {
        // Fallback: all-time top videos
        const { data: allTime } = await supabase
          .from('posts')
          .select('id, video_url, image_url, views_count, likes_count, content, user_profiles:profiles!posts_user_id_fkey(username, avatar_url)')
          .eq('is_video', true)
          .order('views_count', { ascending: false })
          .limit(8);
        setVideos(allTime || []);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="border-b border-border py-3 px-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Flame className="w-4 h-4 text-orange-500" />
          <span className="font-bold text-sm">Trending Videos</span>
        </div>
        <div className="flex gap-2.5 overflow-hidden">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="shrink-0 w-28 h-40 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (videos.length === 0) return null;

  return (
    <div className="border-b border-border bg-gradient-to-r from-orange-500/5 via-background to-red-500/5 py-3">
      <div className="flex items-center gap-2 px-4 mb-2.5">
        <Flame className="w-4 h-4 text-orange-500 shrink-0" />
        <h3 className="font-bold text-sm text-foreground">Trending Videos</h3>
        <span className="text-[10px] font-bold text-orange-500/70 bg-orange-500/10 px-1.5 py-0.5 rounded-full">24h</span>
        <button
          onClick={() => navigate('/videos')}
          className="ml-auto text-xs text-primary font-semibold hover:underline"
        >
          See all →
        </button>
      </div>
      <div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-1">
        {videos.map((video, i) => (
          <button
            key={video.id}
            onClick={() => navigate(`/videos?id=${video.id}`)}
            className="shrink-0 relative w-[108px] h-[160px] rounded-xl overflow-hidden bg-zinc-900 shadow-lg hover:scale-[1.04] active:scale-[0.97] transition-transform ring-0 hover:ring-2 hover:ring-orange-500/50 focus:outline-none"
          >
            {/* Rank badge */}
            {i < 3 && (
              <div className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shadow-md"
                style={{ background: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : '#CD7F32', color: '#000' }}>
                {i + 1}
              </div>
            )}

            {/* Thumbnail */}
            {video.image_url ? (
              <img src={video.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : video.video_url ? (
              <video
                src={`${video.video_url}#t=0.5`}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
                playsInline
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-orange-900 to-red-900 flex items-center justify-center">
                <Play className="w-8 h-8 text-white/30 fill-white/30" />
              </div>
            )}

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />

            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/30">
                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
              </div>
            </div>

            {/* Stats */}
            <div className="absolute bottom-2 left-1.5 right-1.5">
              <div className="flex items-center gap-0.5 text-white text-[9px] font-bold mb-0.5">
                <Eye className="w-2.5 h-2.5 shrink-0" />
                {formatNumber(video.views_count || 0)}
              </div>
              <p className="text-white/70 text-[8px] truncate">@{video.user_profiles?.username}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
