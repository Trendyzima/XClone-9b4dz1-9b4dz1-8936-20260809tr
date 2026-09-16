import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useIsRegulator } from '@/hooks/useFeatureUnlock';
import {
  Send, Loader2, Lock, MessageSquare, Users,
  Crown, Briefcase, Hash, Reply, X, MoreVertical, Trash2,
  Shield, Pencil, Check, Pin,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatNumber } from '@/lib/utils';

// Module-level constants — esbuild-safe
const TEAM_CHAT_EMOJIS = ['👍', '❤️', '🔥', '🎉', '💯', '👏'] as const;

// esbuild guard: module-level style objects — no inline object literals in JSX
const BOUNCE_DELAY_0: React.CSSProperties = { animationDelay: '0ms' };
const BOUNCE_DELAY_1: React.CSSProperties = { animationDelay: '150ms' };
const BOUNCE_DELAY_2: React.CSSProperties = { animationDelay: '300ms' };

// esbuild guard: module-level function — no regex inside inline handler
function parseTicketEmail(message: string): string {
  const match = message.match(/From:\s*([^\n]+)/);
  return match ? match[1].trim() : '';
}

// esbuild guard: module-level — no inline regex in JSX
function isTicketMessage(message: string): boolean {
  return message.includes('[SUPPORT TICKET]');
}
// Pure helper — replaces Object.entries in render scope (esbuild guard)
function getReactionEntries(reacts: any): { emoji: string; count: number }[] {
  const result: { emoji: string; count: number }[] = [];
  const keys = Object.keys(reacts ?? {});
  for (let i = 0; i < keys.length; i++) {
    result.push({ emoji: keys[i], count: Number(reacts[keys[i]] ?? 0) });
  }
  return result;
}

// Module-level helpers for localStorage pin state (esbuild guard: no inline function in useState)
function readPinnedId(): string {
  try { const d = JSON.parse(localStorage.getItem('ts-teamchat-pinned') ?? 'null'); return d?.id ?? ''; }
  catch { return ''; }
}
function readPinnedBy(): string {
  try { const d = JSON.parse(localStorage.getItem('ts-teamchat-pinned') ?? 'null'); return d?.by ?? ''; }
  catch { return ''; }
}

// Pure function replaces index-signature object (esbuild guard)
function getDeptColor(dept: string): string {
  if (dept === 'Engineering')  return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
  if (dept === 'Content')      return 'bg-green-500/10 text-green-600 border-green-500/20';
  if (dept === 'Marketing')    return 'bg-pink-500/10 text-pink-600 border-pink-500/20';
  if (dept === 'Moderation')   return 'bg-red-500/10 text-red-600 border-red-500/20';
  if (dept === 'Finance')      return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
  if (dept === 'Design')       return 'bg-violet-500/10 text-violet-600 border-violet-500/20';
  if (dept === 'Operations')   return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
  return 'bg-muted text-muted-foreground border-border';
}

