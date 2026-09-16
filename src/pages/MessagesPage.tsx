import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Room, RoomEvent, Track } from 'livekit-client';
import { ArrowLeft, Camera, Check, Loader2, Mic, MicOff, Phone, Plus, Search, Send, Smile, Users, Video, VideoOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { communicationService, type CommunicationConversation, type CommunicationMessage } from '@/services/communicationService';
import { backendCapabilities } from '@/services/testagramCapabilityClient';

const PAGE_SIZE = 40;
type Person = { id: string; username?: string | null; display_name?: string | null; avatar_url?: string | null; verified?: boolean };
type Conversation = CommunicationConversation & { members?: Person[]; unread_count?: number; latest_message?: CommunicationMessage | null };

function initials(person?: Person | null) { return (person?.display_name || person?.username || '?').slice(0, 1).toUpperCase(); }
function personName(person?: Person | null) { return person?.display_name || person?.username || 'Testagram user'; }

function VideoTile({ participant, local = false, muted = false }: { participant: any; local?: boolean; muted?: boolean }) {
  const videoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const publication = participant.getTrackPublication?.(Track.Source.Camera);
    const track = publication?.videoTrack;
    if (!track || !videoRef.current) return;
    const element = track.attach();
    element.className = 'h-full w-full object-cover';
    videoRef.current.replaceChildren(element);
    return () => { track.detach(element); videoRef.current?.replaceChildren(); };
  }, [participant, participant?.isCameraEnabled]);
  return <div className="relative min-h-0 overflow-hidden rounded-2xl bg-black/80 ring-1 ring-white/10"><div ref={videoRef} className="absolute inset-0" />{!participant?.isCameraEnabled && <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-background"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-xl font-bold text-primary">{(participant?.name || participant?.identity || '?').slice(0, 1).toUpperCase()}</div></div>}<div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur"><span>{local ? 'You' : participant?.name || participant?.identity || 'Guest'}</span>{muted && <MicOff className="h-3 w-3" />}</div></div>;
}

