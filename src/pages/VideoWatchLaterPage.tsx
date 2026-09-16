import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Bookmark, Play, Heart, Eye, Loader2, X, Trash2 } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';
import { Post } from '@/types/app-types';

export default function VideoWatchLaterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [videoIds, setVideoIds] = useState<string[]>([]);
  const [videos, setVideos] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    const key = `ts-watchlater-${user.id}`;
    const stored = localStorage.getItem(key);
    const ids: string[] = stored ? JSON.parse(stored) : [];
    setVideoIds(ids);
    if (ids.length === 0) { setLoading(false); return; }
    supabase.from('posts').select('*, profiles(*)')
      .in('id', ids).eq('is_video', true)
      .then(({ data }) => {
        // Preserve localStorage order
        const map = new Map((data ?? []).map((v: any) => [v.id, v]));
        setVideos(ids.map(id => map.get(id)).filter(Boolean) as Post[]);
        setLoading(false);
      });
  }, [user?.id]);

  const removeVideo = (id: string) => {
    if (!user) return;
    const newIds = videoIds.filter(v => v !== id);
    setVideoIds(newIds);
    setVideos(prev => prev.filter(v => v.id !== id));
    localStorage.setItem(`ts-watchlater-${user.id}`, JSON.stringify(newIds));
    toast.success('Removed from Watch Later');
  };

  const clearAll = () => {
    if (!user) return;
    if (!window.confirm('Clear all Watch Later videos?')) return;
    setVideoIds([]);
    setVideos([]);
    localStorage.removeItem(`ts-watchlater-${user.id}`);
    toast.success('Watch Later cleared');
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Watch Later" showBack />

      <div className="sticky top-14 z-20 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-primary" fill="currentColor" />
          <span className="font-semibold text-sm">{videoIds.length} saved video{videoIds.length !== 1 ? 's' : ''}</span>
        </div>
        {videoIds.length > 0 && (
          <button onClick={clearAll} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors font-medium">
            <Trash2 className="w-3.5 h-3.5" />Clear all
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Bookmark className="w-10 h-10 text-primary opacity-40" />
          </div>
          <h2 className="text-xl font-bold mb-2">No saved videos</h2>
          <p className="text-muted-foreground text-sm mb-6">Tap the bookmark icon on any video in the feed to save it here for later.</p>
          <button onClick={() => navigate('/videos')}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-bold hover:opacity-90 transition-opacity">
            <Play className="w-4 h-4" />Browse Videos
          </button>
        </div>
      ) : (
        <>
          {/* Play all button */}
          <div className="px-4 py-3 border-b border-border">
            <button onClick={() => navigate(`/videos?id=${videos[0]?.id}`)}
              className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-opacity">
              <Play className="w-4 h-4" fill="currentColor" />Play All
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3">
            {videos.map((video, idx) => (
              <div key={video.id} className="relative group rounded-xl overflow-hidden bg-black aspect-[9/16] cursor-pointer"
                onClick={() => navigate(`/videos?id=${video.id}`)}>
                {/* Thumbnail */}
                <video
                  src={`${video.video_url}#t=0.5`}
                  className="w-full h-full object-cover"
                  muted
                  preload="metadata"
                />
                {/* Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                {/* Order badge */}
                <div className="absolute top-2 left-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-[10px] font-bold text-white">
                  {idx + 1}
                </div>
                {/* Play icon */}
                <div className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                </div>
                {/* Remove button */}
                <button onClick={e => { e.stopPropagation(); removeVideo(video.id); }}
                  className="absolute top-2 right-2 w-7 h-7 bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                  <X className="w-3.5 h-3.5 text-white" />
                </button>
                {/* Bottom info */}
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
                      {(video as any).user_profiles?.avatar_url
                        ? <img src={(video as any).user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-primary/30 flex items-center justify-center text-[8px] font-bold text-white">{(video as any).user_profiles?.username?.[0]?.toUpperCase()}</div>}
                    </div>
                    <span className="text-white/80 text-[9px] font-semibold truncate">@{(video as any).user_profiles?.username}</span>
                  </div>
                  <p className="text-white text-[10px] font-medium line-clamp-2 leading-tight mb-1">
                    {video.content?.slice(0, 60)}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-0.5 text-white/60 text-[9px]">
                      <Heart className="w-2.5 h-2.5" />{formatNumber(video.likes_count ?? 0)}
                    </span>
                    <span className="flex items-center gap-0.5 text-white/60 text-[9px]">
                      <Eye className="w-2.5 h-2.5" />{formatNumber(video.views_count ?? 0)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