export default function TeamChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isReg = useIsRegulator();

  const [loading, setLoading] = useState(true);
  const [isEmployee, setIsEmployee] = useState(false);
  const [myJobInfo, setMyJobInfo] = useState(null);
  const [employees, setEmployees] = useState([]);;
  const [messages, setMessages] = useState([]);;
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [reactions, setReactions] = useState(() => ({}));;
  const [showEmojiFor, setShowEmojiFor] = useState(null);
  const [showMsgMenu, setShowMsgMenu] = useState(null);
  // Inline edit state (esbuild guard: plain useState('') — no explicit typed generics)
  const [editingMsgId, setEditingMsgId] = useState('');
  const [editingText, setEditingText] = useState('');
  // Support ticket reply state
  const [replyTicketMsgId, setReplyTicketMsgId] = useState('');
  const [replyTicketEmail, setReplyTicketEmail] = useState('');
  const [replyTicketReplyText, setReplyTicketReplyText] = useState('');
  const [replyTicketSending, setReplyTicketSending] = useState(false);
  // esbuild guard: plain useRef(null) — no explicit generic type annotations
  const pollingRef = useRef(null);
  const bottomRef = useRef(null);
  const messagesContainerRef = useRef(null);
  // esbuild guard: plain useRef([]) — no explicit generic type annotation
  const employeesRef = useRef([]);
  // Track whether the user is scrolled away from the bottom
  const isAtBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Pinned message (esbuild guard: module-level initializers — no inline function in useState)
  const [pinnedMsgId, setPinnedMsgId] = useState(readPinnedId);
  const [pinnedBy, setPinnedBy] = useState(readPinnedBy);
  // Typing indicator — broadcast-based
  const [typingUsername, setTypingUsername] = useState('');
  // esbuild guard: plain useRef(null) — no explicit generic type annotations
  const typingTimeoutRef = useRef(null);
  const typingThrottleRef = useRef(null);

  useEffect(() => { if (!user) return; checkAccess(); }, [user]);

  const checkAccess = useCallback(async () => {
    if (!user) return;
    // Regulators always have access
    if (isReg) { setIsEmployee(true); setLoading(false); fetchAll(); return; }
    const { data } = await supabase.from('employee_assignments')
      .select('id, job_title, department, permissions')
      .eq('user_id', user.id).eq('is_active', true).maybeSingle();
    if (data) {
      setIsEmployee(true);
      setMyJobInfo(data);
      fetchAll();
    } else {
      setIsEmployee(false);
    }
    setLoading(false);
  }, [user, isReg]);

  const fetchAll = useCallback(async () => {
    const [msgsRes, empsRes] = await Promise.all([
      supabase.from('team_chat_messages')
        .select('*, user_profiles:user_id(id, username, avatar_url, verified), reply_post:reply_to_id(id, message, user_profiles:user_id(username))')
        .order('created_at', { ascending: true })
        .limit(100),
      supabase.from('employee_assignments')
        .select('user_id, job_title, department, user_profiles:user_id(id, username, avatar_url, verified)')
        .eq('is_active', true)
        .limit(50),
    ]);
    if (msgsRes.data) setMessages(msgsRes.data);
    if (empsRes.data) setEmployees(empsRes.data);
    // Load stored reactions
    try {
      const raw = localStorage.getItem('team_chat_reactions');
      if (raw) setReactions(JSON.parse(raw));
    } catch { /* ignore */ }
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  // Keep ref in sync so realtime callback always reads fresh employee list
  useEffect(() => { employeesRef.current = employees; }, [employees]);

  useEffect(() => {
    if (!isEmployee || !user) return;
    pollingRef.current = setInterval(fetchAll, 3000);

    // Real-time subscription — show toast when another member sends a message
    const sub = supabase
      .channel(`team-chat-rt-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'team_chat_messages',
      }, (payload: any) => {
        const msg = payload.new;
        if (!msg || msg.user_id === user.id) return; // skip own messages
        fetchAll(); // refresh message list
        const sender = employeesRef.current.find((e: any) => e.user_id === msg.user_id);
        const username = sender?.user_profiles?.username ?? 'Team member';
        const preview = (msg.message ?? '').slice(0, 80);
        // esbuild guard: use static import — no dynamic import('sonner') inside callback closure
        toast(`@${username}: ${preview}`, { duration: 3000 });
      })
      .subscribe();

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      supabase.removeChannel(sub);
    };
  }, [isEmployee, user, fetchAll]);

  // ── Typing broadcast channel ─────────────────────────────────────────────
  useEffect(() => {
    if (!isEmployee || !user) return;
    const chan = supabase
      .channel('team-chat-typing')
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        const d = payload.payload ?? {};
        if (!d.user_id || d.user_id === user.id) return;
        setTypingUsername(d.username ?? 'Someone');
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTypingUsername(''), 3000) as any;
      })
      .subscribe();
    return () => {
      supabase.removeChannel(chan);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (typingThrottleRef.current) clearTimeout(typingThrottleRef.current);
    };
  }, [isEmployee, user?.id]);

  // When messages update: auto-scroll if already at bottom, otherwise show jump pill
  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [messages]);

  // Broadcast typing event — throttled to 500ms (esbuild guard: payload built in handler, not JSX)
  const handleInputChange = (val: string) => {
    setInput(val);
    if (!user || !val.trim() || typingThrottleRef.current) return;
    supabase.channel('team-chat-typing').send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user.id, username: user.username ?? 'Team member' },
    });
    typingThrottleRef.current = setTimeout(() => { typingThrottleRef.current = null; }, 500) as any;
  };

  const handleSend = async () => {
    if (!user || !input.trim() || sending) return;
    const text = input.trim();
    const replyInfo = replyingTo;
    setInput('');
    setReplyingTo(null);
    setSending(true);
    const { error } = await supabase.from('team_chat_messages').insert({
      user_id: user.id,
      message: replyInfo ? `[↩ @${replyInfo.username}: "${replyInfo.text.slice(0, 40)}…"] ${text}` : text,
      department: myJobInfo?.department ?? (isReg ? 'Regulator' : null),
      reply_to_id: replyInfo?.id ?? null,
    });
    if (error) toast.error(error.message);
    else await fetchAll();
    setSending(false);
  };

  const handleReaction = useCallback((msgId: string, emoji: string) => {
    setReactions(prev => {
      const updated = { ...prev };
      if (!updated[msgId]) updated[msgId] = {};
      updated[msgId][emoji] = (updated[msgId][emoji] ?? 0) + 1;
      localStorage.setItem('team_chat_reactions', JSON.stringify(updated));
      return updated;
    });
    setShowEmojiFor(null);
  }, []);

  const openTicketReply = useCallback((msg: any) => {
    const email = parseTicketEmail(msg.message ?? '');
    setReplyTicketMsgId(msg.id);
    setReplyTicketEmail(email);
    setReplyTicketReplyText('');
  }, []);

  const handleTicketReply = useCallback(async () => {
    if (!user || !replyTicketReplyText.trim() || replyTicketSending) return;
    if (!replyTicketEmail) { toast.error('Could not find user email in ticket'); return; }
    setReplyTicketSending(true);
    // Look up user by email
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('email', replyTicketEmail)
      .maybeSingle();
    if (!profile?.id) {
      // Insert generic reply without user_id — staff will follow up via email
      await supabase.from('team_chat_messages').insert({
        user_id: user.id,
        message: `[↩ TICKET REPLY to ${replyTicketEmail}]: ${replyTicketReplyText.trim()}`,
        department: myJobInfo?.department ?? (isReg ? 'Regulator' : 'Support'),
      });
      toast.info('Reply posted to team chat — user not found by email, follow up manually.');
    } else {
      // Insert into platform_inbox so user sees it in their inbox
      const staffName = user.username ?? 'Testagram Support';
      const { error } = await supabase.from('platform_inbox').insert({
        user_id: profile.id,
        subject: '[Support Reply] Our team has responded to your ticket',
        body: `Hi @${profile.username},\n\nOur support team has replied to your request:\n\n${replyTicketReplyText.trim()}\n\n— ${staffName}`,
        type: 'news',
        icon_emoji: '💬',
        cta_label: 'Contact Support Again',
        cta_url: '/help#contact-support',
      });
      if (error) { toast.error(error.message); setReplyTicketSending(false); return; }
      // Also echo reply to team chat for audit trail
      await supabase.from('team_chat_messages').insert({
        user_id: user.id,
        message: `[↩ TICKET REPLY → @${profile.username}]: ${replyTicketReplyText.trim()}`,
        department: myJobInfo?.department ?? (isReg ? 'Regulator' : 'Support'),
      });
      toast.success(`Reply sent to @${profile.username} via inbox!`);
    }
    setReplyTicketMsgId('');
    setReplyTicketReplyText('');
    setReplyTicketSending(false);
    await fetchAll();
  }, [user, replyTicketEmail, replyTicketReplyText, replyTicketSending, myJobInfo, isReg, fetchAll]);

  const handleEditSave = useCallback(async (msgId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    const { error } = await supabase
      .from('team_chat_messages')
      .update({ message: trimmed, edited_at: new Date().toISOString() })
      .eq('id', msgId);
    if (error) { toast.error(error.message); return; }
    setEditingMsgId('');
    setEditingText('');
    await fetchAll();
  }, [editingText, fetchAll]);

  // esbuild guard: named handlers avoid multi-statement inline closures inside .map()
  const cancelEdit = useCallback(() => {
    setEditingMsgId('');
    setEditingText('');
  }, []);

  const openEditMode = useCallback((msgId: string, text: string) => {
    setEditingMsgId(msgId);
    setEditingText(text);
    setShowMsgMenu(null);
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent, msgId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(msgId); }
    if (e.key === 'Escape') { cancelEdit(); }
  }, [handleEditSave, cancelEdit]);

  // esbuild guard: named handler — no multi-statement inline onScroll closure in JSX
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current as HTMLDivElement | null;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    isAtBottomRef.current = atBottom;
    if (atBottom) setShowJumpToLatest(false);
  }, []);

  // esbuild guard: named handler — no multi-statement inline onClick closure in JSX
  const handleJumpToLatest = useCallback(() => {
    (bottomRef.current as HTMLDivElement | null)?.scrollIntoView({ behavior: 'smooth' });
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  // esbuild guard: named handler — no multi-statement inline onKeyDown closure in JSX
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handlePin = useCallback((msgId: string) => {
    const by = user?.username ?? 'Regulator';
    setPinnedMsgId(msgId);
    setPinnedBy(by);
    setShowMsgMenu(null);
    localStorage.setItem('ts-teamchat-pinned', JSON.stringify({ id: msgId, by }));
    toast.success('Message pinned');
  }, [user]);

  const handleUnpin = useCallback(() => {
    setPinnedMsgId('');
    setPinnedBy('');
    localStorage.removeItem('ts-teamchat-pinned');
    toast.success('Message unpinned');
  }, []);

  // esbuild guard: named handler — no inline object literal in .map() onClick
  const handleSetReplyingTo = useCallback((msg: any) => {
    const username = msg.user_profiles?.username ?? 'user';
    const text = msg.message ?? '';
    const id = msg.id;
    setReplyingTo({ id, text, username });
  }, []);

  const handleDelete = useCallback(async (msgId: string) => {
    if (!isReg) return;
    await supabase.from('team_chat_messages').delete().eq('id', msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setShowMsgMenu(null);
    toast.success('Message deleted');
  }, [isReg]);

  // Pinned message — all values computed before JSX to avoid complex inline expressions in render
  const pinnedMsg = messages.find(m => m.id === pinnedMsgId) ?? null;
  const pinnedRaw = pinnedMsg?.message ?? '';
  const pinnedText = pinnedRaw.length > 100 ? pinnedRaw.slice(0, 100) + '…' : pinnedRaw;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <div className="min-h-screen bg-background"><TopBar title="Team Chat" showBack /><div className="text-center py-20 text-muted-foreground"><p>Please sign in</p></div></div>;
  }

  if (!isEmployee) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar title="Team Chat" showBack />
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-5">
            <Lock className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-black mb-2">Employees Only</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Team Chat is restricted to Testagram employees. Contact the platform regulator (@Shee) to be hired as an employee.
          </p>
          <button onClick={() => navigate('/profile/Shee')}
            className="mt-5 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-bold hover:opacity-90">
            Contact @Shee
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-0">
      <TopBar title="Team Chat" showBack />

      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-violet-600/8 to-primary/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600/10 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h2 className="font-black text-sm">Internal Team Channel</h2>
            <p className="text-[10px] text-muted-foreground">{employees.length} employees · Confidential</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold text-green-600">Live</span>
          </div>
        </div>
        {/* My badge */}
        {myJobInfo && (
          <div className="mt-2 flex items-center gap-2">
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-bold ${getDeptColor(myJobInfo.department ?? '')}`}>
              <Hash className="w-2.5 h-2.5" />{myJobInfo.department}
            </span>
            <span className="text-[10px] text-muted-foreground">{myJobInfo.job_title}</span>
          </div>
        )}
        {isReg && (
          <div className="mt-2">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-violet-600/15 to-primary/10 border border-violet-500/30 text-[10px] font-black text-violet-600 w-fit">
              <Crown className="w-2.5 h-2.5" />Platform Regulator
            </span>
          </div>
        )}
      </div>

      {/* Online employees strip */}
      {employees.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20 overflow-x-auto scrollbar-hide">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">Team</span>
          {employees.slice(0, 12).map((emp: any) => (
            <button key={emp.user_id} onClick={() => navigate(`/profile/${emp.user_profiles?.username}`)}
              className="flex items-center gap-1.5 shrink-0">
              <div className="relative w-7 h-7">
                <div className="w-full h-full rounded-full bg-muted overflow-hidden">
                  {emp.user_profiles?.avatar_url
                    ? <img src={emp.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                    : <div className="w-full h-full flex items-center justify-center text-[9px] font-bold">{emp.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 border border-background" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
        style={{ minHeight: 0, maxHeight: 'calc(100vh - 320px)' }}
        onScroll={handleMessagesScroll}
      >
        {/* Pinned message banner */}
        {pinnedMsgId !== '' && pinnedMsg && (
          <div className="sticky top-0 z-20 mb-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/20 shadow-sm">
            <Pin className="w-3 h-3 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-primary">@{pinnedBy} pinned · </span>
              <span className="text-[11px] text-foreground/80 leading-snug line-clamp-2">
                {pinnedText}
              </span>
            </div>
            {isReg && (
              <button onClick={handleUnpin} className="text-muted-foreground hover:text-foreground ml-1 shrink-0 p-0.5 hover:bg-muted rounded">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <MessageSquare className="w-14 h-14 mx-auto mb-3 opacity-20" />
            <p className="font-semibold">Team chat is quiet</p>
            <p className="text-sm mt-1">Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg: any, i: number) => {
            const isOwn = msg.user_id === user?.id;
            const prev = messages[i - 1];
            const showHeader = !prev || prev.user_id !== msg.user_id;
            const msgReactions = reactions[msg.id] ?? {};

            return (
              <div key={msg.id} className={`group flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0 ${showHeader ? '' : 'invisible'}`}>
                  {msg.user_profiles?.avatar_url
                    ? <img src={msg.user_profiles.avatar_url} className="w-full h-full object-cover" alt="" />
                    : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">{msg.user_profiles?.username?.[0]?.toUpperCase()}</div>}
                </div>
                <div className={`flex flex-col gap-0.5 max-w-[80%] ${isOwn ? 'items-end' : 'items-start'}`}>
                  {showHeader && !isOwn && (
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-[11px] font-black">{msg.user_profiles?.username}</span>
                      {msg.user_profiles?.verified && <span className="text-[9px] text-primary font-bold">✓</span>}
                      {msg.department && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${getDeptColor(msg.department)}`}>
                          {msg.department}
                        </span>
                      )}
                    </div>
                  )}
                  <div className={`relative rounded-2xl px-3 py-2 text-sm leading-relaxed break-words ${
                    isOwn
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : isTicketMessage(msg.message ?? '') ? 'bg-amber-500/10 border border-amber-500/25 text-foreground rounded-bl-sm' : 'bg-muted text-foreground rounded-bl-sm'
                  }`}>
                    {editingMsgId === msg.id ? (
                      /* ── Inline edit mode ── */
                      <div className="space-y-2 min-w-[200px]">
                        <textarea
                          value={editingText}
                          onChange={e => setEditingText(e.target.value)}
                          onKeyDown={e => handleEditKeyDown(e, msg.id)}
                          rows={3}
                          maxLength={500}
                          autoFocus
                          className="w-full bg-white/10 border border-white/25 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-white/40 leading-relaxed placeholder:text-white/40"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] opacity-50">{editingText.length}/500</span>
                          <div className="flex gap-1.5">
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 font-semibold transition-colors"
                            >
                              <X className="w-3 h-3" /> Cancel
                            </button>
                            <button
                              onClick={() => handleEditSave(msg.id)}
                              disabled={!editingText.trim()}
                              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-white/25 hover:bg-white/35 font-bold disabled:opacity-40 transition-colors"
                            >
                              <Check className="w-3 h-3" /> Save
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* ── Display mode ── */
                      <>
                        {isTicketMessage(msg.message ?? '') && (
                          <span className="block text-[9px] font-black text-amber-600 mb-1 uppercase tracking-wide">📩 Support Ticket</span>
                        )}
                        {msg.message}
                        {/* Reply to ticket button — staff only, visible on ticket messages */}
                        {isTicketMessage(msg.message ?? '') && !isOwn && (
                          <button
                            onClick={() => openTicketReply(msg)}
                            className="mt-2 flex items-center gap-1 text-[10px] font-bold text-amber-700 hover:text-amber-900 bg-amber-500/15 hover:bg-amber-500/25 px-2 py-1 rounded-full transition-colors"
                          >
                            <span>↩</span> Reply to user
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {/* Reactions */}
                  {Object.keys(msgReactions).length > 0 && (
                    <div className="flex gap-1 flex-wrap px-1">
                      {getReactionEntries(msgReactions).map(re => (
                        <button key={re.emoji} onClick={() => handleReaction(msg.id, re.emoji)}
                          className="flex items-center gap-0.5 text-[11px] bg-muted/80 hover:bg-muted border border-border rounded-full px-1.5 py-0.5">
                          {re.emoji}<span className="text-[10px] font-bold text-muted-foreground">{re.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Hover actions */}
                  <div className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                    <button onClick={() => setShowEmojiFor(p => p === msg.id ? null : msg.id)} className="text-base hover:scale-110 transition-transform">😊</button>
                    <button onClick={() => handleSetReplyingTo(msg)}
                      className="text-[10px] text-muted-foreground hover:text-primary font-semibold px-1">
                      <Reply className="w-3 h-3" />
                    </button>
                    {(isReg || isOwn) && (
                      <div className="relative">
                        <button onClick={() => setShowMsgMenu(p => p === msg.id ? null : msg.id)}
                          className="text-muted-foreground hover:text-foreground"><MoreVertical className="w-3 h-3" /></button>
                        {showMsgMenu === msg.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowMsgMenu(null)} />
                            <div className={`absolute ${isOwn ? 'right-0' : 'left-0'} bottom-full mb-1 w-36 bg-background border border-border rounded-xl shadow-lg z-50 overflow-hidden`}>
                              {isOwn && (
                                <button
                                  onClick={() => openEditMode(msg.id, msg.message ?? '')}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
                                >
                                  <Pencil className="w-3.5 h-3.5" />Edit
                                </button>
                              )}
                              {isReg && (
                                <button
                                  onClick={() => handlePin(msg.id)}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
                                >
                                  <Pin className="w-3.5 h-3.5" />Pin
                                </button>
                              )}
                              <button onClick={() => handleDelete(msg.id)}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-destructive/10 text-destructive">
                                <Trash2 className="w-3.5 h-3.5" />Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Emoji picker */}
                  {showEmojiFor === msg.id && (
                    <div className="flex gap-1 bg-background border border-border rounded-2xl px-2 py-1.5 shadow-lg z-30">
                      {TEAM_CHAT_EMOJIS.map(e => (
                        <button key={e} onClick={() => handleReaction(msg.id, e)} className="text-xl hover:scale-125 transition-transform">{e}</button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 px-1">
                    {showHeader && <span className="text-[9px] text-muted-foreground">{formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}</span>}
                    {msg.edited_at && <span className="text-[9px] text-muted-foreground/50 italic">· edited</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Jump to latest pill ── */}
      {showJumpToLatest && (
        <div className="flex justify-center pb-1">
          <button
            onClick={handleJumpToLatest}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground rounded-full text-xs font-bold shadow-lg shadow-primary/25 hover:opacity-90 active:scale-95 transition-all animate-in slide-in-from-bottom-2 duration-200"
          >
            <span>↓</span> Jump to latest
          </button>
        </div>
      )}

      {/* Reply indicator */}
      {replyingTo && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-t border-primary/15">
          <Reply className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-[11px] text-primary font-semibold flex-1 truncate">
            @{replyingTo.username}: "{replyingTo.text.slice(0, 50)}…"
          </span>
          <button onClick={() => setReplyingTo(null)} className="text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Ticket Reply Modal ── */}
      {replyTicketMsgId !== '' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center p-4" onClick={() => setReplyTicketMsgId('')}>
          <div className="w-full max-w-md bg-background border border-border rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border bg-amber-500/8">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <Shield className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black">Reply to Support Ticket</p>
                <p className="text-[10px] text-muted-foreground truncate">→ {replyTicketEmail || 'user'}</p>
              </div>
              <button onClick={() => setReplyTicketMsgId('')} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                This reply will be sent to the user's inbox as a platform message.
              </p>
              <textarea
                value={replyTicketReplyText}
                onChange={e => setReplyTicketReplyText(e.target.value)}
                placeholder="Type your reply to the user…"
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
                maxLength={800}
              />
              <p className="text-[10px] text-muted-foreground text-right">{replyTicketReplyText.length}/800</p>
              <button
                onClick={handleTicketReply}
                disabled={!replyTicketReplyText.trim() || replyTicketSending}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
              >
                {replyTicketSending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><Send className="w-4 h-4" /> Send Reply to User</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Typing indicator ── */}
      {typingUsername !== '' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/30 border-t border-border/50">
          <div className="flex gap-0.5 items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={BOUNCE_DELAY_0} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={BOUNCE_DELAY_1} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={BOUNCE_DELAY_2} />
          </div>
          <span className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">@{typingUsername}</span> is typing…
          </span>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border bg-background p-3 pb-safe flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 bg-muted/60 border border-border rounded-2xl px-3 py-2.5">
          <input
            type="text"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Message the team…"
            maxLength={500}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/60"
          />
          <span className="text-[10px] text-muted-foreground/50 shrink-0">{input.length}/500</span>
        </div>
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0 shadow-md shadow-primary/20"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
