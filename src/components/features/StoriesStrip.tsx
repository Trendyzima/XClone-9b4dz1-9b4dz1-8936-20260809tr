import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Plus, X, Loader2, Send, MessageCircle, Music, Search as SearchIcon, Play, Pause, Compass, Gift, Star } from 'lucide-react';
import { toast } from 'sonner';
import { StoryAdSlide } from './StoryAdSlide';
import { uploadStoryMedia, type StoryUploadItem } from '@/services/storyMediaUpload';

interface Story {
  id: string;
  user_id: string;
  media_url: string;
  media_type: string;
  caption?: string | null;
  created_at: string;
  expires_at: string;
  views_count?: number;
  user_profiles: { username: string; avatar_url?: string | null } | null;
}

interface StoryGroup {
  userId: string;
  username: string;
  avatarUrl?: string | null;
  stories: Story[];
  hasUnseen: boolean;
}

export function StoriesStrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Viewer
  const [viewerGroupIdx, setViewerGroupIdx] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeStoryIdx, setActiveStoryIdx] = useState(0);
  const [progressPct, setProgressPct] = useState(0);

  // Story Music Playback in viewer
  const storyAudioRef = useRef<HTMLAudioElement | null>(null);

  // Live countdown tick — updates every second when viewer is open
  const [currentTime, setCurrentTime] = useState(0); // hydrated in effect — avoids esbuild non-determinism
  useEffect(() => { setCurrentTime(Date.now()); }, []);
  useEffect(() => {
    if (viewerGroupIdx === null) return;
    const iv = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [viewerGroupIdx]);

  const stopStoryAudio = () => {
    if (storyAudioRef.current) {
      storyAudioRef.current.pause();
      storyAudioRef.current.currentTime = 0;
      storyAudioRef.current = null;
    }
  };

  const playStoryAudio = (previewUrl: string) => {
    stopStoryAudio();
    const audio = new Audio(previewUrl);
    audio.loop = true;
    audio.volume = 0.6;
    audio.play().catch(() => {});
    storyAudioRef.current = audio;
  };

  // Caption input
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingCaption, setPendingCaption] = useState('');
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [uploadItems, setUploadItems] = useState<StoryUploadItem[]>([]);
  const [uploadedAssets, setUploadedAssets] = useState<any[]>([]);
  // Swipe tracking
  const touchStartX = useRef<number | null>(null);
  const isSwiping = useRef(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [sendingReaction, setSendingReaction] = useState(false);
  // Quick emoji reaction bar — shown above reply input
  const [showQuickReactionBar, setShowQuickReactionBar] = useState(false);
  // esbuild guard: no 'as const' on arrays used in .map() inside component
  const QUICK_REACTION_EMOJIS: string[] = ['❤️', '🔥', '😮', '👏', '😍'];
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Story Text Overlays ──────────────────────────────────────────────────────
  const [textOverlays, setTextOverlays] = useState<{ text: string; x: number; y: number; id: string; color: string; size: string }[]>([]);
  const [showTextInput, setShowTextInput] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftTextColor, setDraftTextColor] = useState('#ffffff');
  const [draftTextSize, setDraftTextSize] = useState('text-2xl');
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const TEXT_COLORS = ['#ffffff', '#000000', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
  const TEXT_SIZES = [{ label: 'S', cls: 'text-lg' }, { label: 'M', cls: 'text-2xl' }, { label: 'L', cls: 'text-4xl' }];

  const addTextOverlay = () => {
    if (!draftText.trim()) return;
    setTextOverlays(prev => [...prev, {
      text: draftText.trim(), x: 30 + Math.random() * 40, y: 30 + Math.random() * 30,
      id: Date.now().toString(), color: draftTextColor, size: draftTextSize,
    }]);
    setDraftText('');
    setShowTextInput(false);
  };

  const moveTextOverlay = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draggingTextId || !storyPreviewRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const rect = storyPreviewRef.current.getBoundingClientRect();
    const xPct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(2, Math.min(95, ((clientY - rect.top) / rect.height) * 100));
    setTextOverlays(prev => prev.map(t => t.id === draggingTextId ? { ...t, x: xPct, y: yPct } : t));
  };

  // ── Story Music ────────────────────────────────────────────────────────────
  const [showMusicPicker, setShowMusicPicker] = useState(false);

  // ── Countdown Sticker ──────────────────────────────────────────────────────
  const [countdownStickers, setCountdownStickers] = useState<{ id: string; targetDate: string; label: string; x: number; y: number }[]>([]);
  const [showCountdownPicker, setShowCountdownPicker] = useState(false);
  const [countdownDate, setCountdownDate] = useState('');
  const [countdownLabel, setCountdownLabel] = useState('');

  const addCountdown = () => {
    if (!countdownDate) return;
    setCountdownStickers(prev => [...prev, {
      id: Date.now().toString(),
      targetDate: countdownDate,
      label: countdownLabel.trim() || 'Event',
      x: 25 + Math.random() * 50,
      y: 40 + Math.random() * 20,
    }]);
    setCountdownDate('');
    setCountdownLabel('');
    setShowCountdownPicker(false);
  };

  const getCountdownText = (targetDate: string) => {
    const diff = new Date(targetDate).getTime() - currentTime;
    if (diff <= 0) return 'LIVE!';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const [musicSearch, setMusicSearch] = useState('');
  const [musicCatalogue, setMusicCatalogue] = useState<any[]>([]);
  const [selectedMusic, setSelectedMusic] = useState<any | null>(null);
  const [previewingMusic, setPreviewingMusic] = useState<any | null>(null);
  const musicPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [localMusicFile, setLocalMusicFile] = useState<File | null>(null);
  const localMusicInputRef = useRef<HTMLInputElement>(null);

  const fetchMusicCatalogue = useCallback(async () => {
    const { data } = await supabase.from('story_music').select('*').eq('is_active', true).order('genre');
    setMusicCatalogue(data ?? []);
  }, []);

  useEffect(() => { fetchMusicCatalogue(); }, [fetchMusicCatalogue]);

  const playPreview = (track: any) => {
    if (musicPreviewRef.current) { musicPreviewRef.current.pause(); musicPreviewRef.current.currentTime = 0; }
    if (previewingMusic?.id === track.id) { setPreviewingMusic(null); return; }
    const audio = new Audio(track.preview_url);
    musicPreviewRef.current = audio;
    audio.play().catch(() => {});
    audio.addEventListener('ended', () => setPreviewingMusic(null));
    setPreviewingMusic(track);
  };

  const selectMusic = (track: any) => {
    if (musicPreviewRef.current) { musicPreviewRef.current.pause(); musicPreviewRef.current.currentTime = 0; }
    setPreviewingMusic(null);
    setSelectedMusic(track);
    setLocalMusicFile(null);
    setShowMusicPicker(false);
  };

  const handleLocalMusicFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localTrack = { id: 'local', title: file.name.replace(/\.[^.]+$/, ''), artist: 'Local file', preview_url: URL.createObjectURL(file), cover_url: null, genre: 'Custom' };
    setLocalMusicFile(file);
    setSelectedMusic(localTrack);
    setShowMusicPicker(false);
    e.target.value = '';
  };

  const filteredMusic = musicSearch.trim()
    ? musicCatalogue.filter(t => t.title.toLowerCase().includes(musicSearch.toLowerCase()) || t.artist.toLowerCase().includes(musicSearch.toLowerCase()) || t.genre?.toLowerCase().includes(musicSearch.toLowerCase()))
    : musicCatalogue;

  // ── Story is FREE for all users — follower gate removed ──────────────────
  const [creatorFollowers, setCreatorFollowers] = useState<number | null>(null);
  // esbuild guard: keep vars to avoid unused-var warnings but gate is always open
  const FOLLOWER_THRESHOLD = 0;
  const isCreationLocked = false;

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('follower_count')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setCreatorFollowers(data?.follower_count ?? 0));
  }, [user?.id]);

  // ── Canonical Story Ads ────────────────────────────────────────────────────
  // Eligibility, frequency caps, campaign selection, impression accounting, and spend are server-owned.
  const [showCanonicalStoryAd, setShowCanonicalStoryAd] = useState(false);

  // ── Story Creation Rewards: +5 credits per day ─────────────────────────────
  const grantStoryCreationReward = useCallback(async (userId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const rewardKey = `ts-story-reward-${userId}-${today}`;
    try {
      if (localStorage.getItem(rewardKey)) return;
      localStorage.setItem(rewardKey, '1');
    } catch { return; }
    await supabase.from('credit_transactions').insert({
      user_id: userId,
      amount: 5,
      reason: 'story_creation',
      metadata: { date: today },
    }).catch(() => {});
    toast.success('🎉 +5 credits for creating a story!', { duration: 3000 });
  }, []);

  // ── Explore Stories ─────────────────────────────────────────────────────────
  const [exploreStories, setExploreStories] = useState<StoryGroup[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [showExplore, setShowExplore] = useState(false);

  const fetchExploreStories = useCallback(async () => {
    if (exploreStories.length > 0) return;
    setExploreLoading(true);
    const { data } = await supabase
      .from('stories')
      .select('*, profiles(username, avatar_url)')
      .gt('expires_at', new Date().toISOString())
      .order('views_count', { ascending: false })
      .limit(40);
    const rawStories: Story[] = (data as Story[]) ?? [];
    const map: { [key: string]: StoryGroup } = {};
    for (const story of rawStories) {
      if (!map[story.user_id]) {
        map[story.user_id] = {
          userId: story.user_id,
          username: story.user_profiles?.username ?? 'user',
          avatarUrl: story.user_profiles?.avatar_url ?? null,
          stories: [],
          hasUnseen: true,
        };
      }
      map[story.user_id].stories.push(story);
    }
    setExploreStories(Object.values(map).slice(0, 16));
    setExploreLoading(false);
  }, [exploreStories.length]);

  // ── Story Poll Sticker ────────────────────────────────────────────────────
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['Yes', 'No']);
  const [showPollPicker, setShowPollPicker] = useState(false);
  const [pollAdded, setPollAdded] = useState(false);
  // Poll votes — parallel arrays (esbuild guard: no Record<string,T> in state)
  const [pollVoteIds, setPollVoteIds] = useState<string[]>([]);
  const [pollVoteCounts, setPollVoteCounts] = useState<number[][]>([]);
  const [pollVoteUser, setPollVoteUser] = useState<(number | null)[]>([]);

  const getPollVote = (sid: string) => {
    const i = pollVoteIds.indexOf(sid);
    if (i < 0) return undefined;
    return { counts: pollVoteCounts[i] ?? [0, 0], userVote: pollVoteUser[i] ?? null };
  };

  const setPollVote = (sid: string, data: { counts: number[]; userVote: number | null }) => {
    setPollVoteIds(prev => {
      const i = prev.indexOf(sid);
      if (i >= 0) {
        setPollVoteCounts(pc => { const n = [...pc]; n[i] = data.counts; return n; });
        setPollVoteUser(pu => { const n = [...pu]; n[i] = data.userVote; return n; });
        return prev;
      }
      setPollVoteCounts(pc => [...pc, data.counts]);
      setPollVoteUser(pu => [...pu, data.userVote]);
      return [...prev, sid];
    });
  };

  const addPollSticker = () => {
    if (!pollQuestion.trim()) return;
    setPollAdded(true);
    setShowPollPicker(false);
  };

  const fetchPollVotes = async (storyId: string) => {
    if (getPollVote(storyId)) return;
    const { data } = await supabase
      .from('story_poll_votes')
      .select('option_index, voter_id')
      .eq('story_id', storyId);
    const counts = [0, 0];
    let userVote: number | null = null;
    (data ?? []).forEach((v: any) => {
      counts[v.option_index] = (counts[v.option_index] ?? 0) + 1;
      if (v.voter_id === user?.id) userVote = v.option_index;
    });
    setPollVote(storyId, { counts, userVote });
  };

  const voteOnStoryPoll = async (storyId: string, optionIdx: number) => {
    if (!user) return;
    const current = getPollVote(storyId);
    if (current?.userVote !== null && current?.userVote !== undefined) return;
    const newCounts = [...(current?.counts ?? [0, 0])];
    newCounts[optionIdx] = (newCounts[optionIdx] ?? 0) + 1;
    setPollVote(storyId, { counts: newCounts, userVote: optionIdx });
    await supabase.from('story_poll_votes').upsert(
      { story_id: storyId, voter_id: user.id, option_index: optionIdx },
      { onConflict: 'story_id,voter_id' }
    );
  };

  const [stickers, setStickers] = useState<{ emoji: string; x: number; y: number; id: string }[]>([]);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [draggingSticker, setDraggingSticker] = useState<string | null>(null);
  const storyPreviewRef = useRef<HTMLDivElement>(null);
  const STICKER_EMOJIS = ['❤️','😂','🔥','😍','👏','🎉','💯','😎','🙏','💪','🤩','😢','😡','👀','✨','🌟','🎵','🌈','🦋','💫','🤑','😜','🙌','💥','🌸'];

  const addSticker = (emoji: string) => {
    setStickers(prev => [...prev, { emoji, x: 40 + Math.random() * 20, y: 30 + Math.random() * 30, id: Date.now().toString() }]);
    setShowStickerPicker(false);
  };

  const moveDragSticker = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draggingSticker || !storyPreviewRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const rect = storyPreviewRef.current.getBoundingClientRect();
    const xPct = Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(2, Math.min(95, ((clientY - rect.top) / rect.height) * 100));
    setStickers(prev => prev.map(s => s.id === draggingSticker ? { ...s, x: xPct, y: yPct } : s));
  };

  const [showViewers, setShowViewers] = useState(false);
  const [storyViewers, setStoryViewers] = useState<any[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  // Story reply/reaction analytics — parallel arrays (esbuild guard)
  const [replyCountIds, setReplyCountIds] = useState<string[]>([]);
  const [replyCounts, setReplyCounts]   = useState<number[]>([]);
  const getStoryReplyCount = (sid: string): number => {
    const i = replyCountIds.indexOf(sid);
    return i >= 0 ? (replyCounts[i] ?? 0) : 0;
  };
  const setStoryReplyCount = (sid: string, n: number) => {
    setReplyCountIds(prev => {
      const i = prev.indexOf(sid);
      if (i >= 0) { setReplyCounts(c => { const next = [...c]; next[i] = n; return next; }); return prev; }
      setReplyCounts(c => [...c, n]);
      return [...prev, sid];
    });
  };

  // ── Story View Analytics: per-story unique view counts ───────────────
  // Parallel arrays (esbuild guard: no Record<string,number> state)
  const [storyAnalyticsIds, setStoryAnalyticsIds] = useState<string[]>([]);
  const [storyAnalyticsViews, setStoryAnalyticsViews] = useState<number[]>([]);
  const [storyAnalyticsUnique, setStoryAnalyticsUnique] = useState<number[]>([]);
  const getStoryAnalytics = (sid: string) => {
    const i = storyAnalyticsIds.indexOf(sid);
    if (i < 0) return null;
    return { views: storyAnalyticsViews[i] ?? 0, unique: storyAnalyticsUnique[i] ?? 0 };
  };
  const setStoryAnalytics = (sid: string, views: number, unique: number) => {
    setStoryAnalyticsIds(prev => {
      const i = prev.indexOf(sid);
      if (i >= 0) {
        setStoryAnalyticsViews(v => { const n = [...v]; n[i] = views; return n; });
        setStoryAnalyticsUnique(u => { const n = [...u]; n[i] = unique; return n; });
        return prev;
      }
      setStoryAnalyticsViews(v => [...v, views]);
      setStoryAnalyticsUnique(u => [...u, unique]);
      return [...prev, sid];
    });
  };

  const fetchStoryAnalytics = useCallback(async (storyId: string) => {
    if (getStoryAnalytics(storyId) !== null) return; // cached
    const [{ count: totalViews }, { data: uniqueData }] = await Promise.all([
      supabase.from('story_views').select('*', { count: 'exact', head: true }).eq('story_id', storyId),
      supabase.from('story_views').select('viewer_id').eq('story_id', storyId),
    ]);
    const uniqueViewers = new Set((uniqueData ?? []).map((v: any) => v.viewer_id)).size;
    setStoryAnalytics(storyId, totalViews ?? 0, uniqueViewers);
  }, [storyAnalyticsIds]);

  const REACTIONS = ['❤️', '😂', '😮', '🔥', '👏', '😍'];

  const fetchStories = useCallback(async () => {
    setLoading(true);
    let followedIds: string[] = [];
    if (user?.id) {
      const { data: followData } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
      followedIds = (followData ?? []).map((f: any) => f.following_id);
    }
    const allowedIds = user?.id ? [user.id, ...followedIds] : [];
    if (allowedIds.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    // Stories use owner_id as the canonical backend column. Query only the
    // active rows visible to this user; the database RLS policy also enforces
    // the 24-hour expiry and public/owner visibility.
    const { data, error } = await supabase
      .from('stories')
      .select('*, media_assets(*)')
      .in('owner_id', allowedIds)
      .gt('expires_at', new Date().toISOString())
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Story fetch failed', error);
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', allowedIds);
    const profilesById = new Map((profileRows ?? []).map((profile: any) => [profile.id, profile]));

    const rawStories: Story[] = (data ?? []).map((story: any) => ({
      ...story,
      user_id: story.owner_id,
      media_url: story.media_url ?? story.media_assets?.media_url ?? '',
      media_type: story.media_type ?? story.media_assets?.media_type ?? 'image',
      user_profiles: profilesById.get(story.owner_id) ?? null,
    })) as Story[];
    let viewedSet = new Set<string>();
    if (user?.id) {
      const { data: vd } = await supabase.from('story_views').select('story_id').eq('viewer_id', user.id);
      viewedSet = new Set(vd?.map((v: any) => v.story_id) ?? []);
      setViewedIds(viewedSet);
    }
    // Use plain object — no Record<string,T> annotation (esbuild guard)
    const map: { [key: string]: StoryGroup } = {};
    for (const story of rawStories) {
      if (!map[story.user_id]) {
        map[story.user_id] = {
          userId: story.user_id,
          username: story.user_profiles?.username ?? 'user',
          avatarUrl: story.user_profiles?.avatar_url ?? null,
          stories: [],
          hasUnseen: false,
        };
      }
      map[story.user_id].stories.push(story);
      if (!viewedSet.has(story.id)) map[story.user_id].hasUnseen = true;
    }
    const all = Object.values(map);
    const myGroup = all.find(g => g.userId === user?.id);
    const others = all.filter(g => g.userId !== user?.id);
    setGroups([
      ...(myGroup ? [myGroup] : []),
      ...others.filter(g => g.hasUnseen),
      ...others.filter(g => !g.hasUnseen),
    ]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { fetchStories(); }, [fetchStories]);

  const markViewed = useCallback(async (storyId: string) => {
    if (!user?.id) return;
    setViewedIds(prev => new Set([...prev, storyId]));
    await supabase.from('story_views').upsert(
      { story_id: storyId, viewer_id: user.id },
      { onConflict: 'story_id,viewer_id' }
    );
  }, [user?.id]);

  // Auto-advance with smooth progress bar — pauses on hold (esbuild guard: no IIFE in effect)
  useEffect(() => {
    if (viewerGroupIdx === null) { setProgressPct(0); return; }
    const g = groups[viewerGroupIdx];
    if (!g) return;
    const story = g.stories[activeStoryIdx];
    if (!story || story.media_type === 'video') { setProgressPct(0); return; }
    setProgressPct(0);
    const DURATION = 5000;
    let elapsed = 0;
    let lastTick = Date.now();
    const iv = setInterval(() => {
      if (isPaused) { lastTick = Date.now(); return; }
      const now = Date.now();
      elapsed += now - lastTick;
      lastTick = now;
      const pct = Math.min((elapsed / DURATION) * 100, 100);
      setProgressPct(pct);
      if (pct >= 100) {
        clearInterval(iv);
        if (activeStoryIdx < g.stories.length - 1) {
          const ni = activeStoryIdx + 1;
          setActiveStoryIdx(ni);
          markViewed(g.stories[ni].id);
        } else {
          const ng = viewerGroupIdx + 1;
          if (ng < groups.length) {
            setViewerGroupIdx(ng);
            setActiveStoryIdx(0);
            markViewed(groups[ng].stories[0].id);
          } else {
            setViewerGroupIdx(null);
          }
        }
      }
    }, 50);
    return () => clearInterval(iv);
  }, [viewerGroupIdx, activeStoryIdx, groups, markViewed, isPaused]);

  const closeViewer = () => {
    stopStoryAudio();
    setViewerGroupIdx(null);
    setReplyText('');
    setShowViewers(false);
    setStoryViewers([]);
  };

  const openViewer = (groupIdx: number) => {
    stopStoryAudio();
    setViewerGroupIdx(groupIdx);
    setActiveStoryIdx(0);
    setShowViewers(false);
    setStoryViewers([]);
    const story = groups[groupIdx]?.stories[0];
    if (story) {
      if (!viewedIds.has(story.id)) markViewed(story.id);
      const meta = (story as any).metadata;
      if (meta?.music?.preview_url) playStoryAudio(meta.music.preview_url);
      setShowCanonicalStoryAd(true);
    }
  };

  const advance = () => {
    setReplyText('');
    setShowViewers(false);
    if (viewerGroupIdx === null) return;
    const g = groups[viewerGroupIdx];
    if (!g) return;
    if (activeStoryIdx < g.stories.length - 1) {
      const ni = activeStoryIdx + 1;
      setActiveStoryIdx(ni);
      markViewed(g.stories[ni].id);
      const meta = (g.stories[ni] as any).metadata;
      if (meta?.music?.preview_url) playStoryAudio(meta.music.preview_url);
      else stopStoryAudio();
    } else if (viewerGroupIdx < groups.length - 1) {
      const ng = viewerGroupIdx + 1;
      setViewerGroupIdx(ng);
      setActiveStoryIdx(0);
      markViewed(groups[ng].stories[0].id);
      const meta = (groups[ng].stories[0] as any).metadata;
      if (meta?.music?.preview_url) playStoryAudio(meta.music.preview_url);
      else stopStoryAudio();
    } else {
      closeViewer();
    }
  };

  const retreat = () => {
    setReplyText('');
    setShowViewers(false);
    if (viewerGroupIdx === null) return;
    if (activeStoryIdx > 0) {
      const pi = activeStoryIdx - 1;
      setActiveStoryIdx(pi);
      const g = groups[viewerGroupIdx];
      const meta = (g?.stories[pi] as any)?.metadata;
      if (meta?.music?.preview_url) playStoryAudio(meta.music.preview_url);
      else stopStoryAudio();
    } else if (viewerGroupIdx > 0) {
      const pg = viewerGroupIdx - 1;
      setViewerGroupIdx(pg);
      const lastIdx = groups[pg].stories.length - 1;
      setActiveStoryIdx(lastIdx);
      const meta = (groups[pg].stories[lastIdx] as any)?.metadata;
      if (meta?.music?.preview_url) playStoryAudio(meta.music.preview_url);
      else stopStoryAudio();
    }
  };

  const fetchStoryViewers = async (storyId: string) => {
    setLoadingViewers(true);
    setShowViewers(true);
    const { data } = await supabase
      .from('story_views')
      .select('viewed_at, user_profiles:viewer_id(id, username, avatar_url)')
      .eq('story_id', storyId)
      .order('viewed_at', { ascending: false });
    setStoryViewers(data ?? []);
    setLoadingViewers(false);
  };

  // Fetch reply+reaction count for own story (DMs referencing the story)
  const fetchStoryReplyCount = async (storyId: string, ownerId: string) => {
    if (getStoryReplyCount(storyId) > 0) return; // cached
    try {
      const { data: convData } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_1.eq.${ownerId},participant_2.eq.${ownerId}`);
      const convIds = (convData ?? []).map((c: any) => c.id);
      if (convIds.length === 0) { setStoryReplyCount(storyId, 0); return; }
      const { count } = await supabase
        .from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', convIds)
        .ilike('content', '%story%')
        .neq('sender_id', ownerId);
      setStoryReplyCount(storyId, count ?? 0);
    } catch { setStoryReplyCount(storyId, 0); }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!user || files.length === 0) return;
    const invalid = files.find(file => !file.type.startsWith('image/') && !file.type.startsWith('video/'));
    if (invalid) { toast.error(`Unsupported media type: ${invalid.name}`); e.target.value = ''; return; }
    const tooLarge = files.find(file => file.size > 500 * 1024 * 1024);
    if (tooLarge) { toast.error(`${tooLarge.name} is larger than 500 MiB`); e.target.value = ''; return; }

    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFiles(files);
    setPendingFile(files[0]);
    setPendingCaption('');
    setPendingPreviewUrl(URL.createObjectURL(files[0]));
    setUploadItems(files.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      file,
      progress: 0,
      status: 'queued',
      attempts: 0,
    })));
    setUploadedAssets([]);
    e.target.value = '';
  };

  const cancelPending = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingFiles([]);
    setPendingCaption('');
    setPendingPreviewUrl(null);
    setUploadItems([]);
    setUploadedAssets([]);
  };

  const resetStoryComposer = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingFiles([]);
    setPendingCaption('');
    setPendingPreviewUrl(null);
    setUploadItems([]);
    setUploadedAssets([]);
    setStickers([]);
    setTextOverlays([]);
    setCountdownStickers([]);
    setPollAdded(false);
    setPollQuestion('');
    setPollOptions(['Yes', 'No']);
    setShowStickerPicker(false);
    setShowTextInput(false);
    setSelectedMusic(null);
    setLocalMusicFile(null);
    setShowMusicPicker(false);
    if (musicPreviewRef.current) { musicPreviewRef.current.pause(); musicPreviewRef.current.currentTime = 0; }
  };

  const doUpload = async () => {
    if (pendingFiles.length === 0 || !user) return;
    setUploading(true);
    grantStoryCreationReward(user.id).catch(() => {});

    try {
      const nextAssets = [...uploadedAssets];
      const indexes = pendingFiles.map((_, i) => i).filter(i => !nextAssets[i]);
      const filesToUpload = indexes.map(i => pendingFiles[i]);

      if (filesToUpload.length > 0) {
        const result = await uploadStoryMedia(filesToUpload, (localIndex, patch) => {
          const originalIndex = indexes[localIndex];
          setUploadItems(prev => prev.map((item, i) => i === originalIndex ? { ...item, ...patch } : item));
        });

        result.assets.forEach((asset, localIndex) => {
          const originalIndex = indexes[localIndex];
          if (asset) nextAssets[originalIndex] = asset;
        });
        setUploadedAssets(nextAssets);

        if (result.failed.length > 0) {
          toast.error(`${result.failed.length} media upload${result.failed.length === 1 ? '' : 's'} failed after retries. Tap Share Story to retry only failed files.`);
          return;
        }
      }

      if (nextAssets.length !== pendingFiles.length || nextAssets.some(asset => !asset?.id)) {
        toast.error('Some media is not ready yet. Retry the failed items.');
        return;
      }

      const stickerMeta = {
        ...(stickers.length > 0 ? { stickers } : {}),
        ...(textOverlays.length > 0 ? { textOverlays } : {}),
        ...(selectedMusic ? { music: { id: selectedMusic.id, title: selectedMusic.title, artist: selectedMusic.artist, cover_url: selectedMusic.cover_url } } : {}),
        ...(countdownStickers.length > 0 ? { countdownStickers } : {}),
        ...(pollAdded && pollQuestion.trim() ? { poll: { question: pollQuestion.trim(), options: pollOptions } } : {}),
      };

      const mediaPayload = nextAssets.map(asset => ({
        media_id: asset.id,
        metadata: stickerMeta,
      }));

      const { data, error } = await supabase.rpc('testagram_story_publish', {
        p_media: mediaPayload,
        p_caption: pendingCaption.trim() || null,
        p_visibility: 'public',
      });

      if (error) throw error;
      toast.success(`Story posted with ${data?.count ?? pendingFiles.length} media items · expires in 24h`);
      resetStoryComposer();
      await fetchStories();
    } catch (error) {
      console.error('Story publish failed', error);
      toast.error(error instanceof Error ? error.message : 'Failed to publish story');
    } finally {
      setUploading(false);
    }
  };

  const sendReaction = async (emoji: string) => {
    if (!user || viewerGroupIdx === null) return;
    const g = groups[viewerGroupIdx];
    if (!g || g.userId === user.id) return;
    setSendingReaction(true);
    setShowReactions(false);
    try {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(participant_1.eq.${user.id},participant_2.eq.${g.userId}),and(participant_1.eq.${g.userId},participant_2.eq.${user.id})`)
        .maybeSingle();
      let convId = existing?.id;
      if (!convId) {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({ participant_1: user.id, participant_2: g.userId })
          .select('id').single();
        convId = newConv?.id;
      }
      if (!convId) throw new Error('No conversation');
      await supabase.from('direct_messages').insert({
        conversation_id: convId,
        sender_id: user.id,
        content: `${emoji} Reacted to your story`,
      });
      toast.success(`${emoji} Sent!`, { duration: 1500 });
    } catch {
      toast.error('Could not send reaction');
    } finally {
      setSendingReaction(false);
    }
  };

  const sendStoryReply = async () => {
    if (!replyText.trim() || !user || viewerGroupIdx === null) return;
    const g = groups[viewerGroupIdx];
    if (!g || g.userId === user.id) return;
    setSendingReply(true);
    const text = replyText.trim();
    setReplyText('');
    try {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(participant_1.eq.${user.id},participant_2.eq.${g.userId}),and(participant_1.eq.${g.userId},participant_2.eq.${user.id})`)
        .maybeSingle();
      let convId = existing?.id;
      if (!convId) {
        const { data: newConv, error: convErr } = await supabase
          .from('conversations')
          .insert({ participant_1: user.id, participant_2: g.userId })
          .select('id').single();
        if (convErr) throw convErr;
        convId = newConv?.id;
      }
      if (!convId) throw new Error('No conversation');
      const { error: msgErr } = await supabase.from('direct_messages').insert({
        conversation_id: convId,
        sender_id: user.id,
        content: text,
      });
      if (msgErr) throw msgErr;
      toast.success('Reply sent!');
    } catch {
      toast.error('Failed to send reply');
      setReplyText(text);
    } finally {
      setSendingReply(false);
    }
  };

  // ── Story AI Caption Generator ──────────────────────────────────────────────
  const [captionSuggestions, setCaptionSuggestions] = useState<string[]>([]);
  const [captionGenLoading, setCaptionGenLoading] = useState(false);

  const generateStoryCaptions = async () => {
    setCaptionGenLoading(true);
    setCaptionSuggestions([]);
    try {
      const ctx = pendingCaption.trim() || (pendingFile?.type.startsWith('video') ? 'a video story' : 'a photo story');
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: {
          messages: [{
            role: 'user',
            content: `Generate exactly 3 short, catchy story captions for: "${ctx}". Under 80 characters each. Return ONLY the 3 captions separated by "|||" with no labels.`,
          }],
          model: 'google/gemini-3-flash-preview',
        },
      });
      if (error) throw error;
      const raw = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.text ?? '';
      const caps = raw.split('|||').map((s: string) => s.trim()).filter(Boolean).slice(0, 3);
      setCaptionSuggestions(caps.length > 0 ? caps : ['No suggestions generated']);
    } catch {
      setCaptionSuggestions(['Failed to generate. Try again.']);
    } finally {
      setCaptionGenLoading(false);
    }
  };

  // Skeleton while loading
  if (loading && groups.length === 0) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border overflow-hidden h-[88px]">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-14 h-14 rounded-full bg-muted animate-pulse" />
            <div className="w-10 h-2 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (!user && groups.length === 0) return null;

  const myGroupIdx = groups.findIndex(g => g.userId === user?.id);
  const hasMyStory = myGroupIdx !== -1;
  // Pre-compute (esbuild guard: no IIFE)
  const exploreViewerStory0 = exploreStories[0]?.stories[0] ?? null;

  // Pre-compute viewer state before JSX — esbuild guard: no IIFE in render
  const viewerG     = viewerGroupIdx !== null ? (groups[viewerGroupIdx] ?? null) : null;
  const viewerStory = viewerG ? (viewerG.stories[activeStoryIdx] ?? null) : null;
  const viewerIsOwn = !!user && !!viewerG && user.id === viewerG.userId;
  const viewerMeta  = viewerStory ? ((viewerStory as any).metadata ?? null) : null;
  const viewerPoll  = viewerMeta?.poll ?? null;
  const viewerMusic = viewerMeta?.music ?? null;
  // Sticker/overlay arrays — pre-extracted (esbuild guard: no nested IIFE in render)
  const viewerStickerList: { emoji: string; x: number; y: number; id: string }[] = viewerMeta?.stickers ?? [];
  const viewerTextList: { text: string; x: number; y: number; id: string; color: string; size: string }[] = viewerMeta?.textOverlays ?? [];
  const viewerCountdownList: { id: string; targetDate: string; label: string; x: number; y: number }[] = viewerMeta?.countdownStickers ?? [];
  // Poll data for current viewer story (no IIFE needed)
  const viewerPollData   = viewerStory ? getPollVote(viewerStory.id) : undefined;
  const viewerTotalVotes = viewerPollData ? (viewerPollData.counts ?? [0, 0]).reduce((a, b) => a + b, 0) : 0;
  const viewerHasVoted   = viewerPollData !== undefined && viewerPollData.userVote !== null && viewerPollData.userVote !== undefined;
  // Story reply count for own story — trigger side-effect and read cache (esbuild guard: no IIFE)
  if (viewerIsOwn && viewerStory) { void fetchStoryReplyCount(viewerStory.id, viewerG!.userId); }
  const viewerReplyCount = viewerIsOwn && viewerStory ? getStoryReplyCount(viewerStory.id) : 0;

  return (
    <>
      {/* ── Canonical Story Ad Slide ───────────────────────────────────────── */}
      {showCanonicalStoryAd && viewerStory && (
        <StoryAdSlide
          ad={{
            id: 'story-slot',
            source_id: viewerStory.id,
            source_type: 'story',
            author_id: viewerG?.userId ?? null,
          }}
          onComplete={() => setShowCanonicalStoryAd(false)}
          onSkip={() => setShowCanonicalStoryAd(false)}
        />
      )}

      {/* ── Explore Stories Sheet ── */}
      {showExplore && (
        <div className="fixed inset-0 z-[300] bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-lg">Explore Stories</h2>
            </div>
            <button onClick={() => setShowExplore(false)} className="p-2 rounded-full hover:bg-muted transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          {exploreLoading ? (
            <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : exploreStories.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Star className="w-12 h-12 opacity-20" />
              <p className="font-semibold">No public stories yet</p>
              <button onClick={() => { setShowExplore(false); fileInputRef.current?.click(); }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90">Create one!</button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                {exploreStories.map((g, idx) => (
                  <button
                    key={g.userId}
                    onClick={() => {
                      setShowExplore(false);
                      const existingIdx = groups.findIndex(gr => gr.userId === g.userId);
                      if (existingIdx >= 0) openViewer(existingIdx);
                    }}
                    className="rounded-2xl overflow-hidden border border-border bg-muted/20 hover:border-primary/30 transition-colors text-left"
                  >
                    <div className="aspect-[9/14] relative bg-muted">
                      {g.stories[0]?.media_type === 'video' ? (
                        <video src={`${g.stories[0].media_url}#t=0.5`} className="w-full h-full object-cover" muted preload="metadata" />
                      ) : g.stories[0]?.media_url ? (
                        <img src={g.stories[0].media_url} alt={g.username} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-purple-500/20">
                          <Star className="w-8 h-8 text-primary/40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <div className="absolute top-2 left-2 w-8 h-8 rounded-full overflow-hidden border-2 border-white/70">
                        {g.avatarUrl
                          ? <img src={g.avatarUrl} alt={g.username} className="w-full h-full object-cover" />
                          : <div className="w-full h-full bg-primary/30 flex items-center justify-center text-xs font-bold text-white">{g.username[0]?.toUpperCase()}</div>}
                      </div>
                      {g.stories.length > 1 && (
                        <div className="absolute top-2 right-2 bg-black/60 rounded-full px-1.5 py-0.5 text-white text-[10px] font-bold">+{g.stories.length}</div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold truncate">@{g.username}</p>
                      {g.stories[0]?.caption && (
                        <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{g.stories[0].caption}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {/* Story Creation CTA */}
              {user && (
                <div className="mt-4 p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-purple-500/10 border border-primary/20 flex items-center gap-3">
                  <Gift className="w-8 h-8 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold text-sm">Earn +5 credits daily</p>
                    <p className="text-xs text-muted-foreground">Post a story every day to earn rewards</p>
                  </div>
                  <button onClick={() => { setShowExplore(false); fileInputRef.current?.click(); }}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-full text-xs font-bold hover:opacity-90">
                    Create
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Story Strip ────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 overflow-x-auto scrollbar-hide border-b border-border bg-background">
        {user && (
          <button
            onClick={() => {
              if (isCreationLocked) {
                const needed = FOLLOWER_THRESHOLD - (creatorFollowers ?? 0);
                toast.error(`Unlock story creation by reaching ${FOLLOWER_THRESHOLD} followers — you need ${needed.toLocaleString()} more`);
                return;
              }
              if (hasMyStory) { openViewer(myGroupIdx); } else fileInputRef.current?.click();
            }}
            disabled={uploading}
            className="flex flex-col items-center gap-1 flex-shrink-0 group"
          >
            <div className={`relative w-14 h-14 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all ${
              hasMyStory ? 'ring-primary' : 'ring-muted-foreground/30 group-hover:ring-primary/50'
            }`}>
              {user.avatar
                ? <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                : <div className="w-full h-full rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center font-bold text-primary">{user.username[0]?.toUpperCase()}</div>
              }
              {!hasMyStory && (
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center border-2 border-background">
                  {uploading ? <Loader2 className="w-3 h-3 text-white animate-spin" /> : isCreationLocked ? <span className="text-[8px]">🔒</span> : <Plus className="w-3 h-3 text-white" />}
                </span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground font-medium leading-none">
              {hasMyStory ? 'My Story' : isCreationLocked ? '🔒 Locked' : 'Add Story'}
            </span>
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileSelected} />
        {/* Explore Stories button */}
        <button
          onClick={() => { setShowExplore(true); fetchExploreStories(); }}
          className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
        >
          <div className="w-14 h-14 rounded-full border-2 border-dashed border-primary/40 group-hover:border-primary/70 flex items-center justify-center bg-primary/5 transition-colors">
            <Compass className="w-6 h-6 text-primary/60 group-hover:text-primary transition-colors" />
          </div>
          <span className="text-[10px] text-muted-foreground font-medium">Explore</span>
        </button>
        {groups.filter(g => g.userId !== user?.id).map(g => {
          const realIdx = groups.indexOf(g);
          return (
            <button key={g.userId} onClick={() => { openViewer(realIdx); }} className="flex flex-col items-center gap-1 flex-shrink-0 group">
              <div className={`w-14 h-14 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all ${g.hasUnseen ? 'ring-primary' : 'ring-muted-foreground/20 group-hover:ring-muted-foreground/40'}`}>
                {g.avatarUrl
                  ? <img src={g.avatarUrl} alt={g.username} className="w-full h-full rounded-full object-cover" />
                  : <div className="w-full h-full rounded-full bg-muted flex items-center justify-center font-bold text-sm">{g.username[0]?.toUpperCase()}</div>
                }
              </div>
              <span className={`text-[10px] font-medium leading-none max-w-[56px] truncate ${g.hasUnseen ? 'text-foreground' : 'text-muted-foreground'}`}>{g.username}</span>
            </button>
          );
        })}
      </div>

      {/* ── Caption Input Modal ─────────────────────────── */}
      {pendingFiles.length > 0 && pendingFile && pendingPreviewUrl && (
        <div className="fixed inset-0 z-[210] bg-black/85 flex flex-col items-center justify-center p-4 gap-3 overflow-y-auto">
          <div
            ref={storyPreviewRef}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden select-none flex-shrink-0"
            onMouseMove={e => { moveDragSticker(e); moveTextOverlay(e); }}
            onMouseUp={() => { setDraggingSticker(null); setDraggingTextId(null); }}
            onTouchMove={e => { moveDragSticker(e); moveTextOverlay(e); }}
            onTouchEnd={() => { setDraggingSticker(null); setDraggingTextId(null); }}
          >
            {pendingFile.type.startsWith('video')
              ? <video src={pendingPreviewUrl} className="w-full max-h-[45vh] object-contain" muted playsInline />
              : <img src={pendingPreviewUrl} alt="" className="w-full max-h-[45vh] object-contain rounded-2xl" />
            }
            {textOverlays.map(t => (
              <div key={t.id}
                className={`absolute font-black cursor-grab active:cursor-grabbing select-none drop-shadow-lg ${t.size}`}
                style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%,-50%)', color: t.color, touchAction: 'none', zIndex: 21, textShadow: t.color === '#ffffff' ? '0 1px 3px rgba(0,0,0,0.8)' : '0 1px 3px rgba(255,255,255,0.5)' }}
                onMouseDown={e => { e.stopPropagation(); setDraggingTextId(t.id); }}
                onTouchStart={e => { e.stopPropagation(); setDraggingTextId(t.id); }}
                onDoubleClick={e => { e.stopPropagation(); setTextOverlays(prev => prev.filter(x => x.id !== t.id)); }}
              >{t.text}</div>
            ))}
            {stickers.map(s => (
              <div key={s.id} className="absolute text-4xl cursor-grab active:cursor-grabbing select-none"
                style={{ left: `${s.x}%`, top: `${s.y}%`, transform: 'translate(-50%,-50%)', touchAction: 'none', zIndex: 20 }}
                onMouseDown={e => { e.stopPropagation(); setDraggingSticker(s.id); }}
                onTouchStart={e => { e.stopPropagation(); setDraggingSticker(s.id); }}
                onDoubleClick={e => { e.stopPropagation(); setStickers(prev => prev.filter(st => st.id !== s.id)); }}
              >{s.emoji}</div>
            ))}
          </div>

          {pendingFiles.length > 1 && (
            <div className="w-full max-w-sm bg-black/70 backdrop-blur-md rounded-2xl border border-white/20 p-3 flex-shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-white text-xs font-bold">{pendingFiles.length} media selected</p>
                <p className="text-white/50 text-[10px]">4 uploads at a time · auto-retry ×3</p>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {uploadItems.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="text-white/70 text-[10px] w-5 text-right">{i + 1}</span>
                    <span className="text-white text-[10px] truncate flex-1">{item.file.name}</span>
                    <span className={`text-[9px] font-semibold ${item.status === 'failed' ? 'text-red-300' : item.status === 'uploaded' ? 'text-emerald-300' : 'text-white/50'}`}>
                      {item.status === 'retrying' ? `Retry ${item.attempts}/3` : item.status === 'uploaded' ? '✓' : `${item.progress}%`}
                    </span>
                    <div className="w-14 h-1 rounded-full bg-white/15 overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showStickerPicker && (
            <div className="w-full max-w-sm bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/20 flex-shrink-0">
              <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest mb-2 text-center">Tap to add · drag to reposition · double-tap to remove</p>
              <div className="grid grid-cols-5 gap-1.5">
                {STICKER_EMOJIS.map(emoji => (
                  <button key={emoji} onClick={() => addSticker(emoji)} className="w-11 h-11 flex items-center justify-center text-2xl rounded-xl hover:bg-white/20 active:scale-110 transition-all">{emoji}</button>
                ))}
              </div>
            </div>
          )}

          <div className="w-full max-w-sm space-y-2 flex-shrink-0">
            {showTextInput && (
              <div className="w-full max-w-sm bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/20">
                <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest mb-2 text-center">Add Text · drag to reposition · double-tap to remove</p>
                <input type="text" value={draftText} onChange={e => setDraftText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTextOverlay()} placeholder="Type something…" autoFocus maxLength={80}
                  className="w-full bg-white/10 text-white placeholder:text-white/40 border border-white/20 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary mb-2" />
                <div className="flex items-center gap-1.5 mb-2">
                  {TEXT_COLORS.map(c => (
                    <button key={c} onClick={() => setDraftTextColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform active:scale-110 ${draftTextColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  {TEXT_SIZES.map(s => (
                    <button key={s.cls} onClick={() => setDraftTextSize(s.cls)}
                      className={`px-3 py-1 rounded-lg text-white text-xs font-bold border transition-colors ${draftTextSize === s.cls ? 'bg-primary border-primary' : 'bg-white/10 border-white/20'}`}
                    >{s.label}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowTextInput(false)} className="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium">Cancel</button>
                  <button onClick={addTextOverlay} disabled={!draftText.trim()} className="flex-1 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold disabled:opacity-50">Add Text</button>
                </div>
              </div>
            )}

            {showMusicPicker && (
              <div className="w-full max-w-sm bg-black/80 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden flex-shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                  <SearchIcon className="w-4 h-4 text-white/50 shrink-0" />
                  <input value={musicSearch} onChange={e => setMusicSearch(e.target.value)} placeholder="Search songs, artists…" className="flex-1 bg-transparent text-white placeholder:text-white/40 text-sm focus:outline-none" />
                  <button onClick={() => { if (musicPreviewRef.current) { musicPreviewRef.current.pause(); musicPreviewRef.current.currentTime = 0; } setPreviewingMusic(null); setShowMusicPicker(false); }} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  <button onClick={() => localMusicInputRef.current?.click()} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/10 transition-colors border-b border-white/10 text-left">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0"><Music className="w-4 h-4 text-purple-400" /></div>
                    <div><p className="text-white text-sm font-semibold">Upload from device</p><p className="text-white/40 text-xs">MP3, AAC, WAV</p></div>
                  </button>
                  {filteredMusic.map(track => (
                    <div key={track.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/10 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-muted overflow-hidden shrink-0">
                        {track.cover_url ? <img src={track.cover_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"><Music className="w-4 h-4 text-white" /></div>}
                      </div>
                      <div className="flex-1 min-w-0"><p className="text-white text-sm font-semibold truncate">{track.title}</p><p className="text-white/50 text-xs">{track.artist} · {track.genre}</p></div>
                      <button onClick={() => playPreview(track)} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0 text-white transition-colors">
                        {previewingMusic?.id === track.id ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                      </button>
                      <button onClick={() => selectMusic(track)} className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 transition-colors ${selectedMusic?.id === track.id ? 'bg-primary text-white' : 'bg-white/10 text-white hover:bg-primary/70'}`}>
                        {selectedMusic?.id === track.id ? 'Added' : 'Add'}
                      </button>
                    </div>
                  ))}
                  {filteredMusic.length === 0 && musicSearch && <p className="text-white/40 text-sm text-center py-6">No results for "{musicSearch}"</p>}
                </div>
                <input ref={localMusicInputRef} type="file" accept="audio/*" className="hidden" onChange={handleLocalMusicFile} />
              </div>
            )}

            {selectedMusic && (
              <div className="flex items-center gap-2 bg-black/60 border border-white/20 rounded-full px-3 py-1.5">
                <Music className="w-3.5 h-3.5 text-primary shrink-0" />
                <p className="text-white text-xs font-semibold truncate max-w-[140px]">{selectedMusic.title}</p>
                <button onClick={() => { setSelectedMusic(null); setLocalMusicFile(null); }} className="text-white/50 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={() => { setShowTextInput(v => !v); setShowStickerPicker(false); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${showTextInput ? 'bg-primary border-primary text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                <span>✍️</span>Text {textOverlays.length > 0 ? `(${textOverlays.length})` : ''}
              </button>
              <button onClick={() => { setShowStickerPicker(v => !v); setShowTextInput(false); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${showStickerPicker ? 'bg-primary border-primary text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                <span>🎉</span>Stickers {stickers.length > 0 ? `(${stickers.length})` : ''}
              </button>
              <button onClick={() => { setShowMusicPicker(v => !v); setShowTextInput(false); setShowStickerPicker(false); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${showMusicPicker ? 'bg-primary border-primary text-white' : selectedMusic ? 'bg-primary/30 border-primary/50 text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                <Music className="w-3.5 h-3.5" />Music {selectedMusic ? '✓' : ''}
              </button>
              <button onClick={() => { setShowPollPicker(v => !v); setShowTextInput(false); setShowStickerPicker(false); setShowMusicPicker(false); setShowCountdownPicker(false); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${showPollPicker ? 'bg-primary border-primary text-white' : pollAdded ? 'bg-primary/30 border-primary/50 text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                📊 Poll {pollAdded ? '✓' : ''}
              </button>
              <button onClick={() => { setShowCountdownPicker(v => !v); setShowTextInput(false); setShowStickerPicker(false); setShowMusicPicker(false); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${showCountdownPicker ? 'bg-primary border-primary text-white' : countdownStickers.length > 0 ? 'bg-primary/30 border-primary/50 text-white' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
                ⏱️ Timer {countdownStickers.length > 0 ? `(${countdownStickers.length})` : ''}
              </button>
              {(stickers.length > 0 || textOverlays.length > 0) && (
                <button onClick={() => { setStickers([]); setTextOverlays([]); }} className="text-white/50 text-xs hover:text-white/80 transition-colors">Clear all</button>
              )}
            </div>

            <input type="text" value={pendingCaption} onChange={e => setPendingCaption(e.target.value)} onKeyDown={e => e.key === 'Enter' && doUpload()} placeholder="Add a caption… (optional)" maxLength={200} autoFocus
              className="w-full bg-white/10 text-white placeholder:text-white/40 border border-white/20 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
            <p className="text-right text-[10px] text-white/40">{pendingCaption.length}/200</p>

            <div className="flex items-center gap-2">
              <button onClick={generateStoryCaptions} disabled={captionGenLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 text-amber-300 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50">
                {captionGenLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>✨</span>}
                {captionGenLoading ? 'Generating…' : 'AI Caption'}
              </button>
              {captionSuggestions.length > 0 && <button onClick={() => setCaptionSuggestions([])} className="text-white/40 hover:text-white/70 text-xs">× Clear</button>}
            </div>
            {captionSuggestions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-white/50 font-semibold uppercase tracking-wide">Tap to use:</p>
                {captionSuggestions.map((cap, i) => (
                  <button key={i} onClick={() => { setPendingCaption(cap); setCaptionSuggestions([]); }}
                    className="w-full text-left text-xs text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-3 py-2 leading-relaxed transition-colors">{cap}</button>
                ))}
              </div>
            )}

            {showPollPicker && (
              <div className="w-full bg-black/70 backdrop-blur-md rounded-2xl border border-white/20 p-3 space-y-2">
                <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest text-center">Add Poll Sticker</p>
                <input type="text" value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="Ask a question…" maxLength={60}
                  className="w-full bg-white/10 text-white placeholder:text-white/40 text-sm border border-white/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="flex gap-2">
                  {pollOptions.map((opt, i) => (
                    <input key={i} type="text" value={opt} onChange={e => setPollOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))} placeholder={`Option ${i + 1}`} maxLength={30}
                      className="flex-1 bg-white/10 text-white placeholder:text-white/40 text-sm border border-white/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowPollPicker(false)} className="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium">Cancel</button>
                  <button onClick={addPollSticker} disabled={!pollQuestion.trim()} className="flex-1 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold disabled:opacity-50">Add Poll 📊</button>
                </div>
              </div>
            )}
            {pollAdded && pollQuestion && (
              <div className="bg-white/10 border border-white/20 rounded-xl px-3 py-2.5">
                <p className="text-white text-xs font-bold mb-1.5">{pollQuestion}</p>
                <div className="flex gap-2">
                  {pollOptions.map((opt, i) => (
                    <div key={i} className="flex-1 py-1.5 bg-white/10 rounded-lg text-center text-white text-[11px] font-semibold border border-white/20">{opt || `Option ${i + 1}`}</div>
                  ))}
                </div>
                <button onClick={() => { setPollAdded(false); setPollQuestion(''); setPollOptions(['Yes', 'No']); }} className="mt-1.5 text-[10px] text-white/50 hover:text-white/80">× Remove Poll</button>
              </div>
            )}
            {showCountdownPicker && (
              <div className="w-full bg-black/70 backdrop-blur-md rounded-2xl border border-white/20 p-3 space-y-2">
                <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest text-center">Add Countdown Sticker</p>
                <input type="datetime-local" value={countdownDate} onChange={e => setCountdownDate(e.target.value)} min={new Date().toISOString().slice(0, 16)}
                  className="w-full bg-white/10 text-white text-sm border border-white/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
                <input type="text" value={countdownLabel} onChange={e => setCountdownLabel(e.target.value)} placeholder="Event name (e.g. My Birthday)" maxLength={30}
                  className="w-full bg-white/10 text-white placeholder:text-white/40 text-sm border border-white/20 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary" />
                <div className="flex gap-2">
                  <button onClick={() => setShowCountdownPicker(false)} className="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium">Cancel</button>
                  <button onClick={addCountdown} disabled={!countdownDate} className="flex-1 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold disabled:opacity-50">Add ⏱️</button>
                </div>
              </div>
            )}
            {countdownStickers.map(cs => (
              <div key={cs.id} className="flex items-center justify-between bg-white/10 border border-white/20 rounded-xl px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⏱️</span>
                  <div><p className="text-white text-xs font-bold">{cs.label}</p><p className="text-white/60 text-[10px]">{getCountdownText(cs.targetDate)} remaining</p></div>
                </div>
                <button onClick={() => setCountdownStickers(prev => prev.filter(c => c.id !== cs.id))} className="text-white/40 hover:text-white/80 text-xs">× Remove</button>
              </div>
            ))}
            <div className="flex gap-3">
              <button onClick={cancelPending} disabled={uploading} className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={doUpload} disabled={uploading} className="flex-1 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploading ? (uploadItems.some(i => i.status === 'uploading' || i.status === 'retrying') ? 'Uploading…' : 'Publishing…') : (pendingFiles.length > 1 ? `Share ${pendingFiles.length} Stories` : 'Share Story')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Full-screen Story Viewer — no IIFE (esbuild guard) ─── */}
      {viewerGroupIdx !== null && viewerG && viewerStory && (
        <div
          className="fixed inset-0 z-[200] bg-black flex items-center justify-center select-none"
          onTouchStart={e => {
            touchStartX.current = e.touches[0].clientX;
            isSwiping.current = false;
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            holdTimerRef.current = setTimeout(() => setIsPaused(true), 150);
          }}
          onTouchMove={e => {
            if (touchStartX.current !== null && Math.abs(e.touches[0].clientX - touchStartX.current) > 10)
              isSwiping.current = true;
          }}
          onTouchEnd={e => {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            setIsPaused(false);
            if (touchStartX.current === null) return;
            const delta = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(delta) < 50) { isSwiping.current = false; return; }
            if (delta < 0) advance(); else retreat();
          }}
          onMouseDown={() => {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            holdTimerRef.current = setTimeout(() => setIsPaused(true), 150);
          }}
          onMouseUp={() => {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            setIsPaused(false);
          }}
          onMouseLeave={() => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); setIsPaused(false); }}
          onClick={e => {
            if (showViewers) return;
            if (isSwiping.current) { isSwiping.current = false; return; }
            const x = e.clientX;
            const w = (e.currentTarget as HTMLElement).clientWidth;
            if (x < w / 2) retreat(); else advance();
          }}
        >
          {/* Pause overlay */}
          {isPaused && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/30">
                <Pause className="w-7 h-7 text-white" fill="white" />
              </div>
            </div>
          )}

          {/* Per-story progress bars */}
          <div className="absolute top-3 left-3 right-3 flex gap-1 z-20 pointer-events-none">
            {viewerG.stories.map((_, i) => (
              <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full" style={{
                  width: i < activeStoryIdx ? '100%' : i === activeStoryIdx ? (viewerStory.media_type === 'video' ? '0%' : `${progressPct}%`) : '0%',
                }} />
              </div>
            ))}
          </div>

          {/* User header */}
          <div className="absolute top-8 left-3 right-3 flex items-center gap-2 z-20">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-white/20 flex-shrink-0">
              {viewerG.avatarUrl
                ? <img src={viewerG.avatarUrl} alt={viewerG.username} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-white font-bold text-xs">{viewerG.username[0]?.toUpperCase()}</div>
              }
            </div>
            <span className="text-white font-semibold text-sm flex-1 truncate">{viewerG.username}</span>
            {viewerIsOwn && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={e => { e.stopPropagation(); fetchStoryViewers(viewerStory.id); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-medium border border-white/20 transition-colors">
                  <span>👁</span><span>{viewerStory.views_count ?? 0}</span>
                </button>
                {viewerReplyCount > 0 && (
                  <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-pink-500/30 border border-pink-500/40 text-white text-xs font-medium">
                    <span>💬</span><span>{viewerReplyCount}</span>
                  </div>
                )}
              </div>
            )}
            <button onClick={e => { e.stopPropagation(); closeViewer(); }}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors flex-shrink-0" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Media */}
          {viewerStory.media_type === 'video'
            ? <video key={viewerStory.id} src={viewerStory.media_url} autoPlay playsInline className="max-h-screen max-w-full object-contain" onEnded={advance} onClick={e => e.stopPropagation()} />
            : <img key={viewerStory.id} src={viewerStory.media_url} alt="" className="max-h-screen max-w-full object-contain" draggable={false} />
          }

          {/* Story viewers analytics sheet — own story only */}
          {showViewers && viewerIsOwn && (
            <div className="absolute inset-0 z-50 flex flex-col" style={{ background: 'rgba(0,0,0,0.93)' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 pt-12 pb-3 border-b border-white/10">
                <div>
                  <h3 className="text-white font-bold text-base">Story Views</h3>
                  <p className="text-white/50 text-xs mt-0.5">{loadingViewers ? 'Loading…' : `${storyViewers.length} viewer${storyViewers.length !== 1 ? 's' : ''}`}</p>
                </div>
                <button onClick={() => { setShowViewers(false); setStoryViewers([]); }} className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {loadingViewers ? (
                  <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-white/50" /></div>
                ) : storyViewers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-2 text-white/40">
                    <span className="text-4xl">👁</span>
                    <p className="text-sm font-medium">No views yet</p>
                    <p className="text-xs">Share your story to get views!</p>
                  </div>
                ) : storyViewers.map((v: any, i: number) => {
                  const profile = v.user_profiles ?? {};
                  const uname = profile.username ?? 'user';
                  const ts = v.viewed_at ? new Date(v.viewed_at) : null;
                  const timeStr = ts ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                  const dateStr = ts ? ts.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
                  return (
                    <div key={v.story_id + String(i)} className="flex items-center gap-3 px-4 py-3.5 border-b border-white/8">
                      <div className="w-10 h-10 rounded-full bg-white/15 overflow-hidden shrink-0">
                        {profile.avatar_url ? <img src={profile.avatar_url} alt={uname} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white font-bold text-sm">{uname[0]?.toUpperCase()}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">{uname}</p>
                        {(dateStr || timeStr) && <p className="text-white/45 text-xs">{dateStr}{dateStr && timeStr ? ' · ' : ''}{timeStr}</p>}
                      </div>
                      <span className="text-white/20 text-lg">👁</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Emoji reactions */}
          {user && !viewerIsOwn && showReactions && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-3 py-2 border border-white/20" onClick={e => e.stopPropagation()}>
              {REACTIONS.map(emoji => (
                <button key={emoji} onClick={() => sendReaction(emoji)} disabled={sendingReaction}
                  className="w-10 h-10 flex items-center justify-center text-2xl rounded-full hover:bg-white/20 active:scale-125 transition-all duration-150">{emoji}</button>
              ))}
              <button onClick={() => setShowReactions(false)} className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white ml-1"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* Sticker overlays — pre-computed, no IIFE */}
          {viewerStickerList.map(s => (
            <div key={s.id} className="absolute text-4xl pointer-events-none select-none"
              style={{ left: `${s.x}%`, top: `${s.y}%`, transform: 'translate(-50%,-50%)', zIndex: 22 }}>{s.emoji}</div>
          ))}
          {viewerTextList.map(t => (
            <div key={t.id} className={`absolute font-black pointer-events-none select-none drop-shadow-lg ${t.size || 'text-2xl'}`}
              style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%,-50%)', color: t.color || '#fff', zIndex: 23, textShadow: t.color === '#ffffff' ? '0 1px 3px rgba(0,0,0,0.8)' : '0 1px 3px rgba(255,255,255,0.5)' }}>{t.text}</div>
          ))}
          {viewerCountdownList.map(cs => {
            const diff = new Date(cs.targetDate).getTime() - currentTime;
            const d = Math.floor(diff / 86400000);
            const h = Math.floor((diff % 86400000) / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            const cdText = diff <= 0 ? 'LIVE!' : d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
            return (
              <div key={cs.id} className="absolute pointer-events-none select-none" style={{ left: `${cs.x ?? 50}%`, top: `${cs.y ?? 50}%`, transform: 'translate(-50%,-50%)', zIndex: 24 }}>
                <div className="bg-black/60 backdrop-blur-sm border border-white/30 rounded-2xl px-4 py-2.5 text-center">
                  <p className="text-white/70 text-[10px] font-semibold uppercase tracking-widest">{cs.label}</p>
                  <p className="text-white text-2xl font-black tabular-nums">{cdText}</p>
                </div>
              </div>
            );
          })}

          {/* Poll sticker — no IIFE (esbuild guard) */}
          {viewerPoll && (
            <div className="absolute bottom-20 left-4 right-4 z-30" onClick={e => e.stopPropagation()}>
              {viewerStory && !viewerPollData && void fetchPollVotes(viewerStory.id)}
              <div className="bg-black/70 backdrop-blur-md border border-white/30 rounded-2xl p-4">
                <p className="text-white font-bold text-sm text-center mb-3">📊 {viewerPoll.question}</p>
                <div className="flex gap-2">
                  {viewerPoll.options.map((opt, i) => {
                    const votes = viewerPollData?.counts?.[i] ?? 0;
                    const pct = viewerTotalVotes > 0 ? Math.round((votes / viewerTotalVotes) * 100) : 0;
                    const voted = viewerPollData?.userVote === i;
                    return (
                      <button key={i} onClick={() => viewerStory && !viewerHasVoted && voteOnStoryPoll(viewerStory.id, i)} disabled={viewerHasVoted}
                        className={`relative flex-1 rounded-xl overflow-hidden border-2 py-3 px-2 text-center transition-all active:scale-95 ${voted ? 'border-primary bg-primary/40' : viewerHasVoted ? 'border-white/20 bg-white/10 opacity-80' : 'border-white/30 bg-white/15 hover:bg-white/25'}`}>
                        {viewerHasVoted && <div className={`absolute inset-y-0 left-0 rounded-xl transition-all duration-700 ${voted ? 'bg-primary/40' : 'bg-white/10'}`} style={{ width: `${pct}%` }} />}
                        <span className="relative text-white text-sm font-bold block">{opt}</span>
                        {viewerHasVoted && <span className="relative text-white/70 text-[10px] block mt-0.5">{pct}%</span>}
                      </button>
                    );
                  })}
                </div>
                {viewerTotalVotes > 0 && <p className="text-white/40 text-[10px] text-center mt-2">{viewerTotalVotes} vote{viewerTotalVotes !== 1 ? 's' : ''}</p>}
              </div>
            </div>
          )}

          {/* Music badge — no IIFE (esbuild guard) */}
          {viewerMusic && (
            <div className="absolute top-16 right-3 z-20 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-white/20 rounded-full px-2.5 py-1.5">
              <Music className="w-3 h-3 text-primary animate-pulse" />
              <p className="text-white text-[10px] font-semibold max-w-[120px] truncate">{viewerMusic.title} — {viewerMusic.artist}</p>
            </div>
          )}

          {/* Caption */}
          {viewerStory.caption && (
            <div className="absolute bottom-16 left-6 right-6 z-20 pointer-events-none">
              <p className="text-white text-sm font-medium bg-black/50 rounded-2xl px-4 py-2.5 text-center backdrop-blur-sm">{viewerStory.caption}</p>
            </div>
          )}

          {/* Reply bar — other user's story only */}
          {user && !viewerIsOwn && (
            <div className="absolute bottom-4 left-4 right-4 z-30 space-y-2" onClick={e => e.stopPropagation()}>
              {/* Quick emoji reaction bar — tapping an emoji sends it instantly as a DM */}
              {showQuickReactionBar && (
                <div className="flex items-center justify-center gap-2 bg-black/70 backdrop-blur-sm rounded-2xl px-3 py-2.5 border border-white/20">
                  {QUICK_REACTION_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => { sendReaction(emoji); setShowQuickReactionBar(false); }}
                      disabled={sendingReaction}
                      className="w-11 h-11 flex items-center justify-center text-2xl rounded-xl hover:bg-white/20 active:scale-125 transition-all duration-150 disabled:opacity-50"
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowQuickReactionBar(false)}
                    className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white ml-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {/* Text reply row */}
              <div className="flex items-center gap-2">
                <button onClick={() => { const su = encodeURIComponent(viewerStory.media_url); navigate(`/messages?to=${viewerG.username}&storyUrl=${su}`); }}
                  className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center border border-white/20 shrink-0 hover:bg-white/25 transition-colors" title="Reply via DM">
                  <MessageCircle className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={() => setShowQuickReactionBar(v => !v)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center border text-lg shrink-0 transition-all ${showQuickReactionBar ? 'bg-white/30 border-white/40 scale-105' : 'bg-white/15 border-white/20 hover:bg-white/25'}`}
                  title="React with emoji"
                >
                  😊
                </button>
                <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') sendStoryReply(); }}
                  placeholder={`Reply to ${viewerG.username}…`}
                  className="flex-1 bg-white/10 text-white placeholder:text-white/50 border border-white/20 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-white/50 backdrop-blur-sm" />
                <button onClick={e => { e.stopPropagation(); sendStoryReply(); }} disabled={sendingReply || !replyText.trim()}
                  className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 disabled:opacity-50 transition-opacity hover:opacity-90">
                  {sendingReply ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
                </button>
              </div>
            </div>
          )}

          {/* Navigation hit zones */}
          {!showViewers && (
            <>
              <div className="absolute inset-y-0 left-0 w-1/3 z-10" onClick={e => { e.stopPropagation(); retreat(); }} />
              <div className="absolute inset-y-0 right-0 w-1/3 z-10" onClick={e => { e.stopPropagation(); advance(); }} />
            </>
          )}
        </div>
      )}
    </>
  );
}
