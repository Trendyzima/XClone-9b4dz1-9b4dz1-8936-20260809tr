import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { backendCapabilities } from '@/services/testagramCapabilityClient';
import { TopBar } from '@/components/layout/TopBar';
import { useSEO } from '@/hooks/useSEO';
import { formatNumber } from '@/lib/utils';
import {
  Trophy, Search, Clock, Users, Gift, Flame, Loader2, Hash, ChevronDown,
  AlertCircle, CalendarDays,
} from 'lucide-react';
import { formatDistanceToNow, isPast, format } from 'date-fns';
import { toast } from 'sonner';
import { PageAdBanner } from '@/components/features/AdSenseAd';

function ChallengeLeaderboardAdBanner() { return <PageAdBanner />; }

// Module-level constants — esbuild-safe (no as const in render scope)
const SEARCH_DEBOUNCE_MS = 350;
const CHALLENGES_PER_PAGE = 12;
const CHALLENGE_SORT_LABELS = [
  { key: 'entry_count', label: '🔥 Most Popular' },
  { key: 'end_date',    label: '⏰ Ending Soon'  },
  { key: 'created_at', label: '✨ Newest'         },
] as const;
type ChallengeSortKey = typeof CHALLENGE_SORT_LABELS[number]['key'];

const PODIUM_MEDALS = ['🥇', '🥈', '🥉'] as const;

