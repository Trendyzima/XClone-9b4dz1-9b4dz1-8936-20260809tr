import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { PostCard } from '@/components/features/PostCard';
import { Bookmark, FolderOpen, FolderPlus, Loader2, X, Folder, Plus, Trash2, Check, Play, Heart, Eye } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { PageAdBanner } from '@/components/features/AdSenseAd';
import { PostContentEmbeds } from '@/components/features/EmbedRenderer';
function BookmarksAdBanner() { return <PageAdBanner />; }

export function BookmarksPage() {
  useSEO({ noindex: true, title: 'Bookmarks', url: '/bookmarks' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([] as any[]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all' as 'all' | 'videos' | 'collections');
  const [videos, setVideos] = useState([] as any[]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  // Collections = user's lists
  const [collections, setCollections] = useState([] as any[]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState(null as string | null);
  const [collectionPosts, setCollectionPosts] = useState([] as any[]);
  const [loadingCollectionPosts, setLoadingCollectionPosts] = useState(false);

  // Create collection dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creating, setCreating] = useState(false);

  // Add-to-collection picker
  const [showAddPicker, setShowAddPicker] = useState(null as string | null); // post id
  const [addingToCollection, setAddingToCollection] = useState(null as string | null);

  useEffect(() => {
    if (!user) { navigate('/auth'); return; }
    fetchBookmarks();
    fetchCollections();
    fetchBookmarkedVideos();
  }, [user]);

  const fetchBookmarkedVideos = async () => {
    if (!user) return;
    setLoadingVideos(true);
    try {
      const { data } = await supabase
        .from('bookmarks')
        .select('*, post:posts(*, user:user_profiles:profiles!posts_user_id_fkey(*))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      const vids = ((data ?? []).map((b: any) => b.post).filter((p: any) => p && p.is_video));
      setVideos(vids);
    } catch { setVideos([]); }
    finally { setLoadingVideos(false); }
  };

  const fetchBookmarks = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('bookmarks')
        .select('*, post:posts(*, user:user_profiles:profiles!posts_user_id_fkey(*))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPosts((data || []).map(b => b.post).filter(Boolean));
    } catch (error) { console.error('Error fetching bookmarks:', error); }
    finally { setLoading(false); }
  };

  const fetchCollections = async () => {
    if (!user) return;
    setLoadingCollections(true);
    const { data } = await supabase.from('lists').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    setCollections(data ?? []);
    setLoadingCollections(false);
  };

  const fetchCollectionPosts = async (listId: string) => {
    setLoadingCollectionPosts(true);
    const { data } = await supabase
      .from('list_posts')
      .select('*, post:posts(*, user_profiles:profiles!posts_user_id_fkey(*))')
      .eq('list_id', listId)
      .order('added_at', { ascending: false });
    setCollectionPosts((data ?? []).map((lp: any) => lp.post).filter(Boolean));
    setLoadingCollectionPosts(false);
  };

  const handleCreateCollection = async () => {
    if (!user || !newCollectionName.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.from('lists').insert({
      user_id: user.id,
      name: newCollectionName.trim(),
      is_private: false,
    }).select().single();
    if (error) { toast.error('Failed to create collection'); setCreating(false); return; }
    setCollections(prev => [data, ...prev]);
    setNewCollectionName('');
    setShowCreateDialog(false);
    toast.success('Collection created!');
    setCreating(false);
  };

  const handleDeleteCollection = async (listId: string) => {
    if (!confirm('Delete this collection? Posts will not be affected.')) return;
    await supabase.from('lists').delete().eq('id', listId);
    setCollections(prev => prev.filter(c => c.id !== listId));
    if (activeCollectionId === listId) { setActiveCollectionId(null); setCollectionPosts([]); }
    toast.success('Collection deleted');
  };

  const handleAddToCollection = async (listId: string, postId: string) => {
    setAddingToCollection(listId);
    const { error } = await supabase.from('list_posts').insert({ list_id: listId, post_id: postId });
    if (error?.code === '23505') { toast.info('Already in this collection'); }
    else if (error) { toast.error('Failed to add to collection'); }
    else { toast.success('Added to collection!'); }
    setAddingToCollection(null);
    setShowAddPicker(null);
  };

  const handleRemoveFromCollection = async (postId: string) => {
    if (!activeCollectionId) return;
    await supabase.from('list_posts').delete().eq('list_id', activeCollectionId).eq('post_id', postId);
    setCollectionPosts(prev => prev.filter(p => p.id !== postId));
    toast.success('Removed from collection');
    // Update count in local state
    const col = collections.find(c => c.id === activeCollectionId);
    if (col) setCollections(prev => prev.map(c => c.id === activeCollectionId ? { ...c, member_count: Math.max(0, (c.member_count || 0) - 1) } : c));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-16 md:pb-0">
      {/* Header */}
      <div className="border-b border-border p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bookmark className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Bookmarks</h1>
            <p className="text-sm text-muted-foreground">{posts.length} saved post{posts.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold hover:opacity-90 transition-opacity">
          <FolderPlus className="w-4 h-4" />
          Collection
        </button>
      </div>

      <BookmarksAdBanner />

      {/* Tabs */}
      <div className="sticky top-14 z-20 bg-background border-b border-border flex">
        <button onClick={() => setActiveTab('all')}
          className={`flex-1 py-3.5 text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'all' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}>
          <Bookmark className="w-4 h-4" /> All
          {posts.length > 0 && <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{posts.length}</span>}
        </button>
        <button onClick={() => setActiveTab('videos')}
          className={`flex-1 py-3.5 text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'videos' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}>
          <Play className="w-4 h-4" /> Videos
          {videos.length > 0 && <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{videos.length}</span>}
        </button>
        <button onClick={() => setActiveTab('collections')}
          className={`flex-1 py-3.5 text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'collections' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/40'
          }`}>
          <FolderOpen className="w-4 h-4" /> Collections
          {collections.length > 0 && <span className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">{collections.length}</span>}
        </button>
      </div>

      {/* ── ALL BOOKMARKS TAB ── */}
      {activeTab === 'all' && (
        <div>
          {posts.length === 0 ? (
            <div className="text-center py-16">
              <Bookmark className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
              <h2 className="text-xl font-semibold mb-2">No bookmarks yet</h2>
              <p className="text-muted-foreground text-sm">Save posts to easily find them later</p>
            </div>
          ) : (
            posts.map(post => (
              <div key={post.id} className="relative group">
                <PostCard post={post} />
                {post.content && <div className="px-4 pb-2"><PostContentEmbeds content={post.content} /></div>}
                {/* Add to collection button */}
                <button
                  onClick={() => setShowAddPicker(showAddPicker === post.id ? null : post.id)}
                  className="absolute top-3 right-14 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-background/80 backdrop-blur rounded-full border border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/30"
                  title="Add to collection"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                {/* Collection picker popover */}
                {showAddPicker === post.id && (
                  <div className="absolute top-10 right-4 z-30 w-52 bg-background border border-border rounded-xl shadow-xl p-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1">Add to collection</p>
                    {collections.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-2 py-2">No collections yet. Create one first.</p>
                    ) : (
                      collections.map(col => (
                        <button key={col.id}
                          onClick={() => handleAddToCollection(col.id, post.id)}
                          disabled={addingToCollection === col.id}
                          className="w-full flex items-center gap-2 px-2 py-2 hover:bg-muted rounded-lg text-left text-xs transition-colors disabled:opacity-50">
                          {addingToCollection === col.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Folder className="w-3.5 h-3.5 text-primary" />}
                          <span className="truncate">{col.name}</span>
                        </button>
                      ))
                    )}
                    <button onClick={() => { setShowAddPicker(null); setShowCreateDialog(true); }}
                      className="w-full flex items-center gap-2 px-2 py-2 hover:bg-muted rounded-lg text-left text-xs text-primary mt-1 border-t border-border pt-2 transition-colors">
                      <Plus className="w-3.5 h-3.5" /> New Collection
                    </button>
                    <button onClick={() => setShowAddPicker(null)} className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted text-muted-foreground">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── VIDEOS TAB ── */}
      {activeTab === 'videos' && (
        <div className="p-3">
          {loadingVideos ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : videos.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Play className="w-14 h-14 mx-auto mb-4 opacity-20" />
              <h2 className="text-lg font-semibold mb-2">No saved videos</h2>
              <p className="text-sm">Bookmark videos from the feed to watch them here</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {videos.map((post: any) => (
                <button
                  key={post.id}
                  onClick={() => navigate(`/videos?id=${post.id}`)}
                  className="relative rounded-xl overflow-hidden bg-black aspect-[9/16] hover:scale-[1.02] active:scale-[0.98] transition-transform focus:outline-none"
                >
                  {/* Thumbnail — video frame or image */}
                  {post.video_url ? (
                    <video
                      src={`${post.video_url}#t=0.5`}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                  ) : post.image_url ? (
                    <img src={post.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <Play className="w-10 h-10 text-white/40" />
                    </div>
                  )}
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  {/* Play icon */}
                  <div className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
                    <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                  </div>
                  {/* Stats */}
                  <div className="absolute bottom-2 left-2 right-2">
                    <p className="text-white text-[10px] font-medium line-clamp-2 mb-1 leading-tight">
                      {post.content?.slice(0, 60)}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-0.5 text-white/70 text-[10px]">
                        <Heart className="w-2.5 h-2.5" />{formatNumber(post.likes_count ?? 0)}
                      </span>
                      <span className="flex items-center gap-0.5 text-white/70 text-[10px]">
                        <Eye className="w-2.5 h-2.5" />{formatNumber(post.views_count ?? 0)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── COLLECTIONS TAB ── */}
      {activeTab === 'collections' && (
        <div>
          {activeCollectionId ? (
            // Collection detail view
            <>
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-muted/20">
                <button onClick={() => { setActiveCollectionId(null); setCollectionPosts([]); }}
                  className="p-1.5 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
                <Folder className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">{collections.find(c => c.id === activeCollectionId)?.name}</span>
                <span className="text-xs text-muted-foreground">{collectionPosts.length} posts</span>
              </div>
              {loadingCollectionPosts ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : collectionPosts.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Folder className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="font-semibold">Empty collection</p>
                  <p className="text-sm mt-1">Go to All Bookmarks and add posts using the folder button</p>
                </div>
              ) : (
                collectionPosts.map(post => (
                  <div key={post.id} className="relative group">
                    <PostCard post={post} />
                    <button
                      onClick={() => handleRemoveFromCollection(post.id)}
                      className="absolute top-3 right-14 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-background/80 backdrop-blur rounded-full border border-destructive/30 text-destructive hover:bg-destructive/10"
                      title="Remove from collection"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </>
          ) : (
            // Collection grid
            loadingCollections ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : collections.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground px-6">
                <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <h2 className="text-xl font-semibold mb-2">No collections yet</h2>
                <p className="text-sm mb-6">Organize your bookmarks into themed folders</p>
                <button onClick={() => setShowCreateDialog(true)}
                  className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold hover:opacity-90 transition-opacity">
                  Create Collection
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4">
                {collections.map(col => (
                  <div key={col.id} className="relative group">
                    <button onClick={() => { setActiveCollectionId(col.id); fetchCollectionPosts(col.id); }}
                      className="w-full text-left border border-border rounded-2xl p-4 hover:border-primary/40 hover:bg-muted/30 transition-all">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                        <Folder className="w-5 h-5 text-primary" />
                      </div>
                      <p className="font-semibold text-sm truncate">{col.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {col.description || 'Saved posts collection'}
                      </p>
                    </button>
                    <button onClick={() => handleDeleteCollection(col.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 backdrop-blur border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive text-muted-foreground">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {/* Create new */}
                <button onClick={() => setShowCreateDialog(true)}
                  className="w-full text-left border-2 border-dashed border-border rounded-2xl p-4 hover:border-primary/40 hover:bg-muted/20 transition-all flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground min-h-[120px]">
                  <Plus className="w-7 h-7" />
                  <span className="text-sm font-medium">New Collection</span>
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* ── Create Collection Dialog ── */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-end" onClick={() => { setShowCreateDialog(false); setNewCollectionName(''); }}>
          <div className="w-full bg-background rounded-t-3xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">New Collection</h2>
              <button onClick={() => { setShowCreateDialog(false); setNewCollectionName(''); }} className="p-2 rounded-full hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              placeholder="Collection name (e.g. Travel, Recipes, Tech)"
              value={newCollectionName}
              onChange={e => setNewCollectionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateCollection()}
              className="w-full px-4 py-3 rounded-xl border border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              maxLength={50}
            />
            <button onClick={handleCreateCollection} disabled={creating || !newCollectionName.trim()}
              className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              {creating ? 'Creating…' : 'Create Collection'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
