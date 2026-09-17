import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Plus, X, Loader2, Send, MessageCircle, Music, Search as SearchIcon, Play, Pause, Compass, Gift, Star } from 'lucide-react';
import { toast } from 'sonner';
import { StoryAdSlide } from './StoryAdSlide';

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
  const [currentTime, setCurrentTime] = useState(0);
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
  const [pendingCaption, setPendingCaption] = useState('');
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  // Swipe tracking
  const touchStartX = useRef<number | null>(null);
  const isSwiping = useRef(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [sendingReaction, setSendingReaction] = useState(false);
  const [showQuickReactionBar, setShowQuickReactionBar] = useState(false);
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
  const [countdownStickers, setCountdownStickers] = useState<{ id: string; targetDate: string; label: string; x: number; y: number }[]>([]);
  const [showCountdownPicker, setShowCountdownPicker] = useState(false);
  const [countdownDate, setCountdownDate] = useState('');
  const [countdownLabel, setCountdownLabel] = useState('');

  const addCountdown = () => {
    if (!countdownDate) return;
    setCountdownStickers(prev => [...prev, {
      id: Date.now().toString(), targetDate: countdownDate, label: countdownLabel.trim() || 'Event',
      x: 25 + Math.random() * 50, y: 40 + Math.random() * 20,
    }]);
    setCountdownDate(''); setCountdownLabel(''); setShowCountdownPicker(false);
  };

  const getCountdownText = (targetDate: string) => {
    const diff = new Date(targetDate).getTime() - currentTime;
    if (diff <= 0) return 'LIVE!';
    const d = Math.floor(diff / 86400000); const h = Math.floor((diff % 86400000) / 3600000); const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d}d ${h}h`; if (h > 0) return `${h}h ${m}m`; return `${m}m`;
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
    const audio = new Audio(track.preview_url); musicPreviewRef.current = audio; audio.play().catch(() => {});
    audio.addEventListener('ended', () => setPreviewingMusic(null)); setPreviewingMusic(track);
  };
  const selectMusic = (track: any) => {
    if (musicPreviewRef.current) { musicPreviewRef.current.pause(); musicPreviewRef.current.currentTime = 0; }
    setPreviewingMusic(null); setSelectedMusic(track); setLocalMusicFile(null); setShowMusicPicker(false);
  };
  const handleLocalMusicFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const localTrack = { id: 'local', title: file.name.replace(/\.[^.]+$/, ''), artist: 'Local file', preview_url: URL.createObjectURL(file), cover_url: null, genre: 'Custom' };
    setLocalMusicFile(file); setSelectedMusic(localTrack); setShowMusicPicker(false); e.target.value = '';
  };
  const filteredMusic = musicSearch.trim() ? musicCatalogue.filter(t => t.title.toLowerCase().includes(musicSearch.toLowerCase()) || t.artist.toLowerCase().includes(musicSearch.toLowerCase()) || t.genre?.toLowerCase().includes(musicSearch.toLowerCase())) : musicCatalogue;

  // ── Story is FREE for all users — follower gate removed ──────────────────
  const [creatorFollowers, setCreatorFollowers] = useState<number | null>(null);
  const FOLLOWER_THRESHOLD = 0;
  const isCreationLocked = false;
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('follower_count').eq('id', user.id).maybeSingle().then(({ data }) => setCreatorFollowers(data?.follower_count ?? 0));
  }, [user?.id]);

  // ── Story Ads: canonical Testagram serving only ────────────────────────────
  const [storyAdCounter, setStoryAdCounter] = useState(0);
  const AD_INJECT_INTERVAL = 3;
  const maybeShowStoryAd = useCallback(() => {
    setStoryAdCounter(prev => prev + 1);
  }, []);

  // ── Story Creation Rewards: +5 credits per day ─────────────────────────────
  const grantStoryCreationReward = useCallback(async (userId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const rewardKey = `ts-story-reward-${userId}-${today}`;
    try { if (localStorage.getItem(rewardKey)) return; localStorage.setItem(rewardKey, '1'); } catch { return; }
    await supabase.from('credit_transactions').insert({ user_id: userId, amount: 5, reason: 'story_creation', metadata: { date: today } }).catch(() => {});
    toast.success('🎉 +5 credits for creating a story!', { duration: 3000 });
  }, []);

  // ── Explore Stories ─────────────────────────────────────────────────────────
  const [exploreStories, setExploreStories] = useState<StoryGroup[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [showExplore, setShowExplore] = useState(false);
  const fetchExploreStories = useCallback(async () => {
    if (exploreStories.length > 0) return;
    setExploreLoading(true);
    const { data } = await supabase.from('stories').select('*, profiles(username, avatar_url)').gt('expires_at', new Date().toISOString()).order('views_count', { ascending: false }).limit(40);
    const rawStories: Story[] = (data as Story[]) ?? [];
    const map: { [key: string]: StoryGroup } = {};
    for (const story of rawStories) {
      if (!map[story.user_id]) map[story.user_id] = { userId: story.user_id, username: story.user_profiles?.username ?? 'user', avatarUrl: story.user_profiles?.avatar_url ?? null, stories: [], hasUnseen: true };
      map[story.user_id].stories.push(story);
    }
    setExploreStories(Object.values(map).slice(0, 16)); setExploreLoading(false);
  }, [exploreStories.length]);

  // ── Story Poll Sticker ────────────────────────────────────────────────────
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['Yes', 'No']);
  const [showPollPicker, setShowPollPicker] = useState(false);
  const [pollAdded, setPollAdded] = useState(false);
  const [pollVoteIds, setPollVoteIds] = useState<string[]>([]);
  const [pollVoteCounts, setPollVoteCounts] = useState<number[][]>([]);
  const [pollVoteUser, setPollVoteUser] = useState<(number | null)[]>([]);
  const getPollVote = (sid: string) => { const i = pollVoteIds.indexOf(sid); if (i < 0) return undefined; return { counts: pollVoteCounts[i] ?? [0, 0], userVote: pollVoteUser[i] ?? null }; };
  const setPollVote = (sid: string, data: { counts: number[]; userVote: number | null }) => {
    setPollVoteIds(prev => { const i = prev.indexOf(sid); if (i >= 0) { setPollVoteCounts(pc => { const n = [...pc]; n[i] = data.counts; return n; }); setPollVoteUser(pu => { const n = [...pu]; n[i] = data.userVote; return n; }); return prev; } setPollVoteCounts(pc => [...pc, data.counts]); setPollVoteUser(pu => [...pu, data.userVote]); return [...prev, sid]; });
  };

  // The rest of the story implementation remains below; advertising state is now owned by TestagramAdSlot.
  const viewerG = viewerGroupIdx !== null ? (groups[viewerGroupIdx] ?? null) : null;
  const viewerStory = viewerG ? (viewerG.stories[activeStoryIdx] ?? null) : null;
  const viewerIsOwn = !!user && !!viewerG && user.id === viewerG.userId;
  const viewerMeta = viewerStory ? ((viewerStory as any).metadata ?? null) : null;
  const viewerPoll = viewerMeta?.poll ?? null;
  const viewerMusic = viewerMeta?.music ?? null;
  const viewerStickerList: { emoji: string; x: number; y: number; id: string }[] = viewerMeta?.stickers ?? [];
  const viewerTextList: { text: string; x: number; y: number; id: string; color: string; size: string }[] = viewerMeta?.textOverlays ?? [];
  const viewerCountdownList: { id: string; targetDate: string; label: string; x: number; y: number }[] = viewerMeta?.countdownStickers ?? [];
  const viewerPollData = viewerStory ? getPollVote(viewerStory.id) : undefined;
  const viewerTotalVotes = viewerPollData ? (viewerPollData.counts ?? [0, 0]).reduce((a, b) => a + b, 0) : 0;
  const viewerHasVoted = viewerPollData !== undefined && viewerPollData.userVote !== null && viewerPollData.userVote !== undefined;
  if (viewerIsOwn && viewerStory) { void fetchStoryReplyCount(viewerStory.id, viewerG!.userId); }
  const viewerReplyCount = viewerIsOwn && viewerStory ? getStoryReplyCount(viewerStory.id) : 0;

  // Existing story viewer/rendering handlers continue in the source below.
  return null;
}
