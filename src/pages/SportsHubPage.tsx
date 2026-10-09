import { useCallback, useEffect, useState } from 'react';
import { Activity, ExternalLink, Loader2, Newspaper, RefreshCw, Trophy } from 'lucide-react';
import { supabaseUrl } from '@/lib/supabase';

type Match = Record<string, unknown>;
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

const SPORTS = [
  { value: 'football', label: 'Football' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'cricket', label: 'Cricket' },
  { value: 'tennis', label: 'Tennis' },
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const obj = record(value);
  if (!obj) return '';
  for (const key of ['name', 'title', 'shortName', 'displayName', 'score', 'text', 'value']) {
    const found = obj[key];
    if (typeof found === 'string' || typeof found === 'number') return String(found);
  }
  return '';
}
function first(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
}
function flattenMatches(data: unknown): Match[] {
  const root = record(data);
  if (!root) return [];
  const direct = first(root, ['matches', 'events', 'items']);
  if (Array.isArray(direct)) return direct.map(record).filter((item): item is Match => Boolean(item));
  const leagues = root.leagues;
  if (Array.isArray(leagues)) {
    return leagues.flatMap(value => {
      const league = record(value);
      return Array.isArray(league?.matches) ? league.matches.map(record).filter((item): item is Match => Boolean(item)) : [];
    });
  }
  return [];
}
function matchTeam(match: Match, side: 'home' | 'away'): string {
  const value = first(match, side === 'home'
    ? ['homeTeam', 'home', 'home_team', 'homeTeamName', 'home_name']
    : ['awayTeam', 'away', 'away_team', 'awayTeamName', 'away_name']);
  return text(value) || (side === 'home' ? 'Home' : 'Away');
}
function matchScore(match: Match, side: 'home' | 'away'): string {
  const value = first(match, side === 'home'
    ? ['homeScore', 'home_score', 'homeGoals']
    : ['awayScore', 'away_score', 'awayGoals']);
  if (value !== undefined) return text(value);
  const score = record(match.score);
  return score ? text(score[side]) : '';
}
function age(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 60 ? minutes + 'm ago' : Math.floor(minutes / 60) + 'h ago';
}

