import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { socialApi } from '@/services/socialApiClient';
import { backendCapabilities } from '@/services/backendClient';
import { BadgeCheck, Check, Users, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type SuggestedUser = {
  id: string;
  username: string;
  avatar_url?: string | null;
  bio?: string | null;
  verified?: boolean;
  is_creator?: boolean;
  follower_count?: number | null;
  mutual_count?: number;
  reason?: string;
};

export function UserSuggestionsWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setSuggestions([]); setLoading(false); return; }

    const fetchSuggestions = async () => {
      setLoading(true);
      try {
        const result = await backendCapabilities.listDiscoveryCreators(20);
        const candidates = (result.items ?? []) as SuggestedUser[];
        const eligible = candidates.filter(candidate => candidate.id && candidate.id !== user.id);
        const states = await Promise.all(eligible.map(async candidate => {
          try {
            const state = await socialApi.getFollowState(candidate.id);
            return { id: candidate.id, following: Boolean(state.following), requested: Boolean(state.requested) };
          } catch {
            return { id: candidate.id, following: false, requested: false };
          }
        }));
        const stateById = new Map(states.map(state => [state.id, state]));
        const visible = eligible
          .filter(candidate => !stateById.get(candidate.id)?.following && !stateById.get(candidate.id)?.requested)
          .slice(0, 5)
          .map(candidate => ({
            ...candidate,
            reason: candidate.is_creator ? 'Creator to discover' : candidate.bio || 'Suggested for you',
          }));
        if (!cancelled) {
          setFollowing(new Set(states.filter(state => state.following).map(state => state.id)));
          setSuggestions(visible);
        }
      } catch (error) {
        console.error('[UserSuggestions] fetch error:', error);
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSuggestions();
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleFollow = async (userId: string) => {
    if (!user) { navigate('/auth'); return; }
    const previous = following;
    setFollowing(new Set([...previous, userId]));
    try {
      // Backend persists the relationship and publishes its notification event atomically.
      await socialApi.setFollow(userId, true);
      toast.success('Following!');
      setSuggestions(current => current.filter(item => item.id !== userId));
    } catch (error: any) {
      setFollowing(previous);
      toast.error(error?.message ?? 'Could not follow this account');
    }
  };

  if (!user || loading || suggestions.length === 0) return null;

  return (
    <div className="bg-muted/30 rounded-2xl p-4 border border-border/60">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /><h2 className="text-base font-bold">Who to follow</h2></div>
        <button onClick={() => navigate('/discover')} className="text-xs font-semibold text-primary hover:underline">Show more</button>
      </div>
      <div className="space-y-3">
        {suggestions.map((suggestedUser) => (
          <div key={suggestedUser.id} className="flex items-center gap-3">
            <button type="button" className="w-10 h-10 rounded-full bg-muted overflow-hidden shrink-0" onClick={() => navigate(`/profile/${suggestedUser.username}`)} aria-label={`Open @${suggestedUser.username}`}>
              {suggestedUser.avatar_url ? <img src={suggestedUser.avatar_url} alt="" className="w-full h-full object-cover" /> : <span className="w-full h-full grid place-items-center font-bold">{suggestedUser.username?.[0]?.toUpperCase()}</span>}
            </button>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(`/profile/${suggestedUser.username}`)}>
              <span className="flex items-center gap-1 font-semibold text-sm truncate">{suggestedUser.username}{suggestedUser.verified && <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" fill="currentColor" />}</span>
              <span className="block text-xs text-muted-foreground truncate">{suggestedUser.reason ?? suggestedUser.bio ?? `@${suggestedUser.username}`}</span>
              {(suggestedUser.mutual_count ?? 0) > 0 && <span className="block text-[10px] text-muted-foreground mt-0.5">{suggestedUser.mutual_count} mutual connection{suggestedUser.mutual_count === 1 ? '' : 's'}</span>}
            </button>
            <button type="button" onClick={() => handleFollow(suggestedUser.id)} disabled={following.has(suggestedUser.id)} className={`shrink-0 px-3.5 py-1.5 rounded-full font-semibold text-xs transition-colors ${following.has(suggestedUser.id) ? 'bg-muted text-foreground' : 'bg-foreground text-background hover:opacity-90'}`}>
              {following.has(suggestedUser.id) ? <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" />Following</span> : 'Follow'}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-border/60 flex items-center gap-2 text-[10px] text-muted-foreground"><Sparkles className="w-3 h-3" />Suggestions adapt from your network and creator discovery signals.</div>
    </div>
  );
}
