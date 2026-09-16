import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { backendCapabilities } from '@/services/backendClient';
import { TestagramEvent, trackTestagramEvent } from '@/lib/testagram-analytics';

export function useFollow(acct?: string) {
  const [state, setState] = useState<'not' | 'pending' | 'following' | 'error'>('not');

  const resolveUserId = useCallback(async (value: string): Promise<string> => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
    const username = value.startsWith('@') ? value.slice(1) : value;
    const { data, error } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error('Profile not found');
    return data.id;
  }, []);

  useEffect(() => {
    if (!acct) return;
    let cancelled = false;
    (async () => {
      try {
        const userId = await resolveUserId(acct);
        const result = await backendCapabilities.getFollowState(userId);
        if (!cancelled) setState(result.state?.following ? 'following' : result.state?.requested ? 'pending' : 'not');
      } catch {
        if (!cancelled) setState('not');
      }
    })();
    return () => { cancelled = true; };
  }, [acct, resolveUserId]);

  const follow = useCallback(async (value: string, shouldFollow = true) => {
    try {
      setState('pending');
      const userId = await resolveUserId(value);
      const result = await backendCapabilities.followUser(userId, shouldFollow);
      const following = Boolean(result.state?.following);
      setState(following ? 'following' : result.state?.requested ? 'pending' : 'not');
      trackTestagramEvent(following ? TestagramEvent.USER_FOLLOWED : TestagramEvent.USER_UNFOLLOWED, {
        target_user_id: userId,
        requested: Boolean(result.state?.requested),
      });
      return result;
    } catch (err) {
      setState('error');
      throw err;
    }
  }, [resolveUserId]);

  return { state, follow, setState };
}
