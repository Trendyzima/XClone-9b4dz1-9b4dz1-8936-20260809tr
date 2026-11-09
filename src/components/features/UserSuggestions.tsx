import { useState, useEffect } from 'react';
import { VerifiedTick } from '@/components/ui/VerifiedTick';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { profileApi } from '@/services/profileApi';
import { socialApi } from '@/services/socialApiClient';
import { backendCapabilities } from '@/services/backendClient';
import { UserSuggestion as UserSuggestionType } from '@/types/app-types';
import { Button } from '@/components/ui/button';
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
      const result = await backendCapabilities.listDiscoveryCreators(20);
      const candidates = (result.items ?? []).filter((profile: any) => profile.id && profile.id !== user.id);
      const states = await Promise.all(candidates.map(async (profile: any) => {
        try {
          const state = await socialApi.getFollowState(profile.id);
          return { id: profile.id, following: Boolean(state.following), requested: Boolean(state.requested) };
        } catch {
          return { id: profile.id, following: false, requested: false };
        }
      }));
      const stateById = new Map(states.map(state => [state.id, state]));
      setFollowingIds(new Set(states.filter(state => state.following).map(state => state.id)));
      setSuggestions(candidates
        .filter((profile: any) => !stateById.get(profile.id)?.following && !stateById.get(profile.id)?.requested)
        .slice(0, 5)
        .map((profile: any, index: number) => ({
          id: profile.id,
          user_id: user.id,
          suggested_user_id: profile.id,
          score: Number(profile.discovery_score ?? 0) - index,
          reason: profile.is_creator ? 'Creator to discover' : 'Suggested for you',
          suggested_user: profile,
        })) as UserSuggestionType[]);
    } catch (err) {
      console.error('Error fetching suggestions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async (userId: string) => {
    if (!user) return;

    try {
      // The canonical Backend owns follow state and emits its own notification/outbox event.
      await socialApi.setFollow(userId, true);

      // Send push notification
      const { sendActivityNotification } = await import('@/components/layout/AuthProvider');
      const { profile } = await profileApi.getById(user.id);
      sendActivityNotification({
        recipientUserId: userId,
        title: 'New Follower',
        body: `${profile?.username || 'Someone'} followed you`,
        data: { route: `/profile/${profile?.username || ''}`, type: 'follow' }
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
