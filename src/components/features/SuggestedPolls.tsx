import { useEffect, useState } from 'react';
import { BarChart3, ChevronRight, Sparkles } from 'lucide-react';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
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

export function SuggestedPolls({ compact = false, initialPolls }: { compact?: boolean; initialPolls?: SuggestedPoll[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [polls, setPolls] = useState<SuggestedPoll[]>(initialPolls ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setPolls([]);
      return;
    }
    if (initialPolls !== undefined) { setPolls(initialPolls); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    backendCapabilities.listPolls(compact ? 12 : 20, 0)
      .then(result => {
        if (cancelled) return;
        const now = Date.now();
        const suggestions = (result.items ?? [])
          .filter((poll: any) => poll.post_id && poll.question && (!poll.ends_at || new Date(poll.ends_at).getTime() > now))
          .slice(0, compact ? 2 : 3)
          .map((poll: any) => ({
            poll_id: poll.id ?? poll.poll_id,
            post_id: poll.post_id,
            question: poll.question,
            description: poll.description ?? null,
            ends_at: poll.ends_at ?? null,
            community_display_name: poll.community_display_name ?? poll.community?.name ?? null,
          }));
        setPolls(suggestions);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('[poll-suggestions] Backend request failed', error);
        setPolls([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, compact, initialPolls]);

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
            Popular open questions from across Testagram.
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