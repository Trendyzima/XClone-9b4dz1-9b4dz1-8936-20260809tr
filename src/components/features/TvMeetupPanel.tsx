import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Check, Flame, Heart, MessageCircle, Radio, Send, Smile, ThumbsUp, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

type Props = { streamId: string };
type Chat = {
  id: string;
  stream_id: string;
  user_id: string | null;
  message: string;
  created_at: string;
  username?: string | null;
};
type Viewer = { user_id: string; username?: string | null };
type Reaction = { emoji: string; count: number };

const REACTIONS = [
  { emoji: '👍', label: 'Like', Icon: ThumbsUp },
  { emoji: '❤️', label: 'Love', Icon: Heart },
  { emoji: '😂', label: 'Laugh', Icon: Smile },
  { emoji: '🔥', label: 'Fire', Icon: Flame },
] as const;

export function TvMeetupPanel({ streamId }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<'chat' | 'watching' | 'poll'>('chat');
  const [messages, setMessages] = useState<Chat[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [poll, setPoll] = useState<any>(null);
  const [results, setResults] = useState<Record<string, number>>({});
  const [myVote, setMyVote] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const lastReactionAt = useRef(0);

  const loadChat = useCallback(async () => {
    const { data } = await supabase
      .from('stream_chat')
      .select('id,stream_id,user_id,message,created_at')
      .eq('stream_id', streamId)
      .order('created_at', { ascending: false })
      .limit(80);

    const ids = Array.from(
      new Set((data || []).map((x: any) => x.user_id).filter(Boolean)),
    );
    const profileResult = ids.length
      ? await supabase.from('profiles').select('id,username').in('id', ids)
      : { data: [] };
    const by = new Map((profileResult.data || []).map((p: any) => [p.id, p]));

    setMessages(
      (data || [])
        .reverse()
        .map((x: any) => ({ ...x, username: by.get(x.user_id)?.username || null })),
    );
  }, [streamId]);

  const loadPoll = useCallback(async () => {
    const { data } = await supabase
      .from('tv_live_polls')
      .select('id,question,options,status,ends_at')
      .eq('stream_id', streamId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setPoll(data || null);
    setResults({});
    setMyVote(null);

    if (!data || !user) return;

    const result = await supabase.rpc('tv_live_poll_results', { p_poll_id: data.id });
    if (!result.error) {
      const next: Record<string, number> = {};
      (result.data || []).forEach((x: any) => {
        next[x.option_id] = Number(x.vote_count);
      });
      setResults(next);
    }

    const voteResult = await supabase
      .from('tv_live_poll_votes')
      .select('option_id')
      .eq('poll_id', data.id)
      .eq('voter_id', user.id)
      .maybeSingle();

    setMyVote(voteResult.data?.option_id || null);
  }, [streamId, user?.id]);

  useEffect(() => {
    void loadChat();
    void loadPoll();

    const channel = supabase
      .channel('tv-meetup-' + streamId)
      .on('broadcast', { event: 'chat_message' }, ({ payload }) => {
        const message = payload as Chat;
        setMessages((previous) =>
          previous.some((item) => item.id === message.id)
            ? previous
            : [...previous, message].slice(-80),
        );
      })
      .on('broadcast', { event: 'poll_changed' }, () => {
        void loadPoll();
      })
      .on('broadcast', { event: 'tv_reaction' }, ({ payload }) => {
        const emoji = String((payload as { emoji?: string })?.emoji || '');
        if (!REACTIONS.some((reaction) => reaction.emoji === emoji)) return;
        setReactions((previous) => {
          const existing = previous.find((reaction) => reaction.emoji === emoji);
          return existing
            ? previous.map((reaction) =>
                reaction.emoji === emoji
                  ? { ...reaction, count: reaction.count + 1 }
                  : reaction,
              )
            : [...previous, { emoji, count: 1 }];
        });
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const next: Viewer[] = [];

        Object.entries(state).forEach(([id, value]: any) => {
          const item = value?.[0];
          if (item) next.push({ user_id: id, username: item.username || null });
        });

        setViewers(next);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            username: user?.user_metadata?.username || null,
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [streamId, user?.id, loadChat, loadPoll]);

  const send = async () => {
    const message = draft.trim();
    if (!message || !user || sending) return;

    setSending(true);
    setDraft('');

    try {
      const result = await supabase
        .from('stream_chat')
        .insert({
          stream_id: streamId,
          user_id: user.id,
          message,
        })
        .select('id,stream_id,user_id,message,created_at')
        .single();

      if (result.error) throw result.error;

      setMessages((previous) =>
        [
          ...previous,
          {
            ...result.data,
            username: user.user_metadata?.username || null,
          },
        ].slice(-80),
      );
    } catch {
      setDraft(message);
    } finally {
      setSending(false);
    }
  };

  const sendReaction = async (emoji: string) => {
    if (!user) return;

    const now = Date.now();
    if (now - lastReactionAt.current < 500) return;
    lastReactionAt.current = now;

    const channel = supabase.channel('tv-meetup-' + streamId);
    const status = await new Promise<string>((resolve) => {
      const timeout = window.setTimeout(() => resolve('TIMED_OUT'), 2500);
      channel.subscribe((next) => {
        if (next === 'SUBSCRIBED' || next === 'CHANNEL_ERROR') {
          window.clearTimeout(timeout);
          resolve(next);
        }
      });
    });

    if (status === 'SUBSCRIBED') {
      await channel.send({
        type: 'broadcast',
        event: 'tv_reaction',
        payload: { emoji, user_id: user.id },
      });
    }

    void supabase.removeChannel(channel);
  };

  const vote = async (optionId: string) => {
    if (!user || !poll || myVote) return;

    const result = await supabase
      .from('tv_live_poll_votes')
      .insert({
        poll_id: poll.id,
        voter_id: user.id,
        option_id: optionId,
      });

    if (!result.error) {
      setMyVote(optionId);
      setResults((previous) => ({
        ...previous,
        [optionId]: (previous[optionId] || 0) + 1,
      }));
    }
  };

  const total = useMemo(
    () => Object.values(results).reduce((sum, count) => sum + count, 0),
    [results],
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950 text-white overflow-hidden">
      <div className="flex border-b border-white/10">
        {(
          [
            ['chat', 'Chat', MessageCircle],
            ['watching', 'Watching', Users],
            ['poll', 'Vote', BarChart3],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={
              'flex-1 px-3 py-2 text-xs font-bold ' +
              (tab === id ? 'bg-white/10' : 'text-zinc-500')
            }
          >
            <Icon className="inline w-3.5 h-3.5 mr-1" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'chat' && (
        <>
          <div className="h-64 overflow-y-auto p-3 space-y-2">
            {messages.map((message) => (
              <button
                key={message.id}
                onClick={() =>
                  message.username &&
                  nav('/profile/' + encodeURIComponent(message.username))
                }
                className="block w-full text-left"
              >
                <span className="text-xs font-bold text-red-300">
                  @{message.username || 'viewer'}
                </span>
                <span className="text-xs text-zinc-300 ml-2">
                  {message.message}
                </span>
              </button>
            ))}
          </div>

          <div className="px-3 pb-2 flex items-center gap-1">
            {REACTIONS.map(({ emoji, label, Icon }) => (
              <button
                key={emoji}
                type="button"
                disabled={!user}
                onClick={() => void sendReaction(emoji)}
                aria-label={label}
                title={label}
                className="rounded-lg bg-zinc-900 px-2 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-40"
              >
                <Icon className="inline w-3.5 h-3.5 mr-1" />
                {emoji}
              </button>
            ))}
            {reactions.map((reaction) => (
              <span
                key={reaction.emoji}
                className="ml-auto rounded-full bg-zinc-900 px-2 py-1 text-xs"
              >
                {reaction.emoji} {reaction.count}
              </span>
            ))}
          </div>

          <div className="p-2 border-t border-white/10 flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send();
              }}
              placeholder={user ? 'Say something…' : 'Sign in to chat'}
              disabled={!user || sending}
              className="min-w-0 flex-1 rounded-xl bg-zinc-900 px-3 py-2 text-sm"
            />
            <button
              onClick={() => void send()}
              disabled={!user || sending || !draft.trim()}
              className="rounded-xl bg-red-600 px-3 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {tab === 'watching' && (
        <div className="p-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
            <Radio className="w-3.5 h-3.5 text-red-400" />
            {viewers.length} here now
          </div>
          <div className="grid grid-cols-2 gap-2">
            {viewers.slice(0, 20).map((viewer) => (
              <button
                key={viewer.user_id}
                onClick={() =>
                  viewer.username &&
                  nav('/profile/' + encodeURIComponent(viewer.username))
                }
                className="rounded-xl bg-zinc-900 p-2 text-left text-xs"
              >
                @{viewer.username || 'viewer'}
                <div className="text-[10px] text-zinc-500">
                  Watching this show
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'poll' && (
        <div className="p-3">
          {poll ? (
            <>
              <p className="font-semibold text-sm">{poll.question}</p>
              <div className="mt-3 space-y-2">
                {(poll.options || []).map((option: any) => (
                  <button
                    key={option.id}
                    disabled={!user || !!myVote}
                    onClick={() => void vote(option.id)}
                    className="w-full rounded-xl border border-white/10 bg-zinc-900 p-2 text-left text-xs disabled:opacity-70"
                  >
                    <div className="flex justify-between">
                      <span>{option.text}</span>
                      <span>{results[option.id] || 0}</span>
                    </div>
                    <div className="mt-1 h-1 rounded bg-zinc-800">
                      <div
                        className="h-full bg-red-500"
                        style={{
                          width:
                            (total
                              ? ((results[option.id] || 0) / total) * 100
                              : 0) + '%',
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
              {!user && (
                <p className="text-[10px] text-zinc-500 mt-2">
                  Sign in to vote and see live totals.
                </p>
              )}
              {myVote && (
                <p className="text-[10px] text-zinc-500 mt-2">
                  <Check className="inline w-3 h-3" /> Vote recorded.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-500 py-10 text-center">
              No live vote right now.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
