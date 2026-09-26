import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useSEO } from '@/hooks/useSEO';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Eye, Heart, MessageCircle, Share2, Loader2, Send,
  Users, BadgeCheck, Radio, Volume2, VolumeX, BarChart3, TrendingUp, Crown
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

interface StreamMessage {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  user_profiles?: { username: string; avatar_url?: string; verified?: boolean };
}

interface FloatReaction {
  id: string;
  emoji: string;
  x: number;
}

// esbuild guard: module-level plain array (no 'as const')
const REACTION_EMOJIS: string[] = ['❤️', '🔥', '😂', '👏', '😮', '🎉'];

function LiveStreamAdBanner() { return <PageAdBanner />; }

export default function LiveStreamPage() {
  const { streamId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stream, setStream] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tvMediaRef = useRef<HTMLDivElement>(null);
  const tvRoomRef = useRef<Room | null>(null);
  const adPushedRef = useRef(false);

  const [floatReactions, setFloatReactions] = useState<FloatReaction[]>([]);
  // esbuild guard: parallel arrays replace Record<string,number> state
  const [reactionEmojis, setReactionEmojis] = useState<string[]>([]);
  const [reactionNums, setReactionNums] = useState<number[]>([]);
  const getReactionCount = (emoji: string): number => {
    const idx = reactionEmojis.indexOf(emoji);
    return idx >= 0 ? (reactionNums[idx] ?? 0) : 0;
  };
  const addReactionCount = (emoji: string) => {
    setReactionEmojis(prev => {
      const idx = prev.indexOf(emoji);
      if (idx >= 0) {
        setReactionNums(ns => { const n = [...ns]; n[idx] = (n[idx] ?? 0) + 1; return n; });
        return prev;
      }
      setReactionNums(ns => [...ns, 1]);
      return [...prev, emoji];
    });
  };

  const [showReactionBar, setShowReactionBar] = useState(false);
  const reactionBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatIdRef = useRef(0);
  const [showChatAnalytics, setShowChatAnalytics] = useState(false);
  const [chatAnalytics, setChatAnalytics] = useState<any>(null);
  const [loadingChatAnalytics, setLoadingChatAnalytics] = useState(false);
  const [msgFreqChart, setMsgFreqChart] = useState<{min: string; count: number}[]>([]);

  const streamJsonLd = stream ? {
    '@context': 'https://schema.org',
    '@type': 'BroadcastEvent',
    name: stream.title ?? 'Live Stream on Testagram',
    description: stream.description ?? 'Watch live stream on Testagram',
    url: `https://testagram.site/live/${stream.id}`,
    startDate: stream.started_at ?? new Date().toISOString(),
    ...(stream.ended_at ? { endDate: stream.ended_at } : {}),
    videoFormat: 'live',
    isAccessibleForFree: true,
    image: stream.thumbnail_url || 'https://testagram.site/tsocial-logo.png',
    broadcaster: { '@type': 'Organization', name: 'Testagram', url: 'https://testagram.site' },
    ...(stream.user_profiles ? {
      performer: {
        '@type': 'Person',
        name: stream.user_profiles.username,
        url: `https://testagram.site/profile/${stream.user_profiles.username}`,
      },
    } : {}),
  } : undefined;

  useSEO({
    title: stream ? `🟢 ${stream.title} — Live on Testagram` : 'Live Stream — Testagram',
    description: stream
      ? `Watch ${stream.title} live on Testagram. ${stream.viewer_count ?? 0} viewers watching now.`
      : 'Watch live streams from creators on Testagram.',
    url: `/live/${stream?.id ?? ''}`,
    image: stream?.thumbnail_url || undefined,
    type: 'website',
    keywords: 'live stream, testagram, creator live, watch now, streaming',
    structuredData: streamJsonLd,
  });

  useEffect(() => {
    const locator = typeof stream?.stream_url === 'string' ? stream.stream_url : '';
    if (!stream?.is_live || !locator.startsWith('livekit://tv/')) return;
    let cancelled = false;
    const connectTv = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('livekit-tv-token', { body: { stream_id: stream.id } });
        if (cancelled || error || !data?.data) return;
        const room = new Room({ adaptiveStream: true, dynacast: true });
        tvRoomRef.current = room;
        const updateCount = () => setViewerCount(room.remoteParticipants.size);
        room.on(RoomEvent.ParticipantConnected, updateCount);
        room.on(RoomEvent.ParticipantDisconnected, updateCount);
        room.on(RoomEvent.TrackSubscribed, (track: any) => {
          if (cancelled) return;
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            void videoRef.current.play().catch(() => {});
          } else if (track.kind === Track.Kind.Audio && tvMediaRef.current) {
            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.playsInline = true;
            audio.dataset.tvTrackSid = track.sid;
            tvMediaRef.current.appendChild(audio);
            track.attach(audio);
            void audio.play().catch(() => {});
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
          try { track.detach(); } catch {}
        });
        await room.connect(data.data.url, data.data.token);
        if (cancelled) { await room.disconnect(); return; }
        room.remoteParticipants.forEach(participant => {
          participant.trackPublications.forEach(publication => {
            if (publication.track) {
              const track: any = publication.track;
              if (track.kind === Track.Kind.Video && videoRef.current) track.attach(videoRef.current);
              if (track.kind === Track.Kind.Audio && tvMediaRef.current) {
                const audio = document.createElement('audio');
                audio.autoplay = true;
                audio.playsInline = true;
                audio.dataset.tvTrackSid = track.sid;
                tvMediaRef.current.appendChild(audio);
                track.attach(audio);
              }
            }
          });
        });
        updateCount();
      } catch (error) {
        console.warn('[tv-live-viewer] ephemeral connection failed', error);
      }
    };
    void connectTv();
    return () => {
      cancelled = true;
      tvRoomRef.current?.disconnect();
      tvRoomRef.current = null;
      if (tvMediaRef.current) tvMediaRef.current.replaceChildren();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream?.id, stream?.is_live, stream?.stream_url]);

  // AdSense web banner on mount
  useEffect(() => {
    if (adPushedRef.current) return;
    adPushedRef.current = true;
    try { ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({}); } catch (_) {}
  }, []);

  useEffect(() => {
    if (!streamId) return;
    fetchStream();
    joinStream();
    fetchMessages();
    pollRef.current = setInterval(() => {
      fetchMessages();
      fetchViewerCount();
      buildMsgFreqChart();
    }, 3000);
    return () => {
      leaveStream();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [streamId]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const fetchStream = async () => {
    try {
      const { data, error } = await supabase
        .from('live_streams')
        .select('*, user:profiles(*)')
        .eq('id', streamId)
        .single();
      if (error) throw error;
      setStream(data);
      setViewerCount(data.viewer_count || 0);
    } catch {
      toast.error('Stream not found');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchViewerCount = async () => {
    const { count } = await supabase
      .from('stream_viewers')
      .select('*', { count: 'exact', head: true })
      .eq('stream_id', streamId);
    if (count !== null) setViewerCount(count);
  };

  const joinStream = async () => {
    try {
      await supabase.from('stream_viewers').upsert({
        stream_id: streamId,
        user_id: user?.id || null,
        joined_at: new Date().toISOString(),
      }, { onConflict: 'stream_id,user_id' });
    } catch {}
  };

  const leaveStream = async () => {
    if (!user) return;
    try {
      await supabase.from('stream_viewers').delete().match({ stream_id: streamId, user_id: user.id });
    } catch {}
  };

  const buildMsgFreqChart = async () => {
    if (!streamId) return;
    const { data } = await supabase
      .from('stream_chat')
      .select('created_at')
      .eq('stream_id', streamId)
      .not('message', 'like', '[REACT:%]')
      .order('created_at', { ascending: true });
    if (!data || data.length === 0) return;
    // Build by-minute buckets — parallel arrays (esbuild guard: no Record<string,T>)
    const minKeys: string[] = [];
    const minCounts: number[] = [];
    data.forEach((m: any) => {
      const key = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const i = minKeys.indexOf(key);
      if (i >= 0) minCounts[i] = (minCounts[i] ?? 0) + 1;
      else { minKeys.push(key); minCounts.push(1); }
    });
    const start = Math.max(0, minKeys.length - 15);
    setMsgFreqChart(minKeys.slice(start).map((min, i) => ({ min, count: minCounts[start + i] ?? 0 })));
  };

  const fetchChatAnalytics = async () => {
    if (!streamId) return;
    setLoadingChatAnalytics(true);
    const { data } = await supabase.rpc('get_stream_chat_analytics', { p_stream_id: streamId });
    if (data && data.length > 0) setChatAnalytics(data[0]);
    await buildMsgFreqChart();
    setLoadingChatAnalytics(false);
  };

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('stream_chat')
      .select('*, profiles(username, avatar_url, verified)')
      .eq('stream_id', streamId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) {
      setMessages(data.filter((m: StreamMessage) => !m.message.startsWith('[REACT:')));
      // Build reaction counts — parallel arrays (esbuild guard: no Record<string,T>)
      const emojis: string[] = [];
      const nums: number[] = [];
      data.forEach((m: StreamMessage) => {
        const match = m.message.match(/^\[REACT:(.+)\]$/);
        if (match) {
          const e = match[1];
          const i = emojis.indexOf(e);
          if (i >= 0) nums[i] = (nums[i] ?? 0) + 1;
          else { emojis.push(e); nums.push(1); }
        }
      });
      setReactionEmojis(emojis);
      setReactionNums(nums);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) { navigate('/auth'); return; }
    if (!newMessage.trim()) return;
    try {
      await supabase.from('stream_chat').insert({ stream_id: streamId, user_id: user.id, message: newMessage.trim() });
      setNewMessage('');
      fetchMessages();
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleReaction = useCallback(async (emoji: string) => {
    const id = String(floatIdRef.current++);
    const x = 10 + Math.random() * 80;
    setFloatReactions(prev => [...prev, { id, emoji, x }]);
    setTimeout(() => setFloatReactions(prev => prev.filter(r => r.id !== id)), 2200);
    addReactionCount(emoji);
    if (user) {
      await supabase.from('stream_chat').insert({
        stream_id: streamId,
        user_id: user.id,
        message: `[REACT:${emoji}]`,
      }).catch(() => {});
    }
  }, [user, streamId]);

  const handleVideoTap = () => {
    setShowReactionBar(true);
    if (reactionBarTimer.current) clearTimeout(reactionBarTimer.current);
    reactionBarTimer.current = setTimeout(() => setShowReactionBar(false), 4000);
  };

  // Pre-computed reaction summary — no IIFE in render (esbuild guard)
  const visibleReactions = REACTION_EMOJIS.filter(e => getReactionCount(e) > 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-10 h-10 animate-spin text-white" />
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white gap-4">
        <Radio className="w-16 h-16 opacity-40" />
        <p className="text-xl font-semibold">Stream not found</p>
        <Button variant="outline" onClick={() => navigate('/')}>Go Home</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden h-screen">
        {/* Video Player */}
        <div className="relative flex-1 bg-black flex items-center justify-center min-h-[40vh] md:min-h-0" onClick={handleVideoTap}>
          {stream.stream_url?.startsWith('livekit://tv/') ? (
            <div ref={tvMediaRef} className="absolute inset-0 flex items-center justify-center">
              <video ref={videoRef} controls autoPlay muted={muted} playsInline className="w-full h-full object-contain max-h-screen" />
            </div>
          ) : stream.stream_url ? (
            <video ref={videoRef} src={stream.stream_url} controls autoPlay muted={muted} playsInline className="w-full h-full object-contain max-h-screen" />
          ) : (
            <div className="text-center p-8">
              <div className={`w-28 h-28 mx-auto rounded-full flex items-center justify-center mb-4 ${stream.is_live ? 'bg-red-600 animate-pulse' : 'bg-muted/30'}`}>
                <Eye className="w-14 h-14" />
              </div>
              <h3 className="text-2xl font-bold mb-2">{stream.title}</h3>
              <p className="text-gray-400 text-sm">{stream.is_live ? 'Stream is live — video feed starting...' : 'Stream has ended'}</p>
            </div>
          )}

          {/* Floating Reaction Particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {floatReactions.map(r => (
              <div key={r.id} className="absolute bottom-20 text-2xl select-none"
                style={{ left: `${r.x}%`, animation: 'floatUp 2.2s ease-out forwards' }}>
                {r.emoji}
              </div>
            ))}
          </div>

          {/* Top overlay */}
          <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors">←</button>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate(`/profile/${stream.user?.username}`)}>
                  <div className="w-10 h-10 rounded-full bg-muted overflow-hidden ring-2 ring-red-500">
                    {stream.user?.avatar_url
                      ? <img src={stream.user.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center font-bold">{stream.user?.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="font-bold text-sm">{stream.user?.username}</p>
                      {stream.user?.verified && <BadgeCheck className="w-4 h-4 text-blue-400" />}
                    </div>
                    <p className="text-xs text-gray-300 truncate max-w-[140px]">{stream.title}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {stream.is_live && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600 rounded-full text-xs font-bold">
                    <div className="w-1.5 h-1.5 bg-white rounded-full animate-live-pulse" />LIVE
                  </div>
                )}
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/50 rounded-full text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <Users className="w-3.5 h-3.5" />
                  {formatNumber(viewerCount)} watching
                </div>
              </div>
            </div>
          </div>

          {/* Reaction count summary — pre-computed, no IIFE (esbuild guard) */}
          {visibleReactions.length > 0 && (
            <div className="absolute top-20 right-4 flex flex-col gap-1.5 pointer-events-none">
              {visibleReactions.map(emoji => (
                <div key={emoji} className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-full px-2 py-0.5 text-xs font-bold">
                  <span>{emoji}</span><span className="text-white/80">{formatNumber(getReactionCount(emoji))}</span>
                </div>
              ))}
            </div>
          )}

          {/* Bottom overlay */}
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
            {stream.description && (
              <div className="flex-1 mr-4 max-w-xs">
                <div className="bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2">
                  <p className="text-xs text-gray-200 line-clamp-2">{stream.description}</p>
                  {stream.category && <span className="text-xs text-primary mt-0.5 inline-block">#{stream.category}</span>}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-3 items-center">
              <button onClick={(e) => { e.stopPropagation(); handleReaction('❤️'); }}
                className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-red-500/30 transition-colors active:scale-90">
                <Heart className="w-6 h-6 text-red-400" />
              </button>
              <button onClick={() => setMuted(m => !m)} className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-white/10 transition-colors">
                {muted ? <VolumeX className="w-6 h-6 text-gray-300" /> : <Volume2 className="w-6 h-6 text-gray-300" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); setShowChat(c => !c); }} className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-white/10 transition-colors">
                <MessageCircle className={`w-6 h-6 ${showChat ? 'text-primary' : 'text-gray-300'}`} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); if (navigator.share) navigator.share({ title: stream.title, url: window.location.href }); else { navigator.clipboard.writeText(window.location.href); toast.success('Link copied!'); } }}
                className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-white/10 transition-colors">
                <Share2 className="w-6 h-6 text-gray-300" />
              </button>
            </div>
          </div>

          {/* Reaction emoji bar */}
          <div className={`absolute bottom-20 left-1/2 -translate-x-1/2 transition-all duration-300 ${showReactionBar ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-1 bg-black/80 backdrop-blur-md border border-white/10 rounded-full px-3 py-2 shadow-xl">
              {REACTION_EMOJIS.map(emoji => (
                <button key={emoji} onClick={() => handleReaction(emoji)}
                  className="text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-125 transition-all duration-100">{emoji}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Chat Panel */}
        {showChat && (
          <div className="w-full md:w-96 bg-background text-foreground flex flex-col border-l border-border"
            style={{ height: 'min(480px, 50vh)', maxHeight: '100vh' }}>
            <div className="p-3 border-b border-border flex items-center justify-between flex-shrink-0 bg-background/95">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-sm">Live Chat</h3>
                <span className="text-xs text-muted-foreground">({messages.length})</span>
              </div>
              <button onClick={() => { setShowChatAnalytics(v => !v); if (!chatAnalytics) fetchChatAnalytics(); }}
                className={`ml-auto mr-2 p-1.5 rounded-lg transition-colors ${showChatAnalytics ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                <BarChart3 className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-xs font-semibold text-green-600 dark:text-green-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  {formatNumber(viewerCount)}
                </div>
                <button onClick={() => setShowChat(false)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
              </div>
            </div>

            {showChatAnalytics && (
              <div className="border-b border-border bg-muted/20 p-3 space-y-3 flex-shrink-0">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold">Chat Analytics</span>
                  {loadingChatAnalytics && <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin ml-auto" />}
                </div>
                {/* KPI cards — no icon object in .map() (esbuild guard) */}
                {chatAnalytics && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-background rounded-lg p-2 text-center">
                      <MessageCircle className="w-3.5 h-3.5 text-primary mx-auto mb-0.5" />
                      <p className="font-bold text-sm">{chatAnalytics.total_messages ?? 0}</p>
                      <p className="text-[9px] text-muted-foreground">Messages</p>
                    </div>
                    <div className="bg-background rounded-lg p-2 text-center">
                      <Users className="w-3.5 h-3.5 text-primary mx-auto mb-0.5" />
                      <p className="font-bold text-sm">{chatAnalytics.unique_chatters ?? 0}</p>
                      <p className="text-[9px] text-muted-foreground">Chatters</p>
                    </div>
                    <div className="bg-background rounded-lg p-2 text-center">
                      <TrendingUp className="w-3.5 h-3.5 text-primary mx-auto mb-0.5" />
                      <p className="font-bold text-sm">{Number(chatAnalytics.messages_per_minute ?? 0).toFixed(1)}</p>
                      <p className="text-[9px] text-muted-foreground">Msg/min</p>
                    </div>
                  </div>
                )}
                {msgFreqChart.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1 font-semibold">Messages per minute</p>
                    <ResponsiveContainer width="100%" height={70}>
                      <BarChart data={msgFreqChart} margin={{ top: 2, right: 2, left: -28, bottom: 0 }}>
                        <XAxis dataKey="min" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 8 }} />
                        <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[2,2,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {chatAnalytics?.top_chatters && Array.isArray(chatAnalytics.top_chatters) && chatAnalytics.top_chatters.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">Top chatters</p>
                    <div className="space-y-1">
                      {chatAnalytics.top_chatters.slice(0, 3).map((chatter: any, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-muted overflow-hidden shrink-0">
                            {chatter.avatar_url ? <img src={chatter.avatar_url} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">{chatter.username?.[0]?.toUpperCase()}</div>}
                          </div>
                          <span className="text-xs font-medium flex-1 truncate">{chatter.username}</span>
                          <span className="text-[10px] font-bold text-primary">{chatter.count} msg</span>
                          {i === 0 && <Crown className="w-3 h-3 text-yellow-500" />}
                        </div>
                      ))}
                    </div>
                    {chatAnalytics.peak_minute && (
                      <p className="text-[9px] text-muted-foreground mt-1.5">Peak activity at {chatAnalytics.peak_minute}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div ref={chatRef} className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide">
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <p className="text-sm font-medium">No messages yet</p>
                  <p className="text-xs mt-1">Be the first to say hi! 👋</p>
                </div>
              ) : messages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-full bg-muted overflow-hidden flex-shrink-0">
                    {msg.user_profiles?.avatar_url
                      ? <img src={msg.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{msg.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-primary">
                      {msg.user_profiles?.username}{msg.user_profiles?.verified && ' ✓'}
                    </span>{' '}
                    <span className="text-xs text-foreground break-words">{msg.message}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Reaction quick-bar — no icon object in .map() (esbuild guard) */}
            <div className="px-3 py-1.5 border-t border-border flex gap-1 bg-muted/20 flex-shrink-0">
              {REACTION_EMOJIS.map(emoji => (
                <button key={emoji} onClick={() => handleReaction(emoji)}
                  className="flex-1 text-base py-1 rounded-lg hover:bg-muted transition-colors active:scale-110 duration-100 relative">
                  {emoji}
                  {getReactionCount(emoji) > 0 && (
                    <span className="absolute -top-1 -right-0.5 text-[8px] font-bold bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                      {getReactionCount(emoji) > 99 ? '99+' : getReactionCount(emoji)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <form onSubmit={sendMessage} className="p-3 border-t border-border flex-shrink-0">
              {user ? (
                <div className="flex gap-2">
                  <Input value={newMessage} onChange={e => setNewMessage(e.target.value)}
                    placeholder="Say something..." maxLength={200} className="flex-1 h-9 text-sm" />
                  <Button type="submit" size="sm" disabled={!newMessage.trim()} className="px-3">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <button onClick={() => navigate('/auth')} className="w-full py-2 text-sm text-center text-primary font-medium border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors">
                  Sign in to chat
                </button>
              )}
            </form>
          </div>
        )}
      </div>

      {/* AdSense banner */}
      <LiveStreamAdBanner />

      {/* CSS for floating reactions */}
      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0)   scale(1);   opacity: 1; }
          60%  { transform: translateY(-80px) scale(1.2); opacity: 0.9; }
          100% { transform: translateY(-160px) scale(0.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
