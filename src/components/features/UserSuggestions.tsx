import { useState, useEffect } from 'react';
import { VerifiedTick } from '@/components/ui/VerifiedTick';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { UserSuggestion as UserSuggestionType } from '@/types/app-types';
import { Button } from '@/components/ui/button';
import {  } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function UserSuggestions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<UserSuggestionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) fetchSuggestions();
  }, [user]);

  const fetchSuggestions = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Generate suggestions server-side
      await supabase.rpc('generate_user_suggestions', { target_user_id: user.id });

      // Fetch top 5 suggestions with related user profiles
      const { data, error } = await supabase
        .from('user_suggestions')
        .select(`
          *,
          suggested_user:user_profiles!user_suggestions_suggested_user_id_fkey(*)
        `)
        .eq('user_id', user.id)
        .order('score', { ascending: false })
        .limit(5);

      if (error) throw error;
      setSuggestions(data || []);
    } catch (err) {
      console.error('Error fetching suggestions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async (userId: string) => {
    if (!user) return;

    try {
      // Insert follow
      await supabase.from('follows').insert({
        follower_id: user.id,
        following_id: userId,
      });

      // Insert notification for the followed user
      await supabase.from('notifications').insert({ recipient_id: userId, kind: 'follow', actor_id: user.id,
       });

      // Send push notification
      const { sendActivityNotification } = await import('@/components/layout/AuthProvider');
      const myProfile = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      sendActivityNotification({
        recipientUserId: userId,
        title: 'New Follower',
        body: `${myProfile.data?.username || 'Someone'} followed you`,
        data: { route: `/profile/${myProfile.data?.username}`, type: 'follow' }
      });

      // Update state
      setFollowingIds((prev) => new Set(prev).add(userId));
      setSuggestions((prev) => prev.filter((s) => s.suggested_user_id !== userId));
    } catch (err) {
      console.error('Error following user:', err);
      toast({
        title: 'Error',
        description: 'Failed to follow user',
        variant: 'destructive',
      });
    }
  };

  if (!user || loading || suggestions.length === 0) return null;

  return (
    <div className="bg-muted/30 rounded-2xl p-4">
      <h2 className="text-xl font-bold mb-4">Who to follow</h2>
      <div className="space-y-4">
        {suggestions.map((suggestion) => (
          <div key={suggestion.id} className="flex items-start justify-between">
            <div
              className="flex items-start space-x-3 flex-1 cursor-pointer"
              onClick={() => navigate(`/profile/${suggestion.suggested_user?.username}`)}
            >
              <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex-shrink-0">
                {suggestion.suggested_user?.avatar_url ? (
                  <img
                    src={suggestion.suggested_user.avatar_url}
                    alt={suggestion.suggested_user.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-bold">
                    {suggestion.suggested_user?.username[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-1">
                  <p className="font-semibold truncate">{suggestion.suggested_user?.username}</p>
                  {suggestion.suggested_user?.verified && (
                    <VerifiedTick className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">
                  @{suggestion.suggested_user?.username}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{suggestion.reason}</p>
              </div>
            </div>
            <Button
              onClick={() => handleFollow(suggestion.suggested_user_id)}
              size="sm"
              className="rounded-full px-4"
            >
              Follow
            </Button>
          </div>
        ))}
      </div>

      <button
        onClick={() => navigate('/explore')}
        className="text-primary hover:underline mt-4 text-sm"
      >
        Show more
      </button>
    </div>
  );
                                           }
