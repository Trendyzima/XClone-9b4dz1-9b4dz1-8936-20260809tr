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
  const [loading, setLoading] = useState(false);
  const [caughtUp, setCaughtUp] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setItems(initialItems);
    setCursor(cursorFor(initialItems[initialItems.length - 1]));
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

  const scheduleRetry = useCallback((delayMs: number, next: () => void) => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(next, delayMs);
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
      const nextCursor = page.pagination?.nextCursor ?? cursorFor(incoming[incoming.length - 1]) ?? cursor;
      merge(incoming);
      setCursor(nextCursor);

      if (incoming.length === 0) {
        // There is deliberately no terminal "end of feed" state. Keep the
        // bottom sentinel alive and check again for newly federated content.
        setCaughtUp(true);
        scheduleRetry(15000, loadNext);
      } else if (!page.pagination?.hasMore) {
        // We reached the currently stored boundary. Keep polling from the last
        // item so newly arriving ActivityPub objects can extend the stream.
        setCaughtUp(true);
        scheduleRetry(15000, loadNext);
      }
    } catch {
      // A transient gateway/database failure must not terminate the feed.
      setCaughtUp(true);
      scheduleRetry(10000, loadNext);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, items.length, merge, pageSize, scheduleRetry]);

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
        ) : null}
      </div>
    </>
  );
}
