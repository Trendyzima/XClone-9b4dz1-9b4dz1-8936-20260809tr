import { useState, useEffect, useRef } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  Eye,
  Heart,
  Repeat2,
  MessageCircle,
  Users,
  BarChart3,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

// ── AdSense banner — push-guarded ─────────────────────────────────────────────
// AnalyticsAdBanner is defined above

interface PostWithAnalytics {
  id: string;
  content: string;
  likes_count: number;
  reposts_count: number;
  replies_count: number;
  views_count: number;
  created_at: string;
  analytics: {
    views: number;
    unique_viewers: number;
    engagement_rate: number;
  };
}

function AnalyticsAdBanner() { return <PageAdBanner />; }
export default function AnalyticsDashboard() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Analytics', url: '/analytics' });
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [overviewStats, setOverviewStats] = useState({
    total_posts: 0,
    total_views: 0,
    total_likes: 0,
    total_reposts: 0,
    total_replies: 0,
    followers: 0,
    following: 0,
  });
  const [topPosts, setTopPosts] = useState<PostWithAnalytics[]>([]);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchAnalytics();
  }, [user]);

  const fetchAnalytics = async () => {
    if (!user) return;

    try {
      // Get overview stats
      const { data: posts } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', user.id);

      const total_posts = posts?.length || 0;
      const total_views = posts?.reduce((sum, p) => sum + (p.views_count || 0), 0) || 0;
      const total_likes = posts?.reduce((sum, p) => sum + (p.likes_count || 0), 0) || 0;
      const total_reposts = posts?.reduce((sum, p) => sum + (p.reposts_count || 0), 0) || 0;
      const total_replies = posts?.reduce((sum, p) => sum + (p.replies_count || 0), 0) || 0;

      const { data: profile } = await supabase
        .from('profiles')
        .select('follower_count, following_count')
        .eq('id', user.id)
        .single();

      setOverviewStats({
        total_posts,
        total_views,
        total_likes,
        total_reposts,
        total_replies,
        followers: profile?.follower_count || 0,
        following: profile?.following_count || 0,
      });

      // Get posts with their analytics
      const { data: postsWithAnalytics, error } = await supabase
        .from('posts')
        .select(`
          *,
          analytics:post_analytics(views, unique_viewers, engagement_rate)
        `)
        .eq('user_id', user.id)
        .order('views_count', { ascending: false })
        .limit(10);

      if (error) throw error;

      const formattedPosts: PostWithAnalytics[] = (postsWithAnalytics || []).map((post: any) => ({
        id: post.id,
        content: post.content,
        likes_count: post.likes_count || 0,
        reposts_count: post.reposts_count || 0,
        replies_count: post.replies_count || 0,
        views_count: post.views_count || 0,
        created_at: post.created_at,
        analytics: {
          views: post.analytics?.views || post.views_count || 0,
          unique_viewers: post.analytics?.unique_viewers || Math.max(1, Math.floor((post.views_count || 0) / 2)),
          engagement_rate: post.analytics?.engagement_rate || (
            post.views_count > 0 
              ? ((post.likes_count + post.reposts_count + post.replies_count) / post.views_count * 100)
              : 0
          ),
        },
      }));

      setTopPosts(formattedPosts);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Analytics" showBack />
      <AnalyticsAdBanner />

      <div className="p-4 space-y-6">
        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-muted-foreground mb-2">
              <Eye className="w-4 h-4" />
              <span className="text-sm">Total Views</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.total_views)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-pink-600 mb-2">
              <Heart className="w-4 h-4" />
              <span className="text-sm text-muted-foreground">Total Likes</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.total_likes)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-green-600 mb-2">
              <Repeat2 className="w-4 h-4" />
              <span className="text-sm text-muted-foreground">Total Reposts</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.total_reposts)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-primary mb-2">
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm text-muted-foreground">Total Replies</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.total_replies)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-muted-foreground mb-2">
              <BarChart3 className="w-4 h-4" />
              <span className="text-sm">Total Posts</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.total_posts)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-muted-foreground mb-2">
              <Users className="w-4 h-4" />
              <span className="text-sm">Followers</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.followers)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-muted-foreground mb-2">
              <Users className="w-4 h-4" />
              <span className="text-sm">Following</span>
            </div>
            <p className="text-2xl font-bold">{formatNumber(overviewStats.following)}</p>
          </div>

          <div className="bg-muted/30 p-4 rounded-xl">
            <div className="flex items-center space-x-2 text-muted-foreground mb-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">Avg Engagement</span>
            </div>
            <p className="text-2xl font-bold">
              {overviewStats.total_views > 0
                ? `${((overviewStats.total_likes + overviewStats.total_reposts) / overviewStats.total_views * 100).toFixed(1)}%`
                : '0%'}
            </p>
          </div>
        </div>

        {/* Top Performing Posts */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Top Performing Posts
          </h2>
          <div className="space-y-3">
            {topPosts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">No analytics data available yet</p>
                <p className="text-sm mt-1">Start posting to see your analytics</p>
              </div>
            ) : (
              topPosts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => navigate(`/post/${post.id}`)}
                  className="bg-gradient-to-br from-muted/30 to-muted/10 border border-border p-4 rounded-xl hover:bg-muted/50 transition-all cursor-pointer hover:shadow-md"
                >
                  <p className="line-clamp-2 mb-4 text-base">{post.content}</p>
                  
                  <div className="flex justify-between items-center">
                    <div className="flex space-x-4 text-sm">
                      <div className="flex items-center space-x-1.5 text-muted-foreground">
                        <Eye className="w-4 h-4" />
                        <span className="font-medium">{formatNumber(post.analytics.views)}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-pink-600">
                        <Heart className="w-4 h-4" />
                        <span className="font-medium">{formatNumber(post.likes_count)}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-green-600">
                        <Repeat2 className="w-4 h-4" />
                        <span className="font-medium">{formatNumber(post.reposts_count)}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-primary">
                        <MessageCircle className="w-4 h-4" />
                        <span className="font-medium">{formatNumber(post.replies_count)}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="px-3 py-1 bg-primary/10 border border-primary/20 rounded-full">
                        <span className="text-sm font-bold text-primary">
                          {post.analytics.engagement_rate.toFixed(1)}% engagement
                        </span>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                    Posted {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })} · 
                    {' '}{formatNumber(post.analytics.unique_viewers)} unique viewers
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