export default function MessagesPage() {
  useSEO({ noindex: true, title: 'Messages', url: '/messages' });
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [groupMembers, setGroupMembers] = useState<Person[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [groupResults, setGroupResults] = useState<Person[]>([]);
  const [groupName, setGroupName] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [callState, setCallState] = useState<'idle' | 'connecting' | 'connected'>('idle');
  const [callKind, setCallKind] = useState<'voice' | 'video'>('video');
  const [callError, setCallError] = useState<string | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<any[]>([]);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const otherMember = useCallback((conversation: Conversation) => conversation.members?.find(member => member.id !== user?.id) ?? conversation.members?.[0] ?? null, [user?.id]);
  const refreshConversations = useCallback(async () => {
    if (!user) return;
    try { const result = await communicationService.listConversations(50); setConversations((result.items ?? []) as Conversation[]); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to load messages'); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);

  const openConversation = useCallback(async (conversation: Conversation) => {
    setSelected(conversation); setMessages([]); setCursor(null); setHasMore(true); setLoadingMessages(true);
    try {
      const result = await communicationService.listMessages(conversation.id, PAGE_SIZE);
      setMessages(result.items ?? []); setCursor(result.next_cursor); setHasMore(Boolean(result.next_cursor));
      for (const message of result.items ?? []) if (message.sender_id !== user?.id && !message.read_at) void communicationService.markMessageRead(message.id).catch(() => {});
      setConversations(prev => prev.map(item => item.id === conversation.id ? { ...item, unread_count: 0 } : item));
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to load conversation'); }
    finally { setLoadingMessages(false); }
  }, [user?.id]);

  useEffect(() => {
    const username = searchParams.get('to');
    if (!username || !user) return;
    void (async () => {
      const result = await backendCapabilities.searchUsers(username, 5);
      const match = (result.items ?? []).find((item: Person) => item.username?.toLowerCase() === username.toLowerCase());
      if (!match || match.id === user.id) return;
      const created = await communicationService.createConversation([match.id]);
      await refreshConversations();
      const list = await communicationService.listConversations(50);
      const found = (list.items ?? []).find((item: Conversation) => item.id === created.conversation_id) as Conversation | undefined;
      if (found) await openConversation(found);
    })().catch(error => toast.error(error instanceof Error ? error.message : 'Unable to open conversation'));
  }, [searchParams, user?.id, openConversation, refreshConversations]);

  useEffect(() => {
    if (!selected) return;
    const unsubscribe = communicationService.subscribeToConversation(selected.id, message => {
      setMessages(prev => prev.some(item => item.id === message.id) ? prev : [...prev, message]);
      if (message.sender_id !== user?.id) void communicationService.markMessageRead(message.id).catch(() => {});
      setConversations(prev => prev.map(item => item.id === selected.id ? { ...item, latest_message: message, unread_count: 0, updated_at: message.created_at } : item));
    });
    return unsubscribe;
  }, [selected?.id, user?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const loadOlder = async () => {
    if (!selected || !cursor || loadingMessages) return;
    setLoadingMessages(true);
    try { const result = await communicationService.listMessages(selected.id, PAGE_SIZE, cursor); setMessages(prev => [...(result.items ?? []), ...prev]); setCursor(result.next_cursor); setHasMore(Boolean(result.next_cursor)); }
    finally { setLoadingMessages(false); }
  };

  const send = async () => {
    const body = draft.trim(); if (!body || !selected || sending) return;
    setSending(true); setDraft(''); const clientMessageId = crypto.randomUUID();
    try { const result = await communicationService.sendMessage({ conversationId: selected.id, body, clientMessageId }); setMessages(prev => prev.some(item => item.id === result.message_id) ? prev : [...prev, { id: result.message_id, conversation_id: selected.id, sender_id: user!.id, body, created_at: new Date().toISOString(), client_message_id: clientMessageId }]); void refreshConversations(); }
    catch (error) { setDraft(body); toast.error(error instanceof Error ? error.message : 'Message failed'); }
    finally { setSending(false); }
  };

  const searchPeople = async (value: string, group = false) => {
    if (group) setGroupSearch(value); else setSearch(value);
    const query = value.trim(); if (!query) { group ? setGroupResults([]) : setPeople([]); return; }
    setSearching(true); try { const result = await backendCapabilities.searchUsers(query, 12); group ? setGroupResults(result.items as Person[]) : setPeople(result.items as Person[]); } finally { setSearching(false); }
  };

  const createDirect = async (person: Person) => {
    if (!user || person.id === user.id) return;
    try { const created = await communicationService.createConversation([person.id]); await refreshConversations(); const result = await communicationService.listConversations(50); const conversation = (result.items ?? []).find((item: Conversation) => item.id === created.conversation_id) as Conversation | undefined; if (conversation) await openConversation(conversation); setShowNewChat(false); setPeople([]); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to create chat'); }
  };

  const toggleGroupMember = (person: Person) => setGroupMembers(prev => prev.some(item => item.id === person.id) ? prev.filter(item => item.id !== person.id) : [...prev, person]);
  const createGroup = async () => {
    if (!groupMembers.length) return;
    try { const created = await communicationService.createConversation(groupMembers.map(person => person.id)); await refreshConversations(); const result = await communicationService.listConversations(50); const conversation = (result.items ?? []).find((item: Conversation) => item.id === created.conversation_id) as Conversation | undefined; if (conversation) await openConversation(conversation); setShowGroup(false); setGroupMembers([]); setGroupResults([]); setGroupName(''); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to create group'); }
  };

  const startCall = async (kind: 'voice' | 'video') => {
    if (!selected || callState !== 'idle') return;
    setCallKind(kind); setCallState('connecting'); setCallError(null);
    try {
      const call = await communicationService.createCall(selected.id, kind); await communicationService.joinCall(call.call_id);
      const media = await communicationService.getLiveKitToken(call.call_id);
      const nextRoom = new Room({ adaptiveStream: true, dynacast: true });
      const sync = () => setRemoteParticipants(Array.from(nextRoom.remoteParticipants.values()));
      nextRoom.on(RoomEvent.ParticipantConnected, sync).on(RoomEvent.ParticipantDisconnected, sync).on(RoomEvent.TrackSubscribed, sync).on(RoomEvent.TrackUnsubscribed, sync).on(RoomEvent.Disconnected, () => { setCallState('idle'); setRoom(null); setRemoteParticipants([]); }).on(RoomEvent.Reconnecting, () => toast.info('Reconnecting call…'));
      await nextRoom.connect(media.url, media.token); await nextRoom.localParticipant.enableMicrophone(); if (kind === 'video') await nextRoom.localParticipant.enableCamera();
      setRoom(nextRoom); setRemoteParticipants(Array.from(nextRoom.remoteParticipants.values())); setCallState('connected');
    } catch (error) { setCallState('idle'); setCallError(error instanceof Error ? error.message : 'Unable to start call'); toast.error(error instanceof Error ? error.message : 'Unable to start call'); }
  };

  const endCall = async () => { if (!room) return; try { await room.disconnect(); } finally { setRoom(null); setRemoteParticipants([]); setCallState('idle'); } };
  const toggleMic = async () => { if (!room) return; await room.localParticipant.setMicrophoneEnabled(micMuted); setMicMuted(!micMuted); };
  const toggleCamera = async () => { if (!room) return; await room.localParticipant.setCameraEnabled(cameraOff); setCameraOff(!cameraOff); };
  const currentOther = selected ? otherMember(selected) : null;
  const filteredConversations = useMemo(() => { const query = search.toLowerCase().trim(); if (!query) return conversations; return conversations.filter(conversation => conversation.members?.some(person => `${person.username} ${person.display_name}`.toLowerCase().includes(query))); }, [conversations, search]);

  if (!user) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return <div className="flex h-[calc(100vh-5rem)] min-h-[620px] flex-col bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4"><div><h1 className="text-lg font-bold">Messages</h1><p className="text-xs text-muted-foreground">Private conversations, groups and calls</p></div><div className="flex items-center gap-1"><button aria-label="New group" onClick={() => setShowGroup(true)} className="rounded-full p-2 hover:bg-muted"><Users className="h-5 w-5" /></button><button aria-label="New message" onClick={() => setShowNewChat(true)} className="rounded-full bg-primary p-2 text-primary-foreground"><Plus className="h-5 w-5" /></button></div></header>
    <div className="flex min-h-0 flex-1">
      <aside className={`${selected ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-border md:w-80`}><div className="p-3"><div className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2"><Search className="h-4 w-4 text-muted-foreground" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations" className="w-full bg-transparent text-sm outline-none" /></div></div><div className="min-h-0 flex-1 overflow-y-auto">{loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : filteredConversations.length === 0 ? <div className="px-6 py-12 text-center"><div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><Send className="h-5 w-5 text-primary" /></div><p className="font-semibold">Your inbox is quiet</p><p className="mt-1 text-sm text-muted-foreground">Start a private conversation on Testagram.</p><button onClick={() => setShowNewChat(true)} className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">New message</button></div> : filteredConversations.map(conversation => { const person = otherMember(conversation); const latest = conversation.latest_message; return <button key={conversation.id} onClick={() => void openConversation(conversation)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/50 ${selected?.id === conversation.id ? 'bg-primary/5' : ''}`}><div className="relative shrink-0"><div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-primary">{person?.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(person)}</div>{(conversation.unread_count ?? 0) > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1"><span className="truncate font-semibold">{personName(person)}</span>{person?.verified && <Check className="h-3.5 w-3.5 text-primary" />}</div><p className="truncate text-sm text-muted-foreground">{latest?.body || 'Start a conversation'}</p></div></button>; })}</div></aside>
      <main className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>{!selected ? <div className="m-auto max-w-sm px-6 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10"><Send className="h-7 w-7 text-primary" /></div><h2 className="text-xl font-bold">Your messages</h2><p className="mt-2 text-sm text-muted-foreground">Message friends, build groups and start voice or video calls.</p></div> : <><header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-3"><button onClick={() => setSelected(null)} className="rounded-full p-2 hover:bg-muted md:hidden"><ArrowLeft className="h-5 w-5" /></button><div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-primary">{currentOther?.avatar_url ? <img src={currentOther.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(currentOther)}</div><div className="min-w-0 flex-1"><div className="truncate font-semibold">{currentOther ? personName(currentOther) : `${selected.members?.length ?? 0} members`}</div><div className="text-xs text-muted-foreground">{selected.members?.length && selected.members.length > 2 ? `${selected.members.length} participants` : 'Testagram communication'}</div></div><button onClick={() => void startCall('voice')} className="rounded-full p-2 hover:bg-muted" title="Voice call"><Phone className="h-5 w-5" /></button><button onClick={() => void startCall('video')} className="rounded-full p-2 hover:bg-muted" title="Video call"><Video className="h-5 w-5" /></button></header><div className="min-h-0 flex-1 overflow-y-auto px-4 py-5"><div className="mx-auto flex max-w-2xl flex-col gap-2">{hasMore && <button onClick={() => void loadOlder()} disabled={loadingMessages} className="mx-auto rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">{loadingMessages ? 'Loading…' : 'Load earlier messages'}</button>}{messages.map(message => { const mine = message.sender_id === user.id; return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted'}`}><p className="whitespace-pre-wrap break-words">{message.deleted_at ? 'Message deleted' : message.body}</p><div className={`mt-1 text-[10px] ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{mine && message.read_at ? ' · Read' : ''}</div></div></div>; })}<div ref={bottomRef} />{loadingMessages && messages.length === 0 && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>}</div></div><div className="border-t border-border p-3"><div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border border-border bg-muted/30 p-1.5 focus-within:ring-2 focus-within:ring-primary/20"><button className="rounded-full p-2 text-muted-foreground hover:bg-muted"><Smile className="h-5 w-5" /></button><textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={1} placeholder="Write a message…" className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-2.5 text-sm outline-none" /><button disabled={!draft.trim() || sending} onClick={() => void send()} className="rounded-full bg-primary p-2.5 text-primary-foreground disabled:opacity-40"><Send className="h-4 w-4" /></button></div></div></>}</main>
    </div>
    {callState !== 'idle' && <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"><div className="flex h-[min(780px,92vh)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-zinc-950 shadow-2xl ring-1 ring-white/10"><header className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white"><div><div className="font-semibold">{callKind === 'video' ? 'Video call' : 'Voice call'}</div><div className="text-xs text-white/50">{callState === 'connecting' ? 'Connecting securely…' : `${remoteParticipants.length + 1} participant${remoteParticipants.length ? 's' : ''}`}</div></div><button onClick={() => void endCall()} className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button></header><div className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 sm:grid-cols-2">{callState === 'connecting' && <div className="col-span-full flex items-center justify-center text-white/70"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Joining call…</div>}{room && <VideoTile participant={room.localParticipant} local muted={micMuted} />}{remoteParticipants.map(participant => <VideoTile key={participant.identity} participant={participant} muted={!participant.isMicrophoneEnabled} />)}</div>{callError && <div className="px-4 pb-2 text-center text-sm text-red-300">{callError}</div>}<footer className="flex items-center justify-center gap-3 border-t border-white/10 p-4"><button onClick={() => void toggleMic()} className={`rounded-full p-3 ${micMuted ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>{micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}</button>{callKind === 'video' && <button onClick={() => void toggleCamera()} className={`rounded-full p-3 ${cameraOff ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>{cameraOff ? <VideoOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}</button>}<button onClick={() => void endCall()} className="rounded-full bg-red-500 p-3 text-white"><Phone className="h-5 w-5 rotate-[135deg]" /></button></footer></div></div>}
    {showNewChat && <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowNewChat(false)}><div className="w-full max-w-md rounded-3xl bg-background p-5 shadow-2xl" onClick={e => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">New message</h2><button onClick={() => setShowNewChat(false)} className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button></div><div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2"><Search className="h-4 w-4 text-muted-foreground" /><input autoFocus value={search} onChange={e => void searchPeople(e.target.value)} placeholder="Search @username or name" className="w-full bg-transparent text-sm outline-none" /></div><div className="mt-3 max-h-72 overflow-y-auto">{searching ? <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div> : people.map(person => <button key={person.id} onClick={() => void createDirect(person)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-muted"><div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-primary">{person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(person)}</div><div><div className="font-semibold">{personName(person)}</div><div className="text-xs text-muted-foreground">@{person.username}</div></div></button>)}</div></div></div>}
    {showGroup && <div className="fixed inset-0 z-[650] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowGroup(false)}><div className="w-full max-w-md rounded-3xl bg-background p-5 shadow-2xl" onClick={e => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold">New group</h2><p className="text-xs text-muted-foreground">Create a Testagram group conversation.</p></div><button onClick={() => setShowGroup(false)} className="rounded-full p-2 hover:bg-muted"><X className="h-5 w-5" /></button></div><input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name (optional)" className="mb-3 w-full rounded-2xl border border-border bg-muted/30 px-3 py-2.5 text-sm outline-none" /><div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2"><Search className="h-4 w-4 text-muted-foreground" /><input value={groupSearch} onChange={e => void searchPeople(e.target.value, true)} placeholder="Add people" className="w-full bg-transparent text-sm outline-none" /></div>{groupMembers.length > 0 && <div className="my-3 flex flex-wrap gap-2">{groupMembers.map(person => <button key={person.id} onClick={() => toggleGroupMember(person)} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{personName(person)}<X className="h-3 w-3" /></button>)}</div>}<div className="mt-2 max-h-56 overflow-y-auto">{groupResults.map(person => <button key={person.id} onClick={() => toggleGroupMember(person)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-muted"><div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-primary">{person.avatar_url ? <img src={person.avatar_url} alt="" className="h-full w-full object-cover" /> : initials(person)}</div><div className="flex-1"><div className="font-semibold">{personName(person)}</div><div className="text-xs text-muted-foreground">@{person.username}</div></div>{groupMembers.some(item => item.id === person.id) && <Check className="h-4 w-4 text-primary" />}</button>)}</div><button disabled={!groupMembers.length} onClick={() => void createGroup()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-40"><Users className="h-4 w-4" />Create group</button></div></div>}
  </div>;
}
