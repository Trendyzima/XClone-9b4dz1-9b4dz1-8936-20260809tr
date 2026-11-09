import { useState, useEffect, useRef, useCallback } from 'react';
import * as federation from '@/api/federation';

export interface FediverseNotif {
  id: string;
  activity_type: string;
  actor_url: string;
  object_url?: string;
  processed: boolean;
  created_at: string;
  // gateway-side fields
  type?: string;
  account?: any;
  status?: any;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

export function useFediversePolling(userId: string | undefined | null) {
  const [notifs, setNotifs] = useState<FediverseNotif[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // 1. Try gateway
      const res: any = await federation.getNotifications({ limit: 50 });
      const items: FediverseNotif[] = Array.isArray(res)
        ? res
        : res?.notifications ?? res?.data ?? [];
      setNotifs(items);
    } catch (error) {
      // Federation owns this feed. Never fall back to browser database access.
      console.warn('[fediverse] Federation API unavailable', error);
      setNotifs([]);
    } finally {
      setLoading(false);
      setLastPolled(new Date());
    }
  }, [userId]);

  // Initial poll + interval
  useEffect(() => {
    if (!userId) return;
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [userId, poll]);

  const unreadCount = notifs.filter(n => !n.processed).length;

  return { notifs, loading, lastPolled, unreadCount, refresh: poll };
}
