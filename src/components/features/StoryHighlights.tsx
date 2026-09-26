import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Plus, X, Edit2, Check, Loader2, Play, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface Highlight {
  id: string;
  user_id: string;
  title: string;
  cover_url?: string | null;
  story_ids: string[];
  sort_order?: number;
  created_at: string;
}

interface Story {
  id: string;
  media_url: string;
  media_type: string;
  caption?: string | null;
  created_at: string;
  views_count?: number;
}

interface StoryHighlightsProps {
  profileUserId: string;
  isOwnProfile: boolean;
}

export function StoryHighlights({ profileUserId, isOwnProfile }: StoryHighlightsProps) {
  const { user } = useAuth();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  // Viewer state
  const [viewingHighlight, setViewingHighlight] = useState<Highlight | null>(null);
  const [viewerStories, setViewerStories] = useState<Story[]>([]);
  const [viewerIdx, setViewerIdx] = useState(0);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerProgress, setViewerProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Create/edit highlight
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [userStories, setUserStories] = useState<Story[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHighlights = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_highlights')
      .select('*')
      .eq('user_id', profileUserId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    setHighlights((data as Highlight[]) ?? []);
    setLoading(false);
  }, [profileUserId]);

  useEffect(() => { fetchHighlights(); }, [fetchHighlights]);

  const fetchUserStories = useCallback(async () => {
    if (!user) return;
    setStoriesLoading(true);
    // Fetch all stories (including expired) for own profile to select from
    const { data } = await supabase
      .from('stories')
      .select('id, media_url, media_type, caption, created_at, views_count')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setUserStories((data as Story[]) ?? []);
    setStoriesLoading(false);
  }, [user?.id]);

  const openCreateSheet = async () => {
    setEditingId(null);
    setDraftTitle('');
    setSelectedStoryIds([]);
    setShowCreate(true);
    await fetchUserStories();
  };

  const openEditSheet = async (highlight: Highlight) => {
    setEditingId(highlight.id);
    setDraftTitle(highlight.title);
    setSelectedStoryIds(highlight.story_ids ?? []);
    setShowCreate(true);
    await fetchUserStories();
  };

  const toggleStorySelection = (id: string) => {
    setSelectedStoryIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const saveHighlight = async () => {
    if (!user || !draftTitle.trim()) { toast.error('Please enter a highlight title'); return; }
    if (selectedStoryIds.length === 0) { toast.error('Please select at least one story'); return; }
    setSavingHighlight(true);
    try {
      // Use the first selected story's media as cover
      const firstStory = userStories.find(s => s.id === selectedStoryIds[0]);
      const coverUrl = firstStory?.media_url ?? null;

      if (editingId) {
        const { error } = await supabase.from('user_highlights').update({
          title: draftTitle.trim(),
          story_ids: selectedStoryIds,
          cover_url: coverUrl,
        }).eq('id', editingId).eq('user_id', user.id);
        if (error) throw error;
        toast.success('Highlight updated!');
      } else {
        const { error } = await supabase.from('user_highlights').insert({
          user_id: user.id,
          title: draftTitle.trim(),
          story_ids: selectedStoryIds,
          cover_url: coverUrl,
          sort_order: highlights.length,
        });
        if (error) throw error;
        toast.success('Highlight created!');
      }
      setShowCreate(false);
      setEditingId(null);
      setDraftTitle('');
      setSelectedStoryIds([]);
      await fetchHighlights();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save highlight');
    } finally {
      setSavingHighlight(false);
    }
  };

  const deleteHighlight = async (id: string) => {
    if (!user) return;
    setDeletingId(id);
    const { error } = await supabase.from('user_highlights').delete().eq('id', id).eq('user_id', user.id);
    if (error) toast.error('Failed to delete');
    else { toast.success('Highlight deleted'); await fetchHighlights(); }
    setDeletingId(null);
  };

  const openViewer = async (highlight: Highlight) => {
    setViewingHighlight(highlight);
    setViewerIdx(0);
    setViewerProgress(0);
    setViewerLoading(true);
    if (highlight.story_ids && highlight.story_ids.length > 0) {
      const { data } = await supabase
        .from('stories')
        .select('id, media_url, media_type, caption, created_at, views_count')
        .in('id', highlight.story_ids);
      // Sort by original order in story_ids
      const sorted = highlight.story_ids
        .map(sid => (data ?? []).find((s: any) => s.id === sid))
        .filter(Boolean) as Story[];
      setViewerStories(sorted);
    } else {
      setViewerStories([]);
    }
    setViewerLoading(false);
  };

  // Auto-advance viewer
  useEffect(() => {
    if (!viewingHighlight || viewerStories.length === 0) {
      if (progressRef.current) clearInterval(progressRef.current);
      setViewerProgress(0);
      return;
    }
    setViewerProgress(0);
    if (progressRef.current) clearInterval(progressRef.current);
    const current = viewerStories[viewerIdx];
    if (current?.media_type === 'video') return; // videos auto-advance on ended
    const DURATION = 5000;
    let elapsed = 0;
    const started = Date.now();
    progressRef.current = setInterval(() => {
      elapsed = Date.now() - started;
      const pct = Math.min((elapsed / DURATION) * 100, 100);
      setViewerProgress(pct);
      if (pct >= 100) {
        if (progressRef.current) clearInterval(progressRef.current);
        if (viewerIdx < viewerStories.length - 1) {
          setViewerIdx(i => i + 1);
        } else {
          setViewingHighlight(null);
          setViewerStories([]);
        }
      }
    }, 50);
    return () => { if (progressRef.current) clearInterval(progressRef.current); };
  }, [viewingHighlight?.id, viewerIdx, viewerStories.length]);

  const advanceViewer = () => {
    if (viewerIdx < viewerStories.length - 1) setViewerIdx(i => i + 1);
    else { setViewingHighlight(null); setViewerStories([]); }
  };

  const retreatViewer = () => {
    if (viewerIdx > 0) setViewerIdx(i => i - 1);
  };

  const closeViewer = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setViewingHighlight(null);
    setViewerStories([]);
    setViewerIdx(0);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 overflow-x-auto scrollbar-hide">
        {[0,1,2].map(i => (
          <div key={i} className="flex flex-col items-center gap-1 shrink-0">
            <div className="w-16 h-16 rounded-full bg-muted animate-pulse" />
            <div className="w-10 h-2 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (highlights.length === 0 && !isOwnProfile) return null;

  return (
    <>
      {/* ── Highlights Row ── */}
      <div className="flex items-center gap-3 px-4 py-3 overflow-x-auto scrollbar-hide border-b border-border">
        {/* Create button — own profile only */}
        {isOwnProfile && (
          <button
            onClick={openCreateSheet}
            className="flex flex-col items-center gap-1.5 shrink-0 group"
          >
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-primary/40 group-hover:border-primary/70 flex items-center justify-center bg-primary/5 transition-colors">
              <Plus className="w-6 h-6 text-primary/60 group-hover:text-primary transition-colors" />
            </div>
            <span className="text-[10px] text-muted-foreground font-medium leading-none">New</span>
          </button>
        )}

        {/* Highlight rings */}
        {highlights.map(h => (
          <div key={h.id} className="flex flex-col items-center gap-1.5 shrink-0 relative group">
            <button
              onClick={() => openViewer(h)}
              className="w-16 h-16 rounded-full border-2 border-border hover:border-primary/50 overflow-hidden bg-muted transition-colors relative"
            >
              {h.cover_url ? (
                <img src={h.cover_url} alt={h.title} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-purple-500/20">
                  <ImageIcon className="w-6 h-6 text-primary/40" />
                </div>
              )}
            </button>
            <span className="text-[10px] text-foreground font-medium leading-none max-w-[64px] truncate text-center">{h.title}</span>
            {/* Edit/delete controls — own profile only */}
            {isOwnProfile && (
              <div className="absolute -top-1 -right-1 hidden group-hover:flex items-center gap-0.5 z-10">
                <button
                  onClick={e => { e.stopPropagation(); openEditSheet(h); }}
                  className="w-5 h-5 bg-primary rounded-full flex items-center justify-center shadow"
                >
                  <Edit2 className="w-2.5 h-2.5 text-white" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); deleteHighlight(h.id); }}
                  disabled={deletingId === h.id}
                  className="w-5 h-5 bg-destructive rounded-full flex items-center justify-center shadow"
                >
                  {deletingId === h.id ? <Loader2 className="w-2.5 h-2.5 text-white animate-spin" /> : <X className="w-2.5 h-2.5 text-white" />}
                </button>
              </div>
            )}
          </div>
        ))}

        {highlights.length === 0 && isOwnProfile && (
          <p className="text-sm text-muted-foreground">Create your first highlight reel ✨</p>
        )}
      </div>

      {/* ── Highlight Viewer ── */}
      {viewingHighlight && (
        <div
          className="fixed inset-0 z-[300] bg-black flex items-center justify-center select-none"
          onClick={e => { if (e.target === e.currentTarget) closeViewer(); }}
        >
          <div className="relative w-full max-w-sm h-full">
            {viewerLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-white" />
              </div>
            ) : viewerStories.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <ImageIcon className="w-12 h-12 opacity-30" />
                <p className="font-semibold">Stories in this highlight are no longer available</p>
                <button onClick={closeViewer} className="px-4 py-2 bg-white/20 rounded-full text-sm">Close</button>
              </div>
            ) : (
              <>
                {/* Media */}
                {viewerStories[viewerIdx]?.media_type === 'video' ? (
                  <video
                    key={viewerStories[viewerIdx].id}
                    src={viewerStories[viewerIdx].media_url}
                    autoPlay playsInline muted={false}
                    className="absolute inset-0 w-full h-full object-cover"
                    onEnded={advanceViewer}
                  />
                ) : (
                  <img
                    key={viewerStories[viewerIdx].id}
                    src={viewerStories[viewerIdx].media_url}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/50 pointer-events-none" />

                {/* Progress bars */}
                <div className="absolute top-3 left-3 right-3 flex gap-1 z-10">
                  {viewerStories.map((_, i) => (
                    <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white rounded-full transition-none"
                        style={{
                          width: i < viewerIdx ? '100%' : i === viewerIdx ? (viewerStories[i].media_type === 'video' ? '0%' : `${viewerProgress}%`) : '0%'
                        }}
                      />
                    </div>
                  ))}
                </div>

                {/* Header */}
                <div className="absolute top-8 left-3 right-3 flex items-center gap-2 z-10">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/20 shrink-0">
                    {viewingHighlight.cover_url
                      ? <img src={viewingHighlight.cover_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-4 h-4 text-white/60" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-sm leading-tight">{viewingHighlight.title}</p>
                    <p className="text-white/60 text-[10px]">{viewerIdx + 1} / {viewerStories.length}</p>
                  </div>
                  <button onClick={closeViewer} className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center">
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>

                {/* Caption */}
                {viewerStories[viewerIdx]?.caption && (
                  <div className="absolute bottom-16 left-4 right-4 z-10 pointer-events-none">
                    <p className="text-white text-sm bg-black/50 rounded-xl px-3 py-2 text-center backdrop-blur-sm">
                      {viewerStories[viewerIdx].caption}
                    </p>
                  </div>
                )}

                {/* Navigation zones */}
                <button className="absolute inset-y-0 left-0 w-1/3 z-20" onClick={e => { e.stopPropagation(); retreatViewer(); }} />
                <button className="absolute inset-y-0 right-0 w-1/3 z-20" onClick={e => { e.stopPropagation(); advanceViewer(); }} />

                {/* Video play indicator */}
                {viewerStories[viewerIdx]?.media_type === 'video' && (
                  <div className="absolute top-16 left-3 z-10 bg-black/50 rounded-full px-2 py-1 flex items-center gap-1">
                    <Play className="w-3 h-3 text-white fill-white" />
                    <span className="text-white text-[10px] font-semibold">Video</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Create / Edit Highlight Sheet ── */}
      {showCreate && (
        <div className="fixed inset-0 z-[400] bg-black/70 flex items-end" onClick={() => setShowCreate(false)}>
          <div
            className="w-full bg-background rounded-t-3xl border-t border-border p-5 pb-8 max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-lg">{editingId ? 'Edit Highlight' : 'New Highlight'}</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-full hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Title */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Highlight Name *</label>
              <input
                type="text"
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                placeholder="e.g. Travel, Food, Work..."
                maxLength={30}
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-right text-[10px] text-muted-foreground mt-0.5">{draftTitle.length}/30</p>
            </div>

            {/* Story selector */}
            <div className="mb-5">
              <label className="text-xs font-semibold text-muted-foreground mb-2 block">
                Select Stories ({selectedStoryIds.length} selected)
              </label>
              {storiesLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : userStories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No stories found. Post a story first!</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {userStories.map(story => {
                    const selected = selectedStoryIds.includes(story.id);
                    return (
                      <button
                        key={story.id}
                        onClick={() => toggleStorySelection(story.id)}
                        className={`relative rounded-xl overflow-hidden border-2 transition-all active:scale-95 ${
                          selected ? 'border-primary shadow-md shadow-primary/20' : 'border-border'
                        }`}
                        style={{ aspectRatio: '9/16' }}
                      >
                        {story.media_type === 'video' ? (
                          <video src={`${story.media_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                        ) : (
                          <img src={story.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        )}
                        <div className={`absolute inset-0 transition-all ${selected ? 'bg-primary/25' : 'bg-black/10'}`} />
                        {story.media_type === 'video' && (
                          <div className="absolute top-1.5 left-1.5">
                            <Play className="w-3 h-3 text-white fill-white drop-shadow" />
                          </div>
                        )}
                        {selected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                        <div className="absolute bottom-0 inset-x-0 h-6 bg-gradient-to-t from-black/70" />
                        {selectedStoryIds.includes(story.id) && (
                          <span className="absolute bottom-1 left-1 text-white text-[8px] font-bold">
                            #{selectedStoryIds.indexOf(story.id) + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save button */}
            <button
              onClick={saveHighlight}
              disabled={savingHighlight || !draftTitle.trim() || selectedStoryIds.length === 0}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
            >
              {savingHighlight ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {savingHighlight ? 'Saving…' : editingId ? 'Update Highlight' : `Create Highlight (${selectedStoryIds.length} stories)`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
