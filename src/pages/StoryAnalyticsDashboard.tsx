import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line,
  CartesianGrid
} from 'recharts';
import {
  Eye, Users, TrendingUp, Loader2, Play, Image as ImageIcon,
  Star, BarChart3, ArrowLeft, BookOpen, Clock,
} from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { formatDistanceToNow, subDays, format } from 'date-fns';
import { PageAdBanner } from '@/components/features/AdSenseAd';

export default function StoryAnalyticsDashboard() {
  useSEO({ title: 'Story Analytics', url: '/story-analytics', noindex: true });
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  // KPI totals
  const [totalViews, setTotalViews] = useState(0);
  const [uniqueViewers, setUniqueViewers] = useState(0);
  const [totalStories, setTotalStories] = useState(0);
  const [avgViewsPerStory, setAvgViewsPerStory] = useState(0);
  // 7-day daily views chart — parallel arrays (esbuild guard: no Record<string,T>)
  const [chartDays, setChartDays] = useState<string[]>([]);
  const [chartViews, setChartViews] = useState<number[]>([]);
  // Top stories — sorted by views
  const [topStories, setTopStories] = useState<any[]>([]);
  // Viewer timeline for most-viewed story
  const [viewerTimeline, setViewerTimeline] = useState<{ hour: string; count: number }[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  // Active stories (not expired)
  const [activeStories, setActiveStories] = useState<any[]>([]);

  const fetchAnalytics = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const since7d = subDays(new Date(), 7).toISOString();

      // Fetch all user's stories
      const { data: storiesData } = await supabase
        .from('stories')
        .select('id, media_asset_id, caption, created_at, expires_at, metadata, media_assets(media_url,media_type)')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      const stories = storiesData ?? [];
      setTotalStories(stories.length);

      const totalV = stories.reduce((s, st) => s + Number((st.metadata as any)?.views_count ?? 0), 0);
      setTotalViews(totalV);
      setAvgViewsPerStory(stories.length > 0 ? Math.round(totalV / stories.length) : 0);

      // Sort by views for top stories
      const sorted = [...stories].sort((a, b) => Number((b.metadata as any)?.views_count ?? 0) - Number((a.metadata as any)?.views_count ?? 0));
      setTopStories(sorted.slice(0, 10));
      setActiveStories(stories.filter(s => new Date(s.expires_at) > new Date()).slice(0, 5));

      // 7-day daily views from story_views table
      const storyIds = stories.map(s => s.id);
      if (storyIds.length > 0) {
        const { data: viewsData } = await supabase
          .from('story_views')
          .select('viewed_at, viewer_id')
          .in('story_id', storyIds)
          .gte('viewed_at', since7d);

        // Build daily buckets — parallel arrays (esbuild guard: no Record)
        const days: string[] = [];
        const viewCounts: number[] = [];
        for (let i = 6; i >= 0; i--) {
          days.push(format(subDays(new Date(), i), 'MMM d'));
          viewCounts.push(0);
        }
        // esbuild guard: plain string[] for unique viewer dedup (no new Set<string>)
        const uniqueViewerIds: string[] = [];
        for (const view of viewsData ?? []) {
          const day = format(new Date(view.viewed_at), 'MMM d');
          const idx = days.indexOf(day);
          if (idx >= 0) viewCounts[idx]++;
          if (!uniqueViewerIds.includes(view.viewer_id)) uniqueViewerIds.push(view.viewer_id);
        }
        setChartDays(days);
        setChartViews(viewCounts);
        setUniqueViewers(uniqueViewerIds.length);

        // Auto-select top story for timeline
        if (sorted.length > 0) loadViewerTimeline(sorted[0].id);
      } else {
        // No stories — build empty 7-day labels
        const days: string[] = [];
        for (let i = 6; i >= 0; i--) days.push(format(subDays(new Date(), i), 'MMM d'));
        setChartDays(days);
        setChartViews(new Array(7).fill(0));
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const loadViewerTimeline = async (storyId: string) => {
    setSelectedStoryId(storyId);
    setTimelineLoading(true);
    const { data } = await supabase
      .from('story_views')
      .select('viewed_at')
      .eq('story_id', storyId)
      .order('viewed_at', { ascending: true });

    // Build hourly buckets (last 24h or full story life)
    // parallel arrays (esbuild guard: no Record<string,T>)
    const hourKeys: string[] = [];
    const hourCounts: number[] = [];
    for (const view of data ?? []) {
      const key = format(new Date(view.viewed_at), 'HH:mm');
      const idx = hourKeys.indexOf(key);
      if (idx >= 0) hourCounts[idx]++;
      else { hourKeys.push(key); hourCounts.push(1); }
    }
    const start = Math.max(0, hourKeys.length - 24);
    setViewerTimeline(
      hourKeys.slice(start).map((hour, i) => ({ hour, count: hourCounts[start + i] ?? 0 }))
    );
    setTimelineLoading(false);
  };

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Build recharts-friendly data from parallel arrays
  const chartData = chartDays.map((day, i) => ({ day, views: chartViews[i] ?? 0 }));

  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-6">
      <TopBar title="Story Analytics" showBack />
      <PageAdBanner />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-5">

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-2xl p-4">
            <Eye className="w-5 h-5 text-primary mb-2" />
            <p className="text-2xl font-black">{formatNumber(totalViews)}</p>
            <p className="text-xs text-muted-foreground font-medium">Total Views</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 rounded-2xl p-4">
            <Users className="w-5 h-5 text-blue-500 mb-2" />
            <p className="text-2xl font-black">{formatNumber(uniqueViewers)}</p>
            <p className="text-xs text-muted-foreground font-medium">Unique Viewers (7d)</p>
          </div>
          <div className="bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20 rounded-2xl p-4">
            <BookOpen className="w-5 h-5 text-green-500 mb-2" />
            <p className="text-2xl font-black">{formatNumber(totalStories)}</p>
            <p className="text-xs text-muted-foreground font-medium">Stories Posted</p>
          </div>
          <div className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
            <TrendingUp className="w-5 h-5 text-amber-500 mb-2" />
            <p className="text-2xl font-black">{formatNumber(avgViewsPerStory)}</p>
            <p className="text-xs text-muted-foreground font-medium">Avg Views / Story</p>
          </div>
        </div>

        {/* 7-day views chart */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="font-bold text-sm">Views This Week</h3>
          </div>
          {chartData.every(d => d.views === 0) ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Eye className="w-10 h-10 opacity-20" />
              <p className="text-sm">No story views yet this week</p>
              <button onClick={() => navigate('/')}
                className="text-xs text-primary font-semibold hover:underline">
                Post a story to get started →
              </button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }}
                  formatter={(v: any) => [v, 'views']}
                />
                <Bar dataKey="views" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Viewer timeline for selected story */}
        {selectedStoryId && viewerTimeline.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm">Viewer Timeline — Top Story</h3>
              {timelineLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={viewerTimeline} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }}
                  formatter={(v: any) => [v, 'views']}
                />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Active stories */}
        {activeStories.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-amber-500" />
              <h3 className="font-bold text-sm">Active Stories</h3>
              <span className="ml-auto text-xs text-muted-foreground">{activeStories.length} live</span>
            </div>
            <div className="space-y-3">
              {activeStories.map(story => {
                const expiresIn = formatDistanceToNow(new Date(story.expires_at), { addSuffix: true });
                return (
                  <div key={story.id} className="flex items-center gap-3">
                    <div className="w-12 h-16 rounded-xl overflow-hidden bg-muted shrink-0">
                      {story.media_assets?.media_type === 'video'
                        ? <video src={`${story.media_assets?.media_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                        : story.media_assets?.media_url
                          ? <img src={story.media_assets?.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          : <div className="w-full h-full flex items-center justify-center bg-primary/10">
                              <ImageIcon className="w-5 h-5 text-primary/50" />
                            </div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {story.media_assets?.media_type === 'video'
                          ? <Play className="w-3 h-3 text-primary shrink-0" />
                          : <ImageIcon className="w-3 h-3 text-primary shrink-0" />}
                        <span className="text-xs font-semibold text-muted-foreground">
                          {story.media_assets?.media_type === 'video' ? 'Video' : 'Image'} story
                        </span>
                      </div>
                      {story.caption && (
                        <p className="text-sm font-medium line-clamp-1">{story.caption}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{formatNumber(Number((story.metadata as any)?.views_count ?? 0))}</span>
                        <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />Expires {expiresIn}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => loadViewerTimeline(story.id)}
                      className={`shrink-0 px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${
                        selectedStoryId === story.id
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      Timeline
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top stories by views */}
        {topStories.length > 0 && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h3 className="font-bold text-sm">Top Stories by Views</h3>
            </div>
            <div className="space-y-2">
              {topStories.slice(0, 8).map((story, idx) => {
                const maxViews = Number((topStories[0]?.metadata as any)?.views_count ?? 1);
                const barPct = Math.max(4, Math.round((Number((story.metadata as any)?.views_count ?? 0) / maxViews) * 100));
                return (
                  <div key={story.id} className="flex items-center gap-3">
                    <span className={`text-xs font-black w-5 shrink-0 text-center ${
                      idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-slate-400' : idx === 2 ? 'text-amber-600' : 'text-muted-foreground'
                    }`}>{idx + 1}</span>
                    <div className="w-9 h-12 rounded-lg overflow-hidden bg-muted shrink-0">
                      {story.media_assets?.media_url
                        ? <img src={story.media_assets?.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full flex items-center justify-center bg-primary/10">
                            <ImageIcon className="w-3 h-3 text-primary/50" />
                          </div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground truncate">
                        {story.caption?.slice(0, 40) || (story.media_assets?.media_type === 'video' ? 'Video story' : 'Image story')}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                            style={{ width: barPct + '%' }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-primary shrink-0">{formatNumber(Number((story.metadata as any)?.views_count ?? 0))}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => loadViewerTimeline(story.id)}
                      className={`shrink-0 text-[9px] font-bold px-2 py-1 rounded-lg border transition-all ${
                        selectedStoryId === story.id
                          ? 'bg-primary/10 border-primary/20 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/20'
                      }`}
                    >
                      Details
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {totalStories === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-muted-foreground">
            <BookOpen className="w-16 h-16 opacity-15" />
            <div className="text-center">
              <p className="font-bold text-base">No stories yet</p>
              <p className="text-sm mt-1">Post your first story to start tracking analytics</p>
            </div>
            <button onClick={() => navigate('/')}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90">
              Create a Story
            </button>
          </div>
        )}

        {/* Back to profile link */}
        {totalStories > 0 && (
          <button
            onClick={() => navigate(`/profile/${user.username}`)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Profile
          </button>
        )}
      </div>
    </div>
  );
}
