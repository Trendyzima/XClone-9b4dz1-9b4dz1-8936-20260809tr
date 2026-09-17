import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import * as federation from '@/api/federation';

interface Props {
  initialItems: any[];
  renderItem: (item: any, index: number) => ReactNode;
  pageSize?: number;
}

const cursorFor = (item: any): string | null => {
  if (!item?.published_at) return null;
  return encodeURIComponent(`${item.published_at}|${item.id ?? ''}`);
};

export function FediverseInfiniteFeed({ initialItems, renderItem, pageSize = 30 }: Props) {
  const [items, setItems] = useState<any[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(() => cursorFor(initialItems[initialItems.length - 1]));
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [caughtUp, setCaughtUp] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setItems(initialItems);
    setCursor(cursorFor(initialItems[initialItems.length - 1]));
    setHasMore(true);
    setCaughtUp(false);
  }, [initialItems]);

  const merge = useCallback((incoming: any[]) => {
    setItems(prev => {
      const seen = new Set(prev.map(item => item.id ?? item.object_url ?? item.uri));
      const additions = incoming.filter(item => {
        const key = item.id ?? item.object_url ?? item.uri;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, []);

  const loadNext = useCallback(async () => {
    if (loadingRef.current) return;
    if (!cursor && items.length > 0) return;

    loadingRef.current = true;
    setLoading(true);
    setCaughtUp(false);
    try {
      const page = await federation.getFederatedTimelinePage({
        limit: pageSize,
        before: cursor ?? undefined,
      });
      const incoming = page.items ?? [];
      const beforeCount = items.length;
      merge(incoming);
      setCursor(page.pagination?.nextCursor ?? cursor);

      if (incoming.length === 0 || items.length === beforeCount) {
        // Do not render an "end of feed" state. Keep the sentinel alive and
        // periodically check for newly federated objects while the user remains
        // at the bottom of the stream.
        setCaughtUp(true);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(loadNext, 15000);
      } else {
        setHasMore(page.pagination?.hasMore ?? incoming.length >= pageSize);
      }
    } catch {
      // A transient gateway/database failure should not terminate the stream.
      setCaughtUp(true);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(loadNext, 10000);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, items.length, merge, pageSize]);

  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void loadNext();
    }, { rootMargin: '900px 0px 900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadNext]);

  return (
    <>
      <div className="divide-y divide-border">
        {items.map((item, index) => renderItem(item, index))}
      </div>
      <div ref={sentinelRef} aria-hidden="true" className="min-h-24 flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        ) : caughtUp ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <RefreshCw className="w-3.5 h-3.5" />
            Loading more federated content automatically…
          </div>
        ) : hasMore ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
        ) : null}
      </div>
    </>
  );
}
