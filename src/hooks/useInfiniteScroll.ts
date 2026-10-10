import { useState, useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  threshold?: number;
  rootMargin?: string;
  /** When supplied, the page owns the authoritative pagination state. */
  hasMore?: boolean;
}

export function useInfiniteScroll(
  loadMore: () => Promise<boolean>,
  options: UseInfiniteScrollOptions = {}
) {
  const { threshold = 0.8, rootMargin = '700px 0px', hasMore: externalHasMore } = options;
  const [loading, setLoading] = useState(false);
  const [localHasMore, setLocalHasMore] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef(loadMore);
  const inFlightRef = useRef(false);
  const blockedNodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  const canLoadMore = externalHasMore ?? localHasMore;

  const lastElementRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    if (blockedNodeRef.current !== node) blockedNodeRef.current = null;
    observerRef.current = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || !canLoadMore || inFlightRef.current || blockedNodeRef.current === node) return;
      inFlightRef.current = true;
      setLoading(true);
      Promise.resolve()
        .then(() => loadMoreRef.current())
        .then((more) => {
          if (externalHasMore === undefined) setLocalHasMore(Boolean(more));
          if (!more) blockedNodeRef.current = node;
        })
        .catch((error) => {
          console.warn('[infinite-scroll] page request failed', error);
          blockedNodeRef.current = node;
        })
        .finally(() => {
          inFlightRef.current = false;
          setLoading(false);
        });
    }, { threshold, rootMargin });

    observerRef.current.observe(node);
  }, [canLoadMore, externalHasMore, threshold, rootMargin]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { lastElementRef, loading, hasMore: canLoadMore };
}
