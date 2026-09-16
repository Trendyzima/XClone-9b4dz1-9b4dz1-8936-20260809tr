import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, BarChart3, ChevronDown, ChevronUp, Clock } from 'lucide-react';

interface PollOption { id: string; option_text: string; votes: number; }
interface Poll { id: string; question: string; expires_at: string; total_votes: number; options: PollOption[]; }
interface PollCardProps { poll?: Poll; postId: string; }

export function PollCard({ poll, postId }: PollCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [voted, setVoted] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [pollData, setPollData] = useState<Poll | null>(poll ?? null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (poll) { setPollData(poll); return; }
      const { data } = await supabase.from('polls').select('*, options:poll_options(*)').eq('post_id', postId).maybeSingle();
      if (!cancelled && data) setPollData(data as Poll);
    };
    void load();
    return () => { cancelled = true; };
  }, [poll, postId]);

  useEffect(() => {
    if (!user || !pollData) return;
    const checkIfVoted = async () => {
      const { data } = await supabase.from('poll_votes').select('option_id').eq('poll_id', pollData.id).eq('user_id', user.id).maybeSingle();
      if (data) { setVoted(true); setSelectedOption(data.option_id); }
    };
    void checkIfVoted();
  }, [pollData, user?.id]);

  const handleVote = async (optionId: string) => {
    if (!user) { navigate('/auth'); return; }
    if (!pollData) return;
    if (voted) { toast.error('You already voted'); return; }
    if (new Date() > new Date(pollData.expires_at)) { toast.error('Poll has ended'); return; }
    setLoading(true);
    const { error } = await supabase.from('poll_votes').insert({ poll_id: pollData.id, option_id: optionId, user_id: user.id });
    if (error) { toast.error(error.message); setLoading(false); return; }
    await supabase.rpc('increment', { table_name: 'poll_options', row_id: optionId, column_name: 'votes' });
    await supabase.rpc('increment', { table_name: 'polls', row_id: pollData.id, column_name: 'total_votes' });
    const { data: updated } = await supabase.from('polls').select('*, options:poll_options(*)').eq('id', pollData.id).single();
    if (updated) setPollData(updated as Poll);
    setVoted(true);
    setSelectedOption(optionId);
    toast.success('Vote recorded!');
    setLoading(false);
  };

  if (!pollData) return null;
  const pct = (votes: number) => pollData.total_votes === 0 ? 0 : Math.round((votes / pollData.total_votes) * 100);
  const isExpired = new Date() > new Date(pollData.expires_at);
  const timeLeft = Math.max(0, new Date(pollData.expires_at).getTime() - Date.now());
  const hoursLeft = Math.floor(timeLeft / 3_600_000);
  const daysLeft = Math.floor(hoursLeft / 24);
  const minsLeft = Math.floor((timeLeft % 3_600_000) / 60_000);
  const showResults = voted || isExpired;
  const leader = showResults && pollData.options.length > 0 ? pollData.options.reduce((a, b) => (a.votes >= b.votes ? a : b)) : null;

  return (
    <div className="mt-3 rounded-2xl border border-border bg-card overflow-hidden" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /><p className="font-bold text-sm line-clamp-1">{pollData.question}</p></div>
        <button onClick={() => setCollapsed(v => !v)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1">{collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}</button>
      </div>
      {!collapsed && <>
        <div className="p-3 space-y-2">
          {pollData.options.map(option => {
            const p = pct(option.votes); const isSelected = selectedOption === option.id; const isLeader = leader?.id === option.id && p > 0;
            return <button key={option.id} onClick={() => !showResults && !loading && handleVote(option.id)} disabled={showResults || loading}
              className={`w-full text-left rounded-xl border-2 overflow-hidden transition-all ${showResults ? 'cursor-default' : 'cursor-pointer hover:border-primary/50 active:scale-[0.99]'} ${isSelected ? 'border-primary' : isLeader && showResults ? 'border-primary/40' : 'border-border'}`}>
              <div className="relative">{showResults && <div className={`absolute inset-0 transition-all duration-700 ease-out rounded-xl ${isSelected ? 'bg-primary/15' : isLeader ? 'bg-primary/8' : 'bg-muted/40'}`} style={{ width: `${p}%` }} />}
                <div className="relative flex items-center justify-between px-3 py-2.5"><div className="flex items-center gap-2 min-w-0"><div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${isSelected ? 'border-primary bg-primary' : 'border-border'}`}>{isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}</div><span className={`text-sm font-medium truncate ${isSelected ? 'text-primary font-semibold' : ''}`}>{option.option_text}</span>{isLeader && showResults && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">Leading</span>}</div>
                  {showResults && <div className="flex items-center gap-1.5 shrink-0 ml-2"><span className="text-xs text-muted-foreground">{option.votes} vote{option.votes !== 1 ? 's' : ''}</span><span className={`text-sm font-black tabular-nums ${isSelected ? 'text-primary' : isLeader ? 'text-foreground' : 'text-muted-foreground'}`}>{p}%</span></div>}
                </div>
              </div>
            </button>;
          })}
        </div>
        <div className="flex items-center justify-between px-4 pb-3 text-xs text-muted-foreground"><div className="flex items-center gap-1"><BarChart3 className="w-3 h-3" /><span><strong className="text-foreground">{pollData.total_votes}</strong> vote{pollData.total_votes !== 1 ? 's' : ''}</span></div><div className="flex items-center gap-1"><Clock className="w-3 h-3" />{isExpired ? <span className="font-semibold text-red-500">Ended</span> : daysLeft > 0 ? <span>{daysLeft}d left</span> : hoursLeft > 0 ? <span>{hoursLeft}h left</span> : <span>{minsLeft}m left</span>}</div>{!showResults && !loading && user && <span className="text-[10px] text-primary font-semibold">Tap to vote</span>}{loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}{!user && !showResults && <button onClick={() => navigate('/auth')} className="text-[10px] text-primary font-semibold hover:underline">Sign in to vote</button>}</div>
      </>}
    </div>
  );
}
