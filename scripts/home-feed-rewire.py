from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'src/pages/HomePage.tsx'
text = HOME.read_text()
if 'const [federatedCursor' in text:
    raise SystemExit(0)

old = "  const [feedHasMore, setFeedHasMore] = useState(true);\n"
new = old + "  const [federatedCursor, setFederatedCursor] = useState<string | null>(null);\n  const [federatedHasMore, setFederatedHasMore] = useState(true);\n"
assert old in text
text = text.replace(old, new, 1)

start = text.index("  // ── Federated timeline via Gateway")
end = text.index("\n  // ── Local posts feed", start)
replacement = '''  // ── Federated timeline via Gateway ──────────────────────────────────────────
  const normalizeFederatedPosts = (posts: any[]): any[] => posts.map((p: any) => ({
    ...p,
    id: p.id ?? p.uri ?? p.url ?? `fed-${p.created_at ?? ''}-${p.content?.slice(0, 8) ?? ''}`,
    content: p.content ?? p.text ?? '',
    created_at: p.created_at ?? p.published ?? new Date().toISOString(),
    actor: p.actor ?? p.account ?? {},
  }));

  const fetchFederatedPage = async (before?: string | null): Promise<{ posts: any[]; nextCursor: string | null; hasMore: boolean }> => {
    try {
      const page = await federation.getFederatedTimelinePage({ limit: 12, before: before ?? undefined });
      const posts = normalizeFederatedPosts(page.items ?? []);
      cacheFederatedPosts(posts).catch(() => {});
      return { posts, nextCursor: page.pagination?.nextCursor ?? null, hasMore: page.pagination?.hasMore ?? posts.length >= 12 };
    } catch (err) {
      console.warn('[feed] federated page unavailable:', err);
      if (before) return { posts: [], nextCursor: null, hasMore: false };
      try {
        const { data } = await supabase.from('remote_posts').select('*, remote_accounts(username, domain, display_name, avatar_url)').order('published_at', { ascending: false }).limit(12);
        const posts = (data ?? []).map((p: any) => ({ ...p, id: p.id, content: p.content ?? '', created_at: p.published_at ?? p.created_at, actor: p.remote_accounts ?? {} }));
        return { posts, nextCursor: null, hasMore: false };
      } catch { return { posts: [], nextCursor: null, hasMore: false }; }
    }
  };

  const fetchFederatedPosts = async (): Promise<any[]> => (await fetchFederatedPage(null)).posts;

  const mixHomeDiscovery = (localItems: FeedItem[], federatedPosts: any[], pageNum: number): FeedItem[] => {
    const result = [...localItems];
    const seedBase = `${user?.id ?? 'anonymous'}:${pageNum}:${result.length}:${federatedPosts.length}`;
    let seed = 2166136261;
    for (let i = 0; i < seedBase.length; i++) seed = Math.imul(seed ^ seedBase.charCodeAt(i), 16777619);
    const random = () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const fed = [...federatedPosts].sort(() => random() - 0.5).map((post: any) => ({ type: 'fedpost' as const, data: post }));
    const fedTarget = Math.min(fed.length, Math.max(1, Math.round(Math.min(0.16, 0.08 + random() * 0.08) * Math.max(result.length, 1))));
    const usedPositions: number[] = [];
    for (let i = 0; i < fedTarget; i++) {
      if (!fed[i]) break;
      const min = Math.min(4, Math.max(1, result.length));
      const max = Math.max(min, result.length - 1);
      let pos = min + Math.floor(random() * (max - min + 1));
      while (usedPositions.includes(pos) && pos < max) pos++;
      usedPositions.push(pos); result.splice(Math.min(pos, result.length), 0, fed[i]);
    }
    const shouldSuggest = pageNum == 0 ? result.length >= 4 : random() < 0.35;
    if (shouldSuggest && result.length >= 4) {
      const min = 3, max = Math.max(min, result.length - 2);
      const pos = min + Math.floor(random() * (max - min + 1));
      result.splice(pos, 0, { type: 'user-suggestions', data: null });
    }
    return result;
  };
'''
text = text[:start] + replacement + text[end:]

old = "        // Who to follow — after 3rd item on first page\n        if (i === 2 && pageNum === 0 && !suggestionInserted) {\n          withExtras.push({ type: 'user-suggestions', data: null });\n          suggestionInserted = true;\n        }\n\n"
assert old in text
text = text.replace(old, '', 1).replace("      let suggestionInserted = false;\n", '', 1)

old = "    setFeedCursor(null);\n    setFeedHasMore(true);\n"
assert old in text
text = text.replace(old, old + "    setFederatedCursor(null);\n    setFederatedHasMore(true);\n", 1)