export default function SportsHubPage() {
  const [sport, setSport] = useState('football');
  const [matches, setMatches] = useState<Match[]>([]);
  const [stories, setStories] = useState<SportsStory[]>([]);
  const [scoresLoading, setScoresLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scoresError, setScoresError] = useState('');
  const [storiesError, setStoriesError] = useState('');

  const loadScores = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setScoresLoading(true);
    setScoresError('');
    try {
      const response = await fetch('/api/sports?kind=matches&sport=' + encodeURIComponent(sport) + '&limit=30', {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Scores are temporarily unavailable');
      setMatches(flattenMatches(payload.data));
    } catch (error) {
      setScoresError(error instanceof Error ? error.message : 'Scores are temporarily unavailable');
      setMatches([]);
    } finally {
      setScoresLoading(false);
      setRefreshing(false);
    }
  }, [sport]);

  const loadStories = useCallback(async () => {
    setStoriesLoading(true);
    setStoriesError('');
    try {
      const response = await fetch(supabaseUrl + '/functions/v1/testagram-rss-feed?limit=20&category=sports', {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Sports headlines are temporarily unavailable');
      setStories(Array.isArray(payload?.items) ? payload.items as SportsStory[] : []);
    } catch (error) {
      setStoriesError(error instanceof Error ? error.message : 'Sports headlines are temporarily unavailable');
      setStories([]);
    } finally {
      setStoriesLoading(false);
    }
  }, []);

  useEffect(() => { void loadScores(); }, [loadScores]);
  useEffect(() => { void loadStories(); }, [loadStories]);

  useEffect(() => {
    document.title = 'Sports Hub — Testagram';
    const timer = window.setInterval(() => { void loadScores(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadScores]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <header className="mb-6 overflow-hidden rounded-3xl border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Trophy className="h-4 w-4" /> TESTAGRAM SPORTS</div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">The game, as it happens.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Live and recent scores alongside fresh sports headlines, in one lightweight feed.</p>
            </div>
            <button type="button" onClick={() => { void loadScores(true); void loadStories(); }} className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-accent" disabled={refreshing}>
              <RefreshCw className={'h-4 w-4 ' + (refreshing ? 'animate-spin' : '')} /> Refresh
            </button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" aria-label="Choose sport">
            {SPORTS.map(option => <button key={option.value} type="button" onClick={() => setSport(option.value)} aria-pressed={sport === option.value} className={'rounded-full px-4 py-2 text-sm font-semibold transition ' + (sport === option.value ? 'bg-primary text-primary-foreground' : 'border hover:bg-accent')}>
              {option.label}
            </button>)}
          </div>
        </header>

        <section className="mb-8" aria-labelledby="sports-scores-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="sports-scores-heading" className="flex items-center gap-2 text-xl font-bold"><Activity className="h-5 w-5 text-primary" /> Scores & fixtures</h2>
            <span className="text-xs text-muted-foreground">Auto-refreshes every minute</span>
          </div>
          {scoresLoading ? <div className="flex items-center gap-2 rounded-2xl border p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading scores…</div>
            : scoresError ? <div className="rounded-2xl border p-5 text-sm text-muted-foreground">{scoresError} <button type="button" className="ml-2 underline" onClick={() => void loadScores(true)}>Try again</button></div>
            : matches.length === 0 ? <div className="rounded-2xl border p-5 text-sm text-muted-foreground">No score entries are available right now. Try another sport or refresh shortly.</div>
            : <div className="grid gap-3 sm:grid-cols-2">
              {matches.map((match, index) => {
                const home = matchTeam(match, 'home');
                const away = matchTeam(match, 'away');
                const status = text(first(match, ['status', 'state', 'matchStatus', 'time', 'minute']));
                const league = text(first(match, ['league', 'competition', 'tournament']));
                const id = text(first(match, ['id', 'matchId', 'slug'])) || home + '-' + away + '-' + index;
                return <article key={id} className="rounded-2xl border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span className="truncate">{league || sport.charAt(0).toUpperCase() + sport.slice(1)}</span><span className="shrink-0">{status || 'Match'}</span></div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm font-semibold">
                    <span className="truncate">{home}</span>
                    <span className="rounded-lg bg-muted px-3 py-2 text-base font-black tabular-nums">{matchScore(match, 'home') || '–'} : {matchScore(match, 'away') || '–'}</span>
                    <span className="truncate text-right">{away}</span>
                  </div>
                </article>;
              })}
            </div>}
          <p className="mt-3 text-xs text-muted-foreground">Scores: <a href="https://sportscore.com/" target="_blank" rel="noreferrer" className="font-semibold underline">Powered by SportScore</a>.</p>
        </section>

        <section aria-labelledby="sports-news-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="sports-news-heading" className="flex items-center gap-2 text-xl font-bold"><Newspaper className="h-5 w-5 text-primary" /> Latest sports headlines</h2>
            <span className="text-xs text-muted-foreground">Imported publisher feeds</span>
          </div>
          {storiesLoading ? <div className="flex items-center gap-2 rounded-2xl border p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading headlines…</div>
            : storiesError ? <div className="rounded-2xl border p-5 text-sm text-muted-foreground">{storiesError} <button type="button" className="ml-2 underline" onClick={() => void loadStories()}>Try again</button></div>
            : stories.length === 0 ? <div className="rounded-2xl border p-5 text-sm text-muted-foreground">No recent sports headlines yet. The publisher feed will populate as scheduled ingestion runs.</div>
            : <div className="grid gap-4 sm:grid-cols-2">
              {stories.map(story => <article key={story.id} className="overflow-hidden rounded-2xl border bg-card">
                {story.image_url ? <img src={story.image_url} alt="" loading="lazy" className="h-44 w-full object-cover" /> : null}
                <div className="p-4">
                  <div className="mb-2 text-xs text-muted-foreground">{story.testagram_rss_source_profiles?.display_name || 'Sports publisher'} · {age(story.published_at)}</div>
                  <h3 className="font-bold leading-snug">{story.title}</h3>
                  {story.excerpt ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{story.excerpt}</p> : null}
                  <a href={story.canonical_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Read at source <ExternalLink className="h-3.5 w-3.5" /></a>
                </div>
              </article>)}
            </div>}
        </section>
      </div>
    </main>
  );
}
