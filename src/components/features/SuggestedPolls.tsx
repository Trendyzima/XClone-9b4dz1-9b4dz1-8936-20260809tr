import { useEffect, useState } from 'react';
import { BarChart3, ChevronRight, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { PollCard } from '@/components/features/PollCard';

type SuggestedPoll = {
  poll_id: string;
  post_id: string;
  question: string;
  description?: string | null;
  ends_at?: string | null;
  community_display_name?: string | null;
};

export function SuggestedPolls({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [polls, setPolls] = useState<SuggestedPoll[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setPolls([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase.rpc('suggest_polls_for_user', { p_limit: compact ? 2 : 3 })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[poll-suggestions] failed', error);
          setPolls([]);
        } else {
          setPolls((data ?? []) as SuggestedPoll[]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, compact]);

  if (!user || loading || polls.length === 0) return null;

  return (
    <section className={compact ? 'border-b border-border px-4 py-3' : 'border-b border-border px-4 py-4'}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <BarChart3 className="w-3.5 h-3.5" />
            </div>
            <h2 className="font-bold text-sm">Suggested polls</h2>
            <Sparkles className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Questions from communities and people relevant to you.
          </p>
        </div>
        <button
          onClick={() => navigate('/polls')}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-primary"
        >
          See all <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {polls.map((poll) => (
          <div key={poll.poll_id}>
            {poll.community_display_name && (
              <p className="text-[10px] font-semibold text-muted-foreground mb-1.5 px-1">
                {poll.community_display_name}
              </p>
            )}
            <PollCard
              postId={poll.post_id}
              repliesCount={0}
              poll={{
                id: poll.poll_id,
                question: poll.question,
                description: poll.description,
                status: 'open',
                ends_at: poll.ends_at,
                total_votes: 0,
                options: [],
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
