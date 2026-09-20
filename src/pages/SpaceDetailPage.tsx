import { useState, useEffect, useRef } from 'react';
import { PageAdBanner } from '@/components/features/AdSenseAd';
import { useParams, useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useFeatureUnlock } from '@/hooks/useFeatureUnlock';
import { Radio, Users, Mic, Headphones, Video, BadgeCheck, Clock, Hash, Play, Loader2, ArrowLeft, DollarSign, X, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';
import { useSEO } from '@/hooks/useSEO';
import { Button } from '@/components/ui/button';
import { JoinSpaceDialog } from '@/components/features/JoinSpaceDialog';

function SpaceDetailAdBanner() { return <PageAdBanner />; }
// SuperChat tip amounts — module scope (esbuild guard)
const SUPERCHAT_AMTS = [1, 2, 5, 10, 20, 50] as const;
// Module-level helper — avoids index-signature object literal at module scope (esbuild guard)
function getSuperChatColor(amt: number): string {
  if (amt >= 50) return 'bg-red-500/10 border-red-500/40 text-red-600';
  if (amt >= 20) return 'bg-orange-500/10 border-orange-500/40 text-orange-600';
  if (amt >= 10) return 'bg-yellow-500/10 border-yellow-500/40 text-yellow-600';
  if (amt >= 5)  return 'bg-green-500/10 border-green-500/40 text-green-600';
  if (amt >= 2)  return 'bg-teal-500/10 border-teal-500/40 text-teal-600';
  return 'bg-blue-500/10 border-blue-500/40 text-blue-600';
}

export default function SpaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const superChatUnlocked = useFeatureUnlock('superchat');
  const [showSuperChat, setShowSuperChat] = useState(false);
  const [superChatMsg, setSuperChatMsg] = useState('');
  const [superChatAmt, setSuperChatAmt] = useState<number | null>(null);
  const [sendingSuperChat, setSendingSuperChat] = useState(false);
  const [superChats, setSuperChats] = useState<any[]>([]);

  const fetchSuperChats = async (spaceId: string) => {
    const { data } = await supabase
      .from('space_superchats')
      .select('*, user_profiles:user_id(username, avatar_url)')
      .eq('space_id', spaceId)
      .gte('pinned_until', new Date().toISOString())
      .order('amount', { ascending: false })
      .limit(5);
    setSuperChats(data ?? []);
  };

  const handleSuperChat = async () => {
    if (!user || !space || !superChatAmt || !superChatMsg.trim()) return;
    setSendingSuperChat(true);
    const { error: superChatError } = await supabase.rpc('send_space_superchat', {
      p_space_id: space.id,
      p_amount: superChatAmt,
      p_message: superChatMsg.trim(),
    });
    if (superChatError) {
      const message = superChatError.message?.includes('INSUFFICIENT_FUNDS') ? 'Insufficient wallet balance' : superChatError.message || 'Unable to send Super Chat';
      toast.error(message);
      setSendingSuperChat(false);
      return;
    }
    toast.success(`💬 SuperChat $${superChatAmt} sent!`);
    setSuperChatMsg('');
    setSuperChatAmt(null);
    setShowSuperChat(false);
    setSendingSuperChat(false);
    fetchSuperChats(space.id);
  };

  const [space, setSpace] = useState<any>(null);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showJoinDialog, setShowJoinDialog] = useState(false);
  // ── SEO — BroadcastEvent JSON-LD ──────────────────────────────────────────
  useSEO({
    title: space
      ? `${space.title} — Live Space on Testagram`
      : 'Live Space — Testagram',
    description: space
      ? `Join "${space.title}" hosted by @${space.host?.username ?? 'creator'} — ${space.listener_count ?? 0} listeners live now on Testagram Spaces.`
      : 'Join a live audio space on Testagram.',
    url: id ? `/spaces/${id}` : '/spaces',
    type: 'website',
    image: space?.artwork_url || 'https://testagram.site/app-icon.jpg',
    keywords: `live audio, space, ${space?.category ?? 'general'}, testagram, podcast, ${space?.host?.username ?? 'creator'}`,
    structuredData: space ? {
      '@context': 'https://schema.org',
      '@type': 'BroadcastEvent',
      name: space.title,
      description: space.description || space.title,
      url: `https://testagram.site/spaces/${id}`,
      startDate: space.started_at,
      endDate: space.ended_at ?? undefined,
      eventStatus: space.is_live
        ? 'https://schema.org/EventScheduled'
        : 'https://schema.org/EventEnded',
      eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      location: {
        '@type': 'VirtualLocation',
        url: `https://testagram.site/spaces/${id}`,
      },
      organizer: space.host ? {
        '@type': 'Person',
        name: space.host.username,
        url: `https://testagram.site/profile/${space.host.username}`,
      } : undefined,
      audience: {
        '@type': 'Audience',
        audienceType: 'Public',
      },
      recordedIn: recordings.length > 0 ? recordings.map(r => ({
        '@type': 'AudioObject',
        name: r.title,
        contentUrl: r.audio_url,
        url: `https://testagram.site/space-recording/${r.id}`,
        duration: r.duration ? `PT${Math.floor(r.duration / 60)}M${r.duration % 60}S` : undefined,
      })) : undefined,
    } : undefined,
  });

  // Poll superchats every 10 seconds while space is live
  const superChatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchSpace();
    fetchRecordings();
    fetchParticipants();
    fetchSuperChats(id);
    superChatPollRef.current = setInterval(() => fetchSuperChats(id), 10000);
    return () => { if (superChatPollRef.current) clearInterval(superChatPollRef.current); };
  }, [id]);

  const fetchSpace = async () => {
    const { data } = await supabase
      .from('spaces')
      .select('*, host:user_profiles!spaces_host_id_fkey(*)')
      .eq('id', id!)
      .single();
    setSpace(data);
    setLoading(false);
  };

  const fetchRecordings = async () => {
    const { data } = await supabase
      .from('space_recordings')
      .select('*')
      .eq('space_id', id!)
      .order('created_at', { ascending: false });
    setRecordings(data ?? []);
  };

  const fetchParticipants = async () => {
    const { data } = await supabase
      .from('space_participants')
      .select('*, profiles(id, username, avatar_url, verified_tier)')
      .eq('space_id', id!)
      .limit(20);
    setParticipants(data ?? []);
  };

  const handleJoin = () => {
    if (!user) { navigate('/auth'); return; }
    setShowJoinDialog(true);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/spaces/${id}`;
    try { await navigator.share({ title: space?.title, url }); }
    catch { navigator.clipboard.writeText(url); toast.success('Link copied!'); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!space) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Space" showBack />
        <div className="text-center py-24 text-muted-foreground">
          <Radio className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="font-bold text-xl mb-2">Space not found</p>
          <p className="text-sm mb-6">This space may have ended or been removed.</p>
          <Button onClick={() => navigate('/spaces')} className="rounded-full">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Spaces
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Space" showBack />

      {/* ── Hero ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-purple-500/10 border-b border-border p-5">
        <div className="flex items-start gap-4">
          {/* Artwork */}
          <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/20 to-purple-500/20 flex-shrink-0 shadow-lg">
            {space.artwork_url ? (
              <img src={space.artwork_url} alt={space.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">🎙️</div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Live badge */}
            {space.is_live && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Live Now</span>
              </div>
            )}
            <h1 className="text-xl font-black leading-snug mb-1">{space.title}</h1>
            {space.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">{space.description}</p>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              {space.category && (
                <span className="capitalize">{space.category}</span>
              )}
              {space.has_video && (
                <span className="flex items-center gap-0.5 text-primary">
                  <Video className="w-3 h-3" /> Video
                </span>
              )}
              {space.episode_number && (
                <span>Ep. {space.episode_number}</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-5 mt-4 text-sm">
          <div className="flex flex-col items-center">
            <span className="font-black text-lg">{formatNumber(space.listener_count ?? 0)}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Listeners</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-black text-lg">{participants.length}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Participants</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-black text-lg">{recordings.length}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Recordings</span>
          </div>
        </div>

        {/* SuperChat feed strip */}
        {superChats.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-bold flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-yellow-500" />SuperChats
              <span className="text-[10px] text-muted-foreground font-normal">pinned for 60s</span>
            </p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {superChats.map((sc: any) => {
                const scAmt = Number(sc.amount ?? 0);
                const scColor = scAmt >= 50 ? 'border-red-500/50 bg-red-500/8 text-red-700 dark:text-red-400'
                  : scAmt >= 20 ? 'border-orange-500/50 bg-orange-500/8 text-orange-700 dark:text-orange-400'
                  : scAmt >= 10 ? 'border-yellow-500/50 bg-yellow-500/8 text-yellow-700 dark:text-yellow-400'
                  : scAmt >= 5 ? 'border-green-500/50 bg-green-500/8 text-green-700 dark:text-green-400'
                  : 'border-blue-500/50 bg-blue-500/8 text-blue-700 dark:text-blue-400';
                return (
                  <div key={sc.id} className={`shrink-0 max-w-[200px] px-3 py-2 rounded-2xl border-2 ${scColor}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-5 h-5 rounded-full overflow-hidden bg-muted shrink-0">
                        {sc.user_profiles?.avatar_url
                          ? <img src={sc.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                          : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">{sc.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                      </div>
                      <span className="text-[10px] font-black truncate">{sc.user_profiles?.username}</span>
                      <span className="text-[10px] font-black ml-auto shrink-0">${scAmt}</span>
                    </div>
                    <p className="text-[11px] leading-snug line-clamp-2">{sc.message}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CTA */}
        {space.is_live && (
          <>
            <Button onClick={handleJoin} className="w-full mt-4 rounded-xl bg-gradient-to-r from-primary to-purple-600 text-white font-bold h-12">
              <Headphones className="w-5 h-5 mr-2" /> Join Live Space
            </Button>
            {superChatUnlocked && user && (
              <button onClick={() => setShowSuperChat(true)}
                className="w-full mt-2 py-3 rounded-xl border-2 border-yellow-500/30 bg-yellow-500/8 text-yellow-600 dark:text-yellow-400 font-bold text-sm flex items-center justify-center gap-2 hover:bg-yellow-500/12 transition-colors">
                <DollarSign className="w-4 h-4" />Send SuperChat
              </button>
            )}
            {!superChatUnlocked && user && (
              <p className="text-center text-[10px] text-muted-foreground mt-1">• SuperChat locked — contact @Shee to unlock</p>
            )}
          </>
        )}
      </div>

      {/* ── Host card ── */}
      {space.host && (
        <div className="px-4 py-4 border-b border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Host</p>
          <button
            onClick={() => navigate(`/profile/${space.host.username}`)}
            className="flex items-center gap-3 w-full text-left hover:bg-muted/30 rounded-xl p-2 -mx-2 transition-colors"
          >
            <div className="w-12 h-12 rounded-full overflow-hidden bg-muted">
              {space.host.avatar_url
                ? <img src={space.host.avatar_url} alt={space.host.username} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center font-bold">{space.host.username?.[0]?.toUpperCase()}</div>}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold">{space.host.username}</span>
                {space.host.verified && <BadgeCheck className="w-4 h-4 text-primary" fill="currentColor" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(space.started_at), { addSuffix: true })}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* ── Tags ── */}
      {space.tags && space.tags.length > 0 && (
        <div className="flex gap-2 px-4 py-3 border-b border-border overflow-x-auto scrollbar-hide">
          {space.tags.map((tag: string) => (
            <span key={tag} className="flex items-center gap-0.5 px-2.5 py-1 bg-muted rounded-full text-xs font-medium text-muted-foreground whitespace-nowrap">
              <Hash className="w-3 h-3" />{tag}
            </span>
          ))}
        </div>
      )}

      {/* ── AdSense banner ── */}
      <SpaceDetailAdBanner />

      {/* ── Participants ── */}
      {participants.length > 0 && (
        <div className="px-4 py-4 border-b border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Participants ({participants.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {participants.map((p: any) => (
              <button
                key={p.id}
                onClick={() => navigate(`/profile/${p.user_profiles?.username}`)}
                className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 rounded-xl border border-border hover:border-primary/30 transition-colors"
              >
                <div className="w-6 h-6 rounded-full overflow-hidden bg-muted">
                  {p.user_profiles?.avatar_url
                    ? <img src={p.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{p.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <span className="text-xs font-medium">{p.user_profiles?.username}</span>
                {p.role === 'speaker' && <Mic className="w-3 h-3 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recordings ── */}
      {recordings.length > 0 && (
        <div className="px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Recordings ({recordings.length})
          </p>
          <div className="space-y-3">
            {recordings.map((rec: any) => (
              <div
                key={rec.id}
                className="flex items-center gap-3 p-3 border border-border rounded-xl hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => navigate(`/space-recording/${rec.id}`)}
              >
                <button
                  onClick={e => { e.stopPropagation(); navigate(`/space-recording/${rec.id}`); }}
                  className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 hover:bg-primary/20 transition-colors"
                >
                  <Play className="w-4 h-4 text-primary ml-0.5" fill="currentColor" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{rec.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {rec.duration > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />{Math.floor(rec.duration / 60)}m
                      </span>
                    )}
                    {rec.listener_count > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Users className="w-3 h-3" />{formatNumber(rec.listener_count)}
                      </span>
                    )}
                    <span>{formatDistanceToNow(new Date(rec.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
                {rec.has_video && <Video className="w-4 h-4 text-primary shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      )}

      <JoinSpaceDialog
        open={showJoinDialog}
        onOpenChange={setShowJoinDialog}
        spaceId={id ?? null}
      />

      {/* ── SuperChat Modal ── */}
      {showSuperChat && user && space && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-end" onClick={() => setShowSuperChat(false)}>
          <div className="w-full bg-background rounded-t-3xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-yellow-600" />
                </div>
                <div>
                  <h3 className="font-black text-base">SuperChat</h3>
                  <p className="text-xs text-muted-foreground">Pin your message for 60 seconds</p>
                </div>
              </div>
              <button onClick={() => setShowSuperChat(false)} className="p-2 rounded-full hover:bg-muted"><X className="w-4 h-4" /></button>
            </div>
            <textarea value={superChatMsg} onChange={e => setSuperChatMsg(e.target.value)}
              placeholder="Write your SuperChat message…" rows={3} maxLength={200}
              className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/50" />
            <p className="text-[10px] text-muted-foreground text-right mt-0.5">{superChatMsg.length}/200</p>
            <div className="grid grid-cols-3 gap-2">
              {SUPERCHAT_AMTS.map(amt => (
                <button key={amt} onClick={() => setSuperChatAmt(amt)}
                  className={`py-2.5 rounded-xl font-black text-base border-2 transition-all ${superChatAmt === amt ? getSuperChatColor(amt) : 'border-border hover:border-yellow-500/30'}`}>
                  ${amt}
                </button>
              ))}
            </div>
            <button onClick={handleSuperChat} disabled={sendingSuperChat || !superChatAmt || !superChatMsg.trim()}
              className="w-full py-3 bg-gradient-to-r from-yellow-500 to-amber-500 text-white rounded-xl font-black disabled:opacity-50 flex items-center justify-center gap-2 hover:opacity-90">
              {sendingSuperChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              {sendingSuperChat ? 'Sending…' : `Send $${superChatAmt ?? '—'} SuperChat`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
