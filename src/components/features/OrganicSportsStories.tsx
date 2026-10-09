import { useEffect, useState } from 'react';
import { Activity, ArrowRight, ExternalLink, Newspaper, Trophy } from 'lucide-react';
import { supabaseUrl } from '@/lib/supabase';

type SportsStory = {
  id: string;
  title: string;
  excerpt?: string | null;
  canonical_url: string;
  image_url?: string | null;
  published_at: string;
  category?: string | null;
  testagram_rss_source_profiles?: { display_name?: string | null } | null;
};

type ScoreMatch = { id: string; home: string; away: string; score: string; status: string; league: string };

type Props = {
  surface: 'home' | 'discover' | 'search';
  query?: string;
  limit?: number;
  compact?: boolean;
};

const SPORTS_QUERY = /\b(sport|sports|football|soccer|premier league|champions league|arsenal|chelsea|manchester|liverpool|real madrid|barcelona|cricket|rugby|basketball|nba|tennis|formula ?1|f1|athletics|olympics|score|scores|fixture|fixtures|transfer|transfers|goal|goals|league|afcon|epl|gor mahia|afc leopards|harambee stars|shabana|kenya premier league)\b/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function display(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const obj = record(value);
  if (!obj) return '';
  for (const key of ['name', 'shortName', 'title', 'displayName', 'score', 'text', 'value']) {
    const candidate = obj[key];
    if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
  }
  return '';
}
function flattenMatches(value: unknown): ScoreMatch[] {
  const root = record(value);
  if (!root) return [];
  const direct = root.matches ?? root.events ?? root.items;
  const values = Array.isArray(direct) ? direct : Array.isArray(root.leagues)
    ? root.leagues.flatMap(leagueValue => {
      const league = record(leagueValue);
      return Array.isArray(league?.matches) ? league.matches : [];
    }) : [];
  return values.slice(0, 5).map((value, index) => {
    const match = record(value) ?? {};
    const home = display(match.homeTeam ?? match.home ?? match.home_team ?? match.homeTeamName ?? match.home_name) || 'Home';
    const away = display(match.awayTeam ?? match.away ?? match.away_team ?? match.awayTeamName ?? match.away_name) || 'Away';
    const score = record(match.score);
    const homeScore = display(match.homeScore ?? match.home_score ?? match.homeGoals ?? score?.home);
    const awayScore = display(match.awayScore ?? match.away_score ?? match.awayGoals ?? score?.away);
    return {
      id: display(match.id ?? match.matchId ?? match.slug) || home + '-' + away + '-' + index,
      home,
      away,
      score: homeScore || awayScore ? (homeScore || '–') + ' : ' + (awayScore || '–') : '– : –',
      status: display(match.status ?? match.state ?? match.matchStatus ?? match.time ?? match.minute) || 'Fixture',
      league: display(match.league ?? match.competition ?? match.tournament) || 'Football',
    };
  });
}

function age(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 60 ? minutes + 'm ago' : minutes < 1440 ? Math.floor(minutes / 60) + 'h ago' : Math.floor(minutes / 1440) + 'd ago';
}

