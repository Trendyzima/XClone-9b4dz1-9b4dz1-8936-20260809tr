import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
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
        const { data: followingData } = await supabase.from('follows').select('following_id').eq('follower_id', user.id);
        const followingIds = new Set<string>((followingData ?? []).map((f: { following_id: string }) => f.following_id));
        setFollowing(followingIds);
        const directIds = Array.from(followingIds);

        const mutualCounts = new Map<string, number>();
        if (directIds.length) {
          const { data: mutualRows } = await supabase.from('follows').select('following_id').in('follower_id', directIds).neq('following_id', user.id).limit(200);
          for (const row of mutualRows ?? []) {
            if (!followingIds.has(row.following_id)) mutualCounts.set(row.following_id, (mutualCounts.get(row.following_id) ?? 0) + 1);
          }
        }

        const mutualIds = Array.from(mutualCounts.keys()).slice(0, 30);
        const { data: mutualProfiles } = mutualIds.length
          ? await supabase.from('profiles').select('id,username,avatar_url,bio,verified,is_creator,follower_count').in('id', mutualIds)
          : { data: [] as SuggestedUser[] };

        const mutuals = (mutualProfiles ?? [])
          .map((profile: SuggestedUser) => ({ ...profile, mutual_count: mutualCounts.get(profile.id) ?? 0, reason: 'Followed by people you follow' }))
          .sort((a, b) => (b.mutual_count ?? 0) - (a.mutual_count ?? 0) || Number(b.follower_count ?? 0) - Number(a.follower_count ?? 0));

        const excluded = new Set([user.id, ...directIds, ...mutuals.map(p => p.id)]);
        const { data: popularProfiles } = await supabase.from('profiles').select('id,username,avatar_url,bio,verified,is_creator,follower_count').neq('id', user.id).order('follower_count', { ascending: false }).limit(40);
        const popular = (popularProfiles ?? [])
          .filter((profile: SuggestedUser) => !excluded.has(profile.id))
          .map((profile: SuggestedUser) => ({ ...profile, reason: profile.is_creator ? 'Popular creator' : 'Popular on Testagram' }));

        if (!cancelled) setSuggestions([...mutuals, ...popular].slice(0, 5));
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
      const { error } = await supabase.from('follows').insert({ follower_id: user.id, following_id: userId });
      if (error) throw error;
      toast.success('Following!');
      await supabase.from('notifications').insert({ recipient_id: userId, kind: 'follow', actor_id: user.id });
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