old = '''    } else {\n      const items = await fetchFeed(0);\n      setFeedItems(items);\n      const lastPost = items.filter((i: any) => i.type === 'post').slice(-1)[0];\n      if (lastPost) setFeedCursor((lastPost.data as any).created_at ?? null);\n      setFeedHasMore(items.filter((i: any) => i.type === 'post').length >= PAGE_SIZE);\n      // Populate prefetch cache for instant tab-switch on next visit\n      if (items.length > 0) setCachedFeed(activeTab, items);\n    }\n'''
new = '''    } else if (activeTab === 'foryou') {\n      const [localItems, federatedPage] = await Promise.all([fetchFeed(0), fetchFederatedPage(null)]);\n      const mixed = mixHomeDiscovery(localItems, federatedPage.posts, 0);\n      setFeedItems(mixed);\n      const localPosts = localItems.filter((i: any) => i.type === 'post');\n      const lastPost = localPosts.slice(-1)[0];\n      if (lastPost) setFeedCursor((lastPost.data as any).created_at ?? null);\n      setFederatedCursor(federatedPage.nextCursor);\n      setFederatedHasMore(federatedPage.hasMore);\n      setFeedHasMore(localPosts.length >= PAGE_SIZE || federatedPage.hasMore || federatedPage.posts.length > 0);\n      if (mixed.length > 0) setCachedFeed(activeTab, mixed);\n    } else {\n      const items = await fetchFeed(0);\n      setFeedItems(items);\n      const lastPost = items.filter((i: any) => i.type === 'post').slice(-1)[0];\n      if (lastPost) setFeedCursor((lastPost.data as any).created_at ?? null);\n      setFeedHasMore(items.filter((i: any) => i.type === 'post').length >= PAGE_SIZE);\n      if (items.length > 0) setCachedFeed(activeTab, items);\n    }\n'''
assert old in text
text = text.replace(old, new, 1)

start = text.index("  const loadMoreFeed = async (): Promise<boolean> =>")
end = text.index("\n\n  const { lastElementRef", start)
replacement = '''  const loadMoreFeed = async (): Promise<boolean> => {\n    if (!feedHasMore) return false;\n    const nextPage = page + 1;\n    if (activeTab === 'federated') {\n      const fedPage = await fetchFederatedPage(federatedCursor);\n      const incoming = fedPage.posts.map((post: any) => ({ type: 'fedpost' as const, data: post }));\n      if (incoming.length > 0) setFeedItems(prev => { const ids = new Set(prev.filter(i => i.type === 'fedpost').map(i => (i.data as any).id)); return [...prev, ...incoming.filter(i => !ids.has((i.data as any).id))]; });\n      setFederatedCursor(fedPage.nextCursor); setFederatedHasMore(fedPage.hasMore); setFeedHasMore(fedPage.hasMore); setPage(nextPage); return fedPage.hasMore;\n    }\n    if (activeTab === 'foryou') {\n      const [localItems, federatedPage] = await Promise.all([fetchFeed(nextPage), fetchFederatedPage(federatedCursor)]);\n      const mixed = mixHomeDiscovery(localItems, federatedPage.posts, nextPage);\n      const incomingLocalPosts = localItems.filter((i: any) => i.type === 'post');\n      const incomingFedPosts = mixed.filter((i: any) => i.type === 'fedpost');\n      if (mixed.length > 0) setFeedItems(prev => {\n        const localIds = new Set(prev.filter(i => i.type === 'post').map(i => (i.data as any).id));\n        const fedIds = new Set(prev.filter(i => i.type === 'fedpost').map(i => (i.data as any).id));\n        return [...prev, ...mixed.filter(i => i.type === 'post' ? !localIds.has((i.data as any).id) : i.type === 'fedpost' ? !fedIds.has((i.data as any).id) : true)];\n      });\n      if (incomingLocalPosts.length > 0) setFeedCursor((incomingLocalPosts.slice(-1)[0].data as any).created_at ?? null);\n      setFederatedCursor(federatedPage.nextCursor); setFederatedHasMore(federatedPage.hasMore);\n      const hasMore = incomingLocalPosts.length >= PAGE_SIZE || federatedPage.hasMore || incomingFedPosts.length > 0;\n      setPage(nextPage); setFeedHasMore(hasMore); return hasMore;\n    }\n    const newItems = await fetchFeed(nextPage);\n    const newPosts = newItems.filter((i: any) => i.type === 'post');\n    if (newPosts.length > 0) {\n      setFeedItems(prev => { const ids = new Set(prev.filter((i: any) => i.type === 'post').map((i: any) => (i.data as any).id)); return [...prev, ...newItems.filter((i: any) => i.type !== 'post' || !ids.has((i.data as any).id))]; });\n      setPage(nextPage); setFeedCursor((newPosts.slice(-1)[0].data as any).created_at ?? null);\n      const hasMore = newPosts.length >= PAGE_SIZE; setFeedHasMore(hasMore); return hasMore;\n    }\n    setFeedHasMore(false); return false;\n  };\n'''
text = text[:start] + replacement + text[end:]
HOME.write_text(text)

if __import__('os').environ.get('GITHUB_ACTIONS') == 'true':
    subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=ROOT, check=True)
    subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=ROOT, check=True)
    subprocess.run(['git', 'add', 'src/pages/HomePage.tsx'], cwd=ROOT, check=True)
    subprocess.run(['git', 'commit', '-m', 'feat: mix federated discovery into home infinite feed'], cwd=ROOT, check=True)
    subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=ROOT, check=True)
