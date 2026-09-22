import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';
import { pingGoogleSitemap } from '@/lib/pingGoogle';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Image, Video, Loader2, X, BarChart3, Smile, Calendar, ShoppingBag, Globe, Wand2, AtSign, Sparkles, Layers, Quote, Hash, Link2, Camera } from 'lucide-react';
import { VideoDuetRecorder } from './VideoDuetRecorder';
import { useToast } from '@/hooks/use-toast';
import { CreatePollDialog } from './CreatePollDialog';
import { SchedulePostDialog } from './SchedulePostDialog';
import { ProductTagDialog } from './ProductTagDialog';
import { GifPicker } from './GifPicker';
import { toast as sonnerToast } from 'sonner';
import * as federation from '@/api/federation';
import { detectEmbed, ComposeEmbedPreview, OGLinkCard } from './EmbedRenderer';
import { uploadTestagramMedia, attachTestagramMedia, deleteTestagramMedia } from '@/services/mediaClient';

interface ComposePostProps {
  onSuccess?: () => void;
  communityId?: string;
}

export function ComposePost({ onSuccess, communityId }: ComposePostProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Duet/quote params — set by VideoPlayer when user taps Duet or Quote
  const duetUrl          = searchParams.get('duet_url')      ? decodeURIComponent(searchParams.get('duet_url')!)      : null;
  // Duet recorder modal state
  const [showDuetRecorder, setShowDuetRecorder] = useState(false);
  const duetMeta         = searchParams.get('duet_meta')     ? decodeURIComponent(searchParams.get('duet_meta')!)     : null;
  const quoteText        = searchParams.get('quote')         ? decodeURIComponent(searchParams.get('quote')!)         : null;
  const quotedPostId     = searchParams.get('quote_post_id') ?? null;
  const quotedPostPreview = searchParams.get('quote_preview') ? decodeURIComponent(searchParams.get('quote_preview')!) : null;

  // Content creation is free for ALL users — no follower gate.
  // Monetization is separately gated in MonetizationDashboard (500 followers + 3000 posts + 100 videos).
  const [content, setContent] = useState(quoteText ? `${quoteText}\n` : duetMeta ? `${duetMeta}\n` : '');
  const [images, setImages] = useState([] as File[]);
  const [video, setVideo] = useState(null as File | null);
  const [loading, setLoading] = useState(false);
  const [showPollDialog, setShowPollDialog] = useState(false);
  const [pollData, setPollData] = useState(null);
  const [gifUrl, setGifUrl] = useState(null as string | null);
  const [showGifDialog, setShowGifDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(null as Date | null);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [taggedProducts, setTaggedProducts] = useState([]);
  const [postToFediverse, setPostToFediverse] = useState(false);
  // Thread composer (multi-tweet chain)
  const [showThreadMode, setShowThreadMode] = useState(false);
  const [threadParts, setThreadParts] = useState(['', '']);
  // Link preview detection — embed or OG card
  const [linkPreview, setLinkPreview] = useState(null as { url: string; isEmbed: boolean } | null);
  // Draft auto-save
  const DRAFT_KEY = 'ts-compose-draft';
  const [hasDraft, setHasDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null as string | null);
  const draftAutoSaveRef = useRef(null as ReturnType<typeof setInterval> | null);
  // Embed dialog
  const [showEmbedDialog, setShowEmbedDialog] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');

  // ── Real-time violation alert ──────────────────────────────────────────────
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  const [violationScore, setViolationScore] = useState(0);
  const [violationReason, setViolationReason] = useState('');
  const [checkingContent, setCheckingContent] = useState(false);
  const violationCheckedRef = useRef(false);
  const [embedPlatform, setEmbedPlatform] = useState(null as string | null);
  const { toast } = useToast();

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

  // ── @Mentions Autocomplete ─────────────────────────────────────────────────
  const textareaRef = useRef(null as HTMLTextAreaElement | null);
  const [mentionQuery, setMentionQuery] = useState(null as string | null);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const mentionSearchRef = useRef(null as string | null);
  const [hashtagQuery, setHashtagQuery] = useState(null as string | null);
  const [hashtagResults, setHashtagResults] = useState<any[]>([]);
  const [hashtagIdx, setHashtagIdx] = useState(0);
  const hashtagSearchRef = useRef(null as string | null);

  // Load draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d?.content?.trim()) setHasDraft(true);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-save draft every 5s while typing
  useEffect(() => {
    if (!content.trim()) return;
    if (draftAutoSaveRef.current) clearInterval(draftAutoSaveRef.current);
    draftAutoSaveRef.current = setInterval(() => {
      try {
        const nowIso = new Date().toISOString();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ content, savedAt: nowIso }));
        setDraftSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch { /* ignore */ }
    }, 5000);
    return () => { if (draftAutoSaveRef.current) clearInterval(draftAutoSaveRef.current); };
  }, [content]);

  const restoreDraft = () => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const d = JSON.parse(saved);
        if (d?.content) setContent(d.content);
      }
    } catch { /* ignore */ }
    setHasDraft(false);
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
  };

  const handleContentChange = useCallback(async (val: string) => {
    setContent(val);
    // Link preview detection (first URL) — detect embed type
    const urlMatch = val.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const isEmbed = !!detectEmbed(urlMatch[0]);
      setLinkPreview({ url: urlMatch[0], isEmbed });
    } else {
      setLinkPreview(null);
    }
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const atMatch = before.match(/@(\\w*)$/);
    const hashMatch = before.match(/(^|\\s)#([\\w-]*)$/);
    if (atMatch) {
      setHashtagQuery(null); setHashtagResults([]);
      const q = atMatch[1];
      setMentionQuery(q); setMentionIdx(0); mentionSearchRef.current = q;
      if (q.length === 0) { setMentionResults([]); return; }
      try {
        const local = await backendCapabilities.searchUsers(q, 5);
        let items: any[] = local.items as any[];
        if (q.includes('@') || items.length === 0) {
          try {
            const remote = await federation.search('@' + q, 'users');
            const remoteItems = (remote ?? []).slice(0, 5).map((a: any) => ({
              id: 'fed:' + String(a.uri ?? a.id ?? a.url),
              username: a.username ?? a.preferredUsername ?? 'user',
              display_name: a.display_name ?? a.displayName ?? a.username ?? 'Fediverse user',
              avatar_url: a.avatar ?? a.icon?.url ?? null,
              origin: 'fediverse', actor_uri: a.uri ?? a.actor_uri ?? a.url ?? null, acct: a.acct ?? null,
            }));
            const seen = new Set<string>();
            items = [...items, ...remoteItems].filter((item: any) => {
              const key = String(item.acct ?? item.username).toLowerCase();
              if (seen.has(key)) return false; seen.add(key); return true;
            }).slice(0, 5);
          } catch {}
        }
        if (mentionSearchRef.current === q) setMentionResults(items);
      } catch { if (mentionSearchRef.current === q) setMentionResults([]); }
      return;
    }
    setMentionQuery(null); setMentionResults([]);
    if (!hashMatch) { setHashtagQuery(null); setHashtagResults([]); return; }
    const q = hashMatch[2].toLowerCase();
    setHashtagQuery(q); setHashtagIdx(0); hashtagSearchRef.current = q;
    if (q.length === 0) { setHashtagResults([]); return; }
    try {
      const { data } = await supabase.from('hashtags')
        .select('id,tag,usage_count,post_count,federated_post_count')
        .ilike('tag', q + '%')
        .order('usage_count', { ascending: false })
        .order('federated_post_count', { ascending: false })
        .limit(8);
      if (hashtagSearchRef.current === q) setHashtagResults(data ?? []);
    } catch { if (hashtagSearchRef.current === q) setHashtagResults([]); }
  }, [linkPreview]);

  const insertMention = useCallback((username: string) => {
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? content.length;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    const replaced = before.replace(/@(\w*)$/, `@${username} `);
    setContent(replaced + after);
    setMentionQuery(null);
    setMentionResults([]);
    setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(replaced.length, replaced.length); } }, 0);
  }, [content]);

  const handleEmbedUrlChange = (val: string) => {
    setEmbedUrl(val);
    if (val.trim()) {
      const info = detectEmbed(val.trim());
      setEmbedPlatform(info ? info.type : null);
    } else {
      setEmbedPlatform(null);
    }
  };

  const insertEmbed = () => {
    if (!embedUrl.trim()) return;
    setContent(prev => prev ? prev + '\n\n' + embedUrl.trim() : embedUrl.trim());
    setEmbedUrl('');
    setEmbedPlatform(null);
    setShowEmbedDialog(false);
    sonnerToast.success('Embed URL added to post');
  };

  const insertHashtag = useCallback((tag: string) => {
    const ta = textareaRef.current;
    const pos = ta?.selectionStart ?? content.length;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    const replaced = before.replace(/(^|\s)#([\w-]*)$/, '$1#' + tag.replace(/^#/, '') + ' ');
    setContent(replaced + after);
    setHashtagQuery(null); setHashtagResults([]);
    setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(replaced.length, replaced.length); } }, 0);
  }, [content]);

  const handleMentionKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (hashtagQuery !== null && hashtagResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHashtagIdx(i => Math.min(i + 1, hashtagResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHashtagIdx(i => Math.max(i - 1, 0)); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && hashtagResults[hashtagIdx]) { e.preventDefault(); insertHashtag(hashtagResults[hashtagIdx].tag); return; }
      if (e.key === 'Escape') { setHashtagQuery(null); setHashtagResults([]); return; }
    }
    if (mentionResults.length === 0 || mentionQuery === null) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionResults.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && mentionResults[mentionIdx]) { e.preventDefault(); insertMention(mentionResults[mentionIdx].acct ?? mentionResults[mentionIdx].username); }
    else if (e.key === 'Escape') { setMentionQuery(null); setMentionResults([]); }
  }, [mentionResults, mentionQuery, mentionIdx, insertMention, hashtagQuery, hashtagResults, hashtagIdx, insertHashtag]);

  // ── AI Caption Generator ─────────────────────────────────────────────────
  const [showCaptionGen, setShowCaptionGen] = useState(false);
  const [captionContext, setCaptionContext] = useState('');
  const [captionSuggestions, setCaptionSuggestions] = useState([]);
  const [captionLoading, setCaptionLoading] = useState(false);

  const handleGenerateCaptions = async () => {
    setCaptionLoading(true);
    setCaptionSuggestions([]);
    try {
      const context = captionContext.trim() || content.trim() || 'a social media post';
      const imageHint = images.length > 0 ? ' for a photo' : video ? ' for a video' : '';
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { messages: [{ role: 'user', content: `Generate exactly 3 catchy social media captions${imageHint} about: "${context}". Make them distinct: one witty/funny, one inspirational, one question-based/engaging. Under 200 characters each. Return ONLY the 3 captions separated by "|||" with no numbering or labels.` }], model: 'google/gemini-3-flash-preview' },
      });
      if (error) throw error;
      const raw = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? '';
      const suggestions = raw.split('|||').map((s: string) => s.trim()).filter(Boolean).slice(0, 3);
      setCaptionSuggestions(suggestions.length > 0 ? suggestions : ['Could not generate captions. Try again.']);
    } catch (err) {
      setCaptionSuggestions(['Failed to generate. Please try again.']);
    } finally {
      setCaptionLoading(false);
    }
  };

  const applyCaptionSuggestion = (caption: string) => {
    setContent(prev => prev ? prev + '\n\n' + caption : caption);
    setShowCaptionGen(false);
    setCaptionSuggestions([]);
    setCaptionContext('');
  };

  // ── AI Post Writer ────────────────────────────────────────────────────────
  const [showAiWriter, setShowAiWriter] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDrafts, setAiDrafts] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  const handleAiWrite = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiDrafts([]);
    try {
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { messages: [{ role: 'user', content: `Generate exactly 3 different engaging social media post drafts about: "${aiPrompt.trim()}". Each draft should be unique in style (one casual, one informative, one engaging/question-based). Keep each under 280 characters. Return ONLY the 3 drafts separated by the delimiter "|||" with no numbering, labels, or extra text.` }], model: 'gemini-2.0-flash' },
      });
      if (error) throw error;
      const raw = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? data?.response ?? '';
      const drafts = raw.split('|||').map((d: string) => d.trim()).filter(Boolean).slice(0, 3);
      setAiDrafts(drafts.length > 0 ? drafts : ['Could not generate drafts. Please try again.']);
    } catch (err) {
      setAiDrafts(['Failed to generate drafts. Please try again.']);
    } finally {
      setAiLoading(false);
    }
  };

  const applyDraft = (draft: string) => { setContent(draft); setAiDrafts([]); setAiPrompt(''); setShowAiWriter(false); };

  // ── File handlers ─────────────────────────────────────────────────────────
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    if (images.length + files.length > 4) { sonnerToast.error('Maximum 4 images per post'); return; }
    const validFiles = files.filter(f => {
      if (f.size > 20 * 1024 * 1024) { sonnerToast.error(`${f.name} exceeds 20MB limit`); return false; }
      if (!f.type.startsWith('image/')) { sonnerToast.error(`${f.name} is not a valid image`); return false; }
      return true;
    });
    if (validFiles.length > 0) { setImages([...images, ...validFiles].slice(0, 4)); setVideo(null); setGifUrl(null); sonnerToast.success(`${validFiles.length} image(s) added`); }
  };

  const removeImage = (index: number) => setImages(images.filter((_, i) => i !== index));

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) { sonnerToast.error('Please select a valid video file'); return; }
    if (file.size > 20 * 1024 * 1024) { sonnerToast.error('Video must be less than 20MB'); return; }
    const videoUrl = URL.createObjectURL(file);
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.onloadedmetadata = () => {
      const maxDuration = (user as any)?.creator_tier !== 'free' ? 3600 : 600;
      if (videoElement.duration > maxDuration) {
        sonnerToast.error(`Video duration cannot exceed ${Math.floor(maxDuration / 60)} minutes`);
        URL.revokeObjectURL(videoUrl); return;
      }
      setVideo(file); setImages([]); setGifUrl(null);
      sonnerToast.success('Video ready to upload!');
    };
    videoElement.onerror = () => { sonnerToast.error('Failed to load video. Please try a different file.'); URL.revokeObjectURL(videoUrl); };
  };

  const handlePollCreated = (data: { question: string; options: string[]; duration: number }) => { setPollData(data); setShowPollDialog(false); sonnerToast.success('Poll attached'); };
  const handleSchedule = (date: Date) => { setScheduledDate(date); setShowScheduleDialog(false); sonnerToast.success('Post scheduled'); };
  const handleProductsSelected = (products: any[]) => { setTaggedProducts(products); sonnerToast.success(`${products.length} product(s) tagged`); };

  // ── Check content for policy violations before posting ────────────────────
  const checkContentViolation = async (postContent: string): Promise<boolean> => {
    if (!postContent.trim() || postContent.trim().length < 10) return true;
    if (violationCheckedRef.current) return true;
    setCheckingContent(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-moderation', {
        body: { content: postContent.trim() },
      });
      if (error) {
        // On error, allow posting — don't block user
        return true;
      }
      const score = data?.overall_score ?? 0;
      const action = data?.action ?? 'pass';
      if (action === 'flag' || (action === 'auto_ban' && score >= 50)) {
        setViolationScore(score);
        setViolationReason(data?.reason ?? 'Potential policy violation detected');
        setShowViolationWarning(true);
        setCheckingContent(false);
        return false; // block posting — show warning
      }
    } catch {
      // Silently allow on error
    }
    setCheckingContent(false);
    return true;
  };

  // ── Post handler ──────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!content.trim() && images.length === 0 && !video && !gifUrl && !pollData) return;
    // Real-time violation check before posting
    if (content.trim() && !violationCheckedRef.current) {
      const canPost = await checkContentViolation(content);
      if (!canPost) return; // show warning dialog instead
    }
    violationCheckedRef.current = false; // reset for next post
    setLoading(true);
    try {
      let imageUrls: string[] = [];
      let uploadedMediaIds: string[] = [];
      let videoUrl = null;

      if (images.length > 0) {
        sonnerToast.loading(`Uploading ${images.length} image(s) to secure media storage...`);
        for (let i = 0; i < images.length; i++) {
          try {
            const media = await uploadTestagramMedia(images[i]);
            if (!media.public_url) throw new Error('The media service did not return a usable file URL.');
            imageUrls.push(media.public_url);
            uploadedMediaIds.push(media.media_id);
          } catch (uploadError: any) {
            sonnerToast.dismiss();
            sonnerToast.error(uploadError?.message ?? 'Could not upload the image. Please try again.');
            setLoading(false);
            return;
          }
        }
        sonnerToast.dismiss();
        if (imageUrls.length > 0) sonnerToast.success(`${imageUrls.length} image(s) uploaded securely!`);
      }

      if (video) {
        sonnerToast.loading('Uploading video to secure media storage...');
        try {
          const media = await uploadTestagramMedia(video);
          if (!media.public_url) throw new Error('The media service did not return a usable file URL.');
          videoUrl = media.public_url;
          uploadedMediaIds.push(media.media_id);
          sonnerToast.dismiss();
          sonnerToast.success('Video uploaded securely!');
        } catch (uploadError: any) {
          sonnerToast.dismiss();
          sonnerToast.error(`Upload failed: ${uploadError?.message ?? 'unknown error'}`);
          setLoading(false);
          return;
        }
      }

      if (scheduledDate) {
        if (images.length > 0 || video || gifUrl || pollData || taggedProducts.length > 0) {
          throw new Error('Scheduled posts currently support text only. Remove media, poll, GIF, or product tags before scheduling.');
        }
        await backendCapabilities.schedulePost(content.trim(), scheduledDate.toISOString());
        setContent('');
      void loadCreationQuota(); setScheduledDate(null);
        toast({ title: 'Success', description: 'Post scheduled successfully' });
        onSuccess?.();
        setLoading(false);
        return;
      }

      const mediaUrls = imageUrls.length > 0 ? imageUrls : (gifUrl ? [gifUrl] : []);

      // A remote Fediverse quote target is an ActivityPub URI, not a local post UUID.
      // Deliver it through federation instead of sending the URI into the local posts FK.
      if (quotedPostId && /^https:\/\//i.test(quotedPostId)) {
        if (mediaUrls.length > 0 || videoUrl || pollData || taggedProducts.length > 0) {
          throw new Error('Remote Fediverse quotes currently support text only.');
        }
        await federation.quoteStatus(quotedPostId, content.trim());
        setContent(''); setImages([]); setVideo(null); setPollData(null); setGifUrl(null); setScheduledDate(null); setTaggedProducts([]);
        sonnerToast.success('Quote posted to the remote Fediverse post.');
        onSuccess?.();
        setLoading(false);
        return;
      }

      let postResult: { post_id: string; poll_id?: string | null; created: boolean };\n      try {\n        postResult = await backendCapabilities.createPost({
        content: content.trim() || '',
        communityId,
        mediaUrls,
        mediaCount: mediaUrls.length,
        imageUrl: imageUrls[0] ?? gifUrl ?? undefined,
        videoUrl: videoUrl ?? undefined,
        isVideo: !!videoUrl,
        quotedPostId: quotedPostId ?? undefined,
        productIds: taggedProducts.map((p: any) => String(p.id)),
        poll: pollData ? {
          question: pollData.question,
          options: pollData.options,
          durationMinutes: pollData.duration,
        } : undefined,
      });
      const postData = { id: postResult.post_id };

      // Bind uploaded media assets to the newly-created post. The binary upload
      // happens before post creation so the R2 transfer is never coupled to a DB
      // insert; this second step makes the relationship authoritative.
      if (uploadedMediaIds.length > 0) {
        try {
          await Promise.all(uploadedMediaIds.map((mediaId, index) => attachTestagramMedia(mediaId, postResult.post_id)));
        } catch (mediaAttachError: any) {
          await Promise.allSettled(uploadedMediaIds.map(deleteTestagramMedia));
          throw new Error(mediaAttachError?.message ?? 'Post media could not be linked to the post.');
        }
      }

      // Persist local quote linkage separately from post creation so quote
      // metadata cannot be silently dropped by an older create-post path.
      if (quotedPostId && !/^https:\/\//i.test(quotedPostId)) {
        const { error: quoteError } = await supabase.rpc('testagram_record_local_quote', {
          p_post_id: postResult.post_id,
          p_quoted_post_id: quotedPostId,
        });
        if (quoteError) throw quoteError;
      }

      if (postToFediverse) {
        try { await federation.postStatus({ content: content.trim(), visibility: 'public' }); sonnerToast.success('Also posted to Fediverse!'); }
        catch (fedErr: any) { sonnerToast.info('Posted locally. Fediverse delivery pending.'); }
      }

      setContent(''); setImages([]); setVideo(null); setPollData(null); setGifUrl(null); setScheduledDate(null); setTaggedProducts([]); setPostToFediverse(false);
      void loadCreationQuota();
      // Clear draft on successful post
      localStorage.removeItem(DRAFT_KEY);
      setHasDraft(false);
      setDraftSavedAt(null);
      sonnerToast.success('Post created successfully!');
      toast({ title: 'Success', description: 'Post created successfully' });
      pingGoogleSitemap();

      // ── Background auto-moderation — fire and forget ───────────────────────────
      // Runs silently after post creation — does NOT block user or show errors
      if (postData?.id && content.trim().length >= 10) {
        supabase.functions.invoke('ai-moderation', {
          body: { post_id: postData.id, content: content.trim(), user_id: user.id },
        }).catch(() => { /* silent — non-critical */ });
      }

      // ── Hashtag Challenge Notifications ──────────────────────────────────
      const postContent = content.trim();
      const hashtagMatches = postContent.match(/#(\w+)/g);
      if (hashtagMatches && postData) {
        const rawTags = hashtagMatches.map((h: string) => h.slice(1).toLowerCase());
        const uniqueTags = rawTags.filter((t: string, idx: number) => rawTags.indexOf(t) === idx).slice(0, 5);
        const { data: htRows } = await supabase
          .from('hashtags')
          .select('id, tag')
          .in('tag', uniqueTags);
        if (htRows && htRows.length > 0) {
          const htIds = htRows.map((r: any) => r.id);
          const { data: challenges } = await supabase
            .from('hashtag_challenges')
            .select('id, title, prize, end_date, entry_count')
            .in('hashtag_id', htIds)
            .eq('is_active', true)
            .limit(3);
          if (challenges && challenges.length > 0) {
            const firstChallenge = challenges[0];
            sonnerToast.success(
              firstChallenge.prize
                ? `🏆 Your post entered the "${firstChallenge.title}" challenge! Prize: ${firstChallenge.prize}`
                : `🏆 Your post entered the "${firstChallenge.title}" challenge!`,
              { duration: 6000, action: { label: 'View', onClick: () => window.location.href = `/challenge/${firstChallenge.id}` } }
            );
            // Challenge delivery remains read/toast-only here; notification writes are server-owned.
          }
        }
      }

      onSuccess?.();
    } catch (error: any) {
      console.error('Post error:', error);
      sonnerToast.error(error.message || 'Failed to create post');
      toast({ title: 'Error', description: error.message || 'Failed to create post', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="border-b border-border p-8 text-center">
        <p className="text-muted-foreground mb-4">Sign in to post</p>
        <Button onClick={() => navigate('/auth')} className="rounded-full px-6">Sign in</Button>
      </div>
    );
  }

  return (
    <div className="border-b border-border p-4">
      {/* Duet banner — shown when arriving from VideoPlayer Duet/Stitch button */}
      {/* Quote-tweet card */}
      {quotedPostId && quotedPostPreview && (
        <div className="mb-3 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Quote className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-bold text-primary">Quoting post</span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{quotedPostPreview}</p>
        </div>
      )}

      {/* Thread mode */}
      {showThreadMode && (
        <div className="mb-4 border border-border rounded-2xl overflow-hidden bg-muted/10">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30">
            <Hash className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold">Thread Composer</span>
            <span className="text-xs text-muted-foreground ml-1">{threadParts.length} parts</span>
            <button onClick={() => setShowThreadMode(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
          <div className="divide-y divide-border">
            {threadParts.map((part, i) => (
              <div key={i} className="relative p-3 flex gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-black text-muted-foreground shrink-0">{i + 1}</div>
                  {i < threadParts.length - 1 && <div className="w-0.5 h-6 bg-border mt-1" />}
                </div>
                <div className="flex-1">
                  <textarea rows={2} value={part}
                    onChange={e => setThreadParts(prev => prev.map((p, j) => j === i ? e.target.value : p))}
                    placeholder={i === 0 ? 'Start your thread here…' : `Part ${i + 1}…`}
                    maxLength={280}
                    className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder:text-muted-foreground/50" />
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] ${part.length > 260 ? 'text-destructive' : 'text-muted-foreground'}`}>{part.length}/280</span>
                    {threadParts.length > 2 && (
                      <button onClick={() => setThreadParts(prev => prev.filter((_, j) => j !== i))} className="text-[10px] text-muted-foreground hover:text-destructive">Remove</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 px-4 py-3 border-t border-border">
            <button onClick={() => setThreadParts(prev => [...prev, ''])}
              className="flex items-center gap-1.5 text-sm text-primary font-semibold hover:opacity-80">+ Add part</button>
            <button disabled={loading || threadParts.filter(p => p.trim()).length < 2}
              onClick={async () => {
                const validParts = threadParts.filter(p => p.trim());
                if (validParts.length < 2) { sonnerToast.error('Add at least 2 parts to post a thread'); return; }
                if (creationQuota.remaining < validParts.length) {
                  sonnerToast.error(`You have ${creationQuota.remaining} creation${creationQuota.remaining === 1 ? '' : 's'} remaining today; this thread needs ${validParts.length}.`);
                  return;
                }
                setLoading(true);
                try {
                  for (let idx = 0; idx < validParts.length; idx++) {
                    const part = validParts[idx];
                    const label = validParts.length > 1 ? ` 🧵 ${idx + 1}/${validParts.length}\n\n` : '';
                    await backendCapabilities.createPost({ content: label + part.trim(), communityId });
                  }
                  setShowThreadMode(false);
                  setThreadParts(['', '']);
                  void loadCreationQuota();
                  sonnerToast.success(`Thread posted (${validParts.length} parts)!`);
                  onSuccess?.();
                } catch (error: any) {
                  void loadCreationQuota();
                  sonnerToast.error(error?.message || 'Thread could not be completed. Any posts already created remain published.');
                } finally {
                  setLoading(false);
                }
              }}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full font-bold text-sm disabled:opacity-50 hover:opacity-90">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Post Thread
            </button>
          </div>
        </div>
      )}

      {/* ── Duet Recorder Modal ── */}
      {showDuetRecorder && duetUrl && (
        <VideoDuetRecorder
          originalVideoUrl={duetUrl}
          duetMeta={duetMeta ?? undefined}
          onDuetReady={(file) => {
            setVideo(file);
            setImages([]);
            setGifUrl(null);
            setShowDuetRecorder(false);
          }}
          onClose={() => setShowDuetRecorder(false)}
        />
      )}

      {duetUrl && (
        <div className="mb-3 rounded-xl overflow-hidden border border-sky-500/30 bg-sky-500/5">
          <div className="flex items-center gap-2 px-3 py-2 bg-sky-500/10 border-b border-sky-500/20">
            <Layers className="w-4 h-4 text-sky-500" />
            <span className="text-xs font-bold text-sky-600 dark:text-sky-400">{duetMeta ?? 'Duet / Stitch'}</span>
          </div>
          <div className="flex gap-2 p-2">
            {/* Left: original video preview */}
            <div className="w-1/2 rounded-lg overflow-hidden bg-black aspect-video relative">
              <video src={duetUrl} muted autoPlay loop playsInline className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/40 px-2 py-0.5 rounded-full text-[10px] text-white font-bold">Original</div>
              </div>
            </div>
            {/* Right: user's reaction upload slot */}
            <div className="w-1/2 flex flex-col gap-1.5">
              <label className="flex-1 rounded-xl border-2 border-dashed border-sky-400/40 bg-muted/30 aspect-video flex flex-col items-center justify-center gap-1 text-sky-500/60 cursor-pointer hover:bg-sky-500/5 transition-colors">
                <Video className="w-5 h-5" />
                <span className="text-[9px] font-semibold text-center px-1">Upload file</span>
                <input type="file" accept="video/*" className="hidden" onChange={handleVideoChange} disabled={loading} />
              </label>
              <button
                type="button"
                onClick={() => setShowDuetRecorder(true)}
                className="flex items-center justify-center gap-1 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 rounded-xl text-sky-500 text-[10px] font-bold transition-colors"
              >
                <Camera className="w-3 h-3" /> Record
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex space-x-3">
        <div
          className="w-10 h-10 rounded-full bg-muted flex-shrink-0 overflow-hidden cursor-pointer"
          onClick={() => navigate(`/profile/${user.username}`)}
        >
          {user.avatar
            ? <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-sm font-bold">{user.username[0].toUpperCase()}</div>}
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="relative">
            <Textarea
              ref={textareaRef}
              placeholder="What's happening?"
              value={content}
              onChange={e => handleContentChange(e.target.value)}
              onKeyDown={handleMentionKeyDown}
              className="min-h-[80px] border-0 resize-none focus-visible:ring-0 p-0 text-lg bg-transparent w-full"
              maxLength={700}
            />
            {/* #Hashtag suggestions — includes hashtags discovered from federated content */}
            {hashtagQuery !== null && hashtagResults.length > 0 && (
              <div className="absolute z-50 left-0 mt-1 w-72 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
                {hashtagResults.map((h, i) => (
                  <button key={h.id} onMouseDown={e => { e.preventDefault(); insertHashtag(h.tag); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${i === hashtagIdx ? 'bg-primary/10' : 'hover:bg-muted'}`}>
                    <span className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Hash className="w-3.5 h-3.5 text-primary"/></span>
                    <span className="min-w-0 flex-1"><span className="font-semibold text-sm block truncate">#{h.tag}</span><span className="text-[10px] text-muted-foreground">{Number(h.usage_count ?? 0) + Number(h.federated_post_count ?? 0)} posts discovered</span></span>
                    {Number(h.federated_post_count ?? 0) > 0 && <Globe className="w-3.5 h-3.5 text-sky-500 shrink-0" aria-label="Fediverse hashtag"/>}
                  </button>
                ))}
              </div>
            )}
            {/* @Mentions dropdown */}
            {mentionQuery !== null && mentionResults.length > 0 && (
              <div className="absolute z-50 left-0 mt-1 w-64 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
                {mentionResults.map((u, i) => (
                  <button key={u.id} onMouseDown={e => { e.preventDefault(); insertMention(u.acct ?? u.username); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${i === mentionIdx ? 'bg-primary/10' : 'hover:bg-muted'}`}>
                    <div className="w-7 h-7 rounded-full bg-muted overflow-hidden flex-shrink-0">
                      {u.avatar_url
                        ? <img src={u.avatar_url} alt={u.username} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xs font-bold">{u.username[0]?.toUpperCase()}</div>}
                    </div>
                    <p className="font-semibold text-sm truncate">@{u.acct ?? u.username}</p>
                    <AtSign className="w-3 h-3 text-primary ml-auto flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Draft save indicator */}
          {draftSavedAt && content.trim() && (
            <p className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              Draft saved {draftSavedAt}
            </p>
          )}

          {/* Draft restore banner */}
          {hasDraft && !content.trim() && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1 rounded-xl border border-amber-500/30 bg-amber-500/8">
              <span className="text-xs text-amber-700 dark:text-amber-400 font-semibold flex-1">📝 You have an unsaved draft</span>
              <button onClick={restoreDraft} className="text-xs font-bold text-amber-600 hover:underline">Restore</button>
              <button onClick={discardDraft} className="text-xs text-muted-foreground hover:text-foreground ml-1">Discard</button>
            </div>
          )}

          {/* Link / Embed preview — live visual card while composing */}
          {linkPreview && !images.length && !video && !gifUrl && (
            linkPreview.isEmbed
              ? <ComposeEmbedPreview url={linkPreview.url} onRemove={() => setLinkPreview(null)} />
              : <OGLinkCard url={linkPreview.url} onRemove={() => setLinkPreview(null)} />
          )}

          {/* Image grid */}
          {images.length > 0 && (
            <div className={`mt-2 gap-2 grid ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {images.map((image, index) => (
                <div key={index} className={`relative rounded-2xl overflow-hidden ${images.length === 3 && index === 0 ? 'col-span-2' : ''}`}>
                  <img src={URL.createObjectURL(image)} alt={`Upload ${index + 1}`} className="w-full h-full object-cover max-h-96" />
                  <button onClick={() => removeImage(index)} className="absolute top-2 right-2 bg-black/80 hover:bg-black text-white rounded-full w-8 h-8 flex items-center justify-center transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Video preview */}
          {video && (
            <div className="mt-2 relative rounded-2xl overflow-hidden max-w-full">
              <video src={URL.createObjectURL(video)} controls className="max-h-96 w-full" />
              <button onClick={() => setVideo(null)} className="absolute top-2 right-2 bg-black/80 hover:bg-black text-white rounded-full w-8 h-8 flex items-center justify-center transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Poll, schedule, products, GIF chips */}
          {pollData && (
            <div className="mt-2 p-3 border border-border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium"><BarChart3 className="w-4 h-4" />Poll attached</div>
                <button onClick={() => setPollData(null)} className="text-sm text-muted-foreground hover:text-foreground">Remove</button>
              </div>
              <p className="text-sm text-muted-foreground break-words">{pollData.question}</p>
            </div>
          )}
          {scheduledDate && (
            <div className="mt-2 p-3 border border-border rounded-lg bg-primary/5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm font-medium"><Calendar className="w-4 h-4" />Scheduled</div>
                <button onClick={() => setScheduledDate(null)} className="text-sm text-muted-foreground hover:text-foreground">Remove</button>
              </div>
              <p className="text-sm text-muted-foreground">{scheduledDate.toLocaleString()}</p>
            </div>
          )}
          {taggedProducts.length > 0 && (
            <div className="mt-2 p-3 border border-border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium"><ShoppingBag className="w-4 h-4" />{taggedProducts.length} product{taggedProducts.length !== 1 ? 's' : ''} tagged</div>
                <button onClick={() => setTaggedProducts([])} className="text-sm text-muted-foreground hover:text-foreground">Remove</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {taggedProducts.map(p => <div key={p.id} className="px-2 py-1 bg-muted rounded text-xs truncate">{p.name} - ${p.price}</div>)}
              </div>
            </div>
          )}
          {gifUrl && (
            <div className="mt-2 relative rounded-2xl overflow-hidden max-w-full">
              <img src={gifUrl} alt="GIF" className="max-h-96 w-full object-cover" />
              <button onClick={() => setGifUrl(null)} className="absolute top-2 right-2 bg-black/80 hover:bg-black text-white rounded-full w-8 h-8 flex items-center justify-center transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Creation tools — responsive grid keeps every action reachable without crowding. */}
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            <div className="grid grid-cols-4 sm:grid-cols-8 lg:grid-cols-11 gap-1" role="toolbar" aria-label="Post creation tools">
              <label className="flex h-10 w-full items-center justify-center cursor-pointer hover:bg-primary/10 rounded-xl text-primary transition-colors" title="Add images">
                <Image className="w-5 h-5" aria-hidden="true" /><span className="sr-only">Add images</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageChange} disabled={loading || !!video || !!gifUrl || images.length >= 4} />
              </label>
              <label className="flex h-10 w-full items-center justify-center cursor-pointer hover:bg-primary/10 rounded-xl text-primary transition-colors" title="Add video">
                <Video className="w-5 h-5" aria-hidden="true" /><span className="sr-only">Add video</span>
                <input type="file" accept="video/*" className="hidden" onChange={handleVideoChange} disabled={loading || images.length > 0 || !!gifUrl} />
              </label>
              <button type="button" onClick={() => setShowGifDialog(true)} disabled={loading || images.length > 0 || !!video} className="flex h-10 w-full items-center justify-center rounded-xl text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Add GIF" aria-label="Add GIF"><Smile className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowPollDialog(true)} disabled={loading || !!pollData} className="flex h-10 w-full items-center justify-center rounded-xl text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Add poll" aria-label="Add poll"><BarChart3 className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowScheduleDialog(true)} disabled={loading || !!scheduledDate} className="flex h-10 w-full items-center justify-center rounded-xl text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Schedule post" aria-label="Schedule post"><Calendar className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowProductDialog(true)} disabled={loading} className="flex h-10 w-full items-center justify-center rounded-xl text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" title="Tag products" aria-label="Tag products"><ShoppingBag className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowThreadMode(v => !v)} disabled={loading || creationQuota.remaining <= 0} className={`flex h-10 w-full items-center justify-center rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showThreadMode ? 'bg-primary/20 text-primary' : 'hover:bg-primary/10 text-muted-foreground'}`} title="Thread composer" aria-label="Thread composer"><Hash className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowCaptionGen(v => !v)} disabled={loading} className={`flex h-10 w-full items-center justify-center rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showCaptionGen ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' : 'hover:bg-primary/10 text-muted-foreground'}`} title="AI Caption Generator" aria-label="AI Caption Generator"><Sparkles className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowAiWriter(v => !v)} disabled={loading} className={`flex h-10 w-full items-center justify-center rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showAiWriter ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'hover:bg-primary/10 text-muted-foreground'}`} title="AI Post Writer" aria-label="AI Post Writer"><Wand2 className="w-5 h-5" /></button>
              <button type="button" onClick={() => setPostToFediverse(v => !v)} disabled={loading} className={`flex h-10 w-full items-center justify-center rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${postToFediverse ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'hover:bg-primary/10 text-muted-foreground'}`} title={postToFediverse ? 'Will post to Fediverse' : 'Also post to Fediverse'} aria-label="Post to Fediverse"><Globe className="w-5 h-5" /></button>
              <button type="button" onClick={() => setShowEmbedDialog(v => !v)} disabled={loading} className={`flex h-10 w-full items-center justify-center rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${showEmbedDialog ? 'bg-blue-500/20 text-blue-600' : 'hover:bg-primary/10 text-muted-foreground'}`} title="Embed media" aria-label="Embed media"><Link2 className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
              <div className="inline-flex w-fit max-w-full items-center gap-2 px-2.5 py-1.5 rounded-full bg-muted/60 border border-border text-xs whitespace-nowrap" title="Posts and threads share this daily limit">
                <span className={creationQuota.remaining === 0 ? 'text-destructive font-bold' : 'text-muted-foreground'}>{creationQuota.used}/{creationQuota.limit} today</span>
                <span className={creationQuota.remaining === 0 ? 'text-destructive font-semibold' : 'text-primary font-semibold'}>{creationQuota.remaining} remaining</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:justify-end">
                {images.length > 0 && <span className="whitespace-nowrap">{images.length}/4 images</span>}
                {content.length > 0 && <span className={`whitespace-nowrap ${content.length > 680 ? 'text-destructive' : ''}`}>{content.length}/700</span>}
                {postToFediverse && <span className="flex items-center gap-1 whitespace-nowrap text-xs text-purple-500 font-medium"><Globe className="w-3 h-3" />+Fediverse</span>}
              </div>
              <Button type="button" onClick={handlePost} disabled={loading || creationQuota.remaining <= 0 || (!content.trim() && images.length === 0 && !video && !gifUrl && !pollData) || content.length > 700} className="w-full sm:w-auto rounded-full px-6 font-semibold">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}</Button>
            </div>
          </div>

          {/* AI Caption Panel */}
          {showCaptionGen && (
            <div className="mt-3 p-3 border border-amber-500/20 rounded-xl bg-amber-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">AI Caption Generator</span>
                <button onClick={() => { setShowCaptionGen(false); setCaptionSuggestions([]); setCaptionContext(''); }} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex gap-2">
                <input type="text" value={captionContext} onChange={e => setCaptionContext(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGenerateCaptions()}
                  placeholder={images.length > 0 || video ? 'Describe your photo/video (optional)…' : 'Describe your post topic…'}
                  className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500" disabled={captionLoading} />
                <button onClick={handleGenerateCaptions} disabled={captionLoading}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors flex-shrink-0">
                  {captionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {captionLoading ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {captionSuggestions.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Pick a caption to add:</p>
                  {captionSuggestions.map((cap, i) => (
                    <button key={i} onClick={() => applyCaptionSuggestion(cap)} className="w-full text-left text-sm p-2.5 border border-border rounded-lg hover:border-amber-500 hover:bg-amber-500/5 transition-colors leading-relaxed">{cap}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Writer Panel */}
          {showAiWriter && (
            <div className="mt-3 p-3 border border-purple-500/20 rounded-xl bg-purple-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Wand2 className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">AI Post Writer</span>
                <button onClick={() => { setShowAiWriter(false); setAiDrafts([]); setAiPrompt(''); }} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex gap-2">
                <input type="text" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAiWrite()}
                  placeholder="What do you want to write about?"
                  className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500" disabled={aiLoading} />
                <button onClick={handleAiWrite} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors flex-shrink-0">
                  {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {aiLoading ? 'Writing…' : 'Write'}
                </button>
              </div>
              {aiDrafts.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Choose a draft:</p>
                  {aiDrafts.map((draft, i) => (
                    <button key={i} onClick={() => applyDraft(draft)} className="w-full text-left text-sm p-2.5 border border-border rounded-lg hover:border-purple-500 hover:bg-purple-500/5 transition-colors leading-relaxed">{draft}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Embed dialog */}
          {showEmbedDialog && (
            <div className="mt-3 p-3 border-2 border-dashed border-blue-500/30 bg-blue-500/[0.03] rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-bold">Embed Media</span>
                  <span className="text-[10px] text-muted-foreground">YouTube · Spotify · SoundCloud · CodePen · X/Twitter · Giphy</span>
                </div>
                <button onClick={() => { setShowEmbedDialog(false); setEmbedUrl(''); setEmbedPlatform(null); }}
                  className="text-muted-foreground hover:text-foreground p-0.5"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="flex items-center gap-2">
                <input type="url" value={embedUrl} onChange={e => handleEmbedUrlChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') insertEmbed(); if (e.key === 'Escape') setShowEmbedDialog(false); }}
                  placeholder="Paste a URL to embed…"
                  className="flex-1 text-sm bg-background border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                <button onClick={insertEmbed} disabled={!embedUrl.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0">
                  Insert
                </button>
              </div>
              {embedPlatform && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-500/8 border border-green-500/20 rounded-xl">
                  <span className="text-xs font-bold text-green-700 dark:text-green-400 capitalize">{embedPlatform} embed detected</span>
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    {embedUrl.length > 45 ? embedUrl.slice(0, 45) + '…' : embedUrl}
                  </span>
                </div>
              )}
              {embedUrl.trim() && !embedPlatform && (
                <p className="text-xs text-muted-foreground">URL not recognized as a supported embed — will appear as a link preview.</p>
              )}
            </div>
          )}

              {/* Real-time Violation Warning Dialog */}
          {showViolationWarning && (
            <div className="fixed inset-0 z-[400] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowViolationWarning(false)}>
              <div className="bg-background border border-orange-500/30 rounded-2xl p-5 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                    <span className="text-xl">⚠️</span>
                  </div>
                  <div>
                    <h3 className="font-black text-base">Policy Warning</h3>
                    <p className="text-xs text-muted-foreground">Score: {violationScore}/100</p>
                  </div>
                  <button onClick={() => setShowViolationWarning(false)} className="ml-auto text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-sm text-muted-foreground mb-1">AI detected potential policy violation:</p>
                <p className="text-sm font-semibold text-orange-600 mb-4">{violationReason}</p>
                <p className="text-xs text-muted-foreground mb-1">You can edit your post or post anyway. Repeated violations may result in account restrictions.</p>
                <button onClick={() => { setShowViolationWarning(false); navigate('/policy'); }} className="text-xs text-primary hover:underline font-semibold mb-3 block">View Content Policy →</button>
                <div className="flex gap-2">
                  <button onClick={() => setShowViolationWarning(false)}
                    className="flex-1 py-2.5 border border-border rounded-xl text-sm font-bold hover:bg-muted">Edit Post</button>
                  <button
                    onClick={() => {
                      setShowViolationWarning(false);
                      violationCheckedRef.current = true; // skip next check
                      setTimeout(handlePost, 50);
                    }}
                    className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-bold hover:opacity-90">
                    Post Anyway
                  </button>
                </div>
              </div>
            </div>
          )}
      {showGifDialog && (
            <GifPicker
              onSelect={url => { setGifUrl(url); setImages([]); setVideo(null); setShowGifDialog(false); }}
              onClose={() => setShowGifDialog(false)}
            />
          )}
        </div>
      </div>

      {showPollDialog && <CreatePollDialog onClose={() => setShowPollDialog(false)} onPollCreated={handlePollCreated} />}
      {showScheduleDialog && <SchedulePostDialog onClose={() => setShowScheduleDialog(false)} onSchedule={handleSchedule} />}
      {showProductDialog && <ProductTagDialog onClose={() => setShowProductDialog(false)} onProductSelected={handleProductsSelected} />}
    </div>
  );
}
