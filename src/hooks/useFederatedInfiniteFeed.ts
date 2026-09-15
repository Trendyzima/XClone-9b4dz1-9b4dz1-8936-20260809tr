import { useCallback, useEffect, useRef, useState } from 'react';
import { getFederatedTimelinePage } from '@/api/federation';

export function useFederatedInfiniteFeed(pageSize = 20) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (reset = false) => {
    if (loadingRef.current || (!reset && !hasMore)) return false;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await getFederatedTimelinePage({
        limit: pageSize,
        before: reset ? undefined : cursorRef.current ?? undefined,
      });
      const incoming = Array.isArray(page.items) ? page.items : [];
      setItems((current) => {
        if (reset) return incoming;
        const seen = new Set(current.map((item) => item.uri ?? item.id));
        return [...current, ...incoming.filter((item) => !seen.has(item.uri ?? item.id))];
      });
      cursorRef.current = page.pagination.nextCursor;
      setHasMore(Boolean(page.pagination.hasMore && incoming.length));
      return incoming.length > 0;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load federated posts';
      setError(message);
      return false;
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, pageSize]);

  const refresh = useCallback(() => {
    cursorRef.current = null;
    setHasMore(true);
    return loadPage(true);
  }, [loadPage]);

  useEffect(() => {
    void loadPage(true);
  }, [loadPage]);

  return { items, loading, hasMore, error, loadMore: () => loadPage(false), refresh };
}
