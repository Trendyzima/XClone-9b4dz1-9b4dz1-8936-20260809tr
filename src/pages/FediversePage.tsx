      ]);
    }
    setLoadingDiscovery(false);
  };

  const searchMastodon = async (q: string) => {
    if (!q.trim()) { setMastodonSearchResults([]); return; }
    setSearchingMastodon(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gateway-relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'search', instance: mastodonInstance, q, type: 'statuses', limit: 20 }),
      });
      if (!res.ok) throw new Error();
      const data = await readJsonResponse(res);
      setMastodonSearchResults(data?.statuses ?? []);
    } catch { setMastodonSearchResults([]); }
    setSearchingMastodon(false);
  };

  useEffect(() => {
    if (tab === 'inbox') fetchInbox();
    if (tab === 'relay') { fetchRelayConfig(); fetchOutboxLog(); }
    if (tab === 'analytics') fetchAnalytics();
    return () => {
      if (inboxPollRef.current) { clearInterval(inboxPollRef.current); inboxPollRef.current = null; }
    };
  }, [tab, user]);

  const checkGateway = async () => {
    try {
      const res = await federation.getHealth();
      setGatewayOk(!!res);
    } catch {
      try { await federation.getInstance(); setGatewayOk(true); } catch { setGatewayOk(false); }
    }
  };

  const fetchMyActor = async () => {
    if (!user) return;
    const { data: actor } = await supabase.from('activitypub_actors').select('*').eq('user_id', user.id).maybeSingle();
    setMyActor(actor);
    const { data: keys } = await supabase.from('activitypub_keys').select('id').eq('user_id', user.id).maybeSingle();
    setKeysReady(!!keys);
    if (!keys) void generateKeys();
  };

  const cacheFederatedPosts = async (posts: any[]) => {
    const rows = posts.filter((p: any) => p.uri ?? p.url ?? p.id).map((p: any) => ({
      uri: p.uri ?? p.url ?? p.id ?? '',
      object_type: p.object_type ?? 'Note',
      actor_uri: (() => {
        const account = p.account ?? p.remote_account ?? {};
        return account.uri ?? account.actor_uri ?? account.pleroma?.ap_id ?? account.url
          ?? p.actor?.id ?? p.actor_url ?? p.actor_uri ?? '';
      })(),
      url: p.url ?? p.uri ?? p.id ?? '',
      content: p.content ?? p.text ?? '',
      summary: p.spoiler_text ?? p.summary ?? null,
      attachments: p.media_attachments ?? p.attachments ?? [],
      tags: p.tags ?? [],
      like_count: p.favourites_count ?? p.likes_count ?? 0,
      reply_count: p.replies_count ?? 0,
      announce_count: p.reblogs_count ?? p.boosts_count ?? 0,
      published_at: p.created_at ?? p.published ?? new Date().toISOString(),
      raw_object: p,
    })).filter((r: any) => r.uri);
    if (!rows.length) return;
    await supabase.from('federated_objects').upsert(rows, { onConflict: 'uri', ignoreDuplicates: false })
      .then(() => setCachedAt(new Date())).catch(() => {});
  };
  const mergeFederatedFeedItems = useCallback((current: any[], incoming: any[]) => {
    const incomingByKey = new Map<string, any>();
    for (const item of incoming) {
      const key = String(item?.uri ?? item?.object_url ?? item?.id ?? '');
      if (key) incomingByKey.set(key, item);
    }

    const existingKeys = new Set<string>();
    const existing = current
      .filter(item => !item?.deleted_at && !item?.tombstone)
      .map(item => {
        const key = String(item?.uri ?? item?.object_url ?? item?.id ?? '');
        if (!key) return item;
        existingKeys.add(key);
        return incomingByKey.has(key) ? { ...item, ...incomingByKey.get(key) } : item;
      });

    const unseen = [...incomingByKey.entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([, item]) => item)
      .filter(item => !item?.deleted_at && !item?.tombstone)
      .sort((a, b) => new Date(b?.published_at ?? b?.created_at ?? 0).getTime() - new Date(a?.published_at ?? a?.created_at ?? 0).getTime());

    // Existing rows retain their DOM position. New refresh items are the only
    // rows allowed to enter at the top, preventing scroll jumps during refresh.
    return [...unseen, ...existing];
  }, []);

  const appendFederatedFeedItems = useCallback((current: any[], incoming: any[]) => {
    const seen = new Set(current.map(item => String(item?.uri ?? item?.object_url ?? item?.id ?? '')));
    const appended = incoming
      .filter(item => !item?.deleted_at && !item?.tombstone)
      .filter(item => {
        const key = String(item?.uri ?? item?.object_url ?? item?.id ?? '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return [...current, ...appended];
  }, []);

  const hydrateFederatedFeed = useCallback(async () => {
    // The database-backed federated_objects table is our durable local cache.
    // Never put the initial empty state behind a loading spinner.
    const { data: cached, error } = await supabase
      .from('federated_objects')
      .select('id,uri,object_type,actor_uri,url,content,summary,published_at,updated_at,sensitive,in_reply_to_uri,quote_uri,language_code,attachments,tags,like_count,announce_count,reply_count,quote_count,view_count,content_warning,raw_object')
      .is('deleted_at', null)
      .eq('tombstone', false)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(20);

    if (!error && cached && cached.length > 0) {
      setRemotePosts(cached);
      setCachedAt(new Date());
      setLoadingFeed(false);
    }

    // Revalidate silently after the cached copy has been painted.
    void refreshFederatedFeed();
  }, []);

  const refreshFederatedFeed = useCallback(async () => {
    // One reconciliation at a time. Realtime can emit bursts when several
    // federated rows arrive together; overlapping refreshes cause competing
    // React commits and visible scroll jitter on Android WebView.
    if (feedRefreshInFlightRef.current) return;
    feedRefreshInFlightRef.current = true;

    // This is intentionally not tied to loadingFeed. Existing cached content
    // must remain visible while the remote source is refreshed.
    setIsStale(true);

    try {
      const page = await federation.getFederatedTimelinePage({ limit: 20 });
      const fresh = Array.isArray(page?.items) ? page.items : [];
      const nextCursor = page?.pagination?.nextCursor ?? null;

      setFeedCursor(nextCursor);
      setHasMoreFeed(page?.pagination?.hasMore !== false && Boolean(nextCursor));

      if (fresh.length > 0) {
        setRemotePosts(prev => mergeFederatedFeedItems(prev, fresh));
        // Upsert is the cache replacement step: changed remote objects replace
        // their previous cached representation by canonical URI.
        void cacheFederatedPosts(fresh);
        setCachedAt(new Date());
      }
    } catch {
      // Cache remains the source of truth for the current render. A remote
      // failure must never clear already-visible federated posts.
    } finally {
      feedRefreshInFlightRef.current = false;
      setLoadingFeed(false);
      setIsStale(false);
    }
  }, [mergeFederatedFeedItems]);

  const loadMoreFederatedFeed = useCallback(async () => {
    if (loadingMoreFeed || !hasMoreFeed || !feedCursor) return;

    setLoadingMoreFeed(true);
    try {
      const page = await federation.getFederatedTimelinePage({
        limit: 20,
        before: feedCursor,
      });
      const items = Array.isArray(page?.items) ? page.items : [];
      const nextCursor = page?.pagination?.nextCursor ?? null;

      if (items.length > 0) {
        setRemotePosts(prev => appendFederatedFeedItems(prev, items));
        void cacheFederatedPosts(items);
        setCachedAt(new Date());
      }

      setFeedCursor(nextCursor);
      setHasMoreFeed(page?.pagination?.hasMore !== false && Boolean(nextCursor));
    } catch {
      // Keep already-rendered pages and allow a later intersection to retry.
    } finally {
      setLoadingMoreFeed(false);
    }
  }, [feedCursor, hasMoreFeed, loadingMoreFeed, appendFederatedFeedItems]);

  // Prefetch the next page before the reader reaches the bottom. The
  // IntersectionObserver is silent: only the small "loading more" affordance
  // at the feed boundary changes, never the whole feed.
  useEffect(() => {
    if (tab !== 'feed') return;
    const sentinel = feedSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) void loadMoreFederatedFeed();
      },
      { rootMargin: '500px 0px 500px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tab, loadMoreFederatedFeed]);

  const fetchFederationStats = async () => {
    if (!user) return;
    const [followingRes, followerRes] = await Promise.all([
      supabase.from('federated_follow_relationships').select('*').eq('local_user_id', user.id).eq('direction','following'),
      supabase.from('federated_follow_relationships').select('*').eq('local_user_id', user.id).eq('direction','follower'),
    ]);