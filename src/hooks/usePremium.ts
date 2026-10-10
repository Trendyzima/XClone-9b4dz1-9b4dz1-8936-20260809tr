import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

interface PremiumStatus {
  isActive: boolean;
  plan: 'monthly' | 'annual' | null;
  expiresAt: Date | null;
  loading: boolean;
}

let cachedStatus: PremiumStatus | null = null;
let cachedUserId: string | null = null;
let listeners: Array<(s: PremiumStatus) => void> = [];
let pendingRefresh: Promise<PremiumStatus> | null = null;
let pendingRefreshUserId: string | null = null;

function notify(s: PremiumStatus, userId: string | null) {
  cachedStatus = s;
  cachedUserId = userId;
  listeners.forEach(fn => fn(s));
}

export function usePremium(): PremiumStatus & { refresh: () => Promise<void> } {
  const { user } = useAuth();
  const [status, setStatus] = useState<PremiumStatus>(() => cachedStatus && cachedUserId === (user?.id ?? null) ? cachedStatus : { isActive: false, plan: null, expiresAt: null, loading: true });

  const refresh = useCallback(async () => {
    const requestedUserId = user?.id ?? null;
    if (pendingRefresh && pendingRefreshUserId === requestedUserId) {
      const shared = await pendingRefresh;
      setStatus(shared);
      return;
    }

    const task = (async (): Promise<PremiumStatus> => {
      if (!user) return { isActive: false, plan: null, expiresAt: null, loading: false };

      const { data, error } = await supabase.rpc('get_my_premium_status');
      if (error) return { isActive: false, plan: null, expiresAt: null, loading: false };

      const active = Boolean(data?.is_active);
      return {
        isActive: active,
        plan: active && (data?.plan === 'monthly' || data?.plan === 'annual') ? data.plan : null,
        expiresAt: active && data?.expires_at ? new Date(data.expires_at) : null,
        loading: false,
      };
    })();

    pendingRefresh = task;
    pendingRefreshUserId = requestedUserId;
    try {
      const resolved = await task;
      notify(resolved, requestedUserId);
      setStatus(resolved);
    } finally {
      if (pendingRefresh === task) {
        pendingRefresh = null;
        pendingRefreshUserId = null;
      }
    }
  }, [user?.id]);

  useEffect(() => {
    const handler = (s: PremiumStatus) => setStatus(s);
    listeners.push(handler);
    if (cachedUserId !== user?.id || !cachedStatus || cachedStatus.loading) void refresh();
    else setStatus(cachedStatus);
    return () => { listeners = listeners.filter(l => l !== handler); };
  }, [refresh, user?.id]);

  return { ...status, refresh };
}

export function resetPremiumCache() {
  cachedStatus = null;
  cachedUserId = null;
}
