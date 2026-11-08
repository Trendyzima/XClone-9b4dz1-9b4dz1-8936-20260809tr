import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { backendCapabilities } from '@/services/backendClient';

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

      const data = await backendCapabilities.call<any>('testagram.premium.status').catch(() => null);
      if (!data) return { isActive: false, plan: null, expiresAt: null, loading: false };

      const active = Boolean(data?.is_active ?? data?.isActive);
      return {
        isActive: active,
        plan: active && (data?.plan === 'monthly' || data?.plan === 'annual') ? data.plan : null,
        expiresAt: active && (data?.expires_at ?? data?.expiresAt) ? new Date(data.expires_at ?? data.expiresAt) : null,
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
