import { useState, useEffect, useCallback, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Image as ImageIcon, Video as VideoIcon, X, Wand2, Sparkles,
  Bold, Italic, Heading2, Quote, List, Type, FileText, Clock, Save, LayoutList, Code, Link2, Play, ExternalLink, BookOpen, Check,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { pingGoogleSitemap } from '@/lib/pingGoogle';

import { PageAdBanner } from '@/components/features/AdSenseAd';
import { detectEmbed, ComposeEmbedPreview } from '@/components/features/EmbedRenderer';
function CreateThreadAdBanner() { return <PageAdBanner />; }

// Module-level constant — esbuild-safe
const EMBED_EXAMPLES = [
  { label: 'YouTube',    icon: '▶',  hint: 'https://youtube.com/watch?v=...' },
  { label: 'Spotify',   icon: '♫',  hint: 'https://open.spotify.com/track/...' },
  { label: 'SoundCloud',icon: '🎵', hint: 'https://soundcloud.com/...' },
  { label: 'CodePen',   icon: '</>',hint: 'https://codepen.io/.../pen/...' },
  { label: 'Tweet / X', icon: '𝕏',  hint: 'https://x.com/user/status/...' },
  { label: 'Giphy GIF', icon: '🎞', hint: 'https://giphy.com/gifs/...' },
] as const;

export default function CreateThreadPage() {
  useSEO({ noindex: true, title: 'Create Thread', url: '/create-thread' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [coverImage, setCoverImage] = useState(null as File | null);
  const [coverPreview, setCoverPreview] = useState(null as string | null);
  const [coverVideo, setCoverVideo] = useState(null as File | null);
  const [coverVideoPreview, setCoverVideoPreview] = useState(null as string | null);
  const [extraImages, setExtraImages] = useState([] as File[]);
  const [extraPreviews, setExtraPreviews] = useState([] as string[]);
  const [loading, setLoading] = useState(false);

  // Daily content allowance: posts + threads share one 10/day quota.
  const [creationQuota, setCreationQuota] = useState({ used: 0, remaining: 10, limit: 10 });
  const loadCreationQuota = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc('get_daily_content_creation_status');
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setCreationQuota({
          used: Number(row.used ?? 0),
          remaining: Number(row.remaining ?? 10),
          limit: Number(row.daily_limit ?? 10),
        });
      }
    }
  }, [user]);

  useEffect(() => {
    void loadCreationQuota();
  }, [loadCreationQuota]);

  // ── Rich Editor ──────────────────────────────────────────────────────────
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const DRAFT_KEY = user ? `ts-thread-draft-${user.id}` : 'thread_draft_v2';
  const [wordCount, setWordCount] = useState(0);
  const [lastSaved, setLastSaved] = useState(null as Date | null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const { title: t, content: c } = JSON.parse(saved);
        if (t) setTitle(t);
        if (c) setContent(c);
      }
    } catch { /* ignore */ }
  }, []);

  const saveDraft = useCallback(() => {
    if (!title && !content) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content }));
    setLastSaved(new Date());
  }, [title, content]);

  // Auto-save 3s after typing stops
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(saveDraft, 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [title, content, saveDraft]);

  // Word count
  useEffect(() => {
    setWordCount(content.trim() ? content.trim().split(/\s+/).length : 0);
  }, [content]);

  // Rich text toolbar: wraps selection or inserts at cursor
  const insertFormatting = (prefix: string, suffix = '', placeholder = 'text') => {
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const newContent = content.slice(0, start) + prefix + selected + suffix + content.slice(end);
    setContent(newContent);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const toolbarActions = [
    { icon: <Bold className="w-3.5 h-3.5" />, label: 'Bold', action: () => insertFormatting('**', '**', 'bold text') },
    { icon: <Italic className="w-3.5 h-3.5" />, label: 'Italic', action: () => insertFormatting('*', '*', 'italic text') },
    { icon: <Heading2 className="w-3.5 h-3.5" />, label: 'Heading', action: () => insertFormatting('\n## ', '', 'Section Title') },
    { icon: <Quote className="w-3.5 h-3.5" />, label: 'Blockquote', action: () => insertFormatting('\n> ', '', 'quoted text') },
    { icon: <List className="w-3.5 h-3.5" />, label: 'List item', action: () => insertFormatting('\n• ', '', 'list item') },
    { icon: <Type className="w-3.5 h-3.5" />, label: 'Divider', action: () => setContent(c => c + '\n\n---\n\n') },
    { icon: <Code className="w-3.5 h-3.5" />, label: 'Code block', action: () => insertFormatting('```\n', '\n```', 'code here') },
  ];

  // AI video caption
  const [aiVideoCaptionLoading, setAiVideoCaptionLoading] = useState(false);

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { sonnerToast.error('Video must be 20 MiB or smaller'); return; }
    if (coverVideoPreview) URL.revokeObjectURL(coverVideoPreview);
    setCoverVideo(file);
    setCoverVideoPreview(URL.createObjectURL(file));
    setCoverImage(null);
    setCoverPreview(null);
    e.target.value = '';
  };

  const handleExtraImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid = files.filter(f => f.type.startsWith('image/') && f.size <= 20 * 1024 * 1024);
    const newPreviews = valid.map(f => URL.createObjectURL(f));
    setExtraImages(prev => [...prev, ...valid].slice(0, 6));
    setExtraPreviews(prev => [...prev, ...newPreviews].slice(0, 6));
    e.target.value = '';
  };

  const removeExtraImage = (idx: number) => {
    URL.revokeObjectURL(extraPreviews[idx]);
    setExtraImages(prev => prev.filter((_, i) => i !== idx));
    setExtraPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const generateVideoCaption = async () => {
    if (!coverVideo && !title.trim()) return;
    setAiVideoCaptionLoading(true);
    const ctx = title.trim() || coverVideo?.name.replace(/\.[^.]+$/, '') || 'a video thread';
    const { data } = await supabase.functions.invoke('ai-chat', {
      body: {
        messages: [{ role: 'user', content: `Generate a compelling short description (1-2 sentences, under 150 chars) for a video thread titled: "${ctx}". Return ONLY the description text.` }],
        model: 'google/gemini-3-flash-preview',
      },
    });
    const raw = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? '';
    if (raw.trim()) setContent(prev => prev ? prev + '\n\n' + raw.trim() : raw.trim());
    setAiVideoCaptionLoading(false);
  };

  // ── Series Linking ─────────────────────────────────────────────────────
  const [showSeriesDialog, setShowSeriesDialog] = useState(false);
  const [seriesList, setSeriesList] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState(null as { id: string; name: string } | null);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const loadSeries = async () => {
    if (!user) return;
    setSeriesLoading(true);
    const { data } = await supabase.from('post_series')
      .select('id, name, description, item_count, cover_image')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(20);
    setSeriesList(data ?? []);
    setSeriesLoading(false);
  };

  const openSeriesDialog = () => {
    setShowSeriesDialog(true);
    if (seriesList.length === 0) loadSeries();
  };

  // ── Embed URL Dialog ───────────────────────────────────────────────────
  const [showEmbedDialog, setShowEmbedDialog] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');
  const [embedPreview, setEmbedPreview] = useState(null as { type: string; url: string } | null);

  const handleEmbedUrlChange = (url: string) => {
    setEmbedUrl(url);
    if (url.trim()) {
      const info = detectEmbed(url.trim());
      setEmbedPreview(info ? { type: info.type, url: url.trim() } : null);
    } else {
      setEmbedPreview(null);
    }
  };

  const insertEmbed = () => {
    if (!embedUrl.trim()) return;
    setContent(prev => prev ? prev + '\n\n' + embedUrl.trim() : embedUrl.trim());
    setEmbedUrl('');
    setEmbedPreview(null);
    setShowEmbedDialog(false);
  };

  // ── Video Chapters ──────────────────────────────────────────────────────
  const [chapters, setChapters] = useState([] as { time: string; title: string }[]);
  const [showChapterEditor, setShowChapterEditor] = useState(false);

  const addChapter = () => setChapters(prev => [...prev, { time: '0:00', title: '' }]);
  const removeChapter = (i: number) => setChapters(prev => prev.filter((_, j) => j !== i));
  const updateChapter = (i: number, field: 'time' | 'title', val: string) =>
    setChapters(prev => prev.map((ch, j) => j === i ? { ...ch, [field]: val } : ch));

  const parseChaptersForDB = () => chapters
    .filter(ch => ch.title.trim())
    .map(ch => {
      const parts = ch.time.split(':').map(Number);
      const secs = parts.length === 2 ? parts[0] * 60 + (parts[1] || 0) : parts[0] || 0;
      return { time: secs, title: ch.title.trim() };
    });

  // ── AI Outline ─────────────────────────────────────────────────────────────
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlinePreview, setOutlinePreview] = useState(null as string | null);
  const [showOutlinePreview, setShowOutlinePreview] = useState(false);

  const handleAutoOutline = async () => {
    if (!title.trim()) {
      sonnerToast.error('Add a title first so AI can outline it');
      return;
    }
    setOutlineLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          messages: [{
            role: 'user',
            content: `Generate a structured markdown outline for a long-form thread titled: "${title.trim()}".

Requirements:
- 4-6 main sections using ## headings
- Under each heading, 2-3 bullet points (• ) showing what that section will cover
- End with a brief concluding section
- Return ONLY the outline text, no preamble, no explanation
- Use this exact format:

## Section Title\n• sub-point\n• sub-point\n\n## Next Section\n• sub-point`,
          }],
          model: 'google/gemini-3-flash-preview',
        },
      });
      if (error) throw error;
      const raw: string = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? '';
      if (!raw.trim()) throw new Error('Empty response');
      // Show preview modal instead of inserting directly
      setOutlinePreview(raw.trim());
      setShowOutlinePreview(true);
    } catch {
      sonnerToast.error('Could not generate outline. Try again.');
    } finally {
      setOutlineLoading(false);
    }
  };

  const applyOutlinePreview = () => {
    if (!outlinePreview) return;
    setContent(prev => prev ? prev + '\n\n' + outlinePreview : outlinePreview);
    setShowOutlinePreview(false);
    setOutlinePreview(null);
    sonnerToast.success('Outline inserted — fill in each section!');
  };

  // ── AI Writer ────────────────────────────────────────────────────────────
  const [showAiWriter, setShowAiWriter] = useState(false);
  const [aiTarget, setAiTarget] = useState('content' as 'title' | 'content');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafts, setAiDrafts] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  if (!user) {
    navigate('/auth');
    return null;
  }

  const handleAiWrite = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiDrafts([]);
    const { data } = await supabase.functions.invoke('ai-chat', {
      body: {
        messages: [{
          role: 'user',
          content: aiTarget === 'title'
            ? `Generate exactly 3 compelling, unique thread titles about: "${aiPrompt.trim()}". Return ONLY the 3 titles separated by "|||" — no numbering, no labels.`
            : `Write exactly 3 different long-form thread content drafts (200-400 words each) about: "${aiPrompt.trim()}". Each should take a different angle or style. Return ONLY the 3 drafts separated by "|||" — no labels, no numbering.`,
        }],
        model: 'gemini-2.0-flash',
      },
    });
    const raw = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data?.response ?? '';
    const drafts = raw.split('|||').map((d: string) => d.trim()).filter(Boolean).slice(0, 3);
    setAiDrafts(drafts.length ? drafts : ['Could not generate drafts. Please try again.']);
    setAiLoading(false);
  };

  const applyDraft = (draft: string) => {
    if (aiTarget === 'title') setTitle(draft.slice(0, 200));
    else setContent(draft.slice(0, 10000));
    setAiDrafts([]);
    setAiPrompt('');
    setShowAiWriter(false);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      if (file.size > 20 * 1024 * 1024) { sonnerToast.error('Image must be 20 MiB or smaller'); return; }
      setCoverImage(file);
      setCoverPreview(URL.createObjectURL(file));
    }
  };

  const handlePublish = async () => {
    if (!title.trim() || !content.trim()) {
      toast({ title: 'Error', description: 'Title and content are required', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      let coverImageUrl = null;
      let videoUrl = null;
      const uploadedMediaUrls: string[] = [];

      if (coverImage) {
        const fileExt = coverImage.name.split('.').pop();
        const fileName = `threads/${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('posts').upload(fileName, coverImage);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
        coverImageUrl = publicUrl;
      }

      if (coverVideo) {
        sonnerToast.loading('Uploading video…');
        const fileExt = coverVideo.name.split('.').pop();
        const fileName = `threads/${user.id}/video_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('posts').upload(fileName, coverVideo);
        sonnerToast.dismiss();
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
        videoUrl = publicUrl;
      }

      for (let i = 0; i < extraImages.length; i++) {
        const img = extraImages[i];
        const fileExt = img.name.split('.').pop();
        const fileName = `threads/${user.id}/img_${Date.now()}_${i}.${fileExt}`;
        const { error: upErr } = await supabase.storage.from('posts').upload(fileName, img);
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
          uploadedMediaUrls.push(publicUrl);
        }
      }

      const parsedChapters = parseChaptersForDB();
      // Insert thread
      const { error, data: threadData } = await supabase.from('threads').insert({
        user_id: user.id,
        title: title.trim(),
        content: content.trim(),
        cover_image: coverImageUrl ?? (uploadedMediaUrls[0] ?? null),
        media_url: videoUrl,
        media_type: videoUrl ? 'video' : 'image',
        media_urls: uploadedMediaUrls.length > 0 ? uploadedMediaUrls : [],
        chapters: parsedChapters.length > 0 ? parsedChapters : null,
        is_published: true,
      }).select('id').single();

      if (error) throw error;

      // Link to series if selected
      if (selectedSeries && (threadData as any)?.id) {
        const { count } = await supabase.from('post_series_items').select('*', { count: 'exact', head: true }).eq('series_id', selectedSeries.id);
        const position = (count ?? 0) + 1;
        await supabase.from('post_series_items').insert({ series_id: selectedSeries.id, post_id: (threadData as any).id, position }).catch(() => {});
        await supabase.from('post_series').update({ item_count: position, updated_at: new Date().toISOString() }).eq('id', selectedSeries.id).catch(() => {});
      }

      // Clear draft on success
      localStorage.removeItem(DRAFT_KEY);

      void loadCreationQuota();
      toast({ title: 'Success', description: 'Thread published successfully' });
      pingGoogleSitemap();
      navigate('/threads');
    } catch (error: any) {
      console.error('Error creating thread:', error);
      toast({ title: 'Error', description: error.message || 'Failed to create thread', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Create Thread" showBack />
      <CreateThreadAdBanner />

      {/* ── AI Outline Preview Modal ── */}
      {showOutlinePreview && outlinePreview && (
        <div className="fixed inset-0 z-[500] bg-black/60 flex items-end justify-center p-4" onClick={() => setShowOutlinePreview(false)}>
          <div className="bg-background border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 flex-wrap">
                <LayoutList className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="font-bold text-sm">AI Outline Preview</span>
                <span className="text-[10px] font-medium bg-teal-500/10 text-teal-600 px-2 py-0.5 rounded-full">Review before inserting</span>
              </div>
              <button onClick={() => setShowOutlinePreview(false)} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground shrink-0 ml-2">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
                For: <span className="text-teal-600 normal-case font-semibold">{title}</span>
              </p>
              <pre className="whitespace-pre-wrap text-sm text-foreground font-mono leading-relaxed bg-muted/30 rounded-xl p-4 border border-border">{outlinePreview}</pre>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-border bg-muted/20">
              <button
                onClick={() => {
                  setShowOutlinePreview(false);
                  setOutlinePreview(null);
                  handleAutoOutline();
                }}
                disabled={outlineLoading}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50 bg-background"
              >
                {outlineLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LayoutList className="w-4 h-4" />}
                Regenerate
              </button>
              <button
                onClick={applyOutlinePreview}
                className="flex-[2] flex items-center justify-center gap-2 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold transition-colors shadow-md"
              >
                <FileText className="w-4 h-4" />
                Insert into Editor
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border border-border bg-muted/40">
          <div>
            <p className="text-sm font-semibold">Daily posts & threads</p>
            <p className="text-[11px] text-muted-foreground">Posts and threads share a 10-per-day allowance.</p>
          </div>
          <div className="text-right shrink-0">
            <p className={creationQuota.remaining === 0 ? 'text-sm font-bold text-destructive' : 'text-sm font-bold text-foreground'}>
              {creationQuota.used}/{creationQuota.limit}
            </p>
            <p className={creationQuota.remaining === 0 ? 'text-[11px] font-semibold text-destructive' : 'text-[11px] font-semibold text-primary'}>
              {creationQuota.remaining} remaining
            </p>
          </div>
        </div>
        {/* Cover media */}
        <div>
          <label className="block text-sm font-semibold mb-2">Cover Media (Optional)</label>

          {coverPreview && (
            <div className="relative rounded-xl overflow-hidden mb-2">
              <img src={coverPreview} alt="Cover" className="w-full max-h-96 object-cover" />
              <button onClick={() => { setCoverImage(null); setCoverPreview(null); }}
                className="absolute top-2 right-2 bg-black/80 hover:bg-black text-white rounded-full w-8 h-8 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {coverVideoPreview && (
            <div className="relative rounded-xl overflow-hidden mb-2">
              <video src={coverVideoPreview} controls className="w-full max-h-72 rounded-xl" />
              <button onClick={() => { setCoverVideo(null); if (coverVideoPreview) URL.revokeObjectURL(coverVideoPreview); setCoverVideoPreview(null); }}
                className="absolute top-2 right-2 bg-black/80 hover:bg-black text-white rounded-full w-8 h-8 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">🎬 Video Chapters</label>
                  <button onClick={() => setShowChapterEditor(v => !v)} className="text-xs text-primary font-semibold hover:underline">
                    {showChapterEditor ? 'Hide' : 'Add Chapters'}
                  </button>
                </div>
                {showChapterEditor && (
                  <div className="space-y-2">
                    {chapters.map((ch, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="text" value={ch.time} onChange={e => updateChapter(i, 'time', e.target.value)}
                          placeholder="0:00" className="w-16 text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <input type="text" value={ch.title} onChange={e => updateChapter(i, 'title', e.target.value)}
                          placeholder="Chapter title…" maxLength={40}
                          className="flex-1 text-sm border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <button onClick={() => removeChapter(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button onClick={addChapter} className="w-full py-2 border-2 border-dashed border-border rounded-xl text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors">
                      + Add Chapter
                    </button>
                  </div>
                )}
              </div>
              <button onClick={generateVideoCaption} disabled={aiVideoCaptionLoading}
                className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/90 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50">
                {aiVideoCaptionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                AI Caption
              </button>
            </div>
          )}

          {!coverPreview && !coverVideoPreview && (
            <div className="grid grid-cols-2 gap-2">
              <label className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                <ImageIcon className="w-8 h-8 text-muted-foreground mb-1" />
                <span className="text-xs text-muted-foreground">Cover Image</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
              <label className="border-2 border-dashed border-blue-500/30 bg-blue-500/5 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-500/10 transition-colors">
                <VideoIcon className="w-8 h-8 text-blue-500 mb-1" />
                <span className="text-xs text-blue-600 font-semibold">Cover Video</span>
                <input type="file" accept="video/*" className="hidden" onChange={handleVideoChange} />
              </label>
            </div>
          )}

          {/* Inline images gallery */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Inline Images (up to 6)</label>
              <label className="flex items-center gap-1 text-xs text-primary font-semibold cursor-pointer hover:underline">
                <ImageIcon className="w-3.5 h-3.5" /> Add Images
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleExtraImages} />
              </label>
            </div>
            {extraPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {extraPreviews.map((url, i) => (
                  <div key={i} className="relative rounded-xl overflow-hidden aspect-square">
                    <img src={url} alt={`img-${i}`} className="w-full h-full object-cover" />
                    <button onClick={() => removeExtraImage(i)}
                      className="absolute top-1 right-1 bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold">Title</label>
            <button
              onClick={() => { setAiTarget('title'); setShowAiWriter(v => !v); setAiDrafts([]); }}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                showAiWriter && aiTarget === 'title' ? 'text-purple-600' : 'text-muted-foreground hover:text-purple-500'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />AI Title
            </button>
          </div>
          <Input
            placeholder="Give your thread a compelling title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="text-lg"
          />
          <div className="text-right text-xs text-muted-foreground mt-1">{title.length}/200</div>
        </div>

        {/* Content — Rich Editor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold">Content</label>
            <div className="flex items-center gap-2">
              {lastSaved && (
                <span className="flex items-center gap-1 text-[10px] text-green-600">
                  <Save className="w-2.5 h-2.5" />
                  Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {/* Auto-Outline button */}
              <button
                onClick={handleAutoOutline}
                disabled={outlineLoading || !title.trim()}
                title={title.trim() ? 'Generate section outline from title' : 'Add a title first'}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-teal-600 disabled:opacity-40 transition-colors"
              >
                {outlineLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <LayoutList className="w-3.5 h-3.5" />}
                {outlineLoading ? 'Generating…' : 'Auto-Outline'}
              </button>
              <button
                onClick={() => { setAiTarget('content'); setShowAiWriter(v => aiTarget === 'content' ? !v : true); setAiDrafts([]); }}
                className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                  showAiWriter && aiTarget === 'content' ? 'text-purple-600' : 'text-muted-foreground hover:text-purple-500'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />AI Write
              </button>
            </div>
          </div>

          {/* Formatting toolbar */}
          <div className="flex items-center gap-0.5 mb-2 p-1.5 bg-muted/40 border border-border rounded-xl flex-wrap">
            {toolbarActions.map((btn) => (
              <button
                key={btn.label}
                onClick={btn.action}
                title={btn.label}
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-background hover:shadow-sm transition-all text-muted-foreground hover:text-foreground active:scale-95"
              >
                {btn.icon}
              </button>
            ))}
            {/* Embed button */}
            <button
              onClick={() => setShowEmbedDialog(v => !v)}
              title="Embed media (YouTube, Spotify, CodePen…)"
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95 ${
                showEmbedDialog ? 'bg-primary/15 text-primary' : 'hover:bg-background hover:shadow-sm text-muted-foreground hover:text-foreground'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>
            {/* Series button */}
            <button
              onClick={openSeriesDialog}
              title="Link to a series"
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95 ${
                selectedSeries ? 'bg-purple-500/15 text-purple-600' : 'hover:bg-background hover:shadow-sm text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
            <div className="ml-auto flex items-center gap-3 pr-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{wordCount} words</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{Math.max(1, Math.ceil(wordCount / 200))} min read</span>
            </div>
          </div>

          {/* Selected series badge */}
          {selectedSeries && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-purple-500/8 border border-purple-500/20 rounded-xl">
              <BookOpen className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <span className="text-xs font-bold text-purple-700 dark:text-purple-400">Part of series:</span>
              <span className="text-xs font-semibold text-foreground truncate flex-1">{selectedSeries.name}</span>
              <button onClick={() => setSelectedSeries(null)} className="text-muted-foreground hover:text-destructive shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Series picker dialog */}
          {showSeriesDialog && (
            <div className="mb-3 rounded-2xl border-2 border-dashed border-purple-500/30 bg-purple-500/[0.03] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-purple-500" />
                  <span className="text-sm font-bold">Link to Series</span>
                  {selectedSeries && <Check className="w-4 h-4 text-green-500" />}
                </div>
                <button onClick={() => setShowSeriesDialog(false)}
                  className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
              {seriesLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : seriesList.length === 0 ? (
                <div className="text-center py-6">
                  <BookOpen className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No series yet — create one in your profile</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {seriesList.map(s => (
                    <button key={s.id}
                      onClick={() => { setSelectedSeries({ id: s.id, name: s.name }); setShowSeriesDialog(false); }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                        selectedSeries?.id === s.id
                          ? 'border-purple-500 bg-purple-500/10'
                          : 'border-border hover:border-purple-500/40 hover:bg-purple-500/5'
                      }`}>
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-primary/20 flex items-center justify-center shrink-0">
                        {s.cover_image
                          ? <img src={s.cover_image} alt={s.name} className="w-full h-full object-cover rounded-lg" />
                          : <BookOpen className="w-5 h-5 text-purple-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.item_count ?? 0} parts</p>
                      </div>
                      {selectedSeries?.id === s.id && <Check className="w-4 h-4 text-purple-500 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => navigate('/series')}
                className="w-full py-2 text-xs text-primary font-semibold hover:underline">Manage series →</button>
            </div>
          )}

          {/* Embed dialog — inline below toolbar */}
          {showEmbedDialog && (
            <div className="mb-3 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold">Embed Media</span>
                  <span className="text-[10px] text-muted-foreground">YouTube · Spotify · SoundCloud · CodePen · X/Twitter · Giphy</span>
                </div>
                <button onClick={() => { setShowEmbedDialog(false); setEmbedUrl(''); setEmbedPreview(null); }}
                  className="p-1 rounded-full hover:bg-muted text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex items-center gap-2">
                <input type="url" value={embedUrl} onChange={e => handleEmbedUrlChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') insertEmbed(); }}
                  placeholder="Paste a URL to embed…"
                  className="flex-1 text-sm bg-background border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                <button onClick={insertEmbed} disabled={!embedUrl.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity">
                  Insert
                </button>
              </div>
              {/* Live embed preview */}
              {embedPreview && (
                <ComposeEmbedPreview url={embedPreview.url} onRemove={() => { setEmbedUrl(''); setEmbedPreview(null); }} />
              )}
              {/* Detection chip */}
              {embedPreview && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-500/8 border border-green-500/20 rounded-xl">
                  {embedPreview.type === 'youtube' && <Play className="w-4 h-4 text-red-500 shrink-0" />}
                  {embedPreview.type === 'spotify' && <span className="text-green-600 text-sm shrink-0">♫</span>}
                  {embedPreview.type === 'soundcloud' && <span className="text-orange-500 text-sm shrink-0">🎵</span>}
                  {embedPreview.type === 'twitter' && <span className="text-sky-500 text-sm shrink-0">𝕏</span>}
                  {embedPreview.type === 'codepen' && <Code className="w-4 h-4 text-foreground shrink-0" />}
                  {embedPreview.type === 'giphy' && <span className="text-purple-500 text-sm shrink-0">🎞</span>}
                  <span className="text-xs font-bold text-green-700 dark:text-green-400 capitalize">{embedPreview.type} embed detected</span>
                  <span className="text-xs text-muted-foreground font-mono truncate">{embedUrl.length > 50 ? embedUrl.slice(0, 50) + '…' : embedUrl}</span>
                  <ExternalLink className="w-3 h-3 text-green-600 shrink-0" />
                </div>
              )}
              {embedUrl.trim() && !embedPreview && (
                <p className="text-xs text-muted-foreground">URL not recognized as a supported embed — will be inserted as a link preview.</p>
              )}
              {/* Platform examples */}
              <div className="flex flex-wrap gap-1.5">
                {EMBED_EXAMPLES.map(ex => (
                  <button key={ex.label}
                    onClick={() => handleEmbedUrlChange(ex.hint)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs font-medium text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors">
                    <span>{ex.icon}</span>{ex.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            ref={contentRef}
            placeholder={"Share your story, thoughts, or insights...\n\nTips:\n  **bold text**  *italic*  ## Section Title\n  > blockquote  • list item\n\nPress Enter twice for new paragraph."}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={10000}
            rows={22}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-y font-mono text-sm"
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
            <span className={content.length > 9500 ? 'text-red-500 font-bold' : ''}>
              {content.length.toLocaleString()}/10,000 chars
              {content.length > 9500 && <span className="ml-1">· {10000 - content.length} left</span>}
            </span>
            <button onClick={saveDraft} className="flex items-center gap-1 hover:text-primary transition-colors">
              <Save className="w-3 h-3" /> Save draft
            </button>
          </div>
        </div>

        {/* AI Writer Panel */}
        {showAiWriter && (
          <div className="border border-purple-500/20 rounded-xl bg-purple-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">
                  AI {aiTarget === 'title' ? 'Title' : 'Content'} Writer
                </span>
              </div>
              <button onClick={() => { setShowAiWriter(false); setAiDrafts([]); setAiPrompt(''); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiWrite()}
                placeholder={aiTarget === 'title' ? 'What is your thread about?' : 'Describe the topic in detail...'}
                className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500"
                disabled={aiLoading}
              />
              <button
                onClick={handleAiWrite}
                disabled={aiLoading || !aiPrompt.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors shrink-0"
              >
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {aiLoading ? 'Writing…' : 'Generate'}
              </button>
            </div>
            {aiDrafts.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Click to use a draft:</p>
                {aiDrafts.map((draft, i) => (
                  <button
                    key={i}
                    onClick={() => applyDraft(draft)}
                    className="w-full text-left text-sm p-3 border border-border rounded-xl hover:border-purple-500 hover:bg-purple-500/5 transition-colors leading-relaxed max-h-48 overflow-y-auto"
                  >
                    {draft}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={() => { saveDraft(); navigate('/threads'); }}
            variant="outline"
            className="flex-1"
            disabled={loading}
          >
            Save & Exit
          </Button>
          <Button
            onClick={handlePublish}
            className="flex-1 bg-gradient-to-r from-primary to-purple-600 hover:opacity-90"
            disabled={loading || creationQuota.remaining <= 0 || !title.trim() || !content.trim()}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Publish Thread
          </Button>
        </div>

        <button
          onClick={() => { localStorage.removeItem(DRAFT_KEY); setTitle(''); setContent(''); setLastSaved(null); sonnerToast.success('Draft cleared'); }}
          className="w-full text-center text-xs text-muted-foreground/50 hover:text-muted-foreground py-1 transition-colors"
        >
          Clear draft
        </button>
      </div>
    </div>
  );
}
