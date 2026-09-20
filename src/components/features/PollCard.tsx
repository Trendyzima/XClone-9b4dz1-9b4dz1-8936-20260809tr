import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, ChevronDown, ChevronUp, Clock, Loader2, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

type PollOption = { id: string; label: string; position: number; votes: number };
type PollData = {
  id: string;
  question: string;
  description?: string | null;
  status: string;
  ends_at?: string | null;
  total_votes: number;
  options: PollOption[];
};

interface PollCardProps {
  poll?: PollData;
  postId: string;
  repliesCount?: number;
}

export function PollCard({ poll, postId, repliesCount = 0 }: PollCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pollData, setPollData] = useState<PollData | null>(poll ?? null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const loadResults = async (pollId: string) => {
    const { data, error } = await supabase.rpc('poll_results', { p_poll_id: pollId });
    if (error) throw error;
    const result = data as PollData;
    setPollData(result);
    if (user) {
      const { data: vote } = await supabase
        .from('poll_votes')
        .select('option_id')
        .eq('poll_id', pollId)
        .eq('voter_id', user.id)
        .maybeSingle();
      if (vote?.option_id) {
        setSelectedOption(vote.option_id);
        setVoted(true);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (poll?.id) {
          await loadResults(poll.id);
        } else {
          const { data, error } = await supabase
            .from('polls')
            .select('id')
            .eq('post_id', postId)
            .maybeSingle();
          if (error) throw error;
          if (data?.id) await loadResults(data.id);
        }
      } catch (error) {
        if (!cancelled) console.warn('[poll] load failed', error);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [poll?.id, postId, user?.id]);

  const isExpired = useMemo(() => {
    if (!pollData) return false;
    return pollData.status !== 'open' || Boolean(pollData.ends_at && new Date(pollData.ends_at) <= new Date());
  }, [pollData]);

  const showResults = voted || isExpired;

  const handleVote = async (optionId: string) => {
    if (!user) { navigate('/auth'); return; }
    if (!pollData || isExpired || voted) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc('cast_poll_vote', {
        p_poll_id: pollData.id,
        p_option_ids: [optionId],
      });
      if (error) throw error;
      setSelectedOption(optionId);
      setVoted(true);
      await loadResults(pollData.id);
      toast.success('Vote recorded');
    } catch (error: any) {
      toast.error(error?.message ?? 'Unable to record vote');
    } finally {
      setLoading(false);
    }
  };

  if (!pollData) return null;

  const total = Number(pollData.total_votes ?? 0);
  const pct = (votes: number) => total > 0 ? Math.round((Number(votes) / total) * 100) : 0;
  const leader = showResults
    ? pollData.options.reduce<PollOption | null>((best, option) => !best || option.votes > best.votes ? option : best, null)
    : null;

  const timeLabel = !pollData.ends_at
    ? 'Open voting'
    : isExpired
      ? 'Voting ended'
      : `${Math.max(1, Math.ceil((new Date(pollData.ends_at).getTime() - Date.now()) / 86_400_000))}d left`;

  return (
    <div className="mt-3 rounded-2xl border border-primary/15 bg-card overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-primary/[0.04]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Poll</p>
            <p className="font-bold text-sm truncate">{pollData.question}</p>
          </div>
        </div>
        <button onClick={() => setCollapsed(v => !v)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground shrink-0">
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <>
          {pollData.description && <p className="px-4 pt-3 text-sm text-muted-foreground">{pollData.description}</p>}
          <div className="p-3 space-y-2">
            {pollData.options.map(option => {
              const percent = pct(option.votes);
              const selected = selectedOption === option.id;
              const leading = leader?.id === option.id && percent > 0;
              return (
                <button
                  key={option.id}
                  disabled={loading || showResults}
                  onClick={() => handleVote(option.id)}
                  className={`w-full text-left rounded-xl border-2 overflow-hidden relative transition-all ${selected ? 'border-primary' : 'border-border'} ${!showResults ? 'hover:border-primary/50 active:scale-[0.99]' : ''}`}
                >
                  {showResults && <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${percent}%` }} />}
                  <span className="relative flex items-center justify-between gap-3 px-3.5 py-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                        {selected && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className={`text-sm font-medium truncate ${selected ? 'text-primary font-semibold' : ''}`}>{option.label}</span>
                    </span>
                    {showResults && <span className="text-xs font-semibold tabular-nums shrink-0">{percent}% · {option.votes}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="px-4 pb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" />{total} vote{total === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{timeLabel}</span>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
          </div>

          <div className="px-4 pb-4 flex items-center justify-between">
            {!user && !isExpired && <button onClick={() => navigate('/auth')} className="text-xs font-semibold text-primary">Sign in to vote</button>}
            {user && !showResults && <span className="text-xs font-semibold text-primary">Choose an answer</span>}
            <button onClick={() => navigate(`/thread/${postId}`)} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary">
              <MessageCircle className="w-3.5 h-3.5" /> {repliesCount} repl{repliesCount === 1 ? 'y' : 'ies'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
