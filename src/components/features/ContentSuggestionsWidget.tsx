import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Loader2, BadgeCheck, Flame, Sparkles, Clock, Users, Search } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

type SuggestionPost = {
  id: string; content?: string; image_url?: string; video_url?: string; is_video?: boolean;
  likes_count?: number; reposts_count?: number; views_count?: number; created_at: string; user_id?: string;
  profiles?: { username: string; avatar_url?: string; verified_tier?: string | null; is_creator?: boolean } | null;
  _reason?: string;
};

export function ContentSuggestionsWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SuggestionPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'for-you' | 'trending' | 'new' | 'creators'>('for-you');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const following = user ? (await supabase.from('follows').select('following_id').eq('follower_id', user.id)).data ?? [] : [];
        const followingIds = following.map(row => row.following_id);
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        let posts: SuggestionPost[] = [];

        if (activeTab === 'for-you' && followingIds.length) {
          const { data } = await supabase.from('posts').select('id,content,image_url,video_url,is_video,likes_count,reposts_count,views_count,created_at,user_id,profiles(username,avatar_url,verified_tier,is_creator)').is('community_id', null).in('user_id', followingIds.slice(0, 50)).order('created_at', { ascending: false }).limit(12);
          posts = (data ?? []).map(p => ({ ...p, _reason: 'from people you follow' }));
        }
        if (activeTab === 'trending' || (activeTab === 'for-you' && posts.length < 5)) {
          const { data } = await supabase.from('posts').select('id,content,image_url,video_url,is_video,likes_count,reposts_count,views_count,created_at,user_id,profiles(username,avatar_url,verified_tier,is_creator)').is('community_id', null).gt('likes_count', 0).order('likes_count', { ascending: false }).limit(12);
          posts = [...posts, ...(data ?? []).map(p => ({ ...p, _reason: 'trending now' }))];
        }
        if (activeTab === 'new') {
          const { data } = await supabase.from('posts').select('id,content,image_url,video_url,is_video,likes_count,reposts_count,views_count,created_at,user_id,profiles(username,avatar_url,verified_tier,is_creator)').is('community_id', null).gte('created_at', since).order('created_at', { ascending: false }).limit(12);
          posts = (data ?? []).map(p => ({ ...p, _reason: 'fresh on Testagram' }));
        }
        if (activeTab === 'creators') {
          const { data } = await supabase.from('posts').select('id,content,image_url,video_url,is_video,likes_count,reposts_count,views_count,created_at,user_id,profiles!inner(username,avatar_url,verified_tier,is_creator)').is('community_id', null).eq('profiles.is_creator', true).order('views_count', { ascending: false }).limit(12);
          posts = (data ?? []).map(p => ({ ...p, _reason: 'creator content' }));
        }

        const seen = new Set<string>();
        const result = posts.filter(p => {
          if (!p.id || seen.has(p.id) || p.user_id === user?.id) return false;
          seen.add(p.id); return true;
        }).slice(0, 6);
        if (!cancelled) setSuggestions(result);
      } catch (error) {
        console.error('[ContentSuggestions] fetch error:', error);
        if (!cancelled) setSuggestions([]);
      } finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [user?.id, activeTab]);

  const tabs = [
    ['for-you', 'For you', Sparkles],
    ['trending', 'Trending', Flame],
    ['new', 'Latest', Clock],
    ['creators', 'Creators', Users],
  ] as const;

  return (
    <div className="bg-muted/20 rounded-2xl p-4 border border-border/60">
      <div className="flex items-center justify-between mb-3"><h2 className="text-base font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />Suggested for you</h2><button onClick={() => navigate('/search')} className="p-1.5 rounded-full hover:bg-muted" aria-label="Search"><Search className="w-4 h-4" /></button></div>
      <div className="flex gap-1 mb-3 bg-muted rounded-lg p-1 overflow-x-auto">
        {tabs.map(([key, label, Icon]) => <button key={key} onClick={() => setActiveTab(key)} className={`flex-1 min-w-fit flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-[11px] font-semibold ${activeTab === key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Icon className="w-3 h-3" />{label}</button>)}
      </div>
      {loading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : suggestions.length === 0 ? <p className="text-center text-muted-foreground text-sm py-4">No suggestions yet</p> : <div className="space-y-3">
        {suggestions.map(post => {
          const profile = post.profiles;
          const text = post.content ?? '';
          return <article key={post.id} className="cursor-pointer rounded-xl p-2 -mx-2 hover:bg-muted/40" onClick={() => navigate(`/post/${post.id}`)}>
            <div className="flex items-center gap-2 mb-1.5">
              <button type="button" className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0" onClick={e => { e.stopPropagation(); if (profile?.username) navigate(`/profile/${profile.username}`); }}>
                {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full grid place-items-center text-xs font-bold">{profile?.username?.[0]?.toUpperCase()}</span>}
              </button>
              <button type="button" className="min-w-0 text-left" onClick={e => { e.stopPropagation(); if (profile?.username) navigate(`/profile/${profile.username}`); }}>
                <span className="flex items-center gap-1 font-semibold text-xs truncate">{profile?.username ?? 'Testagram'}{profile?.verified_tier && <BadgeCheck className="w-3 h-3 text-primary" fill="currentColor" />}</span>
                <span className="text-[10px] text-muted-foreground">{post._reason} · {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</span>
              </button>
            </div>
            <p className="text-sm line-clamp-2 pl-10">{text}</p>
            {(post.image_url || post.video_url) && <div className="pl-10 mt-2 rounded-lg overflow-hidden relative"><div className="h-28 bg-muted">{post.is_video && post.video_url ? <video src={post.video_url} className="w-full h-full object-cover" muted playsInline preload="metadata" /> : post.image_url ? <img src={post.image_url} alt="" className="w-full h-full object-cover" loading="lazy" /> : null}</div>{post.is_video && <span className="absolute left-2 bottom-2 text-[10px] px-1.5 py-0.5 rounded-full bg-black/70 text-white">Video</span>}</div>}
            <div className="flex items-center gap-3 pl-10 mt-1.5 text-[10px] text-muted-foreground"><span>♥ {formatNumber(post.likes_count ?? 0)}</span><span>↻ {formatNumber(post.reposts_count ?? 0)}</span><span>◉ {formatNumber(post.views_count ?? 0)}</span></div>
          </article>;
        })}
      </div>}
      <button onClick={() => navigate('/explore')} className="w-full mt-3 pt-3 border-t border-border/60 text-primary hover:underline text-xs font-semibold">Explore more</button>
    </div>
  );
}
