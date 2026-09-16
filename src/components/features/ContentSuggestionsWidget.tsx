import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Loader2, BadgeCheck, Flame, Sparkles, Clock } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

type SuggestionPost = {
  id: string;
  content: string;
  image_url?: string;
  video_url?: string;
  likes_count: number;
  reposts_count: number;
  views_count: number;
  created_at: string;
  is_video: boolean;
  user_profiles: {
    username: string;
    avatar_url?: string;
    verified?: boolean;
    is_creator?: boolean;
  };
  _reason?: string; // Why this was suggested
};

export function ContentSuggestionsWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SuggestionPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'trending' | 'new' | 'creators'>('trending');

  useEffect(() => {
    fetchSuggestions(activeTab);
  }, [user, activeTab]);

  const fetchSuggestions = async (tab: typeof activeTab) => {
    setLoading(true);
    try {
      let posts: SuggestionPost[] = [];

      if (tab === 'trending') {
        // All-time viral posts — great for new users with no history
        const { data: viral } = await supabase
          .from('posts')
          .select('*, profiles(username, avatar_url, verified_tier)')
          .is('community_id', null)
          .gt('likes_count', 0)
          .order('likes_count', { ascending: false })
          .limit(8);

        posts = (viral || []).map(p => ({ ...p, _reason: 'trending' }));

      } else if (tab === 'new') {
        // Fresh content from the last 48 hours — for engaged/veteran users
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: fresh } = await supabase
          .from('posts')
          .select('*, profiles(username, avatar_url, verified_tier)')
          .is('community_id', null)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(8);

        posts = (fresh || []).map(p => ({ ...p, _reason: 'new' }));

      } else if (tab === 'creators') {
        // Posts from verified creators — high-quality content signal
        const { data: creatorPosts } = await supabase
          .from('posts')
          .select('*, user_profiles!inner(username, avatar_url, verified, is_creator)')
          .is('community_id', null)
          .eq('user_profiles.is_creator', true)
          .order('views_count', { ascending: false })
          .limit(8);

        posts = (creatorPosts || []).map(p => ({ ...p, _reason: 'creator' }));
      }

      // If user is logged in, exclude posts they already authored
      if (user) {
        posts = posts.filter(p => (p as any).user_id !== user.id);
      }

      setSuggestions(posts.slice(0, 5));
    } catch (error) {
      console.error('[ContentSuggestions] fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Tab keys — no icon components in data array (esbuild guard)
  const TAB_KEYS: Array<'trending' | 'new' | 'creators'> = ['trending', 'new', 'creators'];
  const TAB_LABELS = ['Trending', 'New', 'Creators'];

  return (
    <div className="bg-muted/20 rounded-xl p-4">
      {/* Header */}
      <h2 className="text-base font-bold mb-3 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary" />
        Suggested for you
      </h2>

      {/* Tabs — explicit render to avoid icon-in-data esbuild trigger */}
      <div className="flex gap-1 mb-3 bg-muted rounded-lg p-1">
        {TAB_KEYS.map((key, i) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
              activeTab === key
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {key === 'trending' && <Flame className="w-3 h-3" />}
            {key === 'new' && <Clock className="w-3 h-3" />}
            {key === 'creators' && <Sparkles className="w-3 h-3" />}
            {TAB_LABELS[i]}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : suggestions.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-4">No suggestions yet</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((post) => (
            <div
              key={post.id}
              onClick={() => navigate(`/post/${post.id}`)}
              className="cursor-pointer hover:bg-muted/40 -mx-1 px-1 py-2 rounded-lg transition-colors"
            >
              <div className="flex items-start gap-2 mb-1.5">
                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-full bg-muted overflow-hidden flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/profile/${post.user_profiles?.username}`);
                  }}
                >
                  {post.user_profiles?.avatar_url ? (
                    <img
                      src={post.user_profiles.avatar_url}
                      alt={post.user_profiles.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold">
                      {post.user_profiles?.username?.[0]?.toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-semibold text-xs truncate">
                      {post.user_profiles?.username}
                    </span>
                    {post.user_profiles?.verified && (
                      <BadgeCheck className="w-3 h-3 text-primary flex-shrink-0" fill="currentColor" />
                    )}
                    {post.user_profiles?.is_creator && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                        Creator
                      </span>
                    )}
                    <span className="text-muted-foreground text-[10px] ml-auto flex-shrink-0">
                      {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Content */}
              <p className="text-sm line-clamp-2 mb-1.5 pl-9">{post.content}</p>

              {/* Media thumbnail */}
              {(post.image_url || post.video_url) && (
                <div className="pl-9">
                  <div className="relative rounded-lg overflow-hidden max-h-28">
                    {post.is_video && post.video_url ? (
                      <div className="relative">
                        <video
                          src={post.video_url}
                          className="w-full h-28 object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center">
                            <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-gray-800 border-b-[6px] border-b-transparent ml-1" />
                          </div>
                        </div>
                      </div>
                    ) : post.image_url ? (
                      <img
                        src={post.image_url}
                        alt="Post"
                        className="w-full h-28 object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-3 pl-9 mt-1.5 text-[11px] text-muted-foreground">
                <span>❤️ {formatNumber(post.likes_count)}</span>
                <span>🔁 {formatNumber(post.reposts_count)}</span>
                <span>👁 {formatNumber(post.views_count)}</span>
                {/* Reason badge */}
                {post._reason === 'trending' && (
                  <span className="ml-auto text-orange-500 font-medium flex items-center gap-0.5">
                    <Flame className="w-2.5 h-2.5" /> Hot
                  </span>
                )}
                {post._reason === 'new' && (
                  <span className="ml-auto text-blue-500 font-medium flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" /> New
                  </span>
                )}
                {post._reason === 'creator' && (
                  <span className="ml-auto text-primary font-medium flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" /> Creator
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