export default function ChallengeLeaderboardPage() {
  const navigate = useNavigate();

  const [challenges, setChallenges] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query,   setQuery]   = useState('');
  const [sortKey, setSortKey] = useState<ChallengeSortKey>('entry_count');
  const [page,    setPage]    = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useSEO({
    title: 'Challenge Leaderboard — Testagram',
    description: 'Browse and join the hottest hashtag challenges on Testagram. Compete for prizes and grow your audience.',
    url: '/leaderboard/challenges',
    keywords: 'hashtag challenges, leaderboard, contests, testagram, prizes',
  });

  const fetchChallenges = useCallback(async (q: string, sort: ChallengeSortKey, p: number) => {
    if (p === 0) setLoading(true); else setLoadingMore(true);
    try {
      const result = await backendCapabilities.listHashtagChallenges(100);
      const normalizedQuery = q.trim().toLowerCase();
      const filtered = (result.items ?? []).filter((challenge: any) => {
        if (!challenge.is_active) return false;
        if (!normalizedQuery) return true;
        const tag = typeof challenge.hashtags === 'object' ? challenge.hashtags?.tag : challenge.hashtag;
        return String(challenge.title ?? '').toLowerCase().includes(normalizedQuery)
          || String(challenge.description ?? '').toLowerCase().includes(normalizedQuery)
          || String(tag ?? '').toLowerCase().includes(normalizedQuery);
      });
      const sorted = [...filtered].sort((left: any, right: any) => {
        if (sort === 'entry_count') return Number(right.entry_count ?? 0) - Number(left.entry_count ?? 0);
        if (sort === 'end_date') return new Date(left.end_date).getTime() - new Date(right.end_date).getTime();
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      });
      const start = p * CHALLENGES_PER_PAGE;
      const pageItems = sorted.slice(start, start + CHALLENGES_PER_PAGE);
      setChallenges(previous => p === 0 ? pageItems : [...previous, ...pageItems]);
      setHasMore(start + CHALLENGES_PER_PAGE < sorted.length);
      setPage(p);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load challenges');
    } finally {
      if (p === 0) setLoading(false); else setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenges(query, sortKey, 0);
  }, [sortKey]);

  const handleSearch = (val: string) => {
    setQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => fetchChallenges(val, sortKey, 0), SEARCH_DEBOUNCE_MS);
  };

  const getTimeLeft = (endDate: string) => {
    if (!endDate || isPast(new Date(endDate))) return null;
    return formatDistanceToNow(new Date(endDate), { addSuffix: false });
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Challenge Leaderboard" showBack />
      <ChallengeLeaderboardAdBanner />

      {/* ── Hero ── */}
      <div className="bg-gradient-to-br from-primary/8 via-background to-purple-500/5 border-b border-border px-4 py-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center shrink-0">
            <Trophy className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-black">Hashtag Challenges</h1>
            <p className="text-sm text-muted-foreground">Compete, create, and win prizes</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search challenges…"
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Sort controls */}
        <div className="flex gap-1.5">
          {CHALLENGE_SORT_LABELS.map(s => (
            <button key={s.key} onClick={() => setSortKey(s.key)}
              className={`flex-1 py-1.5 rounded-xl text-xs font-bold transition-all ${
                sortKey === s.key
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Top-3 Podium (visible without search) ── */}
      {!query.trim() && !loading && challenges.slice(0, 3).length === 3 && (
        <div className="grid grid-cols-3 gap-2 px-4 py-4 bg-gradient-to-b from-primary/5 to-transparent border-b border-border">
          {challenges.slice(0, 3).map((c: any, i: number) => (
            <button key={c.id} onClick={() => navigate(`/challenge/${c.id}`)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-2xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-all text-center">
              <span className="text-2xl">{PODIUM_MEDALS[i]}</span>
              <p className="text-xs font-bold leading-tight line-clamp-2">{c.title}</p>
              {c.hashtags?.tag && (
                <span className="text-[10px] text-primary font-semibold">#{c.hashtags.tag}</span>
              )}
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-semibold">
                <Users className="w-3 h-3" />{formatNumber(c.entry_count ?? 0)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Full List ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : challenges.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground px-6">
          <Trophy className="w-14 h-14 mx-auto mb-3 opacity-20" />
          <p className="font-semibold">No challenges found</p>
          {query && <p className="text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {challenges.map((c: any, idx: number) => {
            const tag = c.hashtags?.tag ?? '';
            const timeLeft = getTimeLeft(c.end_date);
            const expired = !c.end_date || isPast(new Date(c.end_date));
            return (
              <div key={c.id} className="p-4 hover:bg-muted/15 transition-colors">
                <div className="flex items-start gap-3">
                  {/* Rank badge */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-black text-sm ${
                    idx === 0 ? 'bg-yellow-500/20 text-yellow-600' :
                    idx === 1 ? 'bg-slate-400/20 text-slate-500' :
                    idx === 2 ? 'bg-amber-600/20 text-amber-700' :
                    'bg-muted text-muted-foreground text-xs'
                  }`}>
                    {idx < 3 ? PODIUM_MEDALS[idx] : `#${idx + 1}`}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p className="font-bold text-sm leading-snug">{c.title}</p>
                        {tag && (
                          <button
                            onClick={e => { e.stopPropagation(); navigate(`/hashtag/${tag}`); }}
                            className="text-primary text-xs font-semibold hover:underline flex items-center gap-0.5 mt-0.5">
                            <Hash className="w-3 h-3" />#{tag}
                          </button>
                        )}
                      </div>
                      {/* Status chip */}
                      {expired ? (
                        <span className="shrink-0 flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-bold">
                          <AlertCircle className="w-2.5 h-2.5" />Ended
                        </span>
                      ) : timeLeft ? (
                        <span className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 border border-orange-500/20 font-bold">
                          <Clock className="w-2.5 h-2.5" />{timeLeft} left
                        </span>
                      ) : (
                        <span className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Live
                        </span>
                      )}
                    </div>

                    {c.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{c.description}</p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-2 flex-wrap mb-2.5">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
                        <Users className="w-3.5 h-3.5" />{formatNumber(c.entry_count ?? 0)} entries
                      </span>
                      {c.prize && (
                        <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-semibold">
                          <Gift className="w-3 h-3" />{c.prize}
                        </span>
                      )}
                      {c.end_date && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <CalendarDays className="w-3 h-3" />
                          {expired ? 'Ended ' : 'Ends '}
                          {format(new Date(c.end_date), 'MMM d')}
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/challenge/${c.id}`)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                          expired
                            ? 'bg-muted text-foreground hover:bg-muted/80'
                            : 'bg-primary text-primary-foreground hover:opacity-90'
                        }`}>
                        <Flame className="w-3.5 h-3.5" />
                        {expired ? 'View Results' : 'Join Challenge'}
                      </button>
                      {tag && (
                        <button
                          onClick={() => navigate(`/hashtag/${tag}`)}
                          className="px-3 py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors flex items-center gap-1">
                          <Hash className="w-3 h-3" />Feed
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center py-6">
              <button
                onClick={() => fetchChallenges(query, sortKey, page + 1)}
                disabled={loadingMore}
                className="flex items-center gap-2 px-5 py-2.5 border border-border rounded-full text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50">
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                {loadingMore ? 'Loading…' : 'Load more challenges'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