export function OrganicSportsStories({ surface, query = '', limit = 3, compact = false }: Props) {
  const [stories, setStories] = useState<SportsStory[]>([]);
  const [matches, setMatches] = useState<ScoreMatch[]>([]);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const relevant = surface !== 'search' || (query.trim().length > 0 && SPORTS_QUERY.test(query));

  useEffect(() => {
    if (!relevant) { setStories([]); setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(Math.min(8, Math.max(1, limit))), category: 'sports' });
    if (surface === 'search' && query.trim()) {
      const specificTerms = query.trim().toLowerCase()
        .split(/\s+/)
        .filter(term => !/^(the|and|in|on|for|sports?|football|soccer|cricket|rugby|basketball|nba|tennis|scores?|fixtures?|transfers?|results?|league|epl|afcon|athletics|olympics|news|latest|live)$/i.test(term))
        .join(' ')
        .slice(0, 100);
      if (specificTerms) params.set('q', specificTerms);
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(supabaseUrl + '/functions/v1/testagram-rss-feed?' + params.toString(), {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
      }).then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'Sports stories unavailable');
        if (active) setStories(Array.isArray(payload?.items) ? payload.items as SportsStory[] : []);
      }).catch((error: unknown) => {
        if (active && (error as { name?: string })?.name !== 'AbortError') setStories([]);
      }).finally(() => { if (active) setLoading(false); });
    }, surface === 'search' ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [surface, query, limit, relevant]);

  useEffect(() => {
    if (!relevant) { setMatches([]); setScoresLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    const loadScores = async () => {
      try {
        const response = await fetch('/api/sports?kind=matches&sport=football&limit=5', {
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Scores unavailable');
        if (active) setMatches(flattenMatches(payload.data));
      } catch (error: unknown) {
        if (active && (error as { name?: string })?.name !== 'AbortError') setMatches([]);
      } finally {
        if (active) setScoresLoading(false);
      }
    };
    setScoresLoading(true);
    void loadScores();
    const timer = window.setInterval(() => { void loadScores(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); controller.abort(); };
  }, [relevant]);

  if (!relevant || (!loading && stories.length === 0 && !scoresLoading && matches.length === 0)) return null;

  return (
    <section aria-label="Sports stories" className={compact ? 'my-3' : 'my-4'}>
      <div className="flex items-center justify-between gap-3 px-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary"><Trophy className="h-3.5 w-3.5" /> Sports in your feed</div>
          <h2 className="mt-1 text-lg font-bold">{surface === 'search' ? 'Sports stories matching your search' : surface === 'discover' ? 'Trending from the sports world' : 'Latest sports headlines'}</h2>
        </div>
        <a href="/sports" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">All sports <ArrowRight className="h-3.5 w-3.5" /></a>
      </div>
      {matches.length > 0 && (
        <div className="mb-3">
          <div className="mb-2 flex items-center gap-2 px-4 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Activity className="h-3.5 w-3.5 text-primary" /> Live & upcoming scores</div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2">
            {matches.slice(0, compact ? 4 : 5).map(match => (
              <article key={match.id} className="w-[min(76vw,280px)] shrink-0 rounded-xl border bg-card p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="truncate">{match.league}</span><span className="shrink-0">{match.status}</span></div>
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                  <span className="truncate font-semibold">{match.home}</span><span className="row-span-2 self-center rounded-md bg-muted px-2 py-1 font-black tabular-nums">{match.score}</span>
                  <span className="truncate font-semibold">{match.away}</span>
                </div>
              </article>
            ))}
          </div>
          <p className="px-4 pt-1 text-[10px] text-muted-foreground">Scores <a href="https://sportscore.com/" target="_blank" rel="noreferrer" className="font-semibold underline">Powered by SportScore</a>.</p>
        </div>
      )}
      {loading && stories.length === 0 ? (
        <div className="mx-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          {!compact && <div className="h-24 animate-pulse rounded-xl bg-muted" />}
        </div>
      ) : (
        <div className={compact ? 'flex gap-3 overflow-x-auto px-4 pb-2' : 'grid gap-3 px-4 sm:grid-cols-2'}>
          {stories.slice(0, limit).map(story => (
            <article key={story.id} className={compact ? 'w-[min(82vw,320px)] shrink-0 overflow-hidden rounded-xl border bg-card' : 'overflow-hidden rounded-xl border bg-card'}>
              {story.image_url && <img src={story.image_url} alt="" loading="lazy" decoding="async" className={compact ? 'h-28 w-full object-cover' : 'h-36 w-full object-cover'} />}
              <div className="p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Newspaper className="h-3 w-3 shrink-0" /><span className="truncate">{story.testagram_rss_source_profiles?.display_name || 'Sports publisher'}</span>{story.published_at && <><span>·</span><span className="shrink-0">{age(story.published_at)}</span></>}</div>
                <button type="button" aria-expanded={expandedStoryId === story.id} onClick={() => setExpandedStoryId(current => current === story.id ? null : story.id)} className="block w-full text-left text-sm font-bold leading-snug hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm">{story.title}</button>
                {expandedStoryId === story.id && (
                  <div className="mt-3 space-y-3 rounded-lg bg-muted/50 p-3">
                    <p className="text-xs leading-5 text-muted-foreground">{story.excerpt?.trim() || 'This sports headline has been shared by the publisher. The short preview is not available for this item.'}</p>
                    <p className="text-xs leading-5 text-muted-foreground">This is a summary preview from {story.testagram_rss_source_profiles?.display_name || 'the original publisher'}, not the complete report. Open the source link below for the full article and any further details or updates.</p>
                    <a href={story.canonical_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open original article <ExternalLink className="h-3 w-3" /></a>
                  </div>
                )}
                {expandedStoryId !== story.id && <button type="button" onClick={() => setExpandedStoryId(story.id)} className="mt-2 block text-xs font-semibold text-primary hover:underline">Read story here</button>}
                <a href={story.canonical_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary hover:underline">Original source link <ExternalLink className="h-3 w-3" /></a>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="px-4 pt-2 text-[10px] text-muted-foreground">Publisher headlines · Open the original report for full coverage.</p>
    </section>
  );
}
