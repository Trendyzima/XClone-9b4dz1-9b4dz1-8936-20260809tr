import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalE2EEKeyProvider, Room, RoomEvent, Track } from 'livekit-client';
import { ArrowLeft, Camera, Check, File, Loader2, Mic, MicOff, Phone, Plus, Search, Send, Smile, Users, Video, VideoOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { communicationService, type CallSession, type CommunicationConversation, type CommunicationMessage, type PresenceState, type TypingState } from '@/services/communicationService';
import { communicationCrypto } from '@/services/communicationCrypto';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

const PAGE_SIZE = 40;
type Person = { id: string; username?: string | null; display_name?: string | null; avatar_url?: string | null; verified?: boolean };
type Conversation = CommunicationConversation & { members?: Person[]; unread_count?: number; latest_message?: CommunicationMessage | null };
type CallState = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'ended';
const initials = (p?: Person | null) => (p?.display_name || p?.username || '?').slice(0, 1).toUpperCase();
const nameOf = (p?: Person | null) => p?.display_name || p?.username || 'Testagram user';

function VideoTile({ participant, local = false, muted = false }: { participant: any; local?: boolean; muted?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const pub = participant.getTrackPublication?.(Track.Source.Camera); const track = pub?.videoTrack; if (!track || !ref.current) return; const el = track.attach(); el.className = 'h-full w-full object-cover'; ref.current.replaceChildren(el); return () => { track.detach(el); ref.current?.replaceChildren(); }; }, [participant, participant?.isCameraEnabled]);
  return <div className="relative min-h-0 overflow-hidden rounded-2xl bg-black ring-1 ring-white/10"><div ref={ref} className="absolute inset-0" />{!participant?.isCameraEnabled && <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-background"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-xl font-bold text-primary">{(participant?.name || participant?.identity || '?').slice(0, 1).toUpperCase()}</div></div>}<div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur">{local ? 'You' : participant?.name || participant?.identity || 'Guest'} {muted ? '· muted' : ''}</div></div>;
}

export default function MessagesPage() {
  useSEO({ noindex: true, title: 'Messages', url: '/messages' });
  const { user } = useAuth(); const [params] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]); const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true); const [loadingMessages, setLoadingMessages] = useState(false); const [sending, setSending] = useState(false); const [draft, setDraft] = useState('');
  const [conversationSearch, setConversationSearch] = useState(''); const [newChatSearch, setNewChatSearch] = useState(''); const [people, setPeople] = useState<Person[]>([]); const [searching, setSearching] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false); const [showGroup, setShowGroup] = useState(false); const [groupSearch, setGroupSearch] = useState(''); const [groupMembers, setGroupMembers] = useState<Person[]>([]); const [groupResults, setGroupResults] = useState<Person[]>([]);
  const [typing, setTyping] = useState<Record<string, TypingState>>({}); const [presence, setPresence] = useState<Record<string, PresenceState>>({}); const [replyTo, setReplyTo] = useState<CommunicationMessage | null>(null); const [reactions, setReactions] = useState<Record<string, number>>({});
  const [room, setRoom] = useState<Room | null>(null); const [callId, setCallId] = useState<string | null>(null); const [incomingCall, setIncomingCall] = useState<CallSession | null>(null); const [callKind, setCallKind] = useState<'voice' | 'video'>('video'); const [callState, setCallState] = useState<CallState>('idle'); const [remote, setRemote] = useState<any[]>([]); const [micMuted, setMicMuted] = useState(false); const [cameraOff, setCameraOff] = useState(false); const endingCall = useRef(false); const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null); const bottom = useRef<HTMLDivElement>(null);

  const other = useCallback((c: Conversation) => c.members?.find(m => m.id !== user?.id) ?? c.members?.[0] ?? null, [user?.id]);
  const refresh = useCallback(async () => { if (!user) return; try { const r = await communicationService.listConversations(50); setConversations((r.items ?? []) as Conversation[]); } catch (e) { console.debug('[messages] passive conversation load unavailable', e); setConversations([]); } finally { setLoading(false); } }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (c: Conversation) => { setSelected(c); setMessages([]); setCursor(null); setHasMore(true); setReplyTo(null); setLoadingMessages(true); try { const r = await communicationService.listMessages(c.id, PAGE_SIZE); setMessages(r.items ?? []); setCursor(r.next_cursor); setHasMore(Boolean(r.next_cursor)); for (const m of r.items ?? []) if (m.sender_id !== user?.id && !m.read_at) void communicationService.markMessageRead(m.id).catch(() => {}); setConversations(p => p.map(x => x.id === c.id ? { ...x, unread_count: 0 } : x)); } catch (e) { console.debug('[messages] passive conversation load unavailable', e); setMessages([]); setCursor(null); setHasMore(false); } finally { setLoadingMessages(false); } }, [user?.id]);

  useEffect(() => { const username = params.get('to'); if (!username || !user) return; void (async () => { const r = await backendCapabilities.searchUsers(username, 5); const p = (r.items ?? []).find((x: Person) => x.username?.toLowerCase() === username.toLowerCase()); if (!p || p.id === user.id) return; const created = await communicationService.createConversation([p.id]); await refresh(); const list = await communicationService.listConversations(50); const c = (list.items ?? []).find((x: Conversation) => x.id === created.conversation_id) as Conversation | undefined; if (c) await open(c); })().catch(e => console.debug('[messages] passive deep-link open unavailable', e)); }, [params, user?.id, open, refresh]);

  useEffect(() => { const conversationId = params.get('conversation'); if (!conversationId || !user) return; void (async () => { const list = await communicationService.listConversations(50); const c = (list.items ?? []).find((x: Conversation) => x.id === conversationId) as Conversation | undefined; if (c) await open(c); })().catch(e => console.debug('[messages] conversation deep-link unavailable', e)); }, [params, user?.id, open]);
