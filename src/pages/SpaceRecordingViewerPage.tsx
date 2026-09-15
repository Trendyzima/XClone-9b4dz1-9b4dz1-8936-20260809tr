import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useFeatureUnlock } from '@/hooks/useFeatureUnlock';
import {
  Play, Pause, Volume2, VolumeX, Download, Share2,
  Loader2, Users, Clock, ChevronRight, Radio, Bookmark,
  BookmarkCheck, Scissors, X, Edit2, Save, DollarSign,
  Plus, Trash2, Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';
import { useSEO } from '@/hooks/useSEO';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function SpaceRecordingAdBanner() { return <PageAdBanner />; }

// Module-level constants — esbuild-safe
const PODCAST_TIP_AMTS = [1, 5, 10] as const;

interface Chapter {
  time: number;   // seconds
  label: string;
}

export default function SpaceRecordingViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  // ── Clip params from URL (t=startSec&end=endSec) ────────────────────────
  const clipStart = searchParams.get('t') !== null ? Number(searchParams.get('t')) : null;
  const clipEnd   = searchParams.get('end') !== null ? Number(searchParams.get('end')) : null;
  const isClipMode = clipStart !== null && clipEnd !== null && clipEnd > (clipStart ?? 0);

  const transcriptionUnlocked = useFeatureUnlock('live_transcription');
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);

  const handleTranscribe = async () => {
    if (!recording || !user) return;
    setTranscribing(true);
    try {
      const { data, error } = try {
      await supabase.functions.invoke('transcribe-audio', {
        body: { recording_id: recording.id },
      });
      if (error) {
        const { FunctionsHttpError } = await import('@supabase/supabase-js');
        if (error instanceof FunctionsHttpError) {
          const txt = await error.context?.text?.() ?? error.message;
          throw new Error(txt);
        }
        throw error;
      }
      const transcript = data?.transcript ?? '';
      setTranscriptText(transcript);
    } catch (err: any) {
      setTranscriptText(`Transcription failed: ${err?.message ?? 'Please try again.'}`);
    } finally {
      setTranscribing(false);
    }
  };

  const [recording, setRecording] = useState<any>(null);
  const [space, setSpace] = useState<any>(null);
  const [host, setHost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [otherRecordings, setOtherRecordings] = useState<any[]>([]);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [buffered, setBuffered] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [activeChapter, setActiveChapter] = useState<number>(-1);
  const [clipDismissed, setClipDismissed] = useState(false);
  const clipAutoStarted = useRef(false);

  // ── Chapters editor ────────────────────────────────────────────────────────
  const [showChaptersEditor, setShowChaptersEditor] = useState(false);
  const [editChapters, setEditChapters] = useState<{ time: number; label: string }[]>([]);
  const [savingChapters, setSavingChapters] = useState(false);
  const [overrideChapters, setOverrideChapters] = useState<Chapter[]>([]);

  // ── Tip host ───────────────────────────────────────────────────────────────
  const [showTipHostDialog, setShowTipHostDialog] = useState(false);
  const [tipHostAmount, setTipHostAmount] = useState<number | null>(null);
  const [sendingHostTip, setSendingHostTip] = useState(false);
  const [tipHostSent, setTipHostSent] = useState(false);

  // ── SEO — PodcastEpisode JSON-LD ────────────────────────────────────────
  useSEO({
    title: recording
      ? `${recording.title} — ${space?.title ?? 'Space Recording'}`
      : 'Space Recording',
    description: recording
      ? `Listen to "${recording.title}" hosted by @${host?.username ?? 'creator'} on Testagram Spaces. Duration: ${Math.floor((recording.duration ?? 0) / 60)}m ${(recording.duration ?? 0) % 60}s.`
      : 'Listen to a recorded audio space on Testagram.',
    image: space?.artwork_url || recording?.thumbnail_url || 'https://testagram.site/app-icon.jpg',
    url: id ? `/space-recording/${id}` : '/spaces',
    type: 'website',
    keywords: `podcast, audio space, ${space?.category ?? 'general'}, testagram, live audio, recording`,
    structuredData: recording ? {
      '@context': 'https://schema.org',
      '@type': 'PodcastEpisode',
      name: recording.title,
      description: space?.description || recording.title,
      url: `https://testagram.site/space-recording/${id}`,
      datePublished: recording.created_at,
      duration: recording.duration ? `PT${Math.floor(recording.duration / 60)}M${recording.duration % 60}S` : undefined,
      associatedMedia: recording.audio_url ? {
        '@type': 'MediaObject',
        contentUrl: recording.audio_url,
        encodingFormat: 'audio/mpeg',
        duration: recording.duration ? `PT${Math.floor(recording.duration / 60)}M${recording.duration % 60}S` : undefined,
      } : undefined,
      partOfSeries: space?.title ? {
        '@type': 'PodcastSeries',
        name: space.title,
        url: 'https://testagram.site/spaces',
      } : undefined,
      author: host ? {
        '@type': 'Person',
        name: host.username,
        url: `https://testagram.site/profile/${host.username}`,
      } : undefined,
      publisher: {
        '@type': 'Organization',
        name: 'Testagram',
        logo: { '@type': 'ImageObject', url: 'https://testagram.site/tsocial-logo.png' },
      },
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/ListenAction',
        userInteractionCount: recording.listener_count ?? 0,
      },
    } : undefined,
  });

  // Parse transcript for chapters (lines starting with [00:00])
  const chapters: Chapter[] = [];
  if (recording?.transcript) {
    const lines = recording.transcript.split('\n');
    for (const line of lines) {
      const m = line.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.+)/);
      if (m) {
        const mins = parseInt(m[1]);
        const secs = parseInt(m[2]);
        const extraSecs = m[3] ? parseInt(m[3]) : 0;
        const totalSecs = m[3] ? (mins * 3600 + secs * 60 + extraSecs) : (mins * 60 + secs);
        chapters.push({ time: totalSecs, label: m[4].trim() });
      }
    }
  }

  useEffect(() => {
    if (id) fetchRecording();
  }, [id]);

  const fetchRecording = async () => {
    setLoading(true);
    const { data: rec, error } = await supabase
      .from('space_recordings')
      .select('*, user_profiles:user_id(username, avatar_url, verified), spaces:space_id(title, description, listener_count, is_archived)')
      .eq('id', id!)
      .single();

    if (error || !rec) {
      toast.error('Recording not found');
      navigate('/spaces');
      return;
    }

    setRecording(rec);
    setSpace(rec.spaces);
    setHost(rec.user_profiles);

    // Fetch other recordings from same space
    const { data: others } = await supabase
      .from('space_recordings')
      .select('id, title, duration, listener_count, created_at')
      .eq('space_id', rec.space_id)
      .neq('id', id!)
      .limit(5);
    setOtherRecordings(others ?? []);

    setLoading(false);
  };

  // Audio event wiring
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Update buffered progress
      if (audio.buffered.length > 0) {
        setBuffered((audio.buffered.end(audio.buffered.length - 1) / audio.duration) * 100);
      }
      // Update active chapter
      if (chapters.length > 0) {
        let ci = -1;
        for (let i = 0; i < chapters.length; i++) {
          if (audio.currentTime >= chapters[i].time) ci = i;
          else break;
        }
        setActiveChapter(ci);
      }
      // ── Clip auto-pause at clip end ──────────────────────────────────────
      if (isClipMode && clipEnd !== null && audio.currentTime >= clipEnd && !audio.paused) {
        audio.pause();
      }
    };
    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      // ── Auto-seek to clip start and play once ──────────────────────────────
      if (isClipMode && clipStart !== null && !clipAutoStarted.current) {
        clipAutoStarted.current = true;
        audio.currentTime = clipStart;
        audio.play();
    } catch {}
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setCurrentTime(0); };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [recording, chapters.length]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play().catch(() => toast.error('Cannot play audio'));
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || !audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * duration;
  };

  const seekToChapter = (time: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    audioRef.current.play().catch(() => {});
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !muted;
    setMuted(m => !m);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.volume = v;
    setVolume(v);
    if (v === 0) setMuted(true);
    else setMuted(false);
  };

  const openChaptersEditor = () => {
    const src = overrideChapters.length > 0 ? overrideChapters : chapters;
    setEditChapters(src.length > 0 ? src.map(c => ({ time: c.time, label: c.label })) : [{ time: 0, label: '' }]);
    setShowChaptersEditor(true);
  };

  const saveChapters = async () => {
    if (!recording) return;
    const valid = editChapters.filter(c => c.label.trim());
    setSavingChapters(true);
    try {
      await supabase.from('spaces').update({ chapters: valid }).eq('id', recording.space_id);
    } catch {}
    setOverrideChapters(valid);
    setSavingChapters(false);
    setShowChaptersEditor(false);
    toast.success('Chapters saved!');
  };

  const handleTipHost = async () => {
    if (!user || !recording || !tipHostAmount) return;
    setSendingHostTip(true);
    const { error: deductErr } = try {
      await supabase.rpc('deduct_from_wallet', { p_user_id: user.id, p_amount: tipHostAmount });
    if (deductErr) { toast.error('Insufficient wallet balance'); setSendingHostTip(false); return; }
    await supabase.rpc('add_to_wallet', { p_user_id: recording.user_id, p_amount: tipHostAmount });
    } catch {}
    try {
      await supabase.from('tips').insert({ from_user_id: user.id, to_user_id: recording.user_id, amount: tipHostAmount, message: `Tip for podcast: ${recording.title}` });
    } catch {}
    toast.success(`$${tipHostAmount} tip sent to @${host?.username}!`);
    setTipHostSent(true);
    setShowTipHostDialog(false);
    setTipHostAmount(null);
    setSendingHostTip(false);
    setTimeout(() => setTipHostSent(false), 3000);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: recording?.title, url });
      } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied!');
    }
  };

  const fmtTime = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Displayed chapters — prefer overrideChapters (from editor save) over transcript-parsed
  const displayChapters = overrideChapters.length > 0 ? overrideChapters : chapters;

  // Generate waveform bars (deterministic from id seed)
  const waveformBars = Array.from({ length: 60 }, (_, i) => {
    const seed = (id?.charCodeAt(i % id.length) ?? 50) + i * 13;
    return 20 + (seed % 70); // height between 20-90%
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Clip region percentages for the waveform overlay
  const clipStartPct = (isClipMode && duration > 0 && clipStart !== null) ? (clipStart / duration) * 100 : null;
  const clipEndPct   = (isClipMode && duration > 0 && clipEnd   !== null) ? (clipEnd   / duration) * 100 : null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <TopBar title="Space Recording" showBack />
      <SpaceRecordingAdBanner />

      {/* Hidden audio element */}
      {recording?.audio_url && (
        <audio ref={audioRef} src={recording.audio_url} preload="metadata" />
      )}

      {/* ── Clip mode banner ── */}
      {isClipMode && !clipDismissed && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-4 py-2.5 bg-primary/10 border border-primary/25 rounded-2xl flex-wrap">
          <Scissors className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-primary">Clip Preview</p>
            <p className="text-[10px] text-muted-foreground">
              {fmtTime(clipStart ?? 0)} – {fmtTime(clipEnd ?? 0)}
              <span className="ml-1 font-semibold text-primary">({(clipEnd ?? 0) - (clipStart ?? 0)}s clip)</span>
            </p>
          </div>
          {/* Play clip at start time */}
          <button
            onClick={() => {
              if (audioRef.current && clipStart !== null) {
                audioRef.current.currentTime = clipStart;
                audioRef.current.play().catch(() => {});
              }
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90"
          >
            <Play className="w-3 h-3 fill-current" />Play Clip
          </button>
          {/* Share clip as a feed post — pre-fills ComposePost via ?quote= URL param */}
          <button
            onClick={() => {
              const clipUrl = `${window.location.origin}/space-recording/${id}?t=${clipStart ?? 0}&end=${clipEnd ?? 30}`;
              const shareText = `\ud83c\udfa7 "${recording?.title ?? 'Space Recording'}" \u2014 ${fmtTime(clipStart ?? 0)}\u2013${fmtTime(clipEnd ?? 30)} clip\n\n${clipUrl}`;
              navigate(`/?quote=${encodeURIComponent(shareText)}`);
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-background border border-border rounded-xl text-xs font-bold hover:bg-muted transition-colors"
          >
            <Share2 className="w-3 h-3" />Post
          </button>
          <button onClick={() => setClipDismissed(true)} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hero section */}
      <div className="relative bg-gradient-to-br from-purple-600/15 via-violet-600/10 to-cyan-600/10 border-b border-border px-5 pt-6 pb-8">
        {/* Radio icon */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-violet-600 flex items-center justify-center mb-4 shadow-lg shadow-purple-500/25">
          <Radio className="w-8 h-8 text-white" />
        </div>

        <h1 className="text-2xl font-black leading-snug mb-2">{recording?.title}</h1>

        {/* Space info */}
        {space?.title && (
          <p className="text-sm text-muted-foreground mb-3">
            From space: <span className="font-semibold text-foreground">{space.title}</span>
          </p>
        )}

        {/* Host row */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
            {host?.avatar_url
              ? <img src={host.avatar_url} alt={host?.username} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center font-bold text-xs">{host?.username?.[0]?.toUpperCase()}</div>
            }
          </div>
          <button
            onClick={() => navigate(`/profile/${host?.username}`)}
            className="text-sm font-semibold hover:text-primary transition-colors"
          >
            @{host?.username}
          </button>
          <span className="text-muted-foreground text-xs">· Host</span>
        </div>

        {/* Meta badges */}
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {fmtTime(recording?.duration ?? 0)}
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {formatNumber(recording?.listener_count ?? 0)} listeners
          </span>
          {recording?.created_at && (
            <span>{format(new Date(recording.created_at), 'MMM d, yyyy')}</span>
          )}
          {recording?.has_video && (
            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">Has Video</span>
          )}
        </div>
      </div>

      {/* ── Player card ── */}
      <div className="mx-4 mt-4 bg-card border border-border rounded-3xl p-5 shadow-sm">

        {/* Waveform visualizer */}
        <div
          className="relative h-16 mb-4 cursor-pointer rounded-xl overflow-hidden bg-muted/30"
          onClick={seekTo}
        >
          {/* Buffered bar */}
          <div
            className="absolute inset-y-0 left-0 bg-muted/50 transition-all duration-300"
            style={{ width: `${buffered}%` }}
          />
          {/* Progress overlay */}
          <div
            className="absolute inset-y-0 left-0 bg-primary/15 transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
          {/* Clip region highlight */}
          {clipStartPct !== null && clipEndPct !== null && (
            <div
              className="absolute inset-y-0 bg-orange-400/25 border-x-2 border-orange-400/60 pointer-events-none"
              style={{ left: `${clipStartPct}%`, width: `${clipEndPct - clipStartPct}%` }}
            />
          )}
          {/* Waveform bars */}
          <div className="absolute inset-0 flex items-center justify-between px-1 gap-[1px]">
            {waveformBars.map((h, i) => {
              const barPct = ((i + 0.5) / waveformBars.length) * 100;
              const played = barPct <= progress;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors duration-75 ${
                    played ? 'bg-primary' : 'bg-muted-foreground/25'
                  }`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          {/* Playhead scrubber */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-primary rounded-full shadow pointer-events-none"
            style={{ left: `${progress}%` }}
          >
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary shadow-md" />
          </div>
        </div>

        {/* Time row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground font-mono mb-4">
          <span>{fmtTime(currentTime)}</span>
          <span>{fmtTime(duration)}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3">
          {/* Rewind 15s */}
          <button
            onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, currentTime - 15); }}
            className="flex flex-col items-center gap-0.5 p-2 rounded-xl hover:bg-muted transition-colors"
            title="Rewind 15s"
          >
            <span className="text-lg">⏮</span>
            <span className="text-[9px] text-muted-foreground">15s</span>
          </button>

          {/* Play/Pause main button */}
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30 hover:opacity-90 transition-opacity active:scale-95"
          >
            {playing
              ? <Pause className="w-7 h-7 fill-current" />
              : <Play className="w-7 h-7 fill-current ml-0.5" />
            }
          </button>

          {/* Forward 30s */}
          <button
            onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(duration, currentTime + 30); }}
            className="flex flex-col items-center gap-0.5 p-2 rounded-xl hover:bg-muted transition-colors"
            title="Forward 30s"
          >
            <span className="text-lg">⏭</span>
            <span className="text-[9px] text-muted-foreground">30s</span>
          </button>

          {/* Volume */}
          <div className="flex items-center gap-1.5 flex-1 max-w-[100px]">
            <button onClick={toggleMute} className="shrink-0 text-muted-foreground hover:text-foreground">
              {muted || volume === 0
                ? <VolumeX className="w-4 h-4" />
                : <Volume2 className="w-4 h-4" />
              }
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={handleVolumeChange}
              className="flex-1 h-1 accent-primary cursor-pointer"
            />
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-border">
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border hover:bg-muted text-sm font-medium transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
          {recording?.audio_url && (
            <a
              href={recording.audio_url}
              download
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border hover:bg-muted text-sm font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          )}
          <button
            onClick={() => { setBookmarked(b => !b); toast.success(bookmarked ? 'Removed from bookmarks' : 'Bookmarked!'); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
              bookmarked ? 'border-primary/30 bg-primary/8 text-primary' : 'border-border hover:bg-muted'
            }`}
          >
            {bookmarked ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
            {bookmarked ? 'Saved' : 'Save'}
          </button>
          {/* Tip Host button — only shown for non-host authenticated users */}
          {transcriptionUnlocked && user && recording && user.id === recording.user_id && (
            <button
              onClick={handleTranscribe}
              disabled={transcribing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-violet-500/30 hover:bg-violet-500/10 text-sm font-medium text-muted-foreground hover:text-violet-600 transition-colors"
            >
              {transcribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="text-sm">🎵</span>}
              {transcribing ? 'Transcribing…' : 'Transcribe'}
            </button>
          )}
          {user && recording && user.id !== recording.user_id && (
            <button
              onClick={() => setShowTipHostDialog(true)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                tipHostSent
                  ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600'
                  : 'border-yellow-500/30 hover:bg-yellow-500/10 hover:border-yellow-500/50 text-muted-foreground hover:text-yellow-600'
              }`}
              title="Tip the host"
            >
              {tipHostSent ? <Check className="w-3.5 h-3.5 text-yellow-500" /> : <DollarSign className="w-3.5 h-3.5" />}
              {tipHostSent ? 'Tipped!' : 'Tip Host'}
            </button>
          )}
        </div>
      </div>

      {/* ── Chapter markers ── */}
      {displayChapters.length > 0 && (
        <div className="mx-4 mt-4 bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-500" />
            <h2 className="font-bold text-sm">Chapters</h2>
            <span className="text-xs text-muted-foreground">{displayChapters.length} sections</span>
            {/* Edit chapters button — host only */}
            {user && recording && user.id === recording.user_id && (
              <button
                onClick={openChaptersEditor}
                className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors"
              >
                <Edit2 className="w-3 h-3" />Edit
              </button>
            )}
          </div>
          <div className="divide-y divide-border">
            {displayChapters.map((ch, i) => {
              const isActive = activeChapter === i;
              return (
                <button
                  key={i}
                  onClick={() => seekToChapter(ch.time)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors ${
                    isActive ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {isActive ? <Play className="w-3.5 h-3.5 fill-current" /> : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>{ch.label}</p>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono shrink-0">{fmtTime(ch.time)}</span>
                  <ChevronRight className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Chapters Editor Modal ── */}
      {showChaptersEditor && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-end" onClick={() => setShowChaptersEditor(false)}>
          <div className="w-full bg-background rounded-t-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-primary" />
                <h3 className="font-bold">Edit Chapters</h3>
                <span className="text-xs text-muted-foreground">{editChapters.length} sections</span>
              </div>
              <button onClick={() => setShowChaptersEditor(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {editChapters.map((ch, ci) => (
                <div key={ci} className="flex items-center gap-2">
                  <span className="text-xs font-black text-muted-foreground w-5 shrink-0 text-center">{ci + 1}</span>
                  <input
                    type="number" min={0} max={86400} placeholder="Sec"
                    value={ch.time}
                    onChange={e => setEditChapters(prev => prev.map((c, j) => j === ci ? { ...c, time: Number(e.target.value) } : c))}
                    className="w-20 h-9 px-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 shrink-0"
                  />
                  <input
                    type="text" placeholder="Chapter label"
                    value={ch.label}
                    onChange={e => setEditChapters(prev => prev.map((c, j) => j === ci ? { ...c, label: e.target.value } : c))}
                    maxLength={80}
                    className="flex-1 h-9 px-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button
                    onClick={() => setEditChapters(prev => prev.filter((_, j) => j !== ci))}
                    className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  ><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button
                onClick={() => setEditChapters(prev => [...prev, { time: 0, label: '' }])}
                className="flex items-center gap-1.5 text-sm text-primary font-semibold hover:opacity-80"
              >
                <Plus className="w-4 h-4" />Add chapter
              </button>
            </div>
            <div className="sticky bottom-0 bg-background border-t border-border px-4 py-3 flex gap-2">
              <button onClick={() => setShowChaptersEditor(false)} className="flex-1 py-2.5 border border-border rounded-xl text-sm font-semibold hover:bg-muted transition-colors">Cancel</button>
              <button
                onClick={saveChapters}
                disabled={savingChapters}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-50 hover:opacity-90"
              >
                {savingChapters ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Chapters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tip Host Dialog ── */}
      {showTipHostDialog && user && recording && user.id !== recording.user_id && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowTipHostDialog(false)}>
          <div className="bg-background border border-border rounded-2xl p-5 w-full max-w-xs shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-yellow-600" /></div>
              <div><h3 className="font-bold">Tip the Host</h3><p className="text-xs text-muted-foreground">@{host?.username}</p></div>
              <button onClick={() => setShowTipHostDialog(false)} className="ml-auto p-1.5 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {PODCAST_TIP_AMTS.map(amt => (
                <button key={amt} onClick={() => setTipHostAmount(amt)}
                  className={`py-2.5 rounded-xl font-bold text-base border-2 transition-all ${
                    tipHostAmount === amt ? 'border-yellow-500 bg-yellow-500/10 text-yellow-600' : 'border-border hover:border-yellow-500/40'
                  }`}>${amt}</button>
              ))}
            </div>
            <button
              onClick={handleTipHost}
              disabled={sendingHostTip || !tipHostAmount}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-amber-500 text-white rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90"
            >
              {sendingHostTip ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              {sendingHostTip ? 'Sending…' : `Send $${tipHostAmount ?? '—'} Tip`}
            </button>
          </div>
        </div>
      )}

      {/* ── AI Transcription result ── */}
      {transcriptText && (
        <div className="mx-4 mt-4 bg-card border border-violet-500/20 rounded-2xl p-4">
          <h2 className="font-bold text-sm mb-3 flex items-center gap-2">
            <span className="text-base">🎵</span> AI Transcript
            <span className="text-[10px] text-muted-foreground ml-1">Generated by OnSpace AI</span>
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{transcriptText}</p>
        </div>
      )}

      {/* ── Transcript (if no chapters) ── */}
      {recording?.transcript && displayChapters.length === 0 && !transcriptText && (
        <div className="mx-4 mt-4 bg-card border border-border rounded-2xl p-4">
          <h2 className="font-bold text-sm mb-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-500" />
            Transcript
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{recording.transcript}</p>
        </div>
      )}

      {/* ── Add Chapters button — shown when no chapters exist yet and user is host ── */}
      {displayChapters.length === 0 && user && recording && user.id === recording.user_id && (
        <div className="mx-4 mt-4">
          <button
            onClick={openChaptersEditor}
            className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-border rounded-2xl text-sm text-muted-foreground hover:border-violet-500/30 hover:text-violet-600 transition-colors"
          >
            <Plus className="w-4 h-4" />Add Chapters to this episode
          </button>
        </div>
      )}

      {/* ── Other recordings from this space ── */}
      {otherRecordings.length > 0 && (
        <div className="mx-4 mt-4 mb-4 bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <h2 className="font-bold text-sm">More from this Space</h2>
          </div>
          <div className="divide-y divide-border">
            {otherRecordings.map(r => (
              <button
                key={r.id}
                onClick={() => navigate(`/space-recording/${r.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                  <Radio className="w-5 h-5 text-purple-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{r.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{fmtTime(r.duration ?? 0)}</span>
                    <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{formatNumber(r.listener_count ?? 0)}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
