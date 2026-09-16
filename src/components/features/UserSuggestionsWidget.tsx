import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { BadgeCheck, Loader2, UserPlus, Check } from 'lucide-react';
import { toast } from 'sonner';

export function UserSuggestionsWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchSuggestions();
  }, [user]);

  const fetchSuggestions = async () => {
    if (!user) return;
    try {
      const { data: followingData } = await supabase
        .from('follows').select('following_id').eq('follower_id', user.id);
      const followingIds = new Set<string>(
        (followingData ?? []).map((f: { following_id: string }) => f.following_id),
      );
      setFollowing(followingIds);

      const { data: suggestedUsers } = await supabase
        .from('user_profiles').select('*').neq('id', user.id)
        .not('id', 'in', `(${Array.from(followingIds).join(',') || 'null'})`)
        .order('followers_count', { ascending: false }).limit(5);
      setSuggestions(suggestedUsers || []);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async (userId: string) => {
    if (!user) { navigate('/auth'); return; }
    try {
      const { error } = await supabase.from('follows').insert({ follower_id: user.id, following_id: userId });
      if (error) throw error;
      setFollowing(prev => new Set([...prev, userId]));
      toast.success('Following!');
      await supabase.from('notifications').insert({ user_id: userId, type: 'follow', from_user_id: user.id });
    } catch (error: any) {
      console.error('Follow error:', error);
      toast.error(error.message);
    }
  };

  if (!user || loading || suggestions.length === 0) return null;

  return (
    <div className="bg-muted/30 rounded-xl p-4">
      <h2 className="text-xl font-bold mb-4">Who to follow</h2>
      <div className="space-y-3">
        {suggestions.map((suggestedUser) => (
          <div key={suggestedUser.id} className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1 cursor-pointer" onClick={() => navigate(`/profile/${suggestedUser.username}`)}>
              <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0">
                {suggestedUser.avatar_url ? <img src={suggestedUser.avatar_url} alt={suggestedUser.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{suggestedUser.username[0].toUpperCase()}</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-1">
                  <span className="font-semibold truncate">{suggestedUser.username}</span>
                  {suggestedUser.verified && <BadgeCheck className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" />}
                </div>
                <p className="text-sm text-muted-foreground truncate">{suggestedUser.bio || `@${suggestedUser.username}`}</p>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); handleFollow(suggestedUser.id); }} disabled={following.has(suggestedUser.id)} className={`px-4 py-1.5 rounded-full font-semibold text-sm transition-colors ${following.has(suggestedUser.id) ? 'bg-muted text-foreground' : 'bg-foreground text-background hover:opacity-90'}`}>
              {following.has(suggestedUser.id) ? <span className="flex items-center gap-1"><Check className="w-4 h-4" />Following</span> : 'Follow'}
            </button>
          </div>
        ))}
      </div>
      <button onClick={() => navigate('/explore')} className="w-full mt-3 text-primary hover:underline text-sm font-medium">Show more</button>
    </div>
  );
}
