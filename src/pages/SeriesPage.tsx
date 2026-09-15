import { useState, useEffect, useMemo } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSEO } from '@/hooks/useSEO';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus, BookOpen, ChevronRight, ChevronLeft, Layers, Loader2,
  X, Trash2, Lock, Globe, Edit3, Check, PlayCircle, RotateCcw, Trophy, Bell,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

function SeriesAdBanner() { return <PageAdBanner />; }

// Module-level ring geometry — prevents duplicate binding names in map callbacks (esbuild guard)
const RING_RADIUS = 22;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

export default function SeriesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mySeriesList, setMySeriesList] = useState<any[]>([]);
  const [publicSeries, setPublicSeries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'my' | 'discover'>('my');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [selectedSeries, setSelectedSeries] = useState<any | null>(null);
  const [seriesPosts, setSeriesPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [currentPostIdx, setCurrentPostIdx] = useState(0);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [showAddPost, setShowAddPost] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // Completion challenge — hoisted to component scope (esbuild guard: no hooks in conditionals)
  const [challengeSent, setChallengeSent] = useState(false);

  // ── Reading progress from localStorage ──────────────────────────────────
  const getSeriesProgress = (seriesId: string): { currentPart: number; totalParts: number } | null => {
    try {
      const raw = localStorage.getItem('series_progress');
      if (!raw) return null;
      return JSON.parse(raw)[seriesId] ?? null;
    } catch { return null; }
  };

  const clearSeriesProgress = (seriesId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const raw = localStorage.getItem('series_progress');
      if (!raw) return;
      const all = JSON.parse(raw);
      delete all[seriesId];
      localStorage.setItem('series_progress', JSON.stringify(all));
      setMySeriesList(prev => [...prev]);
      setPublicSeries(prev => [...prev]);
    } catch { /* ignore */ }
  };

  // Helper: compute SVG dash offset from pct (uses module-level RING_CIRC)
  const ringDash = (pct: number) => ((100 - pct) / 100) * RING_CIRC;

  const seriesJsonLd = useMemo(() => {
    const items = publicSeries.slice(0, 5);
    if (items.length === 0) return undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Trending Content Series on Testagram',
      description: 'Browse themed post series created by Testagram creators.',
      url: 'https://testagram.site/series',
      numberOfItems: items.length,
      itemListElement: items.map((s: any, i: number) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: s.name,
        description: s.description ?? `${s.item_count ?? 0} posts in this series`,
        url: 'https://testagram.site/series',
      })),
    };
  }, [publicSeries]);

  useSEO({
    title: 'Content Series — Testagram',
    description: 'Browse themed post collections and story series from Testagram creators. Follow along with multi-part narratives, tutorials, and more.',
    url: '/series',
    structuredData: seriesJsonLd,
    keywords: 'content series, post collections, creator stories, testagram series, thread playlists',
  });

  useEffect(() => {
    fetchAll();
  }, [user]);

  // Reset challengeSent when a different series is opened
  useEffect(() => {
    setChallengeSent(false);
  }, [selectedSeries?.id]);

  const fetchAll = async () => {
    setLoading(true);
    if (user) {
      const { data } = await supabase
        .from('post_series')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setMySeriesList(data ?? []);
    }
    const { data: pub } = await supabase
      .from('post_series')
      .select('*, user_profiles!post_series_user_id_fkey(username, avatar_url, verified)')
      .eq('is_public', true)
      .order('item_count', { ascending: false })
      .limit(20);
    setPublicSeries(pub ?? []);
    setLoading(false);
  };

  const fetchSeriesPosts = async (series: any) => {
    setSelectedSeries(series);
    setCurrentPostIdx(0);
    setLoadingPosts(true);
    const { data } = await supabase
      .from('post_series_items')
      .select('*, posts(*, user_profiles(username, avatar_url, verified))')
      .eq('series_id', series.id)
      .order('position', { ascending: true });
    setSeriesPosts(data ?? []);
    setLoadingPosts(false);
  };

  const fetchUserPosts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('posts')
      .select('id, content, image_url, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setUserPosts(data ?? []);
  };

  const createSeries = async () => {
    if (!user || !name.trim()) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('post_series')
      .insert({ user_id: user.id, name: name.trim(), description: description.trim() || null, is_public: isPublic })
      .select()
      .single();
    if (error) { toast.error('Failed to create series'); setCreating(false); return; }
    toast.success('Series created!');
    setShowCreate(false);
    setName('');
    setDescription('');
    setCreating(false);
    setMySeriesList(prev => [data, ...prev]);
  };

  const deleteSeries = async (id: string) => {
    if (!confirm('Delete this series? Posts won\'t be deleted.')) return;
    await supabase.from('post_series').delete().eq('id', id);
    setMySeriesList(prev => prev.filter(s => s.id !== id));
    toast.success('Series deleted');
  };

  const addPostToSeries = async (postId: string) => {
    if (!selectedSeries) return;
    const maxPos = seriesPosts.length > 0 ? Math.max(...seriesPosts.map(i => i.position)) + 1 : 1;
    const { error } = await supabase
      .from('post_series_items')
      .insert({ series_id: selectedSeries.id, post_id: postId, position: maxPos });
    if (error?.code === '23505') { toast.error('Post already in this series'); return; }
    if (error) { toast.error('Failed to add post'); return; }
    await supabase.from('post_series').update({ item_count: maxPos }).eq('id', selectedSeries.id);
    toast.success('Post added to series!');
    setShowAddPost(false);
    await fetchSeriesPosts(selectedSeries);
    try {
      await supabase.rpc('notify_series_episode_added', {
        p_series_id: selectedSeries.id,
        p_series_name: selectedSeries.name,
        p_episode_number: maxPos,
      });
    } catch { /* non-critical */ }
  };

  const removePostFromSeries = async (itemId: string) => {
    await supabase.from('post_series_items').delete().eq('id', itemId);
    setSeriesPosts(prev => prev.filter(p => p.id !== itemId));
    toast.success('Removed from series');
  };

  const saveTitleEdit = async (id: string) => {
    if (!editingTitle.trim()) return;
    await supabase.from('post_series').update({ name: editingTitle.trim() }).eq('id', id);
    setMySeriesList(prev => prev.map(s => s.id === id ? { ...s, name: editingTitle.trim() } : s));
    if (selectedSeries?.id === id) setSelectedSeries((prev: any) => ({ ...prev, name: editingTitle.trim() }));
    setEditingId(null);
    toast.success('Name updated');
  };

  // ── Series Completion Challenge ───────────────────────────────────────────
  const sendCompletionChallenge = async () => {
    if (!user || !selectedSeries || challengeSent) return;
    setChallengeSent(true);
    try {
      const { data: follows } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('following_id', user.id)
        .limit(50);
      if (!follows || follows.length === 0) {
        toast.success('Challenge sent! (No followers yet to notify)');
        return;
      }
      const notifications = follows.map((f: any) => ({
        user_id: f.follower_id,
        subject: `\ud83d\udcda ${user.username} finished "${selectedSeries.name}" \u2014 Can you beat them?`,
        body: `@${user.username} just completed the "${selectedSeries.name}" series (${seriesPosts.length} parts). Challenge yourself to read it all!`,
        type: 'update',
        icon_emoji: '\ud83c\udfc6',
        cta_label: 'Start Reading',
        cta_url: '/series',
        read: false,
      }));
      for (let i = 0; i < notifications.length; i += 10) {
        await supabase.from('platform_inbox').insert(notifications.slice(i, i + 10)).then(() => {}).catch(() => {});
      }
      toast.success(`Challenge sent to ${follows.length} follower${follows.length !== 1 ? 's' : ''}! \ud83c\udfc6`);
    } catch { setChallengeSent(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Series viewer ────────────────────────────────────────────────────────
  if (selectedSeries) {
    const currentItem = seriesPosts[currentPostIdx];
    const currentPost = currentItem?.posts;
    const isOwn = user?.id === selectedSeries.user_id;
    const isComplete = seriesPosts.length > 0 && currentPostIdx === seriesPosts.length - 1;

    // Save reading progress to localStorage
    const saveProgress = (partIdx: number) => {
      try {
        const raw = localStorage.getItem('series_progress');
        const all = raw ? JSON.parse(raw) : {};
        all[selectedSeries.id] = { currentPart: partIdx + 1, totalParts: seriesPosts.length, lastReadAt: new Date().toISOString() };
        localStorage.setItem('series_progress', JSON.stringify(all));
      } catch { /* ignore */ }
    };

    if (seriesPosts.length > 0) saveProgress(currentPostIdx);

    return (
      <div className="min-h-screen bg-background pb-20">
        <TopBar title={selectedSeries.name} showBack onBack={() => setSelectedSeries(null)} />

        <div className="max-w-2xl mx-auto p-4 space-y-4">
          {/* ── Completion Banner ── */}
          {isComplete && seriesPosts.length > 0 && (
            <div className="bg-gradient-to-br from-yellow-500/15 to-amber-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
                <Trophy className="w-6 h-6 text-yellow-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-yellow-700 dark:text-yellow-400">Series Complete! 🎉</p>
                <p className="text-xs text-muted-foreground">You've read all {seriesPosts.length} parts of "{selectedSeries.name}"</p>
              </div>
              {user && (
                <button
                  onClick={sendCompletionChallenge}
                  disabled={challengeSent}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                    challengeSent
                      ? 'border-green-500/30 bg-green-500/10 text-green-600'
                      : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/20'
                  }`}
                >
                  {challengeSent
                    ? <><Check className="w-3.5 h-3.5" />Sent!</>
                    : <><Bell className="w-3.5 h-3.5" />Challenge Followers</>}
                </button>
              )}
            </div>
          )}

          {/* Series header */}
          <div className="bg-gradient-to-br from-primary/10 to-purple-500/5 border border-primary/20 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-lg truncate">{selectedSeries.name}</h2>
                {selectedSeries.description && (
                  <p className="text-sm text-muted-foreground">{selectedSeries.description}</p>
                )}
              </div>
              {selectedSeries.is_public
                ? <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                : <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
              }
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{seriesPosts.length} part{seriesPosts.length !== 1 ? 's' : ''}</span>
              {isOwn && (
                <button
                  onClick={() => { fetchUserPosts(); setShowAddPost(true); }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Post
                </button>
              )}
            </div>
          </div>

          {loadingPosts ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
          ) : seriesPosts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-semibold">No posts yet</p>
              {isOwn && (
                <button
                  onClick={() => { fetchUserPosts(); setShowAddPost(true); }}
                  className="mt-3 text-sm text-primary font-semibold hover:underline"
                >Add your first post</button>
              )}
            </div>
          ) : (
            <>
              {currentPost && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between p-3 bg-muted/30 border-b border-border">
                    <button
                      disabled={currentPostIdx === 0}
                      onClick={() => setCurrentPostIdx(p => p - 1)}
                      className="flex items-center gap-1 text-sm font-semibold text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" /> Prev
                    </button>
                    <span className="text-sm font-bold text-muted-foreground">
                      Part {currentPostIdx + 1} of {seriesPosts.length}
                    </span>
                    <button
                      disabled={currentPostIdx === seriesPosts.length - 1}
                      onClick={() => setCurrentPostIdx(p => p + 1)}
                      className="flex items-center gap-1 text-sm font-semibold text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="h-1 bg-muted">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${((currentPostIdx + 1) / seriesPosts.length) * 100}%` }}
                    />
                  </div>

                  <div
                    className="p-4 cursor-pointer hover:bg-muted/5 transition-colors"
                    onClick={() => navigate(`/post/${currentPost.id}`)}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full bg-muted overflow-hidden shrink-0">
                        {currentPost.user_profiles?.avatar_url
                          ? <img src={currentPost.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center font-bold text-sm">{currentPost.user_profiles?.username?.[0]?.toUpperCase()}</div>
                        }
                      </div>
                      <div>
                        <p className="font-bold text-sm">{currentPost.user_profiles?.username}</p>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(currentPost.created_at), { addSuffix: true })}</p>
                      </div>
                      {isOwn && (
                        <button
                          onClick={e => { e.stopPropagation(); removePostFromSeries(currentItem.id); }}
                          className="ml-auto p-1.5 rounded-full hover:bg-destructive/10 text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-6">{currentPost.content}</p>
                    {currentPost.image_url && (
                      <img src={currentPost.image_url} alt="" className="mt-3 rounded-xl w-full object-cover max-h-64" />
                    )}
                    <p className="text-xs text-primary mt-2 hover:underline">Read full post →</p>
                  </div>
                </div>
              )}

              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <span className="font-bold text-sm">All Parts</span>
                </div>
                <div className="divide-y divide-border">
                  {seriesPosts.map((item, idx) => {
                    const p = item.posts;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setCurrentPostIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          idx === currentPostIdx ? 'bg-primary/5 border-l-2 border-primary' : 'hover:bg-muted/30'
                        }`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          idx === currentPostIdx ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
                        }`}>{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p?.content?.slice(0, 60)}…</p>
                          <p className="text-xs text-muted-foreground">{p && formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</p>
                        </div>
                        {idx === currentPostIdx && (
                          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">Reading</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {showAddPost && (
          <div className="fixed inset-0 z-[200] bg-black/60" onClick={() => setShowAddPost(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">Add Post to Series</h3>
                <button onClick={() => setShowAddPost(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-2">
                {userPosts.map(p => (
                  <button key={p.id} onClick={() => addPostToSeries(p.id)}
                    className="w-full text-left p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-all">
                    <p className="text-sm font-medium line-clamp-2">{p.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</p>
                  </button>
                ))}
                {userPosts.length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">No posts found. Create some posts first!</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Content Series" showBack />
      <SeriesAdBanner />

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/10 to-purple-500/5 border border-primary/20 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-bold">Content Series</h1>
              <p className="text-sm text-muted-foreground">Group posts into themed playlists</p>
            </div>
          </div>
          {user && (
            <Button onClick={() => setShowCreate(true)} className="w-full rounded-xl">
              <Plus className="w-4 h-4 mr-2" /> Create New Series
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex bg-muted/30 rounded-xl p-1 gap-1">
          {(['my', 'discover'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                tab === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>{t === 'my' ? 'My Series' : 'Discover'}</button>
          ))}
        </div>

        {tab === 'my' && (
          <>
            {!user ? (
              <div className="text-center py-16 text-muted-foreground">
                <p className="font-semibold">Sign in to create series</p>
                <Button onClick={() => navigate('/auth')} className="mt-4">Sign In</Button>
              </div>
            ) : mySeriesList.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Layers className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="font-semibold">No series yet</p>
                <p className="text-sm mt-1">Organize your posts into themed series</p>
                <Button onClick={() => setShowCreate(true)} className="mt-4"><Plus className="w-4 h-4 mr-2" />Create First Series</Button>
              </div>
            ) : (
              <div className="grid gap-3">
                {mySeriesList.map(s => {
                  const prog = getSeriesProgress(s.id);
                  const total = s.item_count ?? 0;
                  const pct = prog && total > 0 ? Math.round((prog.currentPart / total) * 100) : 0;
                  const dash = ringDash(pct);
                  return (
                    <div key={s.id} className="bg-card border border-border rounded-2xl overflow-hidden">
                      <button
                        onClick={() => fetchSeriesPosts(s)}
                        className="w-full p-4 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {/* Progress ring */}
                          <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                            {prog && total > 0 ? (
                              <>
                                <svg width="48" height="48" className="absolute inset-0">
                                  <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth="3" />
                                  <circle
                                    cx="24" cy="24" r={RING_RADIUS} fill="none"
                                    stroke="var(--primary)" strokeWidth="3"
                                    strokeDasharray={RING_CIRC}
                                    strokeDashoffset={dash}
                                    strokeLinecap="round"
                                    transform="rotate(-90 24 24)"
                                    style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                                  />
                                </svg>
                                <span className="relative text-[10px] font-black text-primary">{pct}%</span>
                              </>
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                                <BookOpen className="w-6 h-6 text-primary" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            {editingId === s.id ? (
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <input
                                  value={editingTitle}
                                  onChange={e => setEditingTitle(e.target.value)}
                                  className="flex-1 text-sm font-bold bg-muted px-2 py-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                                  autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter') saveTitleEdit(s.id); if (e.key === 'Escape') setEditingId(null); }}
                                />
                                <button onClick={() => saveTitleEdit(s.id)} className="text-primary"><Check className="w-4 h-4" /></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-base truncate">{s.name}</h3>
                                {s.is_public ? <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                              </div>
                            )}
                            {s.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{s.description}</p>}
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-muted-foreground">{total} posts · {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</p>
                              {prog && (
                                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                                  Part {prog.currentPart}/{total}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
                        </div>
                      </button>
                      {prog && total > 0 && (
                        <div className="flex gap-2 px-4 pb-2">
                          <button
                            onClick={() => {
                              fetchSeriesPosts(s).then(() => {
                                setCurrentPostIdx(Math.max(0, (prog.currentPart ?? 1) - 1));
                              });
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-primary/10 text-primary text-xs font-bold rounded-xl hover:bg-primary/20 transition-colors">
                            <PlayCircle className="w-3.5 h-3.5" /> Continue (Part {prog.currentPart})
                          </button>
                          <button
                            onClick={e => clearSeriesProgress(s.id, e)}
                            className="p-1.5 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                            title="Reset progress">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-1 px-4 py-2 bg-muted/20 border-t border-border">
                        <button onClick={() => { setEditingId(s.id); setEditingTitle(s.name); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted">
                          <Edit3 className="w-3 h-3" /> Rename
                        </button>
                        <button onClick={() => deleteSeries(s.id)} className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive px-2 py-1 rounded-lg hover:bg-destructive/5 ml-auto">
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === 'discover' && (
          <div className="grid gap-3">
            {publicSeries.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="font-semibold">No public series yet</p>
              </div>
            ) : publicSeries.map(s => {
              const prog = getSeriesProgress(s.id);
              const total = s.item_count ?? 0;
              const pct = prog && total > 0 ? Math.round((prog.currentPart / total) * 100) : 0;
              const dash = ringDash(pct);
              return (
                <div key={s.id} className="bg-card border border-border rounded-2xl overflow-hidden hover:border-primary/30 transition-all">
                  <button onClick={() => fetchSeriesPosts(s)} className="w-full text-left p-4">
                    <div className="flex items-start gap-3">
                      <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                        {prog && total > 0 ? (
                          <>
                            <svg width="48" height="48" className="absolute inset-0">
                              <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth="3" />
                              <circle
                                cx="24" cy="24" r={RING_RADIUS} fill="none"
                                stroke="var(--primary)" strokeWidth="3"
                                strokeDasharray={RING_CIRC}
                                strokeDashoffset={dash}
                                strokeLinecap="round"
                                transform="rotate(-90 24 24)"
                                style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                              />
                            </svg>
                            <span className="relative text-[10px] font-black text-primary">{pct}%</span>
                          </>
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center">
                            <BookOpen className="w-6 h-6 text-primary" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-base truncate">{s.name}</h3>
                        {s.description && <p className="text-sm text-muted-foreground mt-0.5 truncate">{s.description}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{total} posts</span>
                          {s.user_profiles && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-xs text-primary">by @{s.user_profiles.username}</span>
                            </>
                          )}
                          {prog && (
                            <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                              Part {prog.currentPart}/{total}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </button>
                  {prog ? (
                    <div className="flex gap-2 px-4 pb-3">
                      <button
                        onClick={() => {
                          fetchSeriesPosts(s).then(() => {
                            setCurrentPostIdx(Math.max(0, (prog.currentPart ?? 1) - 1));
                          });
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl hover:opacity-90 transition-opacity">
                        <PlayCircle className="w-3.5 h-3.5" /> Continue (Part {prog.currentPart})
                      </button>
                      <button
                        onClick={e => clearSeriesProgress(s.id, e)}
                        className="p-2 rounded-xl border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                        title="Reset progress">
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="px-4 pb-3">
                      <button
                        onClick={() => fetchSeriesPosts(s)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-xl transition-colors">
                        <PlayCircle className="w-3.5 h-3.5 text-primary" /> Start Reading
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Series Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[200] bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-background rounded-t-3xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">New Series</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-semibold mb-1 block">Series Name *</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 30 Days of Coding, Travel Diary" maxLength={60} autoFocus />
              </div>
              <div>
                <label className="text-sm font-semibold mb-1 block">Description (optional)</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's this series about?" className="min-h-[80px]" maxLength={300} />
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl border border-border">
                <button onClick={() => setIsPublic(v => !v)}
                  className={`w-10 h-6 rounded-full transition-colors relative ${isPublic ? 'bg-primary' : 'bg-muted'}`}>
                  <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${isPublic ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-semibold flex items-center gap-1.5">
                    {isPublic ? <Globe className="w-3.5 h-3.5 text-primary" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
                    {isPublic ? 'Public' : 'Private'}
                  </p>
                  <p className="text-xs text-muted-foreground">{isPublic ? 'Anyone can read this series' : 'Only you can see this series'}</p>
                </div>
              </div>
            </div>
            <Button onClick={createSeries} disabled={creating || !name.trim()} className="w-full rounded-xl">
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {creating ? 'Creating…' : 'Create Series'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
