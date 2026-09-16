import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Play, Eye, Flame, TrendingUp, ChevronRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatNumber } from '@/lib/utils';

interface VideoPost {
  id: string;
  video_url: string | null;
  image_url: string | null;
  views_count: number;
  likes_count: number;
  content: string;
  user_profiles: { username: string; avatar_url: string | null } | null;
}

function normalizeVideoPosts(rows: any[] | null | undefined): VideoPost[] {
  return (rows ?? []).map((row) => ({ ...row, user_profiles: Array.isArray(row?.user_profiles) ? row.user_profiles[0] ?? null : row?.user_profiles ?? null }));
}

interface Props {
  /** compact = horizontal row (for homepage feed), full = mosaic grid (for Explore) */
  variant?: 'compact' | 'full';
}

export function TrendingVideosSection({ variant = 'compact' }: Props) {
  const [videos, setVideos] = useState<VideoPost[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('posts')
        .select('id, video_url, image_url, views_count, likes_count, content, user_profiles(username, avatar_url)')
        .eq('is_video', true)
        .gte('created_at', since)
        .order('views_count', { ascending: false })
        .limit(10);

      if (recent && recent.length >= 3) {
        setVideos(normalizeVideoPosts(recent));
      } else {
        // Fallback: all-time top videos
        const { data: allTime } = await supabase
          .from('posts')
          .select('id, video_url, image_url, views_count, likes_count, content, user_profiles(username, avatar_url)')
          .eq('is_video', true)
          .order('views_count', { ascending: false })
          .limit(10);
        setVideos(normalizeVideoPosts(allTime));
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="border-b border-border py-4 px-4">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-4 h-4 text-orange-500" />
          <span className="font-bold text-sm">Trending Videos</span>
        </div>
        {variant === 'full' ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-1 h-52 rounded-2xl bg-muted animate-pulse" />
            <div className="grid grid-cols-2 gap-2">
              {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}
            </div>
          </div>
        ) : (
          <div className="flex gap-2.5">
            {[0,1,2,3,4].map(i => <div key={i} className="shrink-0 w-28 h-40 rounded-xl bg-muted animate-pulse" />)}
          </div>
        )}
      </div>
    );
  }

  if (videos.length === 0) return null;

  /* ── COMPACT variant (homepage horizontal scroll) ────────────────────────── */
  if (variant === 'compact') {
    return (
      <div className="border-b border-border bg-gradient-to-r from-orange-500/5 via-background to-red-500/5 py-3">
        <div className="flex items-center gap-2 px-4 mb-2.5">
          <Flame className="w-4 h-4 text-orange-500 shrink-0" />
          <h3 className="font-bold text-sm">Trending Videos</h3>
          <span className="text-[10px] font-bold text-orange-500/70 bg-orange-500/10 px-1.5 py-0.5 rounded-full">24h</span>
          <button onClick={() => navigate('/videos')} className="ml-auto text-xs text-primary font-semibold hover:underline flex items-center gap-0.5">
            See all <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-1">
          {videos.map((v, i) => (
            <VideoThumb key={v.id} video={v} rank={i} onClick={() => navigate(`/videos?id=${v.id}`)} />
          ))}
        </div>
      </div>
    );
  }

  /* ── FULL variant (Explore mosaic) ───────────────────────────────────────── */
  const [featured, ...rest] = videos;
  const gridVideos = rest.slice(0, 8);

  return (
    <div className="py-4 px-4 space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0">
          <TrendingUp className="w-4 h-4 text-orange-500" />
        </div>
        <h2 className="font-bold text-base">Trending Videos</h2>
        <span className="text-[10px] font-black text-orange-500/80 bg-orange-500/10 px-2 py-0.5 rounded-full border border-orange-500/20">
          TOP 24H
        </span>
        <button
          onClick={() => navigate('/videos')}
          className="ml-auto text-xs text-primary font-semibold hover:underline flex items-center gap-0.5"
        >
          Open Reels <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mosaic layout: featured large + 2×2 grid */}
      <div className="grid grid-cols-5 gap-2" style={{ height: 220 }}>
        {/* Featured card — 2/5 width */}
        {featured && (
          <button
            onClick={() => navigate(`/videos?id=${featured.id}`)}
            className="col-span-2 relative rounded-2xl overflow-hidden bg-zinc-900 hover:scale-[1.02] active:scale-[0.98] transition-transform ring-0 hover:ring-2 hover:ring-orange-500/50 focus:outline-none h-full shadow-lg"
          >
            {/* Gold rank badge */}
            <div className="absolute top-2 left-2 z-10 w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-[10px] font-black text-black shadow-md">
              🥇
            </div>
            <ThumbnailMedia video={featured} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent" />
            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-11 h-11 bg-white/25 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/40">
                <Play className="w-5 h-5 text-white fill-white ml-0.5" />
              </div>
            </div>
            {/* Stats */}
            <div className="absolute bottom-3 left-2 right-2">
              <p className="text-white text-[10px] font-bold truncate mb-0.5 leading-tight line-clamp-2">
                {featured.content?.slice(0, 55) || 'Trending video'}
              </p>
              <div className="flex items-center gap-1 text-white/80 text-[9px] font-semibold">
                <Eye className="w-2.5 h-2.5" />
                <span>{formatNumber(featured.views_count || 0)} views</span>
              </div>
            </div>
          </button>
        )}

        {/* 2×2 grid on the right — 3/5 width */}
        <div className="col-span-3 grid grid-cols-2 gap-2 h-full">
          {gridVideos.slice(0, 4).map((v, i) => (
            <button
              key={v.id}
              onClick={() => navigate(`/videos?id=${v.id}`)}
              className="relative rounded-xl overflow-hidden bg-zinc-900 hover:scale-[1.03] active:scale-[0.97] transition-transform focus:outline-none hover:ring-2 hover:ring-orange-500/40"
            >
              {/* Rank badge */}
              <div className="absolute top-1.5 left-1.5 z-10 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black shadow"
                style={{ background: i === 0 ? '#C0C0C0' : i === 1 ? '#CD7F32' : '#444', color: i < 2 ? '#000' : '#fff' }}>
                {i + 2}
              </div>
              <ThumbnailMedia video={v} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-7 h-7 bg-white/20 rounded-full flex items-center justify-center border border-white/30">
                  <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                </div>
              </div>
              <div className="absolute bottom-1.5 left-1.5 right-1.5">
                <div className="flex items-center gap-0.5 text-white text-[8px] font-bold">
                  <Eye className="w-2 h-2" />{formatNumber(v.views_count || 0)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Remaining horizontal scroll row */}
      {gridVideos.length > 4 && (
        <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4">
          {gridVideos.slice(4).map((v, i) => (
            <VideoThumb key={v.id} video={v} rank={i + 5} onClick={() => navigate(`/videos?id=${v.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Shared thumbnail card ────────────────────────────────────────────────── */
function VideoThumb({ video, rank, onClick }: { video: VideoPost; rank: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 relative w-[108px] h-[160px] rounded-xl overflow-hidden bg-zinc-900 shadow-lg hover:scale-[1.04] active:scale-[0.97] transition-transform ring-0 hover:ring-2 hover:ring-orange-500/50 focus:outline-none"
    >
      {rank < 3 && (
        <div className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shadow-md"
          style={{ background: rank === 0 ? '#FFD700' : rank === 1 ? '#C0C0C0' : '#CD7F32', color: '#000' }}>
          {rank + 1}
        </div>
      )}
      <ThumbnailMedia video={video} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/30">
          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
        </div>
      </div>
      <div className="absolute bottom-2 left-1.5 right-1.5">
        <div className="flex items-center gap-0.5 text-white text-[9px] font-bold mb-0.5">
          <Eye className="w-2.5 h-2.5 shrink-0" />{formatNumber(video.views_count || 0)}
        </div>
        <p className="text-white/70 text-[8px] truncate">@{video.user_profiles?.username}</p>
      </div>
    </button>
  );
}

function ThumbnailMedia({ video }: { video: VideoPost }) {
  if (video.image_url) {
    return <img src={video.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />;
  }
  if (video.video_url) {
    return (
      <video
        src={`${video.video_url}#t=0.5`}
        className="w-full h-full object-cover"
        muted
        preload="metadata"
        playsInline
      />
    );
  }
  return (
    <div className="w-full h-full bg-gradient-to-br from-orange-900 to-red-900 flex items-center justify-center">
      <Play className="w-8 h-8 text-white/30 fill-white/30" />
    </div>
  );
}
